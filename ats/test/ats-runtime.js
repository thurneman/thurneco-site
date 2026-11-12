/*
 * ats-runtime.js
 * Datalager som låter ATS Filip och ATS Tomas köras som statiska sidor mot Supabase (Postgres)
 * utan att sidornas logik skrivs om. Definierar window.claude = { use(name) } med db, user och assets
 * i samma form som artefaktplattformens kapabiliteter (Firestore-liknande dokument och samlingar).
 *
 * Konfiguration läses från window.ATS_CONFIG (config.js), inga nycklar finns i den här filen:
 *   SUPABASE_URL   projektets adress
 *   SUPABASE_KEY   publik (publishable) nyckel
 *   VY             "agare" (läser bastabellerna) eller "partner" (läser v_*-vyerna)
 *   Valfritt: EGNA_BESTALLARNYCKLAR (äldre beställar-id som räknas som den inloggades eget dokument
 *   i kontaktbestallningar), CV_BUCKET (standard "cv"), OMHAMTNING_MS (standard 60000),
 *   OMHAMTNING_VY_MS (standard 30000).
 *
 * Fältmappningen är inversen av importskriptet generera_sql.py, se README.md.
 */
(function () {
  "use strict";

  // ===================== Konfiguration =====================
  var CFG = window.ATS_CONFIG || {};
  var SUPABASE_URL = String(CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var SUPABASE_KEY = String(CFG.SUPABASE_KEY || "");
  var VY = CFG.VY === "partner" ? "partner" : CFG.VY === "agare" ? "agare" : null;
  var PARTNER = VY === "partner";
  var POLL_MS = +CFG.OMHAMTNING_MS > 0 ? +CFG.OMHAMTNING_MS : 60000;
  var POLL_VY_MS = +CFG.OMHAMTNING_VY_MS > 0 ? +CFG.OMHAMTNING_VY_MS : 30000;
  var CV_BUCKET = CFG.CV_BUCKET || "cv";
  var EXTRA_SELF_KEYS = (Array.isArray(CFG.EGNA_BESTALLARNYCKLAR) ? CFG.EGNA_BESTALLARNYCKLAR : [])
    .map(function (x) { return String(x || "").trim(); }).filter(Boolean);
  var PAGE = 1000;   // PostgREST:s standardtak per svar i Supabase
  var IN_CHUNK = 50; // id per in-fråga

  var html = document.documentElement;
  var sb = null;

  // ===================== Små hjälpare =====================
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
  var isDel = function (v) { return isObj(v) && v.__delete__ === true && Object.keys(v).length === 1; };
  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (var k in o) if (hasOwn(o, k)) deepFreeze(o[k]);
    }
    return o;
  }
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function stripDeletes(v) {
    if (!isObj(v)) return clone(v);
    var out = {};
    for (var k in v) if (hasOwn(v, k) && !isDel(v[k])) out[k] = stripDeletes(v[k]);
    return out;
  }
  // update-semantik: objekt slås ihop rekursivt, allt annat (listor också) ersätts, {"__delete__":true} tar bort fältet
  function applyPatch(base, patch) {
    var out = Object.assign({}, base || {});
    for (var k in patch) {
      if (!hasOwn(patch, k)) continue;
      var v = patch[k];
      if (v === undefined) continue;
      if (isDel(v)) delete out[k];
      else if (isObj(v) && isObj(out[k])) out[k] = applyPatch(out[k], v);
      else out[k] = stripDeletes(v);
    }
    return out;
  }
  function dbErr(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function pgErr(error, status) {
    var msg = (error && (error.message || error.details)) || "databasfel";
    var c = error && error.code;
    if (!status || status >= 500 || /Failed to fetch|NetworkError|network/i.test(msg)) return dbErr("unavailable", msg);
    if (c === "PGRST116") return dbErr("invalid_argument", msg);
    return dbErr("invalid_argument", msg + (c ? " (" + c + ")" : ""));
  }
  async function q(promise) {
    var r = await promise;
    if (r.error) throw pgErr(r.error, r.status);
    return r.data;
  }
  var ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
  function tsParse(v) {
    if (typeof v !== "string") return null;
    var s = v.trim();
    if (!ISO_RE.test(s)) return null;
    var d = new Date(s.length === 10 ? s + "T00:00:00Z" : s.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : s;
  }
  function tsOut(v) {
    if (v === null || v === undefined) return undefined;
    var d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toISOString();
  }
  var tsLossless = function (v) { var p = tsParse(v); return !!p && tsOut(p) === v; };
  function txt(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  function randId(n) {
    var a = new Uint8Array(n || 10), s = "", abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += abc[a[i] % abc.length];
    return s;
  }
  var SEG_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  function checkPath(path, wantEven) {
    if (typeof path !== "string" || !path) throw new TypeError("Ogiltig sökväg: tom");
    var segs = path.split("/");
    if (segs.length > 16 || path.length > 1000) throw new TypeError("Ogiltig sökväg: för lång");
    segs.forEach(function (s) { if (!SEG_RE.test(s) || s === "." || s === "..") throw new TypeError("Ogiltig sökväg: segmentet '" + s + "'"); });
    if ((segs.length % 2 === 0) !== wantEven) throw new TypeError("Ogiltig sökväg: " + segs.length + " segment");
    return segs;
  }

  // ===================== Fältmappning (invers av generera_sql.py) =====================
  // Typer: t text, ts timestamptz, j jsonb, jl jsonb-lista, jd jsonb-objekt, a text[], b boolean, i int, n numeric
  var M = function (pairs) { var o = {}; pairs.trim().split(/\s+/).forEach(function (p) { var x = p.split(":"); o[x[0]] = [x[1], x[2]]; }); return o; };
  var MAP = {
    roles: M("ref:t:ref rawRef:t:raw_ref type:t:type source:t:source status:t:status title:t:title rawTitle:t:raw_title " +
      "location:t:location category:t:category customer:t:customer deadline:t:deadline deadlineStatus:t:deadline_status " +
      "deadlineSattAt:ts:deadline_satt_at deadlineKalla:t:deadline_kalla deadlineAntagen:t:deadline_antagen prio:t:prio prioReason:t:prio_reason insats:jl:insats " +
      "facts:jd:facts brief:t:brief notes:t:notes kravVersion:i:krav_version inmail:j:inmail go:j:go triage:j:triage " +
      "miniwave:j:miniwave uppdateringar:jl:uppdateringar relatedRoles:a:related_roles delad:a:delad published:b:published " +
      "talendaryProjectId:t:talendary_project_id recruiterProjekt:j:recruiter_projekt partnerAnteckning:j:partner_anteckning " +
      "createdAt:ts:created_at updatedAt:ts:updated_at"),
    candidates: M("name:t:name email:t:email phone:t:phone linkedin:t:linkedin recruiterUrl:t:recruiter_url cv:t:cv note:t:note " +
      "source:t:source kalla:t:kalla bolagsform:t:bolagsform timpris:t:timpris tillganglig:t:tillganglig nastaKontakt:t:nasta_kontakt " +
      "kontaktstopp:b:kontaktstopp dismissed:b:dismissed createdAt:ts:created_at updatedAt:ts:updated_at"),
    matches: M("roleId:t:role_id candId:t:cand_id candName:t:cand_name stage:t:stage stageAt:ts:stage_at stageVia:t:stage_via " +
      "stageAv:t:stage_av result:t:result nextStep:t:next_step nextAt:t:next_at score:n:score level:t:level kravstatus:t:kravstatus " +
      "belagt:jl:belagt saknas:jl:saknas verifiera:jl:verifiera praktiskt:t:praktiskt praktisktStatus:t:praktiskt_status " +
      "rekommendation:t:rekommendation dismissed:b:dismissed preliminar:b:preliminar spets:b:spets svar:j:svar kalibrering:t:kalibrering " +
      "kundsvar:j:kundsvar partnerBedomning:j:partner_bedomning recruiterSpeglat:j:recruiter_speglat source:t:source runAt:ts:run_at " +
      "runBy:t:run_by createdAt:ts:created_at updatedAt:ts:updated_at"),
    ko: M("chatt:t:chatt typ:t:typ prio:t:prio status:t:status roleIds:a:role_ids go:t:go prompt:t:prompt resultat:t:resultat " +
      "utkast:j:utkast delar:j:delar bestallningar:j:bestallningar sourceMailId:t:source_mail_id batchId:t:batch_id " +
      "skapadAt:ts:skapad_at skapadAv:t:skapad_av klarAt:ts:klar_at createdAt:ts:created_at updatedAt:ts:updated_at"),
    kontaktbestallningar: M("roleId:t:role_id candId:t:cand_id candName:t:cand_name matchId:t:match_id bestallareNamn:t:bestallare_namn " +
      "status:t:status statusAt:ts:status_at statusAv:t:status_av instruktion:t:instruktion konto:t:konto kravGodkannande:b:krav_godkannande " +
      "go:j:go kvittens:t:kvittens fel:t:fel kalla:t:kalla kallaDoc:t:kalla_doc koId:t:ko_id svarAt:ts:svar_at svarTolkning:t:svar_tolkning at:ts:at"),
    korgodkannanden: M("beslut:t:beslut fingerprint:t:fingerprint chatt:t:chatt typ:t:typ begaran:b:begaran koStatusVid:t:ko_status_vid " +
      "historik:jl:historik skrivetAv:t:skrivet_av at:ts:at")
  };
  var OPTIONAL_COLS = { created_at: 1, updated_at: 1 };   // utelämnas när fältet saknas, så databasens värde står kvar

  // Ett dokumentvärde till kolumnvärde. keep=true betyder att originalet också sparas i extra (ingen förlust vid återläsning).
  function enc(type, v) {
    if (v === undefined || v === null) {
      if (type === "jl" || type === "a") return { v: [], keep: false };
      if (type === "jd") return { v: {}, keep: false };
      return { v: null, keep: false };
    }
    switch (type) {
      case "t": return { v: txt(v), keep: typeof v !== "string" };
      case "ts": { var p = tsParse(v); return { v: p, keep: !p || tsOut(p) !== v }; }
      case "j": return { v: v, keep: false };
      case "jl": return Array.isArray(v) ? { v: v, keep: false } : { v: [v], keep: true };
      case "jd": return isObj(v) ? { v: v, keep: false } : { v: {}, keep: true };
      case "a":
        if (!Array.isArray(v)) return { v: [txt(v)], keep: true };
        return { v: v.map(function (x) { return typeof x === "string" ? x : JSON.stringify(x); }), keep: v.some(function (x) { return typeof x !== "string"; }) };
      case "b": return typeof v === "boolean" ? { v: v, keep: false } : { v: null, keep: true };
      case "i": return (typeof v === "number" && Number.isInteger(v)) ? { v: v, keep: false } : { v: null, keep: true };
      case "n": return (typeof v === "number" && isFinite(v)) ? { v: v, keep: false } : { v: null, keep: true };
    }
    return { v: v, keep: false };
  }
  function dec(type, v) {
    if (v === null || v === undefined) return undefined;
    if (type === "ts") return tsOut(v);
    return v;
  }
  // Dokument till rad för tabeller med fasta kolumner + extra
  function mappedRow(table, id, doc, skip) {
    var map = MAP[table], row = {}, extra = {};
    if (id !== null) row.id = id;
    for (var f in map) {
      var type = map[f][0], col = map[f][1];
      var has = hasOwn(doc, f) && doc[f] !== undefined;
      if (OPTIONAL_COLS[col] && !has) continue;
      var e = enc(type, has ? doc[f] : undefined);
      row[col] = e.v;
      if (has && e.keep) extra[f] = doc[f];
    }
    for (var k in doc) {
      if (!hasOwn(doc, k) || hasOwn(map, k) || k === "id" || k === "version" || doc[k] === undefined) continue;
      if (skip && skip[k]) continue;
      extra[k] = doc[k];
    }
    row.extra = extra;
    return row;
  }
  function mappedDoc(table, row, noExtra) {
    var map = MAP[table], doc = {};
    for (var f in map) {
      var col = map[f][1];
      if (!hasOwn(row, col)) continue;
      var v = dec(map[f][0], row[col]);
      if (v !== undefined) doc[f] = v;
    }
    if (!noExtra && isObj(row.extra)) for (var k in row.extra) if (hasOwn(row.extra, k)) doc[k] = row.extra[k];
    return doc;
  }
  function diffCols(oldRow, newRow) {
    var out = {}, n = 0;
    for (var c in newRow) {
      if (!hasOwn(newRow, c) || c === "id") continue;
      if (!hasOwn(oldRow, c) || stable(oldRow[c]) !== stable(newRow[c])) { out[c] = newRow[c]; n++; }
    }
    return n ? out : null;
  }

  // ---- roles, candidates, matches, ko ----
  function rowRoles(id, d) { return mappedRow("roles", id, d); }
  function rowMatches(id, d) { return mappedRow("matches", id, d); }
  function rowCandidates(id, d) {
    var row = mappedRow("candidates", id, d, { kontakter: 1 });
    if (typeof d.name !== "string" || !d.name.trim()) {
      row.name = id;
      if (d.name !== undefined && d.name !== null) row.extra.name = d.name;
      else delete row.extra.name;
    }
    if (d.kontakter !== undefined && d.kontakter !== null && !Array.isArray(d.kontakter)) row.extra.kontakter = d.kontakter;
    return row;
  }
  function rowKo(id, d) {
    var dd = d, goObj = null;
    if (isObj(d.go)) { goObj = d.go; dd = Object.assign({}, d); delete dd.go; }
    var row = mappedRow("ko", id, dd);
    if (goObj) { row.go = JSON.stringify(goObj); row.extra.goObjekt = goObj; }
    return row;
  }
  function docKo(row) {
    var d = mappedDoc("ko", row);
    if (hasOwn(d, "goObjekt")) { d.go = d.goObjekt; delete d.goObjekt; }
    return d;
  }

  // ---- kontakter (egen tabell, sätts ihop till candidates[].kontakter) ----
  function kontaktRow(candId, p) {
    if (!isObj(p)) p = { varde: p };
    var extra = {}, row = { cand_id: candId, role_id: null, at: null, kanal: null, riktning: null, text: null, av: null };
    for (var k in p) {
      if (!hasOwn(p, k) || p[k] === undefined) continue;
      var v = p[k];
      if (k === "roleId") { if (v === "" || v === null) { if (v === "") extra.roleId = ""; } else { row.role_id = txt(v); if (typeof v !== "string") extra.roleId = v; } }
      else if (k === "at") { var t = tsParse(v); row.at = t; if (v !== null && (!t || tsOut(t) !== v)) extra.at = v; }
      else if (k === "kanal" || k === "riktning" || k === "text" || k === "av") { row[k] = txt(v); if (v !== null && typeof v !== "string") extra[k] = v; }
      else extra[k] = v;
    }
    row.extra = extra;
    return row;
  }
  function kontaktDoc(r) {
    var rec = isObj(r.extra) ? Object.assign({}, r.extra) : {};
    ["kanal", "text", "riktning", "av"].forEach(function (c) { if (r[c] !== null && r[c] !== undefined && !hasOwn(rec, c)) rec[c] = r[c]; });
    if (r.role_id !== null && r.role_id !== undefined && !hasOwn(rec, "roleId")) rec.roleId = r.role_id;
    if (!hasOwn(rec, "at") && r.at) rec.at = tsOut(r.at);
    return rec;
  }
  function sortKontakter(rows) {
    return rows.slice().sort(function (a, b) {
      var x = a.at ? new Date(a.at).getTime() : Infinity, y = b.at ? new Date(b.at).getTime() : Infinity;
      if (x !== y) return x < y ? -1 : 1;
      return (+a.id || 0) - (+b.id || 0);
    });
  }
  // jämförelseform för en kontaktpost, så som den läses tillbaka
  var kontaktKey = function (p) { var r = kontaktRow("x", p); r.at = r.at ? tsOut(r.at) : null; return stable(kontaktDoc(r)); };

  // ---- generiska tabeller: kolumner för sökning, hela dokumentet i data ----
  var GENERIC = ["atgarder", "forslag", "pingar", "matchbegaran", "bedomningar", "andringar", "searchbegaran", "egna", "cv_uppladdningar", "kommentarer", "kontaktuppgifter", "partnersvar", "foretag", "foretagskontakter", "xslapp", "xgranskare", "xbestallningar", "xorder", "xaterkoppling"];
  var COLL_TABLE = { cv: "cv_uppladdningar" };
  var first = function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]; return null; };
  function genericRow(ctx, id, d) {
    var data = Object.assign({}, d); delete data.id;
    var at = first(d.at, d.skapadAt);
    var av = txt(first(d.av, d.fran));
    if (PARTNER || (av && av === ctx.uid)) av = ctx.email;   // RLS: av ska vara den inloggades e-post
    var row = {
      id: id, role_id: txt(first(d.roleId, d.uppdrag)), cand_id: txt(d.candId), match_id: txt(d.matchId),
      typ: txt(d.typ), status: txt(d.status), av: av, av_namn: txt(first(d.avNamn, d.namn, d.franNamn)),
      at: at === null ? null : tsParse(at), synkad: typeof d.synkad === "boolean" ? d.synkad : false, data: data
    };
    if (tsParse(d.createdAt)) row.created_at = tsParse(d.createdAt);
    if (tsParse(d.updatedAt)) row.updated_at = tsParse(d.updatedAt);
    return row;
  }
  function genericDoc(r) {
    if (isObj(r.data) && Object.keys(r.data).length) return clone(r.data);
    var d = {};
    var put = function (k, v) { if (v !== null && v !== undefined) d[k] = v; };
    put("roleId", r.role_id); put("candId", r.cand_id); put("matchId", r.match_id); put("typ", r.typ); put("status", r.status);
    put("av", r.av); put("avNamn", r.av_namn); put("at", tsOut(r.at)); put("synkad", r.synkad);
    return d;
  }
  // ---- log: data är hela dokumentet ----
  function logRow(id, d) {
    var data = Object.assign({}, d); delete data.id;
    var ri = d.roleIds;
    if ((ri === undefined || ri === null) && typeof d.roleId === "string" && d.roleId) ri = [d.roleId];
    var runAt = d.runAt !== undefined && d.runAt !== null ? tsParse(d.runAt) : null;
    var row = { id: id, type: txt(d.type), run_at: runAt, run_by: txt(d.runBy), role_ids: enc("a", ri).v, cand_id: txt(d.candId), role_id: txt(d.roleId), summary: txt(d.summary), data: data };
    if (runAt) row.created_at = runAt;
    return row;
  }
  var logDoc = function (r) { return isObj(r.data) ? clone(r.data) : {}; };

  // ===================== Sessionen =====================
  var ctx = null;          // { uid, email, anv, roll, selfKeys }
  var readyResolve;
  var ready = new Promise(function (res) { readyResolve = res; });

  function el(id) { return document.getElementById(id); }
  function showLogin(msg, opts) {
    html.classList.remove("ats-inne");
    html.classList.add("ats-ute");
    var box = el("ats-login");
    if (!box) { document.body.insertAdjacentHTML("beforeend", '<div id="ats-login" class="ats-login"><p id="ats-login-info"></p></div>'); box = el("ats-login"); }
    box.hidden = false;
    var form = el("ats-login-form"), info = el("ats-login-info"), out = el("ats-login-ut");
    if (form) form.hidden = !!(opts && opts.hideForm);
    if (out) out.hidden = !(opts && opts.showLogout);
    if (info) info.textContent = msg || "";
  }
  function wireLogin() {
    var form = el("ats-login-form"), email = el("ats-login-email"), btn = el("ats-login-skicka"), info = el("ats-login-info"), out = el("ats-login-ut");
    if (form) form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var adr = (email && email.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adr)) { info.textContent = "Skriv en giltig e-postadress."; return; }
      if (btn) btn.disabled = true;
      info.textContent = "Skickar …";
      try {
        var r = await sb.auth.signInWithOtp({ email: adr, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
        if (r.error) throw r.error;
        info.textContent = "Klart. En inloggningslänk är skickad till " + adr + ". Öppna den på den här enheten. Länken gäller en gång.";
      } catch (err) {
        var kod = (err && (err.code || err.error_code)) || "", txt = (err && err.message) || "fel";
        if (kod === "otp_disabled" || /signups not allowed/i.test(txt)) info.textContent = "Adressen " + adr + " har inget konto här. Använd exakt den adress du fick din inbjudan på. Har du bytt adress behöver Filip lägga upp den nya.";
        else if (/rate limit|too many|security purposes/i.test(txt)) info.textContent = "För många försök just nu. Vänta en minut och prova igen, ett klick räcker.";
        else info.textContent = "Det gick inte att skicka länken (" + txt + "). Bara befintliga användare kan logga in.";
      } finally { if (btn) btn.disabled = false; }
    });
    if (out) out.addEventListener("click", function (e) { e.preventDefault(); logout(); });
    var lo = el("ats-logout");
    if (lo) lo.addEventListener("click", function (e) { e.preventDefault(); logout(); });
  }
  async function logout() {
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* lokal session rensas ändå */ }
    location.replace(location.origin + location.pathname);
  }

  async function boot() {
    if (!SUPABASE_URL || !SUPABASE_KEY || !VY) { showLogin("Konfigurationen saknas eller är ofullständig (config.js).", { hideForm: true }); return; }
    if (!window.supabase || typeof window.supabase.createClient !== "function") { showLogin("Supabase-biblioteket kunde inte laddas. Kontrollera nätet och ladda om sidan.", { hideForm: true }); return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    wireLogin();
    var session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) { session = null; }
    if (!session || !session.user) { showLogin(""); return; }
    var email = String(session.user.email || "").toLowerCase();
    var anv = null;
    try {
      var rows = await q(sb.from("anvandare").select("*").eq("email", email));
      anv = rows && rows[0];
    } catch (e) {
      showLogin("Databasen kunde inte nås (" + (e.message || e.code) + "). Ladda om sidan om en stund.", { hideForm: true, showLogout: true });
      return;
    }
    if (!anv || anv.aktiv === false) { showLogin("Inloggad som " + email + ", men kontot har ingen behörighet i ATS:et.", { hideForm: true, showLogout: true }); return; }
    if (VY === "agare" && anv.roll !== "agare") { showLogin("Den här vyn är bara för ägaren. Partnervyn finns under /ats/tomas/.", { hideForm: true, showLogout: true }); return; }
    if (VY === "partner" && anv.roll !== "partner") { showLogin("Partnervyn visar bara data för partnerkonton. Ägaren använder /ats/.", { hideForm: true, showLogout: true }); return; }
    var selfKeys = [email].concat(EXTRA_SELF_KEYS.map(function (k) { return k.toLowerCase(); }));
    ctx = { uid: session.user.id, email: email, anv: anv, roll: anv.roll, selfKeys: selfKeys, namn: anv.namn || "" };
    html.classList.remove("ats-ute");
    html.classList.add("ats-inne");
    var box = el("ats-login"); if (box) box.hidden = true;
    var lo = el("ats-logout"); if (lo) { lo.hidden = false; lo.title = "Inloggad som " + email + ". Klicka för att logga ut."; }
    sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") location.replace(location.origin + location.pathname); });
    wireBlobLinks();
    readyResolve(ctx);
  }

  // ===================== Hämtning =====================
  async function fetchAll(table, opt) {
    opt = opt || {};
    var out = [], order = opt.order || "id";
    for (var from = 0; ; from += PAGE) {
      var b = sb.from(table).select(opt.select || "*");
      if (opt.build) b = opt.build(b);
      var data = await q(b.order(order, { ascending: true }).range(from, from + PAGE - 1));
      out.push.apply(out, data || []);
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
  async function fetchIn(table, col, values, opt) {
    var out = [];
    for (var i = 0; i < values.length; i += IN_CHUNK) {
      var part = values.slice(i, i + IN_CHUNK);
      out.push.apply(out, await fetchAll(table, Object.assign({}, opt, { build: function (b) { return b.in(col, part); } })));
    }
    return out;
  }

  // ===================== Samlingar (specar) =====================
  // Varje spec: loadAll() -> Map(id -> {doc, version, sig}), loadMany(ids), loadOne(id), poll(entries), set/update/delete,
  // rtTables (realtime) och docFilters(id).
  var known = new Map();   // "samling/id" -> {doc, version}, senast lästa form (bas för update)
  var remember = function (coll, id, ent) { if (ent) known.set(coll + "/" + id, { doc: ent.doc, version: ent.version }); else known.delete(coll + "/" + id); };

  function MappedSpec(coll, table, view, toRow, toDoc) {
    this.coll = coll; this.table = table; this.read = PARTNER && view ? view : table; this.isView = this.read !== table;
    this.toRow = toRow; this.toDoc = toDoc; this.readOnly = PARTNER && !!view;
    this.versioned = true;
    this.poll_ms = this.isView ? POLL_VY_MS : POLL_MS;
    this.rtTables = this.isView ? [] : [table];
  }
  MappedSpec.prototype.entry = function (r) { return { doc: this.toDoc(r), version: r.version }; };
  MappedSpec.prototype.loadAll = async function () {
    var m = new Map(), self = this;
    (await fetchAll(this.read)).forEach(function (r) { m.set(r.id, self.entry(r)); });
    return m;
  };
  MappedSpec.prototype.loadMany = async function (ids) {
    var m = new Map(), self = this;
    (await fetchIn(this.read, "id", ids)).forEach(function (r) { m.set(r.id, self.entry(r)); });
    return m;
  };
  MappedSpec.prototype.loadOne = async function (id) { return (await this.loadMany([id])).get(id) || null; };
  MappedSpec.prototype.poll = async function (entries) {
    var vers = await fetchAll(this.read, { select: "id,version" }), seen = new Set(), reload = [];
    vers.forEach(function (r) { seen.add(r.id); var e = entries.get(r.id); if (!e || e.version !== r.version) reload.push(r.id); });
    var removed = []; entries.forEach(function (_, id) { if (!seen.has(id)) removed.push(id); });
    return { reload: reload, removed: removed };
  };
  MappedSpec.prototype.idsFromEvent = function (t, p) { var r = (p.new && p.new.id) ? p.new : p.old; return r && r.id ? [r.id] : null; };
  MappedSpec.prototype.docFilters = function (id) { return this.isView ? [] : [{ table: this.table, filter: "id=eq." + id }]; };
  MappedSpec.prototype.guard = function () { if (this.readOnly) throw dbErr("invalid_argument", "Partnervyn får inte skriva i " + this.coll + "."); };
  MappedSpec.prototype.base = async function (id) {
    var k = known.get(this.coll + "/" + id);
    if (k) return k;
    var e = await this.loadOne(id); remember(this.coll, id, e); return e;
  };
  MappedSpec.prototype.afterWrite = async function () { /* kontakter för candidates */ };
  MappedSpec.prototype.update = async function (id, patch) {
    this.guard();
    var base = await this.base(id);
    if (!base) throw dbErr("invalid_argument", "Dokumentet " + this.coll + "/" + id + " finns inte.");
    for (var attempt = 0; attempt < 2; attempt++) {
      var next = applyPatch(base.doc, patch);
      var cols = diffCols(this.toRow(id, base.doc), this.toRow(id, next));
      if (!cols) { await this.afterWrite(id, next, patch); return; }
      var data = await q(sb.from(this.table).update(cols).eq("id", id).eq("version", base.version).select("id,version"));
      if (data && data.length) { remember(this.coll, id, null); await this.afterWrite(id, next, patch); return; }
      var fresh = await this.loadOne(id);
      remember(this.coll, id, fresh);
      if (!fresh) throw dbErr("invalid_argument", "Dokumentet " + this.coll + "/" + id + " finns inte.");
      if (fresh.version === base.version) throw dbErr("invalid_argument", "Skrivningen nekades av databasen.");
      if (attempt === 1) break;
      base = fresh;   // läst om: slå ihop ändringen med den nya versionen och försök en gång till
    }
    throw dbErr("conflict", "Dokumentet " + this.coll + "/" + id + " ändrades samtidigt av någon annan. Läs om och försök igen.");
  };
  MappedSpec.prototype.set = async function (id, data) {
    this.guard();
    await q(sb.from(this.table).upsert(this.toRow(id, data), { onConflict: "id" }).select("id,version"));
    remember(this.coll, id, null);
    await this.afterWrite(id, data, data);
  };
  MappedSpec.prototype.remove = async function (id) {
    this.guard();
    await q(sb.from(this.table).delete().eq("id", id));
    remember(this.coll, id, null);
  };

  // candidates: kandidatrad + kontakter
  function CandSpec() {
    MappedSpec.call(this, "candidates", "candidates", "v_candidates_partner", rowCandidates, function (r) { return mappedDoc("candidates", r); });
    this.ktable = PARTNER ? "v_kontakter_partner" : "kontakter";
    if (!this.isView) this.rtTables = ["candidates", "kontakter"];
  }
  CandSpec.prototype = Object.create(MappedSpec.prototype);
  CandSpec.prototype.build = function (rows, krows) {
    var by = new Map(), m = new Map(), self = this;
    krows.forEach(function (k) { var a = by.get(k.cand_id); if (!a) by.set(k.cand_id, a = []); a.push(k); });
    rows.forEach(function (r) {
      var doc = self.toDoc(r), ks = sortKontakter(by.get(r.id) || []);
      if (ks.length) doc.kontakter = ks.map(kontaktDoc);
      m.set(r.id, { doc: doc, version: r.version, sig: ks.map(function (k) { return k.id; }).sort().join(",") });
    });
    return m;
  };
  CandSpec.prototype.loadAll = async function () {
    var res = await Promise.all([fetchAll(this.read), fetchAll(this.ktable)]);
    return this.build(res[0], res[1]);
  };
  CandSpec.prototype.loadMany = async function (ids) {
    var res = await Promise.all([fetchIn(this.read, "id", ids), fetchIn(this.ktable, "cand_id", ids)]);
    return this.build(res[0], res[1]);
  };
  CandSpec.prototype.poll = async function (entries) {
    var res = await Promise.all([fetchAll(this.read, { select: "id,version" }), fetchAll(this.ktable, { select: "id,cand_id" })]);
    var sig = new Map();
    res[1].forEach(function (k) { var a = sig.get(k.cand_id); if (!a) sig.set(k.cand_id, a = []); a.push(k.id); });
    var seen = new Set(), reload = [], removed = [];
    res[0].forEach(function (r) {
      seen.add(r.id);
      var e = entries.get(r.id), s = (sig.get(r.id) || []).sort().join(",");
      if (!e || e.version !== r.version || e.sig !== s) reload.push(r.id);
    });
    entries.forEach(function (_, id) { if (!seen.has(id)) removed.push(id); });
    return { reload: reload, removed: removed };
  };
  CandSpec.prototype.idsFromEvent = function (t, p) {
    var r = (p.new && Object.keys(p.new).length) ? p.new : p.old;
    if (t === "kontakter") return r && r.cand_id ? [r.cand_id] : null;
    return r && r.id ? [r.id] : null;
  };
  CandSpec.prototype.docFilters = function (id) {
    return this.isView ? [] : [{ table: "candidates", filter: "id=eq." + id }, { table: "kontakter", filter: "cand_id=eq." + id }];
  };
  // Nya poster i kontakter-listan blir nya rader. Befintliga rader ändras eller raderas aldrig.
  CandSpec.prototype.afterWrite = async function (id, next, patch) {
    if (!patch || !hasOwn(patch, "kontakter") || !Array.isArray(next.kontakter)) return;
    var rows = await fetchAll("kontakter", { build: function (b) { return b.eq("cand_id", id); } });
    var have = new Map();
    rows.forEach(function (r) { var k = stable(kontaktDoc(Object.assign({}, r, { at: r.at ? tsOut(r.at) : null }))); have.set(k, (have.get(k) || 0) + 1); });
    var add = [];
    next.kontakter.forEach(function (p) {
      var k = kontaktKey(p), n = have.get(k) || 0;
      if (n > 0) have.set(k, n - 1); else add.push(kontaktRow(id, p));
    });
    if (add.length) await q(sb.from("kontakter").insert(add));
  };

  // generiska tabeller
  function GenericSpec(coll, table) {
    this.coll = coll; this.table = table; this.read = table; this.isView = false; this.readOnly = false; this.versioned = true;
    this.poll_ms = POLL_MS; this.rtTables = [table];
    this.toRow = function (id, d) { return genericRow(ctx, id, d); };
    this.toDoc = genericDoc;
  }
  GenericSpec.prototype = Object.create(MappedSpec.prototype);
  GenericSpec.prototype.guard = function () {};

  // log
  function LogSpec() {
    GenericSpec.call(this, "log", "log");
    this.toRow = logRow; this.toDoc = logDoc; this.versioned = false;
  }
  LogSpec.prototype = Object.create(GenericSpec.prototype);
  LogSpec.prototype.entry = function (r) { return { doc: this.toDoc(r), version: null }; };
  LogSpec.prototype.poll = async function () { return "full"; };
  LogSpec.prototype.update = async function (id, patch) {
    var base = await this.loadOne(id);
    if (!base) throw dbErr("invalid_argument", "Dokumentet log/" + id + " finns inte.");
    var row = this.toRow(id, applyPatch(base.doc, patch)); delete row.created_at;
    await q(sb.from("log").update(row).eq("id", id));
  };

  // docs (styrdokument): bara id och text
  function DocsSpec() {
    GenericSpec.call(this, "docs", "docs");
    this.toRow = function (id, d) { return { id: id, text: txt(d.text) }; };
    this.toDoc = function (r) { var d = {}; if (r.text !== null && r.text !== undefined) d.text = r.text; return d; };
  }
  DocsSpec.prototype = Object.create(GenericSpec.prototype);

  // kontaktbestallningar: ett dokument per beställare med kartorna poster och korning
  function KBSpec() {
    this.coll = "kontaktbestallningar"; this.isView = false; this.versioned = false; this.poll_ms = POLL_MS;
    this.withKorning = !PARTNER;
    this.rtTables = this.withKorning ? ["kontaktbestallningar", "korgodkannanden"] : ["kontaktbestallningar"];
  }
  KBSpec.prototype.isSelf = function (docId) { return docId === ctx.uid || ctx.selfKeys.indexOf(String(docId).toLowerCase()) >= 0; };
  KBSpec.prototype.keysFor = function (docId) { return this.isSelf(docId) ? ctx.selfKeys : [docId]; };
  KBSpec.prototype.writeKey = function (docId) { return this.isSelf(docId) ? ctx.email : docId; };
  KBSpec.prototype.docIdFor = function (best) { return ctx.selfKeys.indexOf(String(best || "").toLowerCase()) >= 0 ? ctx.uid : best; };
  KBSpec.prototype.posterFromRow = function (r) {
    var d = mappedDoc("kontaktbestallningar", r);
    return d;
  };
  KBSpec.prototype.posterToRow = function (nyckel, bestallare, docId, entry, namnFallback) {
    var e = Object.assign({}, entry);
    if (e.bestallare === undefined || e.bestallare === null || e.bestallare === docId || e.bestallare === bestallare ||
        (this.isSelf(docId) && (e.bestallare === ctx.uid || ctx.selfKeys.indexOf(String(e.bestallare).toLowerCase()) >= 0))) delete e.bestallare;
    if ((e.bestallareNamn === undefined || e.bestallareNamn === null) && namnFallback) e.bestallareNamn = namnFallback;
    var row = mappedRow("kontaktbestallningar", null, e);
    row.nyckel = nyckel; row.bestallare = bestallare;
    return row;
  };
  KBSpec.prototype.kgToRow = function (koId, entry) {
    var row = mappedRow("korgodkannanden", null, entry);
    var lost = Object.keys(row.extra);
    if (lost.length) console.warn("[ats-runtime] korgodkannanden saknar extra-kolumn, fälten sparas inte:", lost.join(", "));
    delete row.extra;
    if (row.begaran === null) row.begaran = false;
    row.ko_id = koId;
    return row;
  };
  KBSpec.prototype.kgFromRow = function (r) { return mappedDoc("korgodkannanden", r, true); };
  KBSpec.prototype.build = function (rows, kg) {
    var m = new Map(), self = this;
    var get = function (id) { var e = m.get(id); if (!e) m.set(id, e = { doc: { bestallare: id, poster: {}, korning: {} }, version: null }); return e; };
    rows.slice().sort(function (a, b) { return (+a.id || 0) - (+b.id || 0); }).forEach(function (r) {
      get(self.docIdFor(r.bestallare)).doc.poster[r.nyckel] = self.posterFromRow(r);
    });
    if (kg.length) { var own = get(ctx.uid); kg.forEach(function (r) { own.doc.korning[r.ko_id] = self.kgFromRow(r); }); }
    return m;
  };
  KBSpec.prototype.loadAll = async function () {
    var res = await Promise.all([fetchAll("kontaktbestallningar"), this.withKorning ? fetchAll("korgodkannanden", { order: "ko_id" }) : []]);
    return this.build(res[0], res[1]);
  };
  KBSpec.prototype.loadOne = async function (docId) {
    var keys = this.keysFor(docId);
    var res = await Promise.all([
      fetchAll("kontaktbestallningar", { build: function (b) { return b.in("bestallare", keys); } }),
      (this.withKorning && this.isSelf(docId)) ? fetchAll("korgodkannanden", { order: "ko_id" }) : []
    ]);
    var m = this.build(res[0], res[1]);
    var e = m.get(this.isSelf(docId) ? ctx.uid : docId);
    if (e && docId !== ctx.uid && this.isSelf(docId)) e.doc.bestallare = docId;
    return e || null;
  };
  KBSpec.prototype.loadMany = async function (ids) {
    var m = new Map();
    for (var i = 0; i < ids.length; i++) { var e = await this.loadOne(ids[i]); if (e) m.set(ids[i], e); }
    return m;
  };
  KBSpec.prototype.poll = async function () { return "full"; };
  KBSpec.prototype.idsFromEvent = function () { return null; };
  KBSpec.prototype.docFilters = function (docId) {
    var keys = this.keysFor(docId);
    var f = [{ table: "kontaktbestallningar", filter: keys.length === 1 ? "bestallare=eq." + keys[0] : null }];
    if (this.withKorning && this.isSelf(docId)) f.push({ table: "korgodkannanden", filter: null });
    return f;
  };
  KBSpec.prototype.upsertPoster = async function (docId, nyckel, value, merge, namnFallback) {
    if (value === null || value === undefined || isDel(value)) { console.warn("[ats-runtime] kontaktbestallningar: poster raderas aldrig, " + nyckel + " lämnas orörd."); return; }
    var keys = this.keysFor(docId), self = this;
    for (var attempt = 0; attempt < 2; attempt++) {
      var rows = await fetchAll("kontaktbestallningar", { build: function (b) { return b.eq("nyckel", nyckel).in("bestallare", keys); } });
      var row = rows[rows.length - 1];
      if (!row) {
        await q(sb.from("kontaktbestallningar").insert(self.posterToRow(nyckel, self.writeKey(docId), docId, stripDeletes(value), namnFallback)));
        return;
      }
      var old = self.posterFromRow(row), next = merge ? applyPatch(old, value) : stripDeletes(value);
      var cols = diffCols(self.posterToRow(nyckel, row.bestallare, docId, old, null), self.posterToRow(nyckel, row.bestallare, docId, next, namnFallback));
      if (!cols) return;
      var data = await q(sb.from("kontaktbestallningar").update(cols).eq("id", row.id).eq("version", row.version).select("id"));
      if (data && data.length) return;
    }
    throw dbErr("conflict", "Beställningen " + nyckel + " ändrades samtidigt av någon annan.");
  };
  KBSpec.prototype.upsertKorning = async function (koId, value, merge) {
    if (!this.withKorning) throw dbErr("invalid_argument", "Körgodkännanden kan bara skrivas av ägaren.");
    if (value === null || value === undefined || isDel(value)) { console.warn("[ats-runtime] korning raderas aldrig, " + koId + " lämnas orörd."); return; }
    for (var attempt = 0; attempt < 2; attempt++) {
      var rows = await q(sb.from("korgodkannanden").select("*").eq("ko_id", koId));
      var row = rows && rows[0];
      if (!row) { await q(sb.from("korgodkannanden").insert(this.kgToRow(koId, stripDeletes(value)))); return; }
      var old = this.kgFromRow(row), next = merge ? applyPatch(old, value) : stripDeletes(value);
      var cols = diffCols(this.kgToRow(koId, old), this.kgToRow(koId, next));
      if (!cols) return;
      var data = await q(sb.from("korgodkannanden").update(cols).eq("ko_id", koId).eq("version", row.version).select("ko_id"));
      if (data && data.length) return;
    }
    throw dbErr("conflict", "Körgodkännandet för " + koId + " ändrades samtidigt av någon annan.");
  };
  KBSpec.prototype.write = async function (docId, data, merge) {
    var namn = (isObj(data) && typeof data.bestallareNamn === "string" && data.bestallareNamn) || (this.isSelf(docId) ? ctx.namn : null);
    var p = isObj(data.poster) ? data.poster : {}, k = isObj(data.korning) ? data.korning : {};
    for (var key in p) if (hasOwn(p, key)) await this.upsertPoster(docId, key, p[key], merge, namn);
    for (var kid in k) if (hasOwn(k, kid)) await this.upsertKorning(kid, k[kid], merge);
  };
  KBSpec.prototype.update = async function (docId, patch) {
    if (!(await this.loadOne(docId))) throw dbErr("invalid_argument", "Dokumentet kontaktbestallningar/" + docId + " finns inte.");
    await this.write(docId, patch, true);
  };
  KBSpec.prototype.set = async function (docId, data) { await this.write(docId, data, false); };
  KBSpec.prototype.remove = async function () { throw dbErr("invalid_argument", "Kontaktbeställningar raderas inte från vyn."); };

  var specs = {};
  function specFor(coll) {
    if (specs[coll]) return specs[coll];
    var s;
    if (coll === "roles") s = new MappedSpec("roles", "roles", "v_roles_partner", rowRoles, function (r) { return mappedDoc("roles", r); });
    else if (coll === "matches") s = new MappedSpec("matches", "matches", "v_matches_partner", rowMatches, function (r) { return mappedDoc("matches", r); });
    else if (coll === "candidates") s = new CandSpec();
    else if (coll === "ko") s = new MappedSpec("ko", "ko", null, rowKo, docKo);
    else if (coll === "kontaktbestallningar") s = new KBSpec();
    else if (coll === "log") s = new LogSpec();
    else if (coll === "docs") s = new DocsSpec();
    else if (GENERIC.indexOf(COLL_TABLE[coll] || coll) >= 0) s = new GenericSpec(coll, COLL_TABLE[coll] || coll);
    else s = null;
    if (s && PARTNER && (coll === "ko" || coll === "log" || coll === "docs")) s = null;   // finns inte för partnern
    specs[coll] = s;
    return s;
  }

  // ===================== Ögonblicksbilder =====================
  var META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  function docSnap(id, doc) {
    if (!doc) return Object.freeze({ id: id, exists: false, data: function () { return undefined; }, metadata: META });
    deepFreeze(doc);
    return Object.freeze({ id: id, exists: true, data: function () { return doc; }, metadata: META });
  }
  function cmp(a, b) {
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;
    if (typeof a === typeof b) return a < b ? -1 : 1;
    return String(a) < String(b) ? -1 : 1;
  }
  function matchFilter(doc, f) {
    var v = doc[f[0]], op = f[1], w = f[2], s = function (x) { return stable(x); };
    switch (op) {
      case "==": return s(v) === s(w);
      case "!=": return v !== undefined && s(v) !== s(w);
      case "<": return v !== undefined && cmp(v, w) < 0;
      case "<=": return v !== undefined && cmp(v, w) <= 0;
      case ">": return v !== undefined && cmp(v, w) > 0;
      case ">=": return v !== undefined && cmp(v, w) >= 0;
      case "in": return Array.isArray(w) && w.some(function (x) { return s(x) === s(v); });
      case "not-in": return v !== undefined && Array.isArray(w) && !w.some(function (x) { return s(x) === s(v); });
      case "array-contains": return Array.isArray(v) && v.some(function (x) { return s(x) === s(w); });
    }
    return false;
  }
  function runQuery(snaps, qd) {
    var list = snaps.filter(function (sn) { var d = sn.data(); return qd.filters.every(function (f) { return matchFilter(d, f); }); });
    list.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    if (qd.order) {
      var f = qd.order[0], dir = qd.order[1] === "desc" ? -1 : 1;
      list.sort(function (a, b) {
        var x = a.data()[f], y = b.data()[f];
        if (x === undefined && y === undefined) return 0;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return cmp(x, y) * dir;
      });
    }
    if (qd.limit) list = list.slice(0, qd.limit);
    return list;
  }
  function querySnap(list, prev) {
    var changes = [], prevIdx = new Map();
    (prev || []).forEach(function (sn, i) { prevIdx.set(sn.id, i); });
    var nowIds = new Set(list.map(function (s) { return s.id; }));
    (prev || []).forEach(function (sn, i) { if (!nowIds.has(sn.id)) changes.push({ type: "removed", doc: sn, oldIndex: i, newIndex: -1 }); });
    list.forEach(function (sn, i) {
      if (!prevIdx.has(sn.id)) changes.push({ type: "added", doc: sn, oldIndex: -1, newIndex: i });
      else if (prev[prevIdx.get(sn.id)] !== sn) changes.push({ type: "modified", doc: sn, oldIndex: prevIdx.get(sn.id), newIndex: i });
    });
    return { snap: Object.freeze({ docs: list, size: list.length, empty: !list.length, docChanges: function () { return changes; }, metadata: META }), changed: !prev || changes.length > 0 || list.some(function (s, i) { return prev[i] !== s; }) };
  }

  // ===================== Levande källor =====================
  var registry = {};   // samling -> Set av källor och dokumentlyssnare (för lokala skrivningar)
  function reg(coll, x) { (registry[coll] = registry[coll] || new Set()).add(x); }
  function unreg(coll, x) { if (registry[coll]) registry[coll].delete(x); }
  function localChanged(coll, id) { (registry[coll] || new Set()).forEach(function (x) { x.localChanged(id); }); }

  function startRealtime(filters, onEvent) {
    var chans = [];
    filters.forEach(function (f) {
      try {
        var opts = { event: "*", schema: "public", table: f.table };
        if (f.filter) opts.filter = f.filter;
        var ch = sb.channel("ats-" + f.table + "-" + randId(8)).on("postgres_changes", opts, function (p) { onEvent(f.table, p); });
        ch.subscribe();
        chans.push(ch);
      } catch (e) { /* utan realtime gäller den periodiska omhämtningen */ }
    });
    return function () { chans.forEach(function (ch) { try { sb.removeChannel(ch); } catch (e) { /* */ } }); };
  }

  // En källa per samling, delad av alla samlingslyssnare
  function Source(spec) {
    this.spec = spec; this.entries = new Map(); this.snaps = new Map(); this.listeners = new Set();
    this.loaded = false; this.started = false; this.pending = null; this.timer = null; this.dead = null;
  }
  Source.prototype.add = function (l) {
    var self = this;
    this.listeners.add(l);
    if (!this.started) this.start();
    else if (this.loaded) this.deliver(l);
    else if (this.dead) setTimeout(function () { l.error && l.error(self.dead); }, 0);
    return function () { self.listeners.delete(l); if (!self.listeners.size) self.stop(); };
  };
  Source.prototype.start = function () {
    var self = this;
    this.started = true; this.dead = null;
    reg(this.spec.coll, this);
    this.refresh("full");
    this.stopRt = startRealtime(this.spec.rtTables.map(function (t) { return { table: t, filter: null }; }), function (t, p) {
      var ids = self.spec.idsFromEvent(t, p);
      self.queue(ids);
    });
    this.timer = setInterval(function () { if (!document.hidden) self.refresh("poll"); }, this.spec.poll_ms);
    this.onVis = function () { if (!document.hidden && self.loaded) self.refresh("poll"); };
    document.addEventListener("visibilitychange", this.onVis);
  };
  Source.prototype.stop = function () {
    this.started = false; this.loaded = false; this.entries = new Map(); this.snaps = new Map();
    clearInterval(this.timer); if (this.stopRt) this.stopRt();
    document.removeEventListener("visibilitychange", this.onVis);
    unreg(this.spec.coll, this);
  };
  Source.prototype.queue = function (ids) {
    var self = this;
    if (!this.pendingIds) this.pendingIds = new Set();
    if (ids === null) this.pendingFull = true; else ids.forEach(function (i) { self.pendingIds.add(i); });
    clearTimeout(this.qt);
    this.qt = setTimeout(function () {
      var full = self.pendingFull, ids2 = Array.from(self.pendingIds);
      self.pendingFull = false; self.pendingIds = new Set();
      if (full) self.refresh("full"); else if (ids2.length) self.refresh(ids2);
    }, 150);
  };
  Source.prototype.localChanged = function (id) { if (this.started) this.refresh([id]); };
  Source.prototype.setEntry = function (id, e) {
    var old = this.entries.get(id);
    this.entries.set(id, e);
    remember(this.spec.coll, id, e);
    if (!old || stable(old.doc) !== stable(e.doc)) this.snaps.set(id, docSnap(id, e.doc));
  };
  Source.prototype.drop = function (id) { this.entries.delete(id); this.snaps.delete(id); remember(this.spec.coll, id, null); };
  Source.prototype.refresh = function (kind) {
    var self = this;
    // en hämtning i taget per källa, nästa köas
    var run = async function () {
      if (!self.started) return;
      try {
        if (kind === "full") {
          var all = await self.spec.loadAll();
          Array.from(self.entries.keys()).forEach(function (id) { if (!all.has(id)) self.drop(id); });
          all.forEach(function (e, id) { self.setEntry(id, e); });
        } else {
          var ids = kind;
          if (kind === "poll") {
            var p = await self.spec.poll(self.entries);
            if (p === "full") { kind = "full"; return run(); }
            p.removed.forEach(function (id) { self.drop(id); });
            ids = p.reload;
          }
          if (ids.length) {
            var got = await self.spec.loadMany(ids);
            ids.forEach(function (id) { if (got.has(id)) self.setEntry(id, got.get(id)); else self.drop(id); });
          }
        }
        self.loaded = true;
        self.listeners.forEach(function (l) { self.deliver(l); });
      } catch (e) {
        if (e && e.code === "invalid_argument" && !self.loaded) {
          self.dead = e;
          self.listeners.forEach(function (l) { l.error ? l.error(e) : console.error(e); });
          self.listeners.clear(); self.stop();
        } else console.warn("[ats-runtime] hämtning av " + self.spec.coll + " misslyckades, försöker igen:", e && e.message);
      }
    };
    this.pending = (this.pending || Promise.resolve()).then(run, run);
    return this.pending;
  };
  Source.prototype.deliver = function (l) {
    var res = querySnap(runQuery(Array.from(this.snaps.values()), l.q), l.prev);
    if (!res.changed && l.prev) return;
    l.prev = res.snap.docs;
    try { l.next(res.snap); } catch (e) { setTimeout(function () { throw e; }); }
  };
  var sources = {};
  function sourceFor(spec) { return sources[spec.coll] || (sources[spec.coll] = new Source(spec)); }

  // Lyssnare på ett enskilt dokument: egen hämtning, realtime filtrerad på raden, periodisk omhämtning
  function DocWatch(spec, id, next, error) {
    var self = this;
    this.spec = spec; this.id = id; this.next = next; this.error = error; this.last = undefined; this.alive = true; this.chain = Promise.resolve();
    reg(spec.coll, this);
    this.load();
    this.stopRt = startRealtime(spec.docFilters(id), function () { clearTimeout(self.qt); self.qt = setTimeout(function () { self.load(); }, 150); });
    this.timer = setInterval(function () { if (!document.hidden) self.load(); }, spec.poll_ms);
  }
  DocWatch.prototype.localChanged = function (id) { if (id === this.id) this.load(); };
  DocWatch.prototype.load = function () {
    var self = this;
    this.chain = this.chain.then(async function () {
      if (!self.alive) return;
      try {
        var e = await self.spec.loadOne(self.id);
        remember(self.spec.coll, self.id, e);
        var key = e ? stable(e.doc) : "∅";
        if (key === self.last) return;
        self.last = key;
        try { self.next(docSnap(self.id, e ? e.doc : null)); } catch (err) { setTimeout(function () { throw err; }); }
      } catch (err) {
        if (err && err.code === "invalid_argument" && self.last === undefined) { self.stop(); if (self.error) self.error(err); else console.error(err); }
        else console.warn("[ats-runtime] hämtning av " + self.spec.coll + "/" + self.id + " misslyckades, försöker igen:", err && err.message);
      }
    });
    return this.chain;
  };
  DocWatch.prototype.stop = function () { this.alive = false; clearInterval(this.timer); if (this.stopRt) this.stopRt(); unreg(this.spec.coll, this); };

  // ===================== db-API:t =====================
  function noSpec(coll) { return dbErr("invalid_argument", "Samlingen " + coll + " finns inte i databasen."); }
  function Query(coll, qd) { this._coll = coll; this._q = qd || { filters: [], order: null, limit: 0 }; }
  Query.prototype.where = function (f, op, v) {
    if (this._q.filters.length >= 10) throw dbErr("invalid_argument", "Högst 10 villkor.");
    return new Query(this._coll, Object.assign({}, this._q, { filters: this._q.filters.concat([[f, op, v]]) }));
  };
  Query.prototype.orderBy = function (f, dir) { return new Query(this._coll, Object.assign({}, this._q, { order: [f, dir || "asc"] })); };
  Query.prototype.limit = function (n) { return new Query(this._coll, Object.assign({}, this._q, { limit: Math.max(1, Math.min(1000, n | 0)) })); };
  Query.prototype.get = async function () {
    var spec = specFor(this._coll);
    if (!spec) return querySnap([], null).snap;
    var src = sources[spec.coll], snaps;
    if (src && src.loaded) snaps = Array.from(src.snaps.values());
    else {
      var all = await spec.loadAll();
      snaps = [];
      all.forEach(function (e, id) { remember(spec.coll, id, e); snaps.push(docSnap(id, e.doc)); });
    }
    return querySnap(runQuery(snaps, this._q), null).snap;
  };
  Query.prototype.onSnapshot = function (next, error) {
    var spec = specFor(this._coll);
    if (!spec) {
      // okänd eller ej tillgänglig samling läses som tom, som en samling utan läsrätt
      var t = setTimeout(function () { next(querySnap([], null).snap); }, 0);
      return function () { clearTimeout(t); };
    }
    var l = { q: this._q, next: next, error: error, prev: null }, off = sourceFor(spec).add(l), done = false;
    return function () { if (!done) { done = true; off(); } };
  };
  function Collection(path) {
    var segs = checkPath(path, false);
    if (segs.length !== 1) throw new TypeError("Undersamlingar stöds inte: " + path);
    Query.call(this, path);
    this.path = path; this.id = path;
  }
  Collection.prototype = Object.create(Query.prototype);
  Collection.prototype.doc = function (id) { return new DocRef(this.path, id === undefined ? randId(20) : id); };
  Collection.prototype.add = async function (data) { var r = this.doc(); await r.set(data); return r; };

  function DocRef(coll, id) {
    checkPath(coll + "/" + id, true);
    this._coll = coll; this.id = id; this.path = coll + "/" + id;
  }
  DocRef.prototype.get = async function () {
    var spec = specFor(this._coll);
    if (!spec) return docSnap(this.id, null);
    var e = await spec.loadOne(this.id);
    remember(spec.coll, this.id, e);
    return docSnap(this.id, e ? e.doc : null);
  };
  DocRef.prototype.set = async function (data) {
    if (!isObj(data)) throw dbErr("invalid_argument", "Dokumentet måste vara ett objekt.");
    var spec = specFor(this._coll); if (!spec) throw noSpec(this._coll);
    data = stripDeletes(data);
    data = await claimUploads(this._coll, this.id, data);
    await spec.set(this.id, data);
    localChanged(spec.coll, this.id);
  };
  DocRef.prototype.update = async function (patch) {
    if (!isObj(patch)) throw dbErr("invalid_argument", "Ändringen måste vara ett objekt.");
    var spec = specFor(this._coll); if (!spec) throw noSpec(this._coll);
    patch = await claimUploads(this._coll, this.id, patch);
    await spec.update(this.id, patch);
    localChanged(spec.coll, this.id);
  };
  DocRef.prototype.delete = async function () {
    var spec = specFor(this._coll); if (!spec) throw noSpec(this._coll);
    await spec.remove(this.id);
    localChanged(spec.coll, this.id);
  };
  DocRef.prototype.onSnapshot = function (next, error) {
    var spec = specFor(this._coll), id = this.id;
    if (!spec) { var t = setTimeout(function () { next(docSnap(id, null)); }, 0); return function () { clearTimeout(t); }; }
    var w = new DocWatch(spec, id, next, error);
    return function () { w.stop(); };
  };
  DocRef.prototype.acquire = async function () { throw dbErr("capability_removed", "acquire stöds inte i Supabase-läget."); };
  DocRef.prototype.collection = function () { throw new TypeError("Undersamlingar stöds inte i Supabase-läget."); };

  var dbApi = {
    doc: function (path) { var s = checkPath(path, true); if (s.length !== 2) throw new TypeError("Undersamlingar stöds inte: " + path); return new DocRef(s[0], s[1]); },
    collection: function (path) { return new Collection(path); }
  };

  // ===================== user =====================
  function initialsAvatar(name) {
    var ini = String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("") || "?";
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#5b6770"/><text x="32" y="40" font-size="24" font-family="sans-serif" text-anchor="middle" fill="#fff">' + ini + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  var userApi = {
    isOwner: async function () { return ctx.roll === "agare"; },
    canEdit: async function () { return ctx.roll === "agare"; },
    can: async function (name) { if (name === "data.write") return ctx.roll === "agare" || ctx.roll === "partner"; return null; },
    id: async function () { return ctx.uid; },
    name: async function () { return ctx.namn; },
    email: async function () { return ctx.email; },
    avatarUrl: async function () { return initialsAvatar(ctx.namn); },
    me: async function () {
      return { id: ctx.uid, name: ctx.namn, email: ctx.email, avatarUrl: initialsAvatar(ctx.namn), color: "#5b6770", isOwner: ctx.roll === "agare", canEdit: ctx.roll === "agare" };
    },
    profiles: async function (ids) {
      var list = (Array.isArray(ids) ? ids : [ids]).filter(function (x) { return typeof x === "string" && x; });
      var out = {}, mails = [];
      list.forEach(function (id) { if (id !== ctx.uid && id.indexOf("@") > 0) mails.push(id.toLowerCase()); });
      var names = {};
      if (mails.length) {
        try { (await q(sb.from("anvandare").select("email,namn").in("email", mails))).forEach(function (r) { names[String(r.email).toLowerCase()] = r.namn || ""; }); }
        catch (e) { /* namn som inte kan slås upp blir tomma */ }
      }
      list.forEach(function (id) {
        var me = id === ctx.uid || id.toLowerCase() === ctx.email;
        var name = me ? ctx.namn : (names[id.toLowerCase()] || "");
        out[id] = { id: id, name: name, avatarUrl: initialsAvatar(name), color: "#5b6770", email: id.indexOf("@") > 0 ? id : null, isMe: me, guest: false };
      });
      return out;
    },
    search: async function () { return []; }
  };

  // ===================== assets (CV i Storage-bucketen cv) =====================
  var pendingUploads = new Map();   // asset-id (sökväg) -> {path, name}
  var safeName = function (n) { return String(n || "fil").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "fil"; };
  async function signed(path) {
    var r = await sb.storage.from(CV_BUCKET).createSignedUrl(path, 7 * 24 * 3600);
    if (r.error) throw r.error;
    return r.data.signedUrl;
  }
  function upErr(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  var assetsApi = {
    upload: async function (blob, opts) {
      if (!blob || typeof blob.size !== "number") throw upErr("invalid_request", "Ingen fil.");
      var type = (opts && opts.type) || blob.type || "application/octet-stream";
      var name = safeName(blob.name);
      var path = "inkommande/" + Date.now() + "-" + randId(6) + "/" + name;
      var r = await sb.storage.from(CV_BUCKET).upload(path, blob, { contentType: type, upsert: false });
      if (r.error) {
        var st = +(r.error.statusCode || r.error.status || 0);
        throw upErr(st === 413 ? "too_large" : st === 415 ? "unsupported_type" : st === 401 || st === 403 ? "upstream_auth" : "upstream_error", r.error.message);
      }
      var url = await signed(path);
      pendingUploads.set(path, { path: path, name: name, url: url });
      return { id: path, url: url, sizeBytes: blob.size, contentType: type };
    },
    url: async function (path) { return signed(String(path)); },
    list: async function () { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; },
    delete: async function () { throw upErr("capability_removed", "unsupported"); }
  };
  // När en nyss uppladdad fil knyts till en kandidat (cv/<candId> eller candidates/<candId>) flyttas den till <candId>/<filnamn>
  async function claimUploads(coll, id, data) {
    if (!pendingUploads.size || (coll !== "cv" && coll !== "candidates")) return data;
    var out = data, hits = [];
    for (var k in data) if (hasOwn(data, k) && typeof data[k] === "string" && pendingUploads.has(data[k])) hits.push(data[k]);
    for (var i = 0; i < hits.length; i++) {
      var up = pendingUploads.get(hits[i]); pendingUploads.delete(hits[i]);
      var target = id + "/" + up.name, moved = null;
      for (var t = 0; t < 2 && !moved; t++) {
        var dest = t ? id + "/" + Date.now() + "-" + up.name : target;
        var r = await sb.storage.from(CV_BUCKET).move(up.path, dest);
        if (!r.error) moved = dest;
      }
      if (!moved) { console.warn("[ats-runtime] filen kunde inte flyttas till kandidatens mapp, ligger kvar i " + up.path); continue; }
      var url = null; try { url = await signed(moved); } catch (e) { url = null; }
      out = Object.assign({}, out);
      for (var f in out) {
        if (!hasOwn(out, f)) continue;
        if (out[f] === up.path) out[f] = moved;
        else if (out[f] === up.url && url) out[f] = url;
      }
    }
    return out;
  }
  // Länkar till /_blob/<id> (ATS Filip) och utgångna signerade CV-länkar öppnas via en ny signerad länk
  function wireBlobLinks() {
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var u; try { u = new URL(a.getAttribute("href"), location.href); } catch (x) { return; }
      var path = null, m;
      if ((m = /\/_blob\/(.+)$/.exec(u.pathname))) path = decodeURIComponent(m[1]);
      else if (u.origin === SUPABASE_URL && (m = new RegExp("/storage/v1/object/sign/" + CV_BUCKET + "/(.+)$").exec(u.pathname))) path = decodeURIComponent(m[1]);
      if (!path) return;
      e.preventDefault(); e.stopPropagation();
      var w = window.open("", "_blank");
      signed(path).then(function (url) { if (w) w.location.href = url; else location.href = url; })
        .catch(function (err) { if (w) w.close(); alert("Filen kunde inte öppnas (" + ((err && err.message) || "fel") + ")."); });
    }, true);
  }

  // ===================== window.claude =====================
  var apis = { db: dbApi, user: userApi, assets: assetsApi };
  window.claude = {
    use: function (name) {
      return ready.then(function () { return hasOwn(apis, name) ? apis[name] : null; });
    }
  };
  // Mappningsfunktionerna exponeras för test och felsökning (inga nycklar eller data)
  window.ATS_RUNTIME = Object.freeze({
    // Anropar en serverfunktion som den inloggade användaren (ATS-X: inloggningskonto åt granskare)
    funktion: function (namn, kropp) { return sb.functions.invoke(namn, { body: kropp }); },
    vy: VY,
    mappning: { MAP: MAP, mappedRow: mappedRow, mappedDoc: mappedDoc, rowCandidates: rowCandidates, rowKo: rowKo, docKo: docKo, kontaktRow: kontaktRow, kontaktDoc: kontaktDoc, genericRow: function (id, d) { return genericRow(ctx || { uid: null, email: null }, id, d); }, genericDoc: genericDoc, logRow: logRow, logDoc: logDoc, applyPatch: applyPatch }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
