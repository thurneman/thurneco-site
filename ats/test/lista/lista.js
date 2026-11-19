// Listan, testvy. Visar partnerns lista: fem uppdrag och fem namn per uppdrag med Satsa.
// Läser public.satsa_lista och trycker med public.satsa_besked. Ett tryck ger ett besked. Ett kort utan tryck har inget besked.
(function () {
  "use strict";
  var data = null, upptagen = false;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tid(iso) { if (!iso) return ""; var d = new Date(iso); if (isNaN(d)) return ""; return d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); }
  function dag(s) { if (!s) return ""; var d = new Date(s + "T12:00:00Z"); if (isNaN(d)) return s; return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long" }); }
  function knappar(k) {
    if (k.besked) return '<p class="besked' + (k.besked === "nej" ? " nej" : "") + '">' + (k.besked === "satsa" ? "Satsa" : "Nej") + " sparat " + esc(tid(k.besked_at)) + ".</p>";
    return '<div class="knappar"><button class="huvud" data-besked="satsa" data-kort="' + esc(k.kort) + '">Satsa</button><button data-besked="nej" data-kort="' + esc(k.kort) + '">Nej</button></div>';
  }
  function namnHtml(n) {
    var u = n.underlag || {};
    return '<div class="kort"><div class="ini" aria-hidden="true">' + esc(u.initialer) + '</div><div><div class="namn">' + esc(u.namn) + "</div>" +
      (u.stod && u.stod.length ? "<h3>Stöd mot kraven</h3><ul>" + u.stod.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (u.stam_av && u.stam_av.length ? "<h3>Att stämma av</h3><ul>" + u.stam_av.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      knappar(n) + "</div></div>";
  }
  function uppHtml(x) {
    var u = x.underlag || {};
    var rad = [u.ort, u.omfattning, u.period, u.svarsdag ? "Svar senast " + dag(u.svarsdag) + (u.svarstid ? " kl " + u.svarstid : "") : ""].filter(Boolean);
    var namn = x.namn || [];
    return '<div class="upp"><div class="namn">' + esc(u.titel) + '</div><div class="rad">' + rad.map(function (r) { return "<span>" + esc(r) + "</span>"; }).join("") + "</div>" + knappar(x) +
      (x.besked === "satsa" ? (namn.length ? '<div class="namnlista">' + namn.map(namnHtml).join("") + "</div>" : '<p class="liten">Inga namn finns på uppdraget än.</p>') : "") + "</div>";
  }
  function render(fel) {
    var app = document.getElementById("app");
    if (!data) { app.innerHTML = '<p class="fel">' + esc(fel || "Listan går inte att läsa.") + "</p>"; return; }
    var upp = data.uppdrag || [];
    app.innerHTML = (fel ? '<p class="fel">' + esc(fel) + "</p>" : "") + '<section class="ruta">' +
      (upp.length ? upp.map(uppHtml).join("") : "<p>Inga uppdrag med svarsdag just nu.</p>") + "</section>";
  }
  async function las() {
    var r = await window.ATS_RUNTIME.rpc("satsa_lista", {});
    if (r.error) { data = null; var m = String(r.error.message || r.error.code || ""); render(/does not exist|Could not find the function|PGRST202/i.test(m) ? "Listan är inte införd i databasen än." : "Listan kunde inte läsas: " + m); return; }
    data = r.data; render();
  }
  async function tryck(kort, besked) {
    if (upptagen) return;
    upptagen = true;
    document.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    var fel = null;
    try { var r = await window.ATS_RUNTIME.rpc("satsa_besked", { p_kort: kort, p_besked: besked }); if (r.error) fel = String(r.error.message || r.error.code || "fel"); } catch (e) { fel = String(e && e.message || e); }
    upptagen = false;
    await las();
    if (fel) render(fel);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-besked]");
    if (!b || b.disabled) return;
    tryck(b.dataset.kort, b.dataset.besked);
  });
  window.LISTA_TEST = { uppHtml: uppHtml, namnHtml: namnHtml, knappar: knappar, tryck: tryck, satt: function (d) { data = d; } };
  if (window.claude && window.claude.use) window.claude.use("user").then(function () { return las(); });
})();
