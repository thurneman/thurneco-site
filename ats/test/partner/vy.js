/*
 * Partnervyn med kort åt båda håll (17 november 2026): uppdrag med matchade kandidater, kandidater med matchade uppdrag.
 * Av kandidaten visas två saker: intresse och cv. Högst tre cv per uppdrag. Det som brådskar ligger överst.
 * Bara läsning. Läser partnervyerna (v_roles_partner, v_matches_partner, v_candidates_partner, v_kontakter_partner)
 * genom ATS_RUNTIME.vyrad. Ägaren ser partnerns urval genom Visa som. Inget skrivs härifrån.
 * Visas inte: kund, pris, lön, poäng, nivå, anteckningar, kontaktuppgifter. Motivering visas bara när den inte nämner ett verktyg. Ordningen styrs av dagar kvar, aldrig av pris.
 * Obs inför skarp inloggning för partnern: vyrad utan Visa som hämtar högst 1000 rader per vy.
 */
(function () {
  "use strict";
  var D = { roles: [], matches: [], cands: {}, kont: {}, psvar: [], namn: "", sidnamn: "ATS", sign: "" };
  var S = { flik: "uppdrag", roll: null, kand: null, gamla: false, usok: "", ksok: "" };
  var N = { nyckel: "ats-partner-sett", sett: 0, cv: null, visade: {}, forsta: true };
  var OPPNA = ["ny", "pagar", "presenterad"];
  var INTR = ["intresserad", "presenterad", "intervju", "erbjudande", "ansokt"];
  var STEG = { ansokt: "Har ansökt", intresserad: "Intresserad", presenterad: "Inskickad till kund", intervju: "Intervju", erbjudande: "Erbjudande" };
  var MAXCV = 3;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kort(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }
  function ini(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase(); }
  function ms(iso) { var t = Date.parse(iso); return isNaN(t) ? 0 : t; }
  var MAN = { jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
  // Sista dag står som fri text ("1 dec", "4 november 2026", "2026-11-19 kl. 23:59", "Löpande ..."). Saknas den används den antagna dagen.
  function tolka(s) {
    s = String(s == null ? "" : s).trim().toLowerCase();
    if (!s || /^löpande/.test(s)) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\s+([a-zåäö]{3})[a-zåäö]*\.?(?:\s+(\d{4}))?/);
    if (!m || !(m[2] in MAN)) return null;
    var nu = new Date(), y = m[3] ? +m[3] : nu.getFullYear(), d = new Date(y, MAN[m[2]], +m[1]);
    if (!m[3] && nu.getTime() - d.getTime() > 183 * 86400000) d = new Date(y + 1, MAN[m[2]], +m[1]);
    return d;
  }
  function slut(r) {
    var d = tolka(r.deadline), ant = false;
    if (!d && r.deadline_antagen) { d = tolka(r.deadline_antagen); ant = !!d; }
    return { d: d, ant: ant, lop: /^\s*löpande/i.test(String(r.deadline || "")) };
  }
  function dagar(r) {
    var s = slut(r); if (!s.d) return null;
    var n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((s.d.getTime() - n.getTime()) / 86400000);
  }
  function prio(r) { var n = parseInt(r.prio, 10); return n >= 1 && n <= 9 ? n : 9; }
  function nar(iso) {
    var t = ms(iso); if (!t) return "";
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 60) return "För " + Math.max(min, 1) + " min sedan";
    if (min < 24 * 60) return "För " + Math.round(min / 60) + " timmar sedan";
    var dg = Math.round(min / 1440);
    if (dg === 1) return "I går";
    if (dg < 14) return "För " + dg + " dagar sedan";
    return new Date(t).toLocaleDateString("sv-SE");
  }
  function datum(iso) { var t = ms(iso); return t ? new Date(t).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }

  function oppen(r) { var d = dagar(r); return OPPNA.indexOf(r.status) >= 0 && (d === null || d >= 0); }
  function kvar(r) {
    var d = dagar(r);
    if (OPPNA.indexOf(r.status) < 0) return { t: "Stängt", k: "gra" };
    if (d === null) return { t: slut(r).lop ? "Löpande" : "Sista dag saknas", k: "gra" };
    if (d < 0) return { t: "Passerad", k: "gra" };
    if (d === 0) return { t: "Sista dag i dag", k: "rod" };
    return { t: d + (d === 1 ? " dag kvar" : " dagar kvar"), k: d <= 2 ? "rod" : "bla" };
  }
  function roll(id) { for (var i = 0; i < D.roles.length; i++) if (D.roles[i].id === id) return D.roles[i]; return null; }
  function rollrad(r) { return [r.ref, r.category, r.location].filter(Boolean).join(" · "); }
  function iRoll(id) { return D.matches.filter(function (m) { return m.role_id === id && !m.dismissed && m.stage !== "avslutad"; }); }
  function kontakter(m) { return (D.kont[m.cand_id] || []).filter(function (k) { return !k.role_id || k.role_id === m.role_id; }); }
  function obesvarad(m) {
    var s = m.svar;
    if (!s || m.dismissed || m.stage === "avslutad" || ["positiv", "fraga"].indexOf(s.tolkning) < 0) return false;
    var t = ms(s.at);
    if (kontakter(m).some(function (k) { return k.riktning === "ut" && ms(k.at) > t; })) return false;
    return !D.psvar.some(function (p) { return p.match_id === m.id && ["bestalld", "skickas", "skickat"].indexOf(p.status) >= 0 && ms(p.at || p.created_at) > t; });
  }
  // Intresse: ja, fraga, vantar (kontaktad utan svar), nej eller ej (inte kontaktad).
  function intresse(m) {
    var t = m.svar && m.svar.tolkning;
    if (t === "negativ") return "nej";
    if (t === "positiv" || INTR.indexOf(m.stage) >= 0) return "ja";
    if (t === "fraga") return "fraga";
    return m.stage === "kontaktad" ? "vantar" : "ej";
  }
  function intrText(m) { var i = intresse(m); return i === "ja" ? (STEG[m.stage] || "Intresserad") : i === "fraga" ? "Har frågat" : i === "vantar" ? "Kontaktad, inget svar än" : i === "nej" ? "Tackat nej" : "Inte kontaktad"; }
  function harCv(id) { var c = D.cands[id]; return !!(c && String(c.cv == null ? "" : c.cv).trim()); }
  function klara(id) { return iRoll(id).filter(function (m) { return intresse(m) === "ja" && harCv(m.cand_id); }).length; }
  function senast(m) { var t = m.svar ? ms(m.svar.at) : 0; kontakter(m).forEach(function (k) { var x = ms(k.at); if (x > t) t = x; }); return t; }
  function cvChip(id) { return harCv(id) ? '<span class="chip gron">CV inne</span>' : '<span class="chip gra">CV saknas</span>'; }
  function intrChip(m) { var i = intresse(m); return '<span class="chip ' + (i === "ja" ? "bla" : i === "fraga" ? "gul" : "gra") + '">' + esc(intrText(m)) + "</span>"; }
  function rund(n, stor, liten) { return '<span class="rund' + (stor ? " stor" : "") + (liten ? " liten" : "") + '" aria-hidden="true">' + esc(ini(n)) + "</span>"; }
  function sortRoller(a, b) {
    var sa = a.prio === "skip" ? 1 : 0, sb = b.prio === "skip" ? 1 : 0;
    if (sa !== sb) return sa - sb;
    var da = dagar(a), db = dagar(b);
    if (da === null) da = 9999; if (db === null) db = 9999;
    return da - db || prio(a) - prio(b) || String(a.title).localeCompare(String(b.title), "sv");
  }
  function sortMatch(a, b) {
    return (obesvarad(b) ? 1 : 0) - (obesvarad(a) ? 1 : 0) || (harCv(b.cand_id) ? 1 : 0) - (harCv(a.cand_id) ? 1 : 0) || senast(b) - senast(a) || String(a.cand_name).localeCompare(String(b.cand_name), "sv");
  }
  function rollSummering(r) {
    var m = iRoll(r.id), ja = m.filter(function (x) { return intresse(x) === "ja" || intresse(x) === "fraga"; }).length, sv = m.filter(obesvarad).length, cv = klara(r.id);
    if (!m.length) return "Inga kandidater än";
    var d = [];
    if (sv) d.push(sv + " svar väntar på dig");
    d.push(ja + (ja === 1 ? " intresserad" : " intresserade"));
    d.push("cv " + Math.min(cv, MAXCV) + " av " + MAXCV);
    return d.join(" · ");
  }

  // ---------- Notis: svar som väntar och nya cv ----------
  function lagra() { try { localStorage.setItem(N.nyckel, JSON.stringify({ t: N.sett, cv: N.cv })); } catch (e) { /* lagring saknas, notisen gäller då bara tills sidan stängs */ } }
  function lasSett() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(N.nyckel) || "null"); } catch (e) { o = null; }
    if (o && typeof o.t === "number" && Array.isArray(o.cv)) { N.sett = o.t; N.cv = o.cv; }
    else { N.sett = Date.now(); N.cv = Object.keys(D.cands).filter(harCv); lagra(); }
  }
  function handelser() {
    var ut = [];
    D.matches.forEach(function (m) {
      if (obesvarad(m)) ut.push({ k: "svar:" + m.id + ":" + m.svar.at, typ: "svar", cand: m.cand_id, namn: m.cand_name, r: roll(m.role_id), text: m.svar.text, at: ms(m.svar.at), ny: ms(m.svar.at) > N.sett });
    });
    D.psvar.forEach(function (x) {
      var d = x.data || {}, vantar = x.status === "bestalld" && !!d.vantarPaFilip, ejut = x.status === "avvisad" || x.status === "kontrolleras";
      if (!vantar && !ejut) return;
      var at = ms(d.statusAt || d.vantarAt || x.updated_at || x.at);
      if (ejut && Date.now() - at > 3 * 864e5) return;
      ut.push({ k: "eget:" + x.id + ":" + x.status, typ: vantar ? "vantar" : "ejut", cand: x.cand_id, namn: (D.cands[x.cand_id] || {}).name || "", r: roll(x.role_id), text: "", skal: vantar ? svarSkal(x) : skalText(d.fel), at: at, ny: at > N.sett });
    });
    if (N.cv) Object.keys(D.cands).forEach(function (id) {
      if (!harCv(id) || N.cv.indexOf(id) >= 0) return;
      var m = D.matches.filter(function (x) { return x.cand_id === id && !x.dismissed && x.stage !== "avslutad"; }).sort(sortMatch)[0];
      ut.push({ k: "cv:" + id, typ: "cv", cand: id, namn: D.cands[id].name || (m && m.cand_name) || "", r: m ? roll(m.role_id) : null, text: "", at: ms(D.cands[id].updated_at), ny: true });
    });
    return ut.sort(function (a, b) { return (b.ny ? 1 : 0) - (a.ny ? 1 : 0) || b.at - a.at; });
  }
  function notisLage() {
    if (typeof Notification === "undefined") return "";
    if (Notification.permission === "granted") return '<span class="dov">Notiser i webbläsaren är på.</span>';
    if (Notification.permission === "denied") return '<span class="dov">Notiser är avstängda i webbläsaren.</span>';
    return '<button type="button" class="lank" id="notisknapp">Slå på notiser i webbläsaren</button>';
  }
  function vNotis() {
    var hs = handelser(), nya = hs.filter(function (e) { return e.ny; }).length;
    var h = '<section class="notis" aria-live="polite"><div class="rubrikrad"><h2>Att göra nu</h2>' + (hs.length ? '<span class="antal">' + hs.length + "</span>" : "") + "</div>";
    if (!hs.length) h += '<p class="tom">Ingen kandidat väntar på dig just nu. Här syns det när någon har svarat eller skickat cv.</p>';
    hs.slice(0, 5).forEach(function (e) {
      var r = e.r || {};
      h += '<button type="button" class="rad" data-kand="' + esc(e.cand) + '">' + rund(e.namn) + '<span class="mitt"><span class="namn">' + esc(e.namn) + (e.ny ? ' <span class="chip ny">Nytt</span>' : "") + '</span><span class="dov">' +
        esc((e.typ === "cv" ? "Har skickat cv" : e.typ === "vantar" ? "Ditt svar väntar på Filips ja" : e.typ === "ejut" ? "Ditt svar skickades inte" : "Har svarat") + (r.title ? " · " + [r.ref, r.title].filter(Boolean).join(" ") : "") + (r.id && !oppen(r) ? " · stängt uppdrag" : "")) + "</span>" +
        (e.text ? '<span>"' + esc(kort(e.text, 160)) + '"</span>' : "") + (e.skal ? "<span>" + esc(kort(e.skal, 200)) + "</span>" : "") + '</span><span class="tid">' + esc(e.at ? nar(new Date(e.at).toISOString()) : "") + '</span><span class="pil" aria-hidden="true">›</span></button>';
    });
    if (hs.length > 5) h += '<p class="dov">och ' + (hs.length - 5) + " till, se fliken Kandidater.</p>";
    h += '<div class="knapprad">' + (nya ? '<button type="button" class="lank" id="sett">Markera som sett</button>' : "") + notisLage() + "</div></section>";
    return h;
  }
  function avisera() {
    var nya = handelser().filter(function (e) { return e.ny; }), ej = nya.filter(function (e) { return !N.visade[e.k]; });
    ej.forEach(function (e) { N.visade[e.k] = 1; });
    if (typeof document !== "undefined") document.title = (nya.length ? "(" + nya.length + ") " : "") + D.sidnamn;
    if (N.forsta || !ej.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var e = ej[0], text = ej.length === 1 ? e.namn + (e.typ === "cv" ? " har skickat cv" : " har svarat") + (e.r && e.r.ref ? " på " + e.r.ref : "") : ej.length + " kandidater har svarat eller skickat cv";
    try { new Notification(D.sidnamn, { body: text, tag: "ats-partner" }); } catch (x) { /* notisen är ett tillägg, sidan visar samma sak */ }
  }

  // ---------- Kort och detalj ----------
  var RENT = /talendary|recruiter|linkedin/i;
  // Motiveringen visas bara när den inte nämner ett verktyg.
  function motiv(m) { var r = m.rekommendation || (Array.isArray(m.belagt) ? m.belagt[0] : m.belagt) || ""; r = typeof r === "string" ? r : ""; return RENT.test(r) ? "" : kort(r, 150); }
  function intrKort(m) { var i = intresse(m); return i === "ja" ? (STEG[m.stage] || "Intresserad") : i === "fraga" ? "Har frågat" : i === "vantar" ? "Kontaktad" : i === "nej" ? "Tackat nej" : "Föreslagen"; }
  function lageChip(m) { return obesvarad(m) ? '<span class="chip gron">Svar väntar</span>' : '<span class="chip ' + (intresse(m) === "ja" ? "bla" : intresse(m) === "fraga" ? "gul" : "gra") + '">' + esc(intrKort(m)) + "</span>"; }
  function kandRad(m, medSvar) {
    var mv = motiv(m);
    return '<button type="button" class="rad" data-kand="' + esc(m.cand_id) + '">' + rund(m.cand_name) + '<span class="mitt"><span class="namn">' + esc(m.cand_name) + "</span>" +
      (medSvar && m.svar && m.svar.text && intresse(m) !== "nej" ? '<span>"' + esc(kort(m.svar.text, 140)) + '"</span>' : (mv ? "<span>" + esc(mv) + "</span>" : "")) + (senast(m) ? '<span class="dov">' + esc(nar(new Date(senast(m)).toISOString())) + "</span>" : "") + '</span>' +
      '<span class="chips">' + (obesvarad(m) ? '<span class="chip gron">Väntar på svar från dig</span>' : "") + intrChip(m) + cvChip(m.cand_id) + '</span><span class="pil" aria-hidden="true">›</span></button>';
  }
  function miniKand(m) {
    return '<button type="button" class="mini" data-kand="' + esc(m.cand_id) + '">' + rund(m.cand_name, false, true) + '<span class="mitt">' + esc(m.cand_name) + "</span>" + lageChip(m) + (harCv(m.cand_id) ? '<span class="chip gron">CV</span>' : "") + "</button>";
  }
  function miniRoll(m) {
    var r = roll(m.role_id); if (!r) return "";
    var k = kvar(r);
    return '<button type="button" class="mini" data-roll="' + esc(r.id) + '"><span class="mitt">' + esc(r.title) + "</span>" + lageChip(m) + '<span class="chip ' + k.k + '">' + esc(k.t) + "</span></button>";
  }
  function matchade(id) { return iRoll(id).filter(function (m) { return intresse(m) !== "nej"; }).sort(sortMatch); }

  // ---------- Uppdrag ----------
  function uppdragKort(r) {
    var k = kvar(r), ml = matchade(r.id), n = klara(r.id);
    var h = '<article class="kk"><div class="kkrad"><span class="chip ' + k.k + '">' + esc(k.t) + '</span><span class="dov">' + esc(r.category || "") + "</span></div>" +
      '<button type="button" class="huvudknapp" data-roll="' + esc(r.id) + '"><span class="mitt"><span class="namn">' + esc(r.title) + '</span><span class="dov">' + esc([r.ref, r.location].filter(Boolean).join(" · ")) + '</span></span><span class="pil" aria-hidden="true">›</span></button>' +
      '<div class="dov">Cv inne ' + Math.min(n, MAXCV) + " av " + MAXCV + " · " + ml.length + (ml.length === 1 ? " matchad kandidat" : " matchade kandidater") + "</div>";
    ml.slice(0, 3).forEach(function (m) { h += miniKand(m); });
    if (ml.length > 3) h += '<button type="button" class="lank liten" data-roll="' + esc(r.id) + '">och ' + (ml.length - 3) + " till ›</button>";
    return h + "</article>";
  }
  function uppdragDetalj(r) {
    var k = kvar(r), alla = iRoll(r.id).sort(sortMatch), n = klara(r.id);
    var intr = alla.filter(function (m) { var i = intresse(m); return i === "ja" || i === "fraga"; });
    var vant = alla.filter(function (m) { return intresse(m) === "vantar"; });
    var ej = alla.filter(function (m) { return intresse(m) === "ej"; });
    var nej = alla.filter(function (m) { return intresse(m) === "nej"; }).length;
    var h = "<h1>" + esc(r.title) + '</h1><p class="under">' + esc(rollrad(r)) + '</p><p><span class="chip ' + k.k + '">' + esc(k.t) + "</span>" +
      (r.deadline ? ' <span class="dov">Sista dag ' + esc(r.deadline) + "</span>" : (slut(r).ant ? ' <span class="dov">Sista dag ' + esc(r.deadline_antagen) + " (antagen)</span>" : "")) + "</p>";
    h += '<div class="matt' + (n >= MAXCV ? " full" : "") + '"><span class="fet">Cv inne: ' + Math.min(n, MAXCV) + " av " + MAXCV + "</span> " +
      (n >= MAXCV ? "Uppdraget har de cv som behövs." : n ? "Räknas när kandidaten är intresserad och cv finns." : "Inget cv inne än. Ett tidigt cv går före ett bättre som kommer för sent.") + "</div>";
    h += '<section class="del"><h2>Intresserade</h2>';
    if (!intr.length) h += '<p class="tom">Ingen har visat intresse än.</p>';
    intr.slice(0, 40).forEach(function (m) { h += kandRad(m, true); });
    h += '</section><section class="del"><h2>Kontaktade, inget svar än</h2>';
    if (!vant.length) h += '<p class="tom">Ingen väntar på svar.</p>';
    vant.slice(0, 40).forEach(function (m) { h += kandRad(m, false); });
    if (vant.length > 40) h += '<p class="dov">och ' + (vant.length - 40) + " till</p>";
    h += '</section><section class="del"><h2>Matchade, inte kontaktade</h2><p class="dov">' + ej.length + (ej.length === 1 ? " kandidat" : " kandidater") + (nej ? ". " + nej + " har tackat nej" : "") + ".</p>";
    ej.slice(0, 30).forEach(function (m) { h += kandRad(m, false); });
    if (ej.length > 30) h += '<p class="dov">och ' + (ej.length - 30) + " till</p>";
    return h + "</section>";
  }
  function vUppdrag() {
    var vald = S.roll ? roll(S.roll) : null;
    if (vald) return '<button type="button" class="bak" data-bak="uppdrag">‹ Alla uppdrag</button>' + uppdragDetalj(vald);
    var q = S.usok.toLowerCase();
    var rs = D.roles.filter(function (r) { return (S.gamla || oppen(r)) && (!q || [r.title, r.ref, r.category, r.location].join(" ").toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) {
      return (oppen(a) ? 0 : 1) - (oppen(b) ? 0 : 1) || sortRoller(a, b);
    });
    var h = '<div class="verktyg"><h1>Uppdrag</h1><label class="falt">Sök<input type="search" id="usok" placeholder="Sök titel, nummer, typ av roll eller ort" value="' + esc(S.usok) + '"></label>' +
      '<label class="kryss"><input type="checkbox" id="gamla"' + (S.gamla ? " checked" : "") + '> Visa passerade och stängda</label></div><p class="dov">' + rs.length + " uppdrag. Det som brådskar ligger överst.</p>" + '<div class="kortnat">';
    rs.slice(0, 60).forEach(function (r) { h += uppdragKort(r); });
    h += "</div>";
    if (rs.length > 60) h += '<p class="dov">Visar 60 av ' + rs.length + ". Sök för att hitta fler.</p>";
    if (!rs.length) h += '<p class="tom">Inga uppdrag matchar.</p>';
    return h;
  }

  // ---------- Kandidater ----------
  function kandLista() {
    var per = {};
    D.matches.forEach(function (m) {
      if (m.dismissed) return;
      var p = per[m.cand_id] || (per[m.cand_id] = { id: m.cand_id, namn: m.cand_name, ms: [], sv: 0, ja: 0, senast: 0, kvar: 0 });
      p.ms.push(m);
      if (m.stage !== "avslutad" && intresse(m) !== "nej") p.kvar++;
      if (obesvarad(m)) p.sv++;
      if (m.stage !== "avslutad" && intresse(m) === "ja") p.ja++;
      var t = senast(m); if (t > p.senast) p.senast = t;
    });
    return Object.keys(per).map(function (k) { return per[k]; });
  }
  var SVARLAGE = { bestalld: "väntar på att skickas", skickas: "skickas nu", avvisad: "skickades inte", kontrolleras: "behöver kontrolleras", aterkallad: "återkallat" };
  // Skälet visas för partnern bara när det inte nämner verktyg. Annars en hänvisning till Filip.
  function skalText(t) { t = String(t || "").trim(); return !t ? "" : /talendary|recruiter|linkedin/i.test(t) ? "Hör med Filip om varför." : t; }
  function svarLage(x) { var d = x.data || {}; return x.status === "bestalld" && d.vantarPaFilip ? "väntar på Filips ja" : (SVARLAGE[x.status] || x.status); }
  function svarSkal(x) { var d = x.data || {}; return x.status === "avvisad" || x.status === "kontrolleras" ? skalText(d.fel) : (x.status === "bestalld" && d.vantarPaFilip ? skalText(String(d.vantarSkal || "").replace(/\bpartnerns\b/g, "ditt")) : ""); }
  function egnaSvar(candId) { return D.psvar.filter(function (p) { return p.cand_id === candId && p.status !== "skickat"; }); }
  function kandStatus(p) { return !p.kvar ? "Tackat nej eller avslutad" : p.sv ? "Väntar på svar från dig" : (p.ja ? "Intresserad" : (p.senast ? "Kontaktad" : "Inte kontaktad")) + (harCv(p.id) ? " · CV inne" : " · CV saknas"); }
  function kandMatch(p) {
    return p.ms.filter(function (m) { return roll(m.role_id) && m.stage !== "avslutad" && intresse(m) !== "nej"; }).sort(function (a, b) {
      var ra = roll(a.role_id), rb = roll(b.role_id);
      return (oppen(ra) ? 0 : 1) - (oppen(rb) ? 0 : 1) || (obesvarad(b) ? 1 : 0) - (obesvarad(a) ? 1 : 0) || senast(b) - senast(a) || sortRoller(ra, rb);
    });
  }
  function kandKort(p) {
    var ml = kandMatch(p);
    var h = '<article class="kk"><button type="button" class="huvudknapp" data-kand="' + esc(p.id) + '">' + rund(p.namn) + '<span class="mitt"><span class="namn">' + esc(p.namn) + '</span><span class="dov">' + esc(kandStatus(p)) + '</span></span><span class="pil" aria-hidden="true">›</span></button>' +
      '<div class="dov">' + ml.length + (ml.length === 1 ? " matchat uppdrag" : " matchade uppdrag") + "</div>";
    ml.slice(0, 3).forEach(function (m) { h += miniRoll(m); });
    if (ml.length > 3) h += '<button type="button" class="lank liten" data-kand="' + esc(p.id) + '">och ' + (ml.length - 3) + " till ›</button>";
    return h + "</article>";
  }
  function kandDetalj(p) {
    var c = D.cands[p.id] || {}, cv = String(c.cv == null ? "" : c.cv).trim();
    var h = '<div class="huvud">' + rund(p.namn, true) + "<div><h1>" + esc(p.namn) + "</h1><p>" + cvChip(p.id) +
      (/^https:\/\/\S+$/i.test(cv) ? ' <a class="lank" href="' + esc(cv) + '" target="_blank" rel="noopener noreferrer">Öppna cv</a>' : "") + "</p></div></div>";
    h += '<section class="del"><h2>Matchade uppdrag</h2>';
    p.ms.slice().sort(function (a, b) { var ra = roll(a.role_id) || {}, rb = roll(b.role_id) || {}; return (oppen(ra) ? 0 : 1) - (oppen(rb) ? 0 : 1) || sortMatch(a, b) || sortRoller(ra, rb); }).slice(0, 25).forEach(function (m) {
      var r = roll(m.role_id); if (!r) return;
      var k = kvar(r), mv = motiv(m);
      h += '<button type="button" class="rad" data-roll="' + esc(r.id) + '"><span class="mitt"><span class="namn">' + esc(r.title) + '</span><span class="dov">' + esc(rollrad(r)) + "</span>" + (mv ? "<span>" + esc(mv) + "</span>" : "") + '</span><span class="chips">' +
        (obesvarad(m) ? '<span class="chip gron">Väntar på svar från dig</span>' : "") + (m.stage === "avslutad" ? '<span class="chip gra">Avslutad</span>' : intrChip(m)) + '<span class="chip ' + k.k + '">' + esc(k.t) + '</span></span><span class="pil" aria-hidden="true">›</span></button>';
    });
    var kt = (D.kont[p.id] || []).concat(egnaSvar(p.id).map(function (x) { var d = x.data || {}; return { order: true, at: x.at || x.created_at, role_id: x.role_id, text: d.text || "", lage: svarLage(x), skal: svarSkal(x) }; })).sort(function (a, b) { return ms(a.at) - ms(b.at); });
    h += '</section><section class="del"><h2>Konversation</h2>';
    if (!kt.length) h += '<p class="tom">Ingen kontakt loggad än.</p>';
    if (kt.length > 40) h += '<p class="dov">Visar de 40 senaste av ' + kt.length + " meddelanden.</p>";
    kt.slice(-40).forEach(function (k) {
      if (k.order) { var or = roll(k.role_id) || {}; h += '<div class="medd order"><div class="dov">' + esc("Ditt svar, " + k.lage + " · " + datum(k.at) + (or.ref ? " · " + or.ref : "")) + "</div><div>" + esc(kort(k.text, 1500)) + "</div>" + (k.skal ? '<div class="dov">Skäl: ' + esc(kort(k.skal, 300)) + "</div>" : "") + "</div>"; return; }
      var kr = roll(k.role_id) || {}, egen = /^kommentar/.test(String(k.kanal || "")), inn = k.riktning === "in" && !egen;
      h += '<div class="medd ' + (egen ? "egen" : inn ? "in" : "ut") + '"><div class="dov">' + esc((egen ? "Din anteckning" : inn ? p.namn : "Vi") + " · " + datum(k.at) + (kr.ref ? " · " + kr.ref : "")) + "</div><div>" + esc(kort(k.text, 1500)) + "</div></div>";
    });
    return h + "</section>";
  }
  function vKandidater() {
    var alla = kandLista();
    var vald = S.kand ? alla.filter(function (x) { return x.id === S.kand; })[0] : null;
    if (vald) return '<button type="button" class="bak" data-bak="kandidater">‹ Alla kandidater</button>' + kandDetalj(vald);
    var q = S.ksok.toLowerCase();
    var ks = alla.filter(function (p) { return !q || String(p.namn).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) {
      return (a.kvar ? 0 : 1) - (b.kvar ? 0 : 1) || b.sv - a.sv || (b.ja ? 1 : 0) - (a.ja ? 1 : 0) || b.senast - a.senast || String(a.namn).localeCompare(String(b.namn), "sv");
    });
    var h = '<div class="verktyg"><h1>Kandidater</h1><label class="falt">Sök<input type="search" id="ksok" placeholder="Sök kandidat" value="' + esc(S.ksok) + '"></label></div><p class="dov">' + ks.length + " kandidater. De som väntar på dig ligger överst.</p>" + '<div class="kortnat">';
    ks.slice(0, 60).forEach(function (p) { h += kandKort(p); });
    h += "</div>";
    if (ks.length > 60) h += '<p class="dov">Visar 60 av ' + ks.length + ". Sök för att hitta fler.</p>";
    if (!ks.length) h += '<p class="tom">Inga kandidater matchar.</p>';
    return h;
  }

  function rita() {
    ["uppdrag", "kandidater"].forEach(function (f) { var b = $("flik-" + f); if (b) b.setAttribute("aria-current", f === S.flik ? "page" : "false"); });
    $("vy").innerHTML = vNotis() + (S.flik === "kandidater" ? vKandidater() : vUppdrag());
  }
  function behall(id) { var e = $(id); if (e) { e.focus(); var v = e.value; e.value = ""; e.value = v; } }

  async function las(namn) {
    var r = await window.ATS_RUNTIME.vyrad(namn);
    if (r.error) throw new Error(namn + ": " + (r.error.message || "fel"));
    var d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = []; } }
    return Array.isArray(d) ? d : [];
  }
  function signatur() {
    return JSON.stringify([D.roles.map(function (r) { return [r.id, r.status, r.deadline, r.deadline_antagen, r.prio]; }), D.matches.map(function (m) { return [m.id, m.stage, m.dismissed, m.svar && m.svar.at]; }),
      Object.keys(D.cands).filter(harCv), Object.keys(D.kont).map(function (k) { return D.kont[k].length; }), D.psvar.map(function (x) { var d = x.data || {}; return [x.id, x.status, !!d.vantarPaFilip, d.fel || ""]; })]);
  }
  // tyst = bakgrundskontroll: ritar bara om när något har ändrats, och rör inte sökfält eller rullning i onödan.
  async function hamta(tyst) {
    if (!tyst) $("lage").textContent = "Hämtar…";
    try {
      var x = await Promise.all([las("v_roles_partner"), las("v_matches_partner"), las("v_candidates_partner"), las("v_kontakter_partner"), las("partnersvar").catch(function () { return []; }), las("anvandare").catch(function () { return []; })]);
      D.roles = x[0]; D.matches = x[1]; D.cands = {}; D.kont = {}; D.psvar = x[4];
      x[2].forEach(function (c) { D.cands[c.id] = c; });
      x[3].forEach(function (k) { (D.kont[k.cand_id] || (D.kont[k.cand_id] = [])).push(k); });
      var som = window.ATS_RUNTIME.visaSom && window.ATS_RUNTIME.visaSom();
      var jag = x[5].filter(function (a) { return som ? String(a.email).toLowerCase() === som : a.roll === "partner"; })[0] || {};
      D.namn = jag.namn || "";
      var fn = String(D.namn).split(" ")[0];
      D.sidnamn = fn ? "ATS " + fn : "ATS";
      $("sidnamn").textContent = D.sidnamn;
      $("jag").textContent = fn ? fn.charAt(0).toUpperCase() : "";
      if (N.forsta) { N.nyckel = "ats-partner-sett:" + (som || "jag"); lasSett(); }
      $("lage").textContent = "Uppdaterad " + new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
      var sg = signatur(), andrad = sg !== D.sign; D.sign = sg;
      avisera(); N.forsta = false;
      if (!tyst || andrad) { var akt = document.activeElement && document.activeElement.id; rita(); if (akt === "usok" || akt === "ksok") behall(akt); }
    } catch (e) {
      if (tyst) { $("lage").textContent = "Kunde inte uppdatera " + new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }); return; }
      $("lage").textContent = "";
      $("vy").innerHTML = '<p class="tom">Det gick inte att hämta data (' + esc(e.message || e) + "). Ladda om sidan.</p>";
    }
  }

  function start() {
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-flik],[data-roll],[data-kand],[data-bak],#ladda,#sett,#notisknapp") : null;
      if (!t) return;
      if (t.id === "ladda") { hamta(); return; }
      if (t.id === "sett") { N.sett = Date.now(); N.cv = Object.keys(D.cands).filter(harCv); lagra(); avisera(); rita(); return; }
      if (t.id === "notisknapp") { try { var p = Notification.requestPermission(function () { rita(); }); if (p && p.then) p.then(rita, rita); } catch (e) { rita(); } return; }
      if (t.hasAttribute("data-bak")) { if (t.getAttribute("data-bak") === "uppdrag") S.roll = null; else S.kand = null; }
      else if (t.hasAttribute("data-flik")) { S.flik = t.getAttribute("data-flik"); S.roll = null; S.kand = null; }
      else if (t.hasAttribute("data-roll")) { S.roll = t.getAttribute("data-roll"); S.flik = "uppdrag"; }
      else if (t.hasAttribute("data-kand")) { S.kand = t.getAttribute("data-kand"); S.flik = "kandidater"; }
      rita(); window.scrollTo(0, 0);
    });
    document.addEventListener("input", function (ev) {
      var id = ev.target.id;
      if (id === "usok") { S.usok = ev.target.value; rita(); behall("usok"); }
      else if (id === "ksok") { S.ksok = ev.target.value; rita(); behall("ksok"); }
    });
    document.addEventListener("change", function (ev) { if (ev.target.id === "gamla") { S.gamla = ev.target.checked; rita(); } });
    var sek = Math.max(parseInt((window.ATS_CONFIG || {}).POLL_SEK, 10) || 120, 5);
    window.claude.use("user").then(function () { return hamta(); }).then(function () { setInterval(function () { hamta(true); }, sek * 1000); });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { D: D, S: S, N: N, tolka: tolka, dagar: dagar, intresse: intresse, klara: klara, obesvarad: obesvarad, handelser: handelser, sortRoller: sortRoller, motiv: motiv, skalText: skalText, signatur: signatur, vNotis: vNotis, vUppdrag: vUppdrag, vKandidater: vKandidater };
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
