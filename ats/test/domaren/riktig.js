// Domaren, riktiga tryck. Läser public.satsa_las. Bara ägaren. Visar var i kedjan namnen faller bort, per ursprung.
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tid(iso) { if (!iso) return ""; var d = new Date(iso); if (isNaN(d)) return ""; return d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function stor(m) { m = String(m || ""); return m.charAt(0).toUpperCase() + m.slice(1); }
  var STEG = [["visade", "Visade"], ["satsa", "Satsa"], ["styrkta_krav", "Styrkta krav"], ["intresse", "Intresse"], ["kundens_svar", "Kundens svar"], ["tillsatt", "Tillsatt"], ["tillsatt_och_fakturerat", "Tillsatt och fakturerat"]];
  function html(d) {
    var u = d.uppdrag || {}, t = d.tratt || {}, met = Object.keys(t).sort(), tr = d.tryck || [];
    var tratt = met.length ? "<table><thead><tr><th>Ursprung</th>" + STEG.map(function (s) { return "<th>" + esc(s[1]) + "</th>"; }).join("") + "<th>Nej</th><th>Utan besked</th></tr></thead><tbody>" +
      met.map(function (m) { var x = t[m]; return "<tr><td>" + esc(stor(m)) + "</td>" + STEG.map(function (s) { return "<td>" + esc(x[s[0]]) + "</td>"; }).join("") + "<td>" + esc(x.nej) + "</td><td>" + esc(x.utan_besked) + "</td></tr>"; }).join("") + "</tbody></table>"
      : '<p class="liten">Inga namn har visats än.</p>';
    var rader = tr.length ? "<table><thead><tr><th>Tid</th><th>Slag</th><th>Uppdrag</th><th>Namn</th><th>Lista</th><th>Plats</th><th>Besked</th><th>Ursprung</th></tr></thead><tbody>" +
      tr.slice().reverse().map(function (x) { return "<tr><td>" + esc(tid(x.at)) + "</td><td>" + esc(x.slag) + "</td><td>" + esc(x.uppdrag) + "</td><td>" + esc(x.namn || "") + "</td><td>" + esc(x.lista) + "</td><td>" + esc(x.plats) + "</td><td>" + esc(x.besked === "nej" ? "Nej" : "Satsa") + "</td><td>" + esc(x.ursprung ? stor(x.ursprung) : "") + "</td></tr>"; }).join("") + "</tbody></table>"
      : '<p class="liten">Inga tryck än.</p>';
    return '<section class="ruta"><h2>Uppdrag</h2><div class="tal"><div><b>' + esc(u.visade) + "</b><span>visade</span></div><div><b>" + esc(u.satsa) + "</b><span>Satsa</span></div><div><b>" + esc(u.nej) + "</b><span>Nej</span></div><div><b>" + esc(u.utan_besked) + '</b><span>utan besked</span></div></div><p class="liten">Utan besked räknas inte som nej.</p></section>' +
      '<section class="ruta"><h2>Var namnen faller bort</h2>' + tratt + '<div class="dom"><p class="slut">' + esc(d.dom && d.dom.slutsats) + '</p><p class="liten">' + esc(d.dom && d.dom.slutmatt) + "</p></div></section>" +
      '<section class="ruta"><h2>Tryck</h2>' + rader + '<p class="liten">' + esc(d.visningar) + " visningar sparade.</p></section>";
  }
  async function las() {
    var el = document.getElementById("riktig"); if (!el) return;
    var r = await window.ATS_RUNTIME.rpc("satsa_las", {});
    if (r.error) { var m = String(r.error.message || r.error.code || ""); el.innerHTML = '<p class="fel">' + esc(/does not exist|Could not find the function|PGRST202/i.test(m) ? "Listan är inte införd i databasen än." : "Trycken kunde inte läsas: " + m) + "</p>"; return; }
    el.innerHTML = r.data ? html(r.data) : '<p class="fel">Bara ägaren når den här delen.</p>';
  }
  window.RIKTIG_TEST = { html: html };
  if (window.claude && window.claude.use) window.claude.use("user").then(function () { return las(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) las(); });
})();
