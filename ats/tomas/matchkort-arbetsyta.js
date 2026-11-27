// The two partner views share this workspace. All displayed data comes from the
// current view's existing, permission-filtered role and candidate snapshots.
function pxRenderMatchWorkspace(detail, role) {
  const wasOpen = Boolean(detail.querySelector(".match-workspace.profile-open"));
  pxPairView(detail, role);
  const card = detail.querySelector(".px-match-detail");
  if (!card || !pxVisibleDetailRole(role.id)) return;
  const match = matches.get(focusPick[role.id]);
  const candidate = match?.roleId === role.id ? cands.get(match.candId) : null;

  const shell = document.createElement("div");
  shell.className = "match-workspace";
  card.replaceWith(shell);
  shell.append(pxWorkspaceNavigation(role), card);
  const meta = card.querySelector(".px-pair-hero .px-d-meta");
  if (!meta || !candidate) return;
  const url = partnerPublicProfileUrl(candidate);
  const summary = pxCandidateSummary(candidate, match);
  if (!url && !summary) return;

  // The external anchor keeps middle-click and the browser's native split-view action.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tbtn match-profile-toggle";
  toggle.textContent = "Visa kandidatsammanfattning";
  if (url) {
    const linkedin = meta.querySelector("a[data-ext]") || document.createElement("a");
    linkedin.href = url;
    linkedin.target = "_blank";
    linkedin.rel = "noopener noreferrer";
    linkedin.dataset.ext = "";
    linkedin.className = "tbtn";
    linkedin.textContent = "Öppna på LinkedIn ↗";
    meta.append(toggle, linkedin);
  } else {
    meta.append(toggle);
  }
  toggle.setAttribute("aria-controls", "match-profile-pane");
  const panel = document.createElement("aside");
  panel.id = "match-profile-pane";
  panel.className = "match-profile-pane";
  panel.setAttribute("aria-labelledby", "match-profile-heading");
  panel.innerHTML = '<div class="match-profile-heading"><h2 id="match-profile-heading" tabindex="-1">Kandidatsammanfattning</h2>' +
    '<button class="tbtn" type="button" aria-label="Stäng kandidatsammanfattning">×</button></div>' +
    '<h3>' + t(candidate.name || match.candName || "Konsult") + '</h3>' +
    summary +
    (url ? '<a class="tbtn match-linkedin" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" data-ext>Öppna på LinkedIn ↗</a>' +
      '<p class="match-split-hint">För att se hela LinkedIn-profilen bredvid kortet, högerklicka på länken och välj delad vy om din webbläsare har det valet.</p>' : '');
  shell.append(panel);

  function showProfile(open, moveFocus) {
    panel.hidden = !open;
    shell.classList.toggle("profile-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (moveFocus) {
      const destination = open ? panel.querySelector("h2") : toggle;
      destination.focus({ preventScroll: true });
      destination.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  toggle.addEventListener("click", () => showProfile(panel.hidden, true));
  panel.querySelector("button").addEventListener("click", () => showProfile(false, true));
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      showProfile(false, true);
    }
  });
  showProfile(wasOpen, false);
}

