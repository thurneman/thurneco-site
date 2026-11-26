/* Shared presentation rules for the partner's relationship with a consultant. */
const TomasMatchkort = (() => {
  const norm = value => typeof value === "string" ? value.trim().toLocaleLowerCase("sv") : "";

  // Match whole submission instructions. A reference to a CV or to contact in a
  // substantive qualification does not make that qualification administrative.
  function isSubmissionTask(label) {
    const text = norm(label).replace(/[.!:]+$/, "").replace(/\s+/g, " ");
    const admin = [
      /^(?:(?:kandidatens|konsultens) )?(?:aktuellt cv|uppdaterat cv|cv|kontaktuppgifter|telefonnummer|e-postadress|mejladress)(?: till (?:kandidaten|konsulten))?$/,
      /^(?:cv|kontaktuppgifter|telefonnummer|e-postadress|mejladress) (?:ska|skall|måste) (?:vara (?:registrerade|registrerat|bifogat|uppdaterat)|finnas(?: registrerat)?|anges|bifogas|laddas upp)$/,
      /^(?:(?:ladda upp|bifoga|skicka in|lämna in|kontrollera|komplettera med) (?:ett |en |sitt |sina |kandidatens |konsultens )?)?(?:(?:aktuellt |uppdaterat |komplett )?cv(?:-fil(?:en)?)?|kontaktuppgifter|telefon(?:nummer)?(?: och (?:e-post|mejl)(?:adress)?)?|(?:e-post|mejl)(?:adress)?)(?: (?:krävs|ska (?:bifogas|laddas upp|anges)|finns|finns registrerat|för (?:presentation|inskick)))?$/,
      /^(?:(?:kandidatens|konsultens) (?:ok|klartecken|godkännande|samtycke|bekräftelse)(?: och timpris)?(?: (?:för|till|inför) (?:uppdraget|presentation(?:en)?|inskick))?|(?:kandidaten|konsulten) (?:har |ska ha )?(?:godkänt|gett sitt ok till) (?:presentationen|uppdraget))$/,
      /^(?:attach|upload|submit|provide) (?:an? |the |your )?(?:(?:updated |current )?(?:cv|résumé|resume)|contact details|phone number|email address)$/
    ];
    return admin.some(pattern => pattern.test(text));
  }

  function latestMessage({ match, candidate, contacts, replies, actorId, actorEmail, actorName, preview, unambiguousPair, now }) {
    if (!match?.id || !match.roleId || !match.candId || candidate?.id !== match.candId) return null;
    const actorKeys = new Set([norm(actorEmail), preview ? "" : norm(actorId)].filter(Boolean));
    if (!actorKeys.size) return null;
    const partner = actorName || "Partnern";
    let latest = null;
    function consider(at, text, sender, priority) {
      const time = typeof at === "string" ? Date.parse(at) : NaN;
      if (!Number.isFinite(time) || time > now || typeof text !== "string" || !text.trim()) return;
      if (!latest || time > latest.time || (time === latest.time && priority > latest.priority))
        latest = { at, time, text: text.trim(), sender, priority };
    }
    for (const contact of contacts) {
      if (!contact || contact.roleId !== match.roleId || (contact.matchId && contact.matchId !== match.id) ||
          (contact.candId && contact.candId !== candidate.id) || !["inmail", "mail", "sms"].includes(contact.kanal)) continue;
      if (contact.partnerMeddelande && contact.kanal === "inmail" && contact.riktning === "ut") {
        if (contact.partnerMeddelande.matchId === match.id) {
          consider(contact.at, contact.partnerMeddelande.text, "Skickat via Recruiter", 2);
        }
        continue;
      }
      if (!contact.matchId && !unambiguousPair) continue;
      if (contact.riktning === "in") consider(contact.at, contact.text, candidate.name || "Kandidaten", 1);
      if (contact.riktning === "ut" && actorKeys.has(norm(contact.av))) consider(contact.at, contact.text, partner, 1);
    }
    // partnersvar is scoped by the server to the viewed partner's account, also
    // in Visa som. The owner session UUID must never be used as that partner.
    for (const reply of replies) {
      if (!reply || reply.typ !== "svar" || reply.status !== "skickat" || reply.matchId !== match.id ||
          reply.candId !== match.candId || reply.roleId !== match.roleId) continue;
      if (!actorKeys.has(norm(reply.av)) && !(preview && actorName && typeof reply.av === "string" && reply.av && reply.av !== actorId && reply.avNamn === actorName)) continue;
      consider(reply.skickatAt, reply.text, partner, 2);
    }
    return latest;
  }
  return { isSubmissionTask, latestMessage };
})();
