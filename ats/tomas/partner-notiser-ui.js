const pxNotiser = (() => {
  const host = document.getElementById("px-notiser");
  const button = document.getElementById("px-notiser-knapp");
  const popup = document.getElementById("px-notiser-panel");
  const rail = document.getElementById("px-notisurval");
  let actor = null, state, rows = [], selection = null, showRead = false;

  function openMenu(on) {
    popup.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
    if (on) document.querySelector(".px-menu")?.removeAttribute("open");
  }
  function clearSelection() {
    selection = null;
    rail.hidden = true;
    document.getElementById("main").classList.remove("has-notisurval");
  }
  function personalState(id) {
    if (actor !== id) {
      actor = id;
      let storage; try { storage = window.localStorage; } catch {}
      state = id ? PartnerNotiser.personalStore(id, storage) : null;
      openMenu(false); clearSelection(); showRead = false;
      popup.innerHTML = ""; popup._notisHTML = null;
      rail.innerHTML = ""; rail._notisHTML = null;
    }
    return state;
  }
  function keepFocus(el, html) {
    if (el._notisHTML === html) return;
    const previous = el.contains(document.activeElement) ? document.activeElement : null;
    const attr = previous && [...previous.attributes].find(a => a.name.startsWith("data-notis-"));
    el.innerHTML = html; el._notisHTML = html;
    if (attr) {
      const next = [...el.querySelectorAll("[" + attr.name + "]")].find(b => b.getAttribute(attr.name) === attr.value);
      (next || (el === popup ? button : rail.querySelector("button")))?.focus({preventScroll:true});
    }
  }
  function visibleGroup(kind) {
    return rows.filter(row => row.kind === kind && (showRead || !row.read));
  }
  function rowButton(row) {
    return '<button type="button" class="px-notis-row" data-notis-row="' + esc(row.key) + '"' +
      (selection?.current === row.key ? ' aria-current="true"' : '') + '><strong>' + t(row.title) + '</strong>' +
      (row.detail ? '<small>' + t(row.detail) + '</small>' : '') + '<small>' +
      (row.observed ? 'Först visad ' : '') + esc(SenastInkomna.format(row.at)) + (row.read ? ' · Läst' : '') + '</small></button>';
  }
  function acknowledger(row) {
    return row.read ? '' : '<button type="button" class="tbtn px-notis-ok" data-notis-ok="' + esc(row.key) +
      '" aria-label="Markera som läst: ' + t(row.title) + '">OK</button>';
  }
  function paint() {
    if (!host || !personalState(pxWorkActor())) {
      if (host) host.hidden = true;
      return;
    }
    host.hidden = false;
    const sources = ["roles","candidates","matches","ändringar"];
    const ready = sources.every(s => arbetsdagRead.has(s) && !arbetsdagFailed.has(s));
    const teamReady = pxTeamState.actor === actor && pxTeamState.phase === "ready";
    const owned = new Set([...(pxTeamRows()?.values() || [])].filter(r => r.owned_by_me === true).map(r => r.role_id));
    rows = ready ? PartnerNotiser.collect({
      now:Date.now(), actor, roles, matches, people:cands, owned,
      order:m => ordersState === "ok" ? findOrder(m) : null,
      sentReplies:arbetsdagRead.has("partnersvar") && !arbetsdagFailed.has("partnersvar") ? svarP.values() : [],
      roleTitle:pxRoleName, stamp:SenastInkomna.createdTime,
      visible:r => pxVisibleCatalogRole(r) && !!r.title,
      reviewable:m => !m.dismissed && !pxClosedPair(m) && !hiddenRole(roles.get(m.roleId)) && !sistaDagPasserad(roles.get(m.roleId)),
      complete:teamReady
    }, state) : [];
    const unread = rows.filter(row => !row.read).length;
    button.setAttribute("aria-label", unread ? "Notiser, " + unread + " olästa" : "Notiser");
    const count = document.getElementById("px-notis-antal");
    count.hidden = !unread; count.textContent = String(unread);
    const sections = PartnerNotiser.order.map(kind => {
      const list = visibleGroup(kind);
      if (!list.length) return "";
      // New roles and candidates open a filtered work list. Replies also link directly to each conversation.
      const links = kind === "replies" ? '<ul>' + list.map(r => '<li>' + rowButton(r) + acknowledger(r) + '</li>').join("") + '</ul>' : '';
      return '<section><button type="button" class="px-notis-group" data-notis-group="' + kind + '">' +
        t(PartnerNotiser.groups[kind]) + ' <b>' + list.length + '</b></button>' + links + '</section>';
    }).join("");
    const unavailable = !ready || !teamReady || ordersState !== "ok" || !arbetsdagRead.has("partnersvar") || arbetsdagFailed.has("partnersvar");
    let message = sections ? "" : (unavailable ? "" : (showRead ? "Inga notiser att visa." : "Inga olästa notiser."));
    if (unavailable) message += (message ? " " : "") + (sources.some(s => arbetsdagFailed.has(s)) || ordersState === "fel" || ["error","disabled"].includes(pxTeamState.phase) || arbetsdagFailed.has("partnersvar") ? "Vissa notiser kan inte läsas." : "Hämtar notiser …");
    keepFocus(popup, '<h2>Notiser</h2>' + sections + (message ? '<p role="status">' + t(message) + '</p>' : '') +
      (rows.some(r => r.read) ? '<button type="button" class="tbtn" data-notis-read="" aria-pressed="' + String(showRead) + '">' + (showRead ? "Dölj lästa" : "Visa lästa") + '</button>' : ''));
    if (!selection) return;
    const available = new Map(rows.map(r => [r.key, r]));
    const filtered = selection.keys.map(key => available.get(key)).filter(Boolean);
    if (!filtered.length || !["rollkort","matchning"].includes(view)) { clearSelection(); return; }
    const current = filtered.find(row => row.kind === "roles" ? view === "rollkort" && row.role === selected : view === "matchning" && row.match === focusPick[selected]);
    if (!current) { clearSelection(); return; }
    if (!filtered.some(r => r.key === selection.current && r.match === current.match && r.role === current.role)) selection.current = current.key;
    rail.hidden = false; document.getElementById("main").classList.add("has-notisurval");
    keepFocus(rail, '<div class="px-notis-head"><h2>' + t(PartnerNotiser.groups[selection.kind]) + ' (' + filtered.length + ')</h2>' +
      '<button type="button" class="tbtn" data-notis-close-list="" aria-label="Stäng urvalet">Stäng</button></div><ul>' +
      filtered.map(r => '<li>' + rowButton(r) + acknowledger(r) + '</li>').join("") + '</ul>');
  }
  function openRow(row, list) {
    if (!row || pxWorkActor() !== actor) return;
    const nextSelection = {kind:row.kind, keys:list.map(r => r.key), current:row.key};
    openMenu(false);
    selection = nextSelection;
    if (row.kind === "roles") openRole(row.role); else openMatch(row.match);
    if (row.kind === "replies" && view === "matchning" && focusPick[row.role] === row.match) {
      selectTab("dialog", false);
      const entries = [...document.querySelectorAll("#panel-dialog [data-notis-historik]")];
      const target = (row.contact && entries.find(el => el.dataset.notisKontakt === row.contact)) ||
        entries.find(el => Date.parse(el.dataset.notisHistorik) === row.at) || document.getElementById("tab-dialog");
      target?.focus({preventScroll:true}); target?.scrollIntoView({block:"center"});
    } else {
      const heading = document.querySelector("#detail h1");
      if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); heading.scrollIntoView({block:"nearest"}); }
    }
  }
  function sequence(m) {
    if (selection?.kind !== "matches" || !selection.keys.includes(rows.find(row => row.kind === "matches" && row.match === m.id)?.key)) return null;
    const available = new Map(rows.filter(r => r.kind === "matches").map(r => [r.key, r.match]));
    return selection.keys.map(k => matches.get(available.get(k))).filter(Boolean);
  }
  button.addEventListener("click", () => { paint(); openMenu(popup.hidden); });
  document.addEventListener("click", e => {
    if (!host.contains(e.target)) openMenu(false);
    if (!host.contains(e.target) && !rail.contains(e.target)) return;
    const control = e.target.closest("button"); if (!control || control === button) return;
    const key = control.dataset.notisRow, ack = control.dataset.notisOk;
    if (!pxWorkActor() || pxWorkActor() !== actor) { paint(); return; }
    if (ack) {
      if (!rows.some(r => r.key === ack)) return;
      state.put("read." + ack, "1"); paint(); return;
    }
    if (control.hasAttribute("data-notis-close-list")) { clearSelection(); renderDetail(); button.focus(); return; }
    if (control.hasAttribute("data-notis-read")) { showRead = !showRead; paint(); return; }
    if (key) {
      const row = rows.find(r => r.key === key);
      if (row) openRow(row, rail.contains(control) && selection ? rows.filter(r => selection.keys.includes(r.key)) : visibleGroup(row.kind));
    } else if (Object.hasOwn(PartnerNotiser.groups, control.dataset.notisGroup)) {
      const list = visibleGroup(control.dataset.notisGroup); if (list.length) openRow(list[0], list);
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !popup.hidden) { openMenu(false); button.focus(); e.preventDefault(); }
  });
  document.addEventListener("focusin", e => { if (!host.contains(e.target)) openMenu(false); });
  window.addEventListener("storage", e => { if (state) { state.invalidate(e.key); paint(); } });
  return {paint, sequence};
})();
