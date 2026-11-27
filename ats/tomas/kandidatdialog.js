"use strict";

const TomasKandidatdialog = (() => {
  const swedishDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const id = value => value == null ? "" : String(value).trim();
  const actor = value => id(value).toLowerCase();
  const body = value => typeof value === "string" && value.trim() ? value : null;
  const channels = new Set(["inmail", "mail"]);
  const openOrders = new Set(["angerfrist", "bestalld", "utkast", "vantar-godkannande",
    "vantar_godkannande", "pagar", "godkand", "vantar-text", "skickas"]);
  const openReplies = new Set(["bestalld", "skickas"]);

  function calendarDay(time) {
    return Date.parse(swedishDate.format(time) + "T00:00:00Z") / 86400000;
  }

  function thread({ match, candidate, contacts = [], replies = [], order, actorId, actorEmail,
    unambiguousPair = false, now = Date.now() }) {
    const actors = new Set([actor(actorId), actor(actorEmail)].filter(Boolean));
    if (!actors.size || !match?.id || !match.roleId || !match.candId || candidate?.id !== match.candId) return null;
    const messages = [], pending = [];
    const projections = [];
    const contactIds = new Set(), replyIds = new Set();
    let unscopedReplyTime = -Infinity;
    const exactPair = row => row?.roleId === match.roleId && row.candId === match.candId &&
      (row.matchId ? row.matchId === match.id : unambiguousPair);

    function event(direction, at, text, channel) {
      const atTime = typeof at === "string" ? Date.parse(at) : NaN;
      if (atTime > now) return null;
      return { direction, at: Number.isFinite(atTime) ? at : null, text: body(text), channel };
    }

    function pendingEvent(kind, row, channel) {
      const known = stamp => typeof stamp === "string" && Date.parse(stamp) <= now ? stamp : null;
      pending.push({ kind, channel, status: row.status, at: known(row.at), statusAt: known(row.statusAt) });
    }

    // The partner view proves ownership and match for both directions. The
    // legacy contact.text may contain an operator's summary or receipt.
    for (const contact of contacts) {
      const proof = contact?.partnerMeddelande;
      if (!channels.has(contact?.kanal) || !["in", "ut"].includes(contact.riktning) ||
          contact.roleId !== match.roleId || (contact.candId && contact.candId !== candidate.id)) continue;
      if (!proof?.matchId && contact.riktning === "in") {
        // A legacy reply may belong to another partner on this same pair.
        // It can prevent a false reminder, but none of its contents are shown.
        const time = typeof contact.at === "string" ? Date.parse(contact.at) : NaN;
        if (!(time > now)) unscopedReplyTime = Math.max(unscopedReplyTime, Number.isFinite(time) ? time : Infinity);
        continue;
      }
      if (proof?.matchId !== match.id || (contact.matchId && contact.matchId !== match.id)) continue;
      const contactId = id(contact.kontaktId ?? contact.id);
      if (contactId && contactIds.has(contactId)) continue;
      const message = event(contact.riktning, contact.at, proof.text, contact.kanal);
      if (!message) continue;
      if (contactId) contactIds.add(contactId);
      messages.push(message);
      projections.push({ message, orderId: id(proof.orderId), replyId: id(proof.partnerSvarId), used: false });
    }

    // Consume one projected copy per receipt. Two contacts with separate IDs
    // remain two events even when their timestamp and text are identical.
    function addReceipt(message, key, sourceId) {
      if (!message) return;
      const possible = projections.filter(p => !p.used && p.message.direction === message.direction && p.message.channel === message.channel &&
        !(p[key] && sourceId && p[key] !== sourceId) && !(key === "orderId" && p.replyId) &&
        !(key === "replyId" && p.orderId && !p.replyId));
      // The initial order ID may also be stamped on several incoming replies.
      // It identifies their thread, never an individual incoming message.
      const exactId = key !== "orderId" || message.direction === "ut";
      const projected = possible.find(p => exactId && sourceId && p[key] === sourceId) ||
        possible.find(p => message.at && p.message.at && Date.parse(p.message.at) === Date.parse(message.at) &&
          (!p.message.text || !message.text || p.message.text === message.text));
      if (projected) {
        projected.used = true;
        projected.message.text ??= message.text;
        projected.message.at ??= message.at;
      } else {
        messages.push(message);
      }
    }

    for (const reply of replies) {
      const channel = reply?.kanal ?? "inmail";
      if (!exactPair(reply) || !actors.has(actor(reply.av)) || reply.typ !== "svar" || !channels.has(channel)) continue;
      const replyId = id(reply.id);
      if (replyId && replyIds.has(replyId)) continue;
      if (replyId) replyIds.add(replyId);
      if (reply.status === "skickat") addReceipt(event("ut", reply.skickatAt, reply.text, channel), "replyId", replyId);
      else if (openReplies.has(reply.status)) pendingEvent("reply", reply, channel);
    }

    const owners = [actor(order?.uid), actor(order?.bestallare)].filter(Boolean);
    const orderChannel = order?.kanal ?? "inmail";
    if (exactPair(order) && owners.length && owners.every(who => actors.has(who)) && channels.has(orderChannel)) {
      if (["skickat", "svar"].includes(order.status) && body(order.kvittens)) {
        const orderId = id(order.orderId) || id(order.id);
        addReceipt(event("ut", order.kvittens, null, orderChannel), "orderId", orderId);
        if (order.svarAt) addReceipt(event("in", order.svarAt, null, orderChannel), "orderId", orderId);
      } else if (openOrders.has(order.status)) {
        pendingEvent("order", order, orderChannel);
      }
    }
    if (!messages.length && !pending.length) return null;

    pending.sort((a, b) => (Date.parse(b.statusAt ?? b.at) || 0) - (Date.parse(a.statusAt ?? a.at) || 0));

    const times = m => m.at ? Date.parse(m.at) : Infinity;
    messages.sort((a, b) => times(a) - times(b) || Number(a.direction === "in") - Number(b.direction === "in"));
    const outbound = messages.filter(m => m.direction === "ut");
    const inbound = messages.filter(m => m.direction === "in");
    const lastSentAt = outbound.findLast(m => m.at)?.at ?? null;
    const lastReplyAt = inbound.findLast(m => m.at)?.at ?? null;
    const sentTime = lastSentAt ? Date.parse(lastSentAt) : -Infinity;
    const replyTime = lastReplyAt ? Date.parse(lastReplyAt) : -Infinity;
    const undatedOut = outbound.some(m => !m.at);
    const undatedIn = inbound.some(m => !m.at);
    const definitelyAnswered = !undatedOut && inbound.length > 0 && replyTime >= sentTime;
    const possiblyAnswered = undatedIn || (undatedOut && inbound.length > 0 && replyTime >= sentTime) ||
      (unscopedReplyTime > -Infinity && unscopedReplyTime >= sentTime);
    const unknownTiming = outbound.length > 0 && !definitelyAnswered && possiblyAnswered;
    const waiting = outbound.length > 0 && !definitelyAnswered && !unknownTiming;
    return {
      messages, pending, pendingAt: pending[0]?.statusAt ?? pending[0]?.at ?? null,
      lastSentAt, lastReplyAt, waiting, unknownTiming,
      waitingDays: waiting && lastSentAt && !undatedOut ? calendarDay(now) - calendarDay(sentTime) : null
    };
  }
  return { thread };
})();

if (typeof window !== "undefined") window.TomasKandidatdialog = TomasKandidatdialog;
if (typeof module !== "undefined" && module.exports) module.exports = TomasKandidatdialog;
