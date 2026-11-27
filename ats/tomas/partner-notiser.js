"use strict";

const PartnerNotiser = (() => {
  const stockholmDay = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Stockholm", year:"numeric", month:"2-digit", day:"2-digit"});
  const groups = {roles:"Nya uppdrag i dag", matches:"Nya kandidater till mina uppdrag", replies:"Svar på mina meddelanden"};
  const order = ["replies", "matches", "roles"];
  const makeKey = (...parts) => JSON.stringify(parts);

  // Store only identifiers and observation times. Acknowledging one event never overwrites another tab's decisions.
  function personalStore(actor, storage) {
    const prefix = "ats.tomas.notiser.v1." + encodeURIComponent(actor) + ".";
    const cache = new Map();
    function get(key) {
      if (!cache.has(key)) {
        let value = null;
        try { value = storage?.getItem(prefix + key) ?? null; } catch {}
        cache.set(key, value);
      }
      return cache.get(key);
    }
    function put(key, value) {
      try { storage?.setItem(prefix + key, value); } catch {}
      cache.set(key, value);
    }
    return { get, put, invalidate(key) { if (!key) cache.clear(); else if (key.startsWith(prefix)) cache.delete(key.slice(prefix.length)); } };
  }

  function collect(data, state) {
    const rows = [], today = stockholmDay.format(data.now);
    let since = state.get("firstDay");
    if (!since) { since = today; state.put("firstDay", today); }
    const openRoles = new Map();
    for (const role of data.roles.values()) {
      if (!data.visible(role)) continue;
      openRoles.set(role.id, role);
      const stamp = data.stamp(role.createdAt, data.now);
      if (stamp !== null && stockholmDay.format(stamp) === today) {
        rows.push({kind:"roles", key:makeKey("role", role.id), role:role.id, title:data.roleTitle(role), at:stamp});
      }
    }
    const ownReplies = new Map();
    for (const reply of data.sentReplies) {
      if (reply.av !== data.actor || reply.status !== "skickat") continue;
      const sent = data.stamp(reply.skickatAt, data.now);
      if (sent === null) continue;
      const key = makeKey(reply.matchId, reply.roleId, reply.candId);
      if (!ownReplies.has(key)) ownReplies.set(key, []);
      ownReplies.get(key).push(sent);
    }
    for (const m of data.matches.values()) {
      const role = openRoles.get(m.roleId), c = data.people.get(m.candId);
      if (!role || !c || c.dismissed || c.id !== m.candId || !c.name) continue;
      const common = {role:role.id, match:m.id, title:c.name, detail:data.roleTitle(role)};
      const identity = makeKey(m.roleId, m.id, m.candId);
      if (data.owned.has(role.id) && data.reviewable(m)) {
        let at = data.stamp(m.createdAt, data.now), observed = false;
        if (at === null && !m.createdAt) {
          const k = "seen." + identity, previous = state.get(k);
          if (previous === null) state.put(k, state.get("baseline." + role.id) ? String(data.now) : "baseline");
          const saved = state.get(k);
          if (saved !== "baseline") { at = Number(saved); observed = true; }
        }
        if (at !== null && Number.isFinite(at) && at <= data.now && stockholmDay.format(at) >= since)
          rows.push({...common, kind:"matches", key:makeKey("match", m.id, m.roleId, m.candId), at, observed});
      }
      const o = data.order(m);
      const ownOrder = o?.uid === data.actor && o.roleId === m.roleId && o.candId === m.candId && (!o.matchId || o.matchId === m.id) ? o : null;
      const receipt = data.stamp(ownOrder?.kvittens, data.now);
      const personalSends = ownReplies.get(makeKey(m.id, m.roleId, m.candId))?.slice() || [];
      if (receipt !== null) personalSends.push(receipt);
      if (!personalSends.length) continue;
      const thread = (c.kontakter || []).filter(k => k?.roleId === role.id && k.kanal === "inmail");
      const outgoing = thread.filter(k => k.riktning === "ut").map(k => data.stamp(k.at, data.now)).filter(s => s !== null);
      const known = new Set();
      for (const contact of thread) {
        if (contact.roleId !== role.id || contact.riktning !== "in" || contact.kanal !== "inmail") continue;
        const at = data.stamp(contact.at, data.now);
        if (at === null) continue;
        const lastOwn = Math.max(-Infinity, ...personalSends.filter(time => time <= at));
        // A later outgoing message without our own receipt makes ownership of this reply ambiguous.
        if (!Number.isFinite(lastOwn) || outgoing.some(time => time > lastOwn && time <= at)) continue;
        known.add(at);
        const key = makeKey("reply", m.id, m.roleId, m.candId, contact.id || at);
        rows.push({...common, kind:"replies", key, at, contact:contact.id || "", historyAt:contact.at});
      }
      // The order may be the sole dated reply source on older conversations.
      const replyAt = data.stamp(ownOrder?.svarAt, data.now);
      if (receipt !== null && replyAt !== null && replyAt >= receipt && !known.has(replyAt))
        rows.push({...common, kind:"replies", key:makeKey("reply", m.id, m.roleId, m.candId, replyAt), at:replyAt, historyAt:ownOrder.svarAt});
    }
    if (data.complete) for (const id of data.owned) {
      if (openRoles.has(id) && !state.get("baseline." + id)) state.put("baseline." + id, "1");
    }
    const unique = new Map(rows.map(row => [row.key, row]));
    return [...unique.values()].map(row => ({...row, read:state.get("read." + row.key) === "1"}))
      .sort((a,b) => b.at-a.at || a.title.localeCompare(b.title,"sv") || a.key.localeCompare(b.key));
  }
  return {collect, groups, order, personalStore};
})();
if (typeof module !== "undefined" && module.exports) module.exports = PartnerNotiser;
