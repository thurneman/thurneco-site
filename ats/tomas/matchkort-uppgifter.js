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

  function availableDetails(candidate, upload, contact) {
    const cvLink = [upload?.url, candidate?.cv].find(value => {
      if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return false;
      try { return Boolean(new URL(value.trim()).hostname); } catch { return false; }
    })?.trim();
    const hasCv = Boolean(cvLink || norm(upload?.assetId));
    const email = norm(contact?.email);
    const phone = norm(contact?.phone);
    const hasContact = /^[^\s@]+@[^\s@]+$/.test(email) || /^[+\d(][\d\s()./-]*\d$/.test(phone) && phone.replace(/\D/g, "").length >= 5;
    return { cvLink, hasCv, hasContact };
  }

  function availabilityHTML(details) {
    const labels = [];
    if (details.hasDialog) labels.push("Tidigare dialog");
    if (details.hasCv) labels.push("CV finns!");
    if (details.hasContact) labels.push("Kontaktuppgifter finns!");
    if (details.hasConsent) labels.push("Givit samtycke");
    return labels.length ? '<div class="px-match-availability">' + labels.map(label => '<span><i aria-hidden="true">✓</i> ' + label + '</span>').join("") + '</div>' : "";
  }

  function earlierDialog(candidate,pairs,now){
    if(!candidate?.id || !Array.isArray(candidate.kontakter))return false;
    return candidate.kontakter.some(message=>{
      if(!message || message.riktning!=="in" || !["inmail","mail","sms"].includes(message.kanal)
          || message.typ && !["svar","meddelande"].includes(message.typ)
          || !norm(message.text) || message.candId && message.candId!==candidate.id)return false;
      const stamp=Date.parse(message.at);
      if(!Number.isFinite(stamp) || stamp>now)return false;
      const linked=pairs.filter(pair=>pair.candId===candidate.id && pair.roleId===message.roleId);
      return message.matchId?linked.some(pair=>pair.id===message.matchId):linked.length===1;
    });
  }

  function callSignals(match,rows,now){
    let hasDialog=false,decision=null;
    for(const row of rows){
      if(!row || row.match_id!==match.id || row.cand_id!==match.candId || row.role_id!==match.roleId)continue;
      const at=Date.parse(row.at);
      if(!Number.isFinite(at) || at>now || !["ja_presentation","nej","vill_veta_mer","aterkom"].includes(row.utfall))continue;
      if(row.utfall!=="aterkom")hasDialog=true;
      if(!["ja_presentation","nej"].includes(row.utfall))continue;
      const id=typeof row.id==="string" || Number.isSafeInteger(row.id)?String(row.id):"";
      if(!/^\d+$/.test(id))continue;
      const rank=BigInt(id),yes=row.utfall==="ja_presentation";
      if(!decision || at>decision.at || at===decision.at && (rank>decision.rank || rank===decision.rank && !yes))
        decision={at,rank,yes};
    }
    return {hasDialog,hasConsent:decision?.yes===true};
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
  return { isSubmissionTask, availableDetails, availabilityHTML, earlierDialog, callSignals, latestMessage };
})();
