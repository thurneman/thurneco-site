// Domaren, demo. Testsida för ägaren. Läser public.dom_las och trycker med public.dom_besked.
// Kortet visas som partnern skulle se det: inga metodnamn, ingen poäng. Domarens sida visar talen och domen.
(function () {
  "use strict";
  var PROV = "demo-domaren-v1";
  var data = null, upptagen = false, nollArm = 0;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tid(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d)) return "";
    return d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  var KUND = { vill_traffa: "Kunden vill träffa personen", mer_underlag: "Kunden vill ha mer underlag", nej: "Kunden har sagt nej" };
  function metodNamn(m) { m = String(m || ""); return m.charAt(0).toUpperCase() + m.slice(1); }

  function kortHtml(k) {
    var u = k.underlag || {};
    var knappar = k.besked
      ? '<p class="besked">' + (k.besked === "satsa" ? "Satsa" : "Avstå") + " sparat " + esc(tid(k.besked_at)) + ". Ett nytt tryck ändrar inget.</p>"
      : '<div class="knappar"><button class="huvud" data-besked="satsa" data-kort="' + esc(k.id) + '">Satsa</button><button data-besked="avsta" data-kort="' + esc(k.id) + '">Avstå</button></div>';
    return '<div class="kort"><div class="ini" aria-hidden="true">' + esc(u.initialer) + "</div><div>" +
      '<div class="namn">' + esc(u.namn) + '</div><div class="sub">' + esc([u.titel, u.ort].filter(Boolean).join(", ")) + "</div>" +
      '<p class="liten">Uppdrag: ' + esc(u.uppdrag) + "</p>" +
      (u.stod && u.stod.length ? "<h3>Stöd mot kraven</h3><ul>" + u.stod.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (u.stam_av && u.stam_av.length ? "<h3>Att stämma av</h3><ul>" + u.stam_av.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      knappar + "</div></div>";
  }

  function talHtml(t) {
    var rad = [
      [t.bedomda, t.bedomda === 1 ? "bedömd person" : "bedömda personer"], [t.satsa, "Satsa"], [t.ursprung, "ursprung"],
      [t.exklusiva, "exklusiva fynd"], [t.styrkta_satsa, "fullt styrkta Satsa"],
      [t.kundsvar ? t.kundsvar : "saknas", t.kundsvar ? "kundsvar" : "kundsvar"]
    ];
    return '<div class="tal">' + rad.map(function (r) { return "<div><b>" + esc(r[0]) + "</b><span>" + esc(r[1]) + "</span></div>"; }).join("") + "</div>";
  }

  function domHtml(d) {
    var pb = d.partnerns_besked || {}, kb = d.kundens_beslut || {};
    var kund = kb.kundsvar ? [kb.vill_traffa ? kb.vill_traffa + " vill träffa" : "", kb.mer_underlag ? kb.mer_underlag + " vill ha mer underlag" : "", kb.nej ? kb.nej + " nej" : ""].filter(Boolean).join(", ") : "Kundsvar saknas";
    return '<div class="dom"><p><b>Fråga:</b> ' + esc(d.fraga) + "</p><p><b>Utfall:</b> " + esc(d.utfall) + '</p><p class="slut">' + esc(d.slutsats) + "</p><p><b>Vad skulle ändra den:</b> " + esc(d.vad_skulle_andra) + "</p>" +
      '<div class="tva"><div><p class="etikett">Partnerns besked om profilen</p><p>' + esc(pb.satsa) + " Satsa, " + esc(pb.avsta) + " Avstå, " + esc(pb.utan_besked) + ' utan besked. Utan besked räknas inte som nej.</p></div>' +
      '<div><p class="etikett">Kundens beslut</p><p>' + esc(kund) + "</p></div></div></div>";
  }

  function sparHtml(s, prov) {
    var roll = (prov.roller || []).filter(function (r) { return r.roll_id === s.roll && r.kravversion === s.kravversion; })[0] || { ska_krav: [] };
    var urs = s.ursprung || [];
    var rader = roll.ska_krav.map(function (k) {
      var celler = urs.map(function (u) { var v = u.belagg && u.belagg[k.id]; return v ? "<td>" + esc(v) + "</td>" : '<td class="saknas">saknas</td>'; }).join("");
      return "<tr><td>" + esc(k.text) + "</td>" + celler + "</tr>";
    }).join("");
    return "<details><summary>Spåret bakom kortet</summary>" +
      '<p class="liten">Prov ' + esc(prov.id) + ", uppdrag " + esc(s.roll) + ", kravversion " + esc(s.kravversion) + ", kandidat " + esc(s.kandidat) + ", lista " + esc(s.lista) + ", plats " + esc(s.plats) + ", visat " + esc(tid(s.visat_at)) + ".</p>" +
      "<table><thead><tr><th>Ska-krav</th>" + urs.map(function (u) { return "<th>" + esc(metodNamn(u.metod)) + "</th>"; }).join("") + "</tr></thead><tbody>" + rader + "</tbody></table>" +
      '<p class="liten">Besked: ' + (s.besked ? esc(s.besked.besked) + " av " + esc(s.besked.av) + ", " + esc(tid(s.besked.at)) : "inget än") + ".</p>" +
      '<p class="liten">Kundbesked: ' + ((s.kundbesked || []).length ? s.kundbesked.map(function (x) { return esc(KUND[x.utfall] || x.utfall) + (x.fiktivt ? " (fiktivt)" : "") + ", " + esc(tid(x.at)); }).join("; ") : "inget än") + ".</p></details>";
  }

  function render(fel) {
    var app = document.getElementById("app");
    if (!data) { app.innerHTML = '<p class="fel">' + esc(fel || "Domaren går inte att läsa.") + "</p>"; return; }
    var k = (data.kort || [])[0];
    var harSatsa = !!(k && k.besked === "satsa");
    var domar = data.domar || [];
    app.innerHTML =
      (fel ? '<p class="fel">' + esc(fel) + "</p>" : "") +
      '<section class="ruta"><p class="etikett">Kortet som partnern skulle se det</p>' + (k ? kortHtml(k) : "<p>Inget kort.</p>") + "</section>" +
      '<section class="ruta"><h2>Domarens sida</h2>' + talHtml(data.nu.tal) + "<h3>Domen nu</h3>" + domHtml(data.nu) +
      '<div class="knappar"><button id="kundbesked"' + (harSatsa ? "" : " disabled") + '>Lägg till fiktivt kundbesked: kunden vill träffa personen</button></div>' +
      (harSatsa ? "" : '<p class="liten">Kundbeskedet går att lägga till efter Satsa.</p>') + "</section>" +
      '<section class="ruta"><h2>Domar med datum</h2>' + (domar.length ? domar.slice().reverse().map(function (d) {
        return '<div class="hist"><div class="tid">' + esc(tid(d.at)) + ", efter " + esc(d.handelse) + "</div><div>" + esc(d.utfall) + "</div><div><b>" + esc(d.slutsats) + "</b></div></div>";
      }).join("") : '<p class="liten">Ingen dom än. Den första kommer när kortet får ett besked.</p>') + "</section>" +
      '<section class="ruta">' + ((data.spar || [])[0] ? sparHtml(data.spar[0], data.prov) : "") +
      '<p class="liten">Vinstregel: ' + esc(data.prov.vinstregel) + "</p>" +
      '<div class="knappar"><button id="nollstall">' + (nollArm > Date.now() ? "Tryck igen för att börja om" : "Börja om demon") + "</button></div>" +
      '<p class="liten">Börja om tar bort besked och kundbesked i demoprovet, inget annat.</p></section>';
  }

  async function las() {
    var r = await window.ATS_RUNTIME.rpc("dom_las", { p_prov: PROV });
    if (r.error) {
      data = null;
      var m = String(r.error.message || r.error.code || "");
      render(/does not exist|Could not find the function|PGRST202/i.test(m) ? "Domaren är inte införd i databasen än." : "Domaren kunde inte läsas: " + m);
      return;
    }
    data = r.data;
    if (!data) { render("Demoprovet finns inte i databasen."); return; }
    render();
  }

  async function anropa(namn, arg) {
    if (upptagen) return;
    upptagen = true;
    document.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    var fel = null;
    try {
      var r = await window.ATS_RUNTIME.rpc(namn, arg);
      if (r.error) fel = String(r.error.message || r.error.code || "fel");
    } catch (e) { fel = String(e && e.message || e); }
    upptagen = false;
    await las();
    if (fel) render(fel);
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.besked) { anropa("dom_besked", { p_kort: b.dataset.kort, p_besked: b.dataset.besked }); return; }
    if (b.id === "kundbesked") { var k = data && data.kort && data.kort[0]; if (k) anropa("dom_kundbesked", { p_kort: k.id, p_utfall: "vill_traffa" }); return; }
    if (b.id === "nollstall") {
      if (nollArm > Date.now()) { nollArm = 0; anropa("dom_nollstall_demo", { p_prov: PROV }); }
      else { nollArm = Date.now() + 6000; render(); setTimeout(function () { if (nollArm && nollArm <= Date.now()) { nollArm = 0; render(); } }, 6200); }
    }
  });

  window.DOMAREN_TEST = { kortHtml: kortHtml, talHtml: talHtml, domHtml: domHtml, sparHtml: sparHtml };
  if (window.claude && window.claude.use) window.claude.use("user").then(function () { return las(); });
})();
