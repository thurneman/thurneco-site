// Konsultregistret, personkortet och matchkortet delar samma konversation per uppdrag.
const TomasDialogVy = (() => {
  let viewer = '', filter = 'alla';
  const opened = new Set();

  function identity() {
    const previewEmail = window.ATS_RUNTIME?.visaSom?.();
    const email = String(previewEmail || userEmail || '').toLowerCase();
    const id = previewEmail ? '' : userId;
    const scope = recentMayRead() && email ? JSON.stringify([userId, email, Boolean(previewEmail)]) : '';
    if (scope !== viewer) {
      viewer = scope;
      filter = 'alla';
      opened.clear();
      TomasKontaktinfo.reset();
    }
    return {scope, email, id};
  }

  function selection() { identity(); return filter; }

  function filters() {
    const selected = selection();
    return '<div class="p12-dialog-filter" role="group" aria-label="Visa konsulter">' +
      [['alla','Alla konsulter'],['dialog','I dialog med']].map(([mode,label]) =>
        `<button type="button" data-dialog-filter="${mode}" aria-pressed="${selected === mode}">${label}</button>`).join('') + '</div>';
  }

  function dataState() {
    const required = ['roles','candidates','matches','partnersvar'];
    if (ordersState === 'fel' || required.some(k => arbetsdagFailed.has(k))) return 'Konversationerna kunde inte läsas in.';
    if (ordersState !== 'ok' || required.some(k => !arbetsdagRead.has(k))) return 'Hämtar konversationer …';
    return '';
  }

  function source() {
    const actor = identity();
    const replies = new Map();
    for (const reply of svarP.values()) {
      if (!replies.has(reply.matchId)) replies.set(reply.matchId, []);
      replies.get(reply.matchId).push(reply);
    }
    // In Visa som the runtime loads the viewed partner's own document under the session ID.
    const own = actor.scope ? (orders[userId] || orders[actor.email])?.poster : null;
    return {actor, own, replies, now:Date.now()};
  }

  function conversations(c, links, src) {
    if (!src.actor.scope || !cands.has(c.id)) return [];
    const counts = new Map();
    for (const m of links) counts.set(m.roleId, (counts.get(m.roleId) || 0) + 1);
    const rows = [];
    for (const m of links) {
      if (m.candId !== c.id || !pxVisibleDetailRole(m.roleId)) continue;
      const order = src.own?.[key(m)];
      const thread = TomasKandidatdialog.thread({match:m, candidate:c, contacts:c.kontakter || [],
        replies:src.replies.get(m.id) || [], order:order ? {...order, uid:src.actor.email} : null,
        actorId:src.actor.id, actorEmail:src.actor.email, unambiguousPair:counts.get(m.roleId) === 1, now:src.now});
      if (thread) rows.push({m, role:roles.get(m.roleId), thread,
        latest:Math.max(Date.parse(thread.lastSentAt) || 0, Date.parse(thread.lastReplyAt) || 0, Date.parse(thread.pendingAt) || 0)});
    }
    return rows.sort((a,b) => b.latest - a.latest || String(a.m.id).localeCompare(String(b.m.id)));
  }

  function date(stamp) {
    if (!stamp) return 'Datum saknas';
    return `<time datetime="${esc(stamp)}">${esc(new Date(stamp).toLocaleString('sv-SE', {timeZone:'Europe/Stockholm',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time>`;
  }

  function waitLabel(thread) {
    if (!thread.waiting) return '';
    if (thread.waitingDays == null) return 'Väntar på svar';
    if (thread.waitingDays === 0) return 'Skickat i dag · väntar på svar';
    return `${thread.waitingDays} ${thread.waitingDays === 1 ? 'dag' : 'dagar'} sedan kontakt utan svar`;
  }

  function channelName(channel) {
    return channel === 'mail' ? 'Mejl' : 'InMail';
  }

  function pendingHTML(thread) {
    return thread.pending.map(item => {
      const medium = channelName(item.channel);
      const label = item.kind === 'reply' ? 'Svar beställt via ' + medium : medium + ' beställt';
      return `<p class="p12-dialog-pending">${label} · ${date(item.at)} · Väntar på utskick</p>`;
    }).join('');
  }

  function transcript(thread) {
    if (!thread.messages.length) return '';
    return '<ol class="p12-dialog-messages">' + thread.messages.map(msg => {
      const medium = channelName(msg.channel);
      const direction = msg.direction === 'in' ? 'Svar via ' + medium : medium + ' skickat';
      const body = msg.text == null ? '<p class="cnote">Meddelandetext saknas.</p>' : `<p class="pre">${esc(msg.text)}</p>`;
      return `<li><strong>${direction}</strong> · ${date(msg.at)}${body}</li>`;
    }).join('') + '</ol>';
  }

  function rowHTML(row) {
    const {m,role,thread} = row, open = opened.has(m.id);
    const title = [role.ref,role.title].filter(Boolean).join(' · ') || 'Uppdrag';
    const latest = (direction, at) => thread.messages.findLast(msg => msg.direction === direction && msg.at === at);
    const outgoing = latest('ut', thread.lastSentAt);
    const incoming = latest('in', thread.lastReplyAt);
    const times = [];
    if (outgoing) times.push(channelName(outgoing.channel) + ' skickat ' + date(outgoing.at));
    if (incoming) {
      const via = channelName(incoming.channel);
      const label = outgoing && outgoing.channel === incoming.channel && outgoing.at && incoming.at &&
        Date.parse(outgoing.at) <= Date.parse(incoming.at) ? via + ' besvarat' : 'Svar via ' + via;
      times.push(label + ' ' + date(incoming.at));
    }
    const wait = waitLabel(thread);
    const detail = !thread.messages.length ? '' :
      `<button type="button" class="tbtn" data-dialog-trad="${esc(m.id)}" aria-expanded="${open}" aria-label="${open?'Dölj':'Visa'} konversation om ${esc(title)}">${open?'Dölj konversation':'Visa konversation'}</button>` +
      (open ? transcript(thread) : '');
    return `<section class="p12-dialog-row"><h3>${esc(title)}</h3>` +
      (times.length ? `<p>${times.join(' · ')}</p>` : '') + pendingHTML(thread) +
      (wait ? `<p class="p12-dialog-wait">${esc(wait)}</p>` : '') + detail + '</section>';
  }

  function person(c, matchesForPerson) {
    const status = dataState();
    if (status) return `<section class="px-d-pane"><h2>I dialog med</h2><p role="status">${esc(status)}</p></section>`;
    const rows = conversations(c, matchesForPerson, source());
    return rows.length ? '<section class="px-d-pane"><h2>I dialog med</h2>' + rows.map(rowHTML).join('') + '</section>' : '';
  }

  function matchHistory(m,c) {
    if (!recentMayRead() || dataState()) return '';
    const row = conversations(c,linksForCand(c.id),source()).find(row => row.m.id === m.id);
    return row ? '<section class="fsec"><h3>Konversation med kandidaten</h3>' + pendingHTML(row.thread) + transcript(row.thread) + '</section>' : '';
  }

  function contact(c, editFields) {
    const {scope} = identity();
    return scope ? TomasKontaktinfo.render(scope,c.id,contactOf(c),editFields) : '';
  }

  function select(mode) { if (identity().scope && ['alla','dialog'].includes(mode)) filter = mode; }
  function toggleThread(id) { if (opened.has(id)) opened.delete(id); else opened.add(id); }
  function toggleContact(c) { const {scope} = identity(); if (scope) TomasKontaktinfo.toggle(scope,c.id); }
  return {selection,filters,dataState,source,conversations,rowHTML,person,matchHistory,contact,select,toggleThread,toggleContact};
})();

