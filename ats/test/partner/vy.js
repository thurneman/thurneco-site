/*
 * Nya partnervyn, steg 1: bara läsning.
 * Läser partnervyerna (v_roles_partner, v_matches_partner, v_candidates_partner, v_kontakter_partner)
 * genom ATS_RUNTIME.vyrad. Ägaren ser partnerns urval genom Visa som. Inget skrivs härifrån.
 * Obs inför skarp inloggning för partnern: vyrad utan Visa som hämtar högst 1000 rader per vy.
 */
(function () {
  "use strict";
  var D = { roles: [], matches: [], cands: {}, kont: {}, psvar: [], namn: "" };
  var S = { flik: "oversikt", roll: null, kand: null, gamla: false, usok: "", ksok: "", omr: "" };
  var OPPNA = ["ny", "pagar", "presenterad"];
  var STEG = { matchad: "Föreslagen", ansokt: "Har ansökt", kontaktad: "Kontaktad", intresserad: "Intresserad", presenterad: "Inskickad till kund", intervju: "Intervju", erbjudande: "Erbjudande", avslutad: "Avslutad" };
  var RANG = { erbjudande: 7, intervju: 6, presenterad: 5, intresserad: 4, ansokt: 3, kontaktad: 2, matchad: 1, avslutad: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kort(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }
  function ini(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase(); }
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
    var t = Date.parse(iso); if (isNaN(t)) return "";
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 60) return "För " + Math.max(min, 1) + " min sedan";
    if (min < 24 * 60) return "För " + Math.round(min / 60) + " timmar sedan";
    var dg = Math.round(min / 1440);
    if (dg === 1) return "I går";
    if (dg < 14) return "För " + dg + " dagar sedan";
    return new Date(t).toLocaleDateString("sv-SE");
  }
  function datum(iso) { var t = Date.parse(iso); return isNaN(t) ? "" : new Date(t).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function lista(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

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
  function iRoll(id) { return D.matches.filter(function (m) { return m.role_id === id && !m.dismissed && m.stage !== "avslutad"; }); }
  function obesvarad(m) {
    var s = m.svar;
    if (!s || m.dismissed || m.stage === "avslutad" || ["positiv", "fraga"].indexOf(s.tolkning) < 0) return false;
    var t = Date.parse(s.at); if (isNaN(t)) t = 0;
    var ut = (D.kont[m.cand_id] || []).some(function (k) { return k.riktning === "ut" && (!k.role_id || k.role_id === m.role_id) && Date.parse(k.at) > t; });
    if (ut) return false;
    return !D.psvar.some(function (p) { return p.match_id === m.id && Date.parse(p.at || p.created_at) > t; });
  }
  function bedomning(m) { var b = m.partner_bedomning && m.partner_bedomning.bedomning; return b === "ja" ? "Intressant" : b === "nej" ? "Ej intressant" : "Obedömd"; }
  function motiv(m) { var r = m.rekommendation || lista(m.belagt)[0] || ""; return kort(typeof r === "string" ? r : "", 150); }
  function cvRad(c) { return c && c.cv ? '<span class="chip gron">CV finns</span>' : '<span class="chip gra">CV saknas</span>'; }
  function rund(n, stor) { return '<span class="rund' + (stor ? " stor" : "") + '" aria-hidden="true">' + esc(ini(n)) + "</span>"; }
  function attGora(r) {
    var ms = iRoll(r.id), sv = ms.filter(obesvarad).length;
    if (sv) return "Svara " + sv + (sv === 1 ? " kandidat" : " kandidater");
    var ob = ms.filter(function (m) { return !(m.partner_bedomning && m.partner_bedomning.bedomning); }).length;
    if (ob) return "Bedöm " + ob + (ob === 1 ? " kandidat" : " kandidater");
    if (!ms.length) return "Inga kandidater än";
    return ms.length + (ms.length === 1 ? " kandidat i uppdraget" : " kandidater i uppdraget");
  }
  function sortRoller(a, b) {
    var pa = prio(a), pb = prio(b);
    if (pa !== pb) return pa - pb;
    var da = dagar(a), db = dagar(b);
    if (da === null) da = 9999; if (db === null) db = 9999;
    return da - db || String(a.title).localeCompare(String(b.title), "sv");
  }

  // ---------- Översikt ----------
  function vOversikt() {
    var sv = D.matches.filter(obesvarad).sort(function (a, b) { return Date.parse(b.svar.at) - Date.parse(a.svar.at); });
    var h = '<h1>Översikt</h1><div class="tva"><section class="kort"><div class="rubrikrad"><h2>Positiva svar</h2><span class="antal">' + sv.length + "</span></div>";
    if (!sv.length) h += '<p class="tom">Inga svar väntar på dig just nu.</p>';
    sv.slice(0, 12).forEach(function (m) {
      var r = roll(m.role_id) || {};
      h += '<button type="button" class="rad" data-kand="' + esc(m.cand_id) + '">' + rund(m.cand_name) +
        '<span class="mitt"><span class="namn">' + esc(m.cand_name) + '</span><span class="dov">' + esc((r.ref ? r.ref + " · " : "") + (r.title || "")) + (oppen(r) ? "" : " · stängt uppdrag") + '</span><span>"' + esc(kort(m.svar.text, 160)) + '"</span></span>' +
        '<span class="tid">' + esc(nar(m.svar.at)) + '</span><span class="pil" aria-hidden="true">›</span></button>';
    });
    if (sv.length > 12) h += '<p class="dov">och ' + (sv.length - 12) + " till</p>";
    h += '<button type="button" class="lank" data-flik="kandidater">Visa alla kandidater ›</button></section>';
    var pr = D.roles.filter(function (r) { return oppen(r) && r.prio !== "skip"; }).sort(function (a, b) {
      var sa = iRoll(a.id).filter(obesvarad).length ? 0 : 1, sb = iRoll(b.id).filter(obesvarad).length ? 0 : 1;
      return sa - sb || sortRoller(a, b);
    }).slice(0, 5);
    h += '<section class="kort"><h2>Prioriterade uppdrag</h2>';
    if (!pr.length) h += '<p class="tom">Inga öppna uppdrag.</p>';
    pr.forEach(function (r) {
      var k = kvar(r);
      h += '<button type="button" class="rad" data-roll="' + esc(r.id) + '"><span class="mitt"><span class="namn">' + esc(r.title) + '</span><span class="dov">' + esc((r.ref || "") + (r.location ? " · " + r.location : "")) + "</span><span>" + esc(attGora(r)) + '</span></span>' +
        '<span class="chip ' + k.k + '">' + esc(k.t) + '</span><span class="pil" aria-hidden="true">›</span></button>';
    });
    h += '<button type="button" class="lank" data-flik="uppdrag">Visa alla uppdrag ›</button></section></div>';
    return h;
  }

  // ---------- Uppdrag ----------
  function vUppdrag() {
    var q = S.usok.toLowerCase();
    var rs = D.roles.filter(function (r) { return (S.gamla || oppen(r)) && (!q || (String(r.title) + " " + String(r.ref)).toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) {
      return (oppen(a) ? 0 : 1) - (oppen(b) ? 0 : 1) || sortRoller(a, b);
    });
    if (!S.roll || !rs.some(function (r) { return r.id === S.roll; })) S.roll = rs.length ? rs[0].id : null;
    var h = '<div class="delad"><aside><h2>Uppdrag</h2><label class="falt">Sök<input type="search" id="usok" placeholder="Sök titel eller uppdragsnummer" value="' + esc(S.usok) + '"></label><div class="lista">';
    rs.slice(0, 200).forEach(function (r) {
      var k = kvar(r);
      h += '<button type="button" class="val' + (r.id === S.roll ? " vald" : "") + '" data-roll="' + esc(r.id) + '"><span class="mitt"><span class="fet">' + esc((r.ref ? r.ref + " · " : "") + r.title) + '</span><span class="dov">' + iRoll(r.id).length + ' kandidater</span></span><span class="chip ' + k.k + '">' + esc(k.t) + "</span></button>";
    });
    if (!rs.length) h += '<p class="tom">Inga uppdrag matchar.</p>';
    h += '</div><label class="kryss"><input type="checkbox" id="gamla"' + (S.gamla ? " checked" : "") + "> Visa passerade och arkiverade</label></aside><main>";
    var r = roll(S.roll);
    if (!r) return h + '<p class="tom">Välj ett uppdrag i listan.</p></main></div>';
    var k = kvar(r), ms = iRoll(r.id).sort(function (a, b) {
      return (obesvarad(b) ? 1 : 0) - (obesvarad(a) ? 1 : 0) || (RANG[b.stage] || 0) - (RANG[a.stage] || 0) || String(a.cand_name).localeCompare(String(b.cand_name), "sv");
    });
    h += "<h1>" + esc(r.title) + '</h1><p class="under">' + esc([r.ref, r.location, r.category].filter(Boolean).join(" · ")) + '</p><p><span class="chip ' + k.k + '">' + esc(k.t) + "</span>" +
      (r.deadline ? ' <span class="dov">Sista dag ' + esc(r.deadline) + "</span>" : (slut(r).ant ? ' <span class="dov">Sista dag ' + esc(r.deadline_antagen) + " (antagen)</span>" : "")) + "</p>";
    if (typeof r.brief === "string" && r.brief) h += "<p>" + esc(kort(r.brief, 260)) + "</p>";
    h += '<section class="del"><h2>I uppdraget</h2><p class="dov">' + ms.length + (ms.length === 1 ? " kandidat" : " kandidater") + ". Bedömningen görs här när knapparna kommer i nästa steg.</p>";
    ms.slice(0, 60).forEach(function (m) {
      h += '<button type="button" class="rad" data-kand="' + esc(m.cand_id) + '">' + rund(m.cand_name) + '<span class="mitt"><span class="namn">' + esc(m.cand_name) + '</span><span>' + esc(motiv(m)) + '</span></span>' +
        '<span class="chips">' + (obesvarad(m) ? '<span class="chip gron">Väntar på svar från dig</span>' : "") + '<span class="chip bla">' + esc(STEG[m.stage] || m.stage) + "</span>" + cvRad(D.cands[m.cand_id]) + '<span class="chip gra">' + esc(bedomning(m)) + '</span></span><span class="pil" aria-hidden="true">›</span></button>';
    });
    if (ms.length > 60) h += '<p class="dov">och ' + (ms.length - 60) + " till</p>";
    if (!ms.length) h += '<p class="tom">Inga kandidater i uppdraget än.</p>';
    h += '</section><section class="del"><h2>Föreslagna kandidater</h2><p class="dov">Förslag ur kandidatdatabasen, Generera kandidater och Lägg till egen kandidat kommer i nästa steg.</p></section></main></div>';
    return h;
  }

  // ---------- Kandidater ----------
  function kandLista() {
    var per = {};
    D.matches.forEach(function (m) {
      if (m.dismissed) return;
      var p = per[m.cand_id] || (per[m.cand_id] = { id: m.cand_id, namn: m.cand_name, ms: [], sv: 0, senast: 0, omr: {} });
      p.ms.push(m);
      if (obesvarad(m)) p.sv++;
      var t = m.svar && Date.parse(m.svar.at); if (t && t > p.senast) p.senast = t;
      var r = roll(m.role_id); if (r && r.category) p.omr[r.category] = 1;
    });
    return Object.keys(per).map(function (k) { return per[k]; });
  }
  function vKandidater() {
    var alla = kandLista(), q = S.ksok.toLowerCase(), omr = {};
    alla.forEach(function (p) { Object.keys(p.omr).forEach(function (o) { omr[o] = 1; }); });
    var ks = alla.filter(function (p) { return (!q || String(p.namn).toLowerCase().indexOf(q) >= 0) && (!S.omr || p.omr[S.omr]); }).sort(function (a, b) {
      return b.sv - a.sv || b.senast - a.senast || String(a.namn).localeCompare(String(b.namn), "sv");
    });
    if (!S.kand || !alla.some(function (p) { return p.id === S.kand; })) S.kand = ks.length ? ks[0].id : null;
    var h = '<div class="delad"><aside><h2>Kandidater</h2><label class="falt">Sök<input type="search" id="ksok" placeholder="Sök kandidat" value="' + esc(S.ksok) + '"></label><label class="falt">Filter<select id="omr"><option value="">Kompetensområde</option>';
    Object.keys(omr).sort().forEach(function (o) { h += '<option value="' + esc(o) + '"' + (o === S.omr ? " selected" : "") + ">" + esc(o) + "</option>"; });
    h += '</select></label><div class="lista">';
    ks.slice(0, 150).forEach(function (p) {
      var c = D.cands[p.id] || {};
      h += '<button type="button" class="val' + (p.id === S.kand ? " vald" : "") + '" data-kand="' + esc(p.id) + '"><span class="mitt"><span class="fet">' + esc(p.namn) + '</span><span class="dov">' + esc(p.sv ? "Väntar på svar från dig" : (c.cv ? "CV finns" : "CV saknas")) + "</span></span></button>";
    });
    if (ks.length > 150) h += '<p class="dov">Visar 150 av ' + ks.length + ". Sök för att hitta fler.</p>";
    if (!ks.length) h += '<p class="tom">Inga kandidater matchar.</p>';
    h += "</div></aside><main>";
    var p = alla.filter(function (x) { return x.id === S.kand; })[0];
    if (!p) return h + '<p class="tom">Välj en kandidat i listan.</p></main></div>';
    var c = D.cands[p.id] || {};
    h += '<div class="huvud">' + rund(p.namn, true) + "<div><h1>" + esc(p.namn) + "</h1>" + (c.tillganglig ? '<p class="under">Tillgänglig: ' + esc(c.tillganglig) + "</p>" : "") + (c.note ? "<p>" + esc(kort(c.note, 220)) + "</p>" : "") + "<p>" + cvRad(c) + "</p></div></div>";
    var sen = p.ms.filter(function (m) { return m.svar && m.svar.text; }).sort(function (a, b) { return Date.parse(b.svar.at) - Date.parse(a.svar.at); })[0];
    if (sen) { var sr = roll(sen.role_id) || {}; h += '<div class="svar"><span class="chip gron">Senaste svar' + (sr.ref ? " · " + esc(sr.ref) : "") + '</span><span class="mitt">' + esc(kort(sen.svar.text, 240)) + '</span><span class="tid">' + esc(nar(sen.svar.at)) + "</span></div>"; }
    var kt = (D.kont[p.id] || []).slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
    h += '<section class="del"><h2>Konversation</h2>';
    if (!kt.length) h += '<p class="tom">Ingen kontakt loggad än.</p>';
    kt.slice(-30).forEach(function (k) {
      var kr = roll(k.role_id) || {};
      h += '<div class="medd ' + (k.riktning === "in" ? "in" : "ut") + '"><div class="dov">' + esc((k.riktning === "in" ? p.namn : (k.av || "Vi")) + " · " + datum(k.at) + (kr.ref ? " · " + kr.ref : "")) + "</div><div>" + esc(kort(k.text, 900)) + "</div></div>";
    });
    h += '</section><section class="del"><h2>Passande uppdrag</h2>';
    p.ms.slice().sort(function (a, b) { var ra = roll(a.role_id) || {}, rb = roll(b.role_id) || {}; return (oppen(ra) ? 0 : 1) - (oppen(rb) ? 0 : 1) || (RANG[b.stage] || 0) - (RANG[a.stage] || 0); }).slice(0, 25).forEach(function (m) {
      var r = roll(m.role_id); if (!r) return;
      var k = kvar(r);
      h += '<button type="button" class="rad" data-roll="' + esc(r.id) + '"><span class="mitt"><span class="namn">' + esc(r.title) + '</span><span class="dov">' + esc([r.ref, r.location].filter(Boolean).join(" · ")) + "</span><span>" + esc(motiv(m)) + '</span></span><span class="chips"><span class="chip bla">' + esc(STEG[m.stage] || m.stage) + '</span><span class="chip ' + k.k + '">' + esc(k.t) + '</span></span><span class="pil" aria-hidden="true">›</span></button>';
    });
    return h + "</section></main></div>";
  }

  function rita() {
    ["oversikt", "kandidater", "uppdrag"].forEach(function (f) { var b = $("flik-" + f); if (b) b.setAttribute("aria-current", f === S.flik ? "page" : "false"); });
    $("vy").innerHTML = S.flik === "uppdrag" ? vUppdrag() : S.flik === "kandidater" ? vKandidater() : vOversikt();
  }
  function behall(id) { var e = $(id); if (e) { e.focus(); var v = e.value; e.value = ""; e.value = v; } }

  async function las(namn) {
    var r = await window.ATS_RUNTIME.vyrad(namn);
    if (r.error) throw new Error(namn + ": " + (r.error.message || "fel"));
    var d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = []; } }
    return Array.isArray(d) ? d : [];
  }
  async function hamta() {
    $("lage").textContent = "Hämtar…";
    try {
      var x = await Promise.all([las("v_roles_partner"), las("v_matches_partner"), las("v_candidates_partner"), las("v_kontakter_partner"), las("partnersvar").catch(function () { return []; }), las("anvandare").catch(function () { return []; })]);
      D.roles = x[0]; D.matches = x[1]; D.cands = {}; D.kont = {}; D.psvar = x[4];
      x[2].forEach(function (c) { D.cands[c.id] = c; });
      x[3].forEach(function (k) { (D.kont[k.cand_id] || (D.kont[k.cand_id] = [])).push(k); });
      var som = window.ATS_RUNTIME.visaSom && window.ATS_RUNTIME.visaSom();
      var jag = x[5].filter(function (a) { return som ? String(a.email).toLowerCase() === som : a.roll === "partner"; })[0] || x[5][0] || {};
      D.namn = jag.namn || "";
      var fn = String(D.namn).split(" ")[0];
      $("sidnamn").textContent = fn ? "ATS " + fn : "ATS";
      document.title = $("sidnamn").textContent;
      $("jag").textContent = fn ? fn.charAt(0).toUpperCase() : "";
      $("lage").textContent = "Uppdaterad " + new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
      rita();
    } catch (e) {
      $("lage").textContent = "";
      $("vy").innerHTML = '<p class="tom">Det gick inte att hämta data (' + esc(e.message || e) + "). Ladda om sidan.</p>";
    }
  }

  function start() {
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-flik],[data-roll],[data-kand],#ladda") : null;
      if (!t) return;
      if (t.id === "ladda") { hamta(); return; }
      if (t.hasAttribute("data-flik")) S.flik = t.getAttribute("data-flik");
      else if (t.hasAttribute("data-roll")) { S.roll = t.getAttribute("data-roll"); S.flik = "uppdrag"; var r = roll(S.roll); if (r && !oppen(r)) S.gamla = true; }
      else if (t.hasAttribute("data-kand")) { S.kand = t.getAttribute("data-kand"); S.flik = "kandidater"; S.ksok = ""; S.omr = ""; }
      rita(); window.scrollTo(0, 0);
    });
    document.addEventListener("input", function (ev) {
      var id = ev.target.id;
      if (id === "usok") { S.usok = ev.target.value; rita(); behall("usok"); }
      else if (id === "ksok") { S.ksok = ev.target.value; rita(); behall("ksok"); }
    });
    document.addEventListener("change", function (ev) {
      var id = ev.target.id;
      if (id === "gamla") { S.gamla = ev.target.checked; rita(); }
      else if (id === "omr") { S.omr = ev.target.value; rita(); }
    });
    window.claude.use("user").then(hamta);
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { D: D, S: S, tolka: tolka, dagar: dagar, vOversikt: vOversikt, vUppdrag: vUppdrag, vKandidater: vKandidater };
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