function pxCandidateSummary(candidate, match) {
  // Profile notes are partner-visible free text. Move only explicitly labelled
  // lines into sections. Never infer titles, skills or jobs from role requirements.
  const groups = new Map();
  const headings = {
    "nuvarande roll": "Nuvarande roll", "nuvarande titel": "Nuvarande roll", "current role": "Nuvarande roll",
    "erfarenhet": "Erfarenhet", "arbetslivserfarenhet": "Erfarenhet", "experience": "Erfarenhet",
    "kompetenser": "Kompetenser", "skills": "Kompetenser", "tekniker": "Tekniker"
  };
  const append = (label, value) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(value);
  };
  const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
  let current = "Profiltext i ATS";
  for (const line of note.split(/\r?\n/)) {
    const parts = /^\s*(?:#{1,4}\s*)?([^:]{1,26}):\s*(.*)$/.exec(line);
    const heading = parts && Object.hasOwn(headings, parts[1].trim().toLowerCase())
      ? headings[parts[1].trim().toLowerCase()] : null;
    if (heading) {
      current = heading;
      if (parts[2]) append(current, parts[2]);
    } else if (!line.trim()) {
      current = "Profiltext i ATS";
    } else {
      append(current, line.trim());
    }
  }
  const facts = [];
  const full = [];
  const normalize = value => value.toLocaleLowerCase("sv").replace(/\s+/g, " ").trim();
  const seen = new Set();
  for (const [heading, lines] of groups) {
    const paragraph = lines.filter(line => {
      const key = normalize(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join("\n");
    if (!paragraph) continue;
    // Keep the initial reading view compact, with complete remaining text available.
    const limit = facts.length ? 125 : 245;
    const boundary = paragraph.length > limit ? paragraph.slice(0, limit).search(/\s+\S*$/) : -1;
    const cut = paragraph.length > limit ? (boundary > 0 ? boundary : limit) : paragraph.length;
    const shown = paragraph.slice(0, cut);
    const block = (title, content) => '<section class="match-profile-text"><h4>' + t(title) +
      '</h4><p class="pre">' + t(content) + '</p></section>';
    if (facts.length < 3) {
      facts.push(block(heading, shown + (cut < paragraph.length ? "…" : "")));
      if (cut < paragraph.length) full.push(block(heading + " (fortsättning)", paragraph.slice(cut).trimStart()));
    } else {
      full.push(block(heading, paragraph));
    }
  }
  const normalizedNote = normalize(note);
  const evidence = (Array.isArray(match.belagt) ? match.belagt : [match.belagt]).filter(item => {
    if (typeof item !== "string" || !item.trim()) return false;
    const key = normalize(item);
    if (seen.has(key) || normalizedNote.includes(key)) return false;
    seen.add(key);
    return true;
  });
  const evidenceList = values => '<ul>' + values.map(value => '<li>' + t(value.trim()) + '</li>').join("") + '</ul>';
  if (evidence.length) {
    // A match-specific assessment is a separate, labelled source.
    const section = '<section class="match-profile-text"><h4>Belagt för uppdraget</h4>';
    const shortCount = facts.length ? 1 : 2;
    if (facts.length < 3) {
      facts.push(section + evidenceList(evidence.slice(0, shortCount)) + '</section>');
      if (evidence.length > shortCount) full.push(section + evidenceList(evidence.slice(shortCount)) + '</section>');
    } else {
      full.push(section + evidenceList(evidence) + '</section>');
    }
  }
  return facts.join("") + (full.length ? '<details class="match-profile-more"><summary>Läs mer</summary>' + full.join("") + '</details>' : '');
}

function pxWorkspaceNavigation(currentRole) {
  const ids = new Set([currentRole.id]);
  if (typeof workTabs !== "undefined") {
    for (const tab of workTabs.values()) {
      if (tab.kind === "role") ids.add(tab.id);
    }
  }
  for (const row of pxTeamRows()?.values() || []) {
    if (row.owned_by_me) ids.add(row.role_id);
  }
  const visible = [...ids].filter(pxVisibleDetailRole).map(id => roles.get(id));
  const nav = document.createElement("nav");
  nav.className = "match-role-nav";
  nav.setAttribute("aria-label", "Uppdrag i arbetsytan");
  const rows = visible.map(role => {
    const active = role.id === currentRole.id ? ' aria-current="true"' : '';
    return '<li><button type="button" data-openr="' + esc(role.id) + '"' + active + '>' +
      (role.ref ? '<span class="match-role-ref">' + t(role.ref) + '</span>' : '') +
      '<span>' + t(role.title || "Uppdrag utan titel") + '</span></button></li>';
  }).join("");
  nav.innerHTML = '<details><summary>Uppdrag</summary><div class="match-role-list"><ul>' + rows +
    '</ul><button type="button" class="tbtn" data-px-jobs-back>Alla uppdrag</button></div></details>';
  const menu = nav.querySelector("details");
  // A resize between large and small screens must keep the navigation usable.
  menu.open = window.matchMedia("(min-width: 60rem)").matches;
  return nav;
}