document.addEventListener("click",event=>{
  const button=event.target.closest?.("[data-dialog-filter],[data-dialog-trad],[data-dialog-kontakt]");
  if(!button||!recentMayRead())return;
  let selector;
  if(button.hasAttribute("data-dialog-filter")&&view==="konsulter"){
    const mode=button.dataset.dialogFilter;
    TomasDialogVy.select(mode);
    selector='[data-dialog-filter="'+CSS.escape(mode)+'"]';
  }else if(button.hasAttribute("data-dialog-trad")&&["konsulter","kandidat"].includes(view)){
    const id=button.dataset.dialogTrad,m=matches.get(id);
    if(!m||!cands.has(m.candId)||!pxVisibleDetailRole(m.roleId))return;
    TomasDialogVy.toggleThread(id);
    selector='[data-dialog-trad="'+CSS.escape(id)+'"]';
  }else if(button.hasAttribute("data-dialog-kontakt")&&["konsulter","kandidat"].includes(view)){
    const c=cands.get(button.dataset.dialogKontakt);
    if(!c||(view==="kandidat"&&candSel!==c.id))return;
    TomasDialogVy.toggleContact(c);
    selector='[data-dialog-kontakt="'+CSS.escape(c.id)+'"]';
  }else return;
  renderDetail();
  document.querySelector(selector)?.focus({preventScroll:true});
});
