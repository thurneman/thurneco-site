/* Partners write through scoped ATS functions. The normal partner views supply the readback. */
const TomasManual = (function installManualRegistration() {
  "use strict";

  const consultantFields = `
    <label>Förnamn<input name="first" autocomplete="given-name" required maxlength="120"></label>
    <label>Efternamn<input name="last" autocomplete="family-name" maxlength="120"></label>
    <label>LinkedIn-profil<input type="url" name="linkedin" placeholder="https://www.linkedin.com/in/namn" maxlength="400"></label>
    <label>Telefon<input type="tel" name="phone" maxlength="80"></label>
    <label>Mejl<input type="email" name="email" maxlength="254"></label>
    <label>Profiltext<textarea name="note" rows="4" maxlength="4000"></textarea></label>`;
  const assignmentFields = `
    <label>Uppdragets titel<input name="title" required maxlength="200"></label>
    <label>Ort<input name="location" maxlength="160"></label>
    <label>Sista svarsdag<input type="date" name="deadline"></label>
    <label>Uppdragsbeskrivning och krav<textarea name="brief" rows="5" maxlength="8000"></textarea></label>`;

  function allowed() {
    return partnerCanCreate() && typeof window.ATS_RUNTIME?.rpc === "function";
  }

  function renderCreate(container) {
    container.innerHTML = `<div class="page p12-register p12-create"><h1>Lägg till</h1>${
      allowed() ? `<div class="acts">
        <button type="button" class="btn" data-manual-new="consultant">Konsult</button>
        <button type="button" class="btn light" data-manual-new="assignment">Uppdrag</button>
      </div>` : '<p>Öppna din skrivbara partnervy för att lägga till.</p>'
    }</div>`;
  }

  function candidateActions(person) {
    if (!allowed() || cands.get(person.id) !== person) return "";
    return `<section class="px-d-pane"><h2>Arbeta med konsulten</h2>
      <button type="button" class="btn small" data-manual-link="${esc(person.id)}">Koppla till uppdrag</button>
      ${matchaHTML("kandidat", person.id, "")}</section>`;
  }

  function message(form, value) {
    form.querySelector("[data-manual-status]").textContent = value;
  }

  function formDialog(title, fields, submitTitle, save) {
    const {bg} = modal(title, `<form data-manual-form>${fields}
      <p class="cnote" role="status" aria-live="polite" data-manual-status></p>
      <div class="acts"><button type="button" class="btn light" data-close>Avbryt</button>
      <button type="submit" class="btn">${esc(submitTitle)}</button></div></form>`);
    const form = bg.querySelector("form");
    const submit = form.querySelector("[type=submit]");
    const actor = pxWorkActor();
    const hasAccess = () => allowed() && pxWorkActor() === actor;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submit.disabled) return;
      if (!hasAccess()) { message(form, "Din åtkomst har ändrats. Öppna formuläret igen."); return; }
      submit.disabled = true;
      bg.dataset.busy = "1";
      message(form, "Sparar …");
      try {
        await save(form, bg, hasAccess);
      } catch (error) {
        if (form.isConnected) message(form, error.message || "Det gick inte att bekräfta sparningen.");
      } finally {
        if (form.isConnected) { delete bg.dataset.busy; submit.disabled = false; }
      }
    });
  }

  async function rpc(name, args) {
    const {data, error} = await window.ATS_RUNTIME.rpc(name, args);
    if (error) {
      if (error.code === "PGRST202") throw Error("Den här funktionen har ännu inte installerats i ATS.");
      if (error.code === "42501") throw Error("Åtkomst saknas för det här valet.");
      if (error.code === "22023" || error.code === "P0001") throw Error(error.message);
      throw Error("Sparningen kunde inte bekräftas. Försök igen i samma formulär.");
    }
    if (!data || typeof data.id !== "string" || !data.id || typeof data.created !== "boolean") {
      throw Error("Kvittensen gick inte att läsa. Försök igen i samma formulär.");
    }
    return data;
  }

  async function showRecord(bg, collection, id, kind, hasAccess, title) {
    const drawer = bg.querySelector(".drawer");
    drawer.innerHTML = `<h2>${esc(title)}</h2><p role="status">Hämtar kortet …</p><div class="acts">
      <button type="button" class="btn" data-manual-open>Öppna kortet</button>
      <button type="button" class="btn light" data-close>Stäng</button></div>`;
    delete bg.dataset.busy;
    const button = drawer.querySelector("[data-manual-open]");
    const status = drawer.querySelector("[role=status]");
    async function readCard(navigate) {
      button.disabled = true;
      try {
        if (!hasAccess()) throw Error();
        const snapshot = await db.doc(collection + "/" + id).get();
        if (!hasAccess() || !bg.isConnected || !snapshot.exists) throw Error();
        const map = collection === "roles" ? roles : collection === "matches" ? matches : cands;
        map.set(id, {...snapshot.data(), id});
        render();
        if (!workLabel(kind, id)) throw Error();
        status.textContent = "Kortet är sparat och synligt i ditt register.";
        button.textContent = "Öppna kortet";
        if (navigate) { bg.remove(); visitWorkTab({kind, id}); }
      } catch {
        status.textContent = "Sparningen är kvitterad. Kortet kunde inte läsas tillbaka.";
        button.textContent = "Hämta kortet igen";
      } finally { button.disabled = false; }
    }
    button.addEventListener("click", () => readCard(true));
    await readCard(false);
  }

  function newRecord(kind) {
    if (view !== "skapa" || !allowed() || !["consultant","assignment"].includes(kind)) return;
    const consultant = kind === "consultant";
    const requestId = crypto.randomUUID();
    const title = consultant ? "Ny konsult" : "Nytt uppdrag";
    formDialog(title, consultant ? consultantFields : assignmentFields, "Spara", async (form, bg, hasAccess) => {
      const value = key => form.elements.namedItem(key).value.trim();
      const args = consultant ? {
        p_first_name: value("first"), p_last_name: value("last"), p_linkedin: value("linkedin"),
        p_phone: value("phone"), p_email: value("email"), p_note: value("note")
      } : {p_title: value("title"), p_location: value("location"), p_deadline: value("deadline") || null, p_brief: value("brief")};
      if (consultant && args.p_linkedin && !partnerPublicProfileUrl({linkedin: args.p_linkedin})) {
        throw Error("Ange en offentlig LinkedIn-profil med https://www.linkedin.com/in/…");
      }
      const result = await rpc(consultant ? "ats_partner_manual_konsult" : "ats_partner_manual_uppdrag",
        {p_request_id: requestId, ...args});
      if (!hasAccess()) { bg.remove(); return; }
      await showRecord(bg, consultant ? "candidates" : "roles", result.id, consultant ? "person" : "role", hasAccess,
        consultant ? "Konsultkort sparat" : "Uppdrag sparat");
    });
  }

  function openForLink(role, personId) {
    return Boolean(role && partnerCreateTarget(role.id) && !linksForCand(personId).some(m => m.roleId === role.id));
  }

  function linkRecord(id) {
    if (view !== "kandidat" || candSel !== id || !allowed() || !cands.has(id)) return;
    if (["roles", "matches"].some(k => !arbetsdagRead.has(k) || arbetsdagFailed.has(k))) {
      toast("Uppdrag och befintliga kopplingar måste vara inlästa."); return;
    }
    const choices = [...roles.values()].filter(r => openForLink(r, id)).sort(deadlineSort);
    if (!choices.length) { toast("Inga fler öppna uppdrag att koppla konsulten till."); return; }
    const options = choices.map(r => `<option value="${esc(r.id)}">${t([r.ref, r.title, r.location].filter(Boolean).join(" · "))}</option>`).join("");
    formDialog("Koppla konsult till uppdrag",
      `<label>Uppdrag<select name="role" required><option value="">Välj uppdrag</option>${options}</select></label>`,
      "Koppla till uppdrag", async (form, bg, hasAccess) => {
        const roleId = form.elements.namedItem("role").value;
        if (!cands.has(id) || !partnerCreateTarget(roleId)) throw Error("Uppdraget eller konsulten är inte längre tillgänglig.");
        const result = await rpc("ats_partner_manual_koppla", {p_cand_id: id, p_role_id: roleId});
        if (result.cand_id !== id || result.role_id !== roleId) throw Error("Kvittensen avser inte den valda kopplingen.");
        if (!hasAccess()) { bg.remove(); return; }
        await showRecord(bg, "matches", result.id, "match", hasAccess, result.created ? "Konsult kopplad" : "Kopplingen finns redan");
      });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-manual-new], [data-manual-link]");
    if (!button || !allowed()) return;
    if (button.hasAttribute("data-manual-new")) newRecord(button.dataset.manualNew);
    else linkRecord(button.dataset.manualLink);
  });
  return Object.freeze({renderCreate, candidateActions});
})();
