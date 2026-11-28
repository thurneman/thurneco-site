/* Kandidatlistan använder partnerns redan inlästa uppdrag och matchkort. */
function pxStrongMatches(scope) {
  if (!recentMayRead()) return null;
  const sources = ["roles", "matches", "candidates", "bedomningar", "ändringar"];
  if (!sources.every(key => arbetsdagRead.has(key) && !arbetsdagFailed.has(key)) ||
      !lsData || lsFel || lsUpptagen || ordersState !== "ok") return null;

  const actor = pxWorkActor();
  if (actor && (pxRoleState.actor !== actor || ["idle", "loading", "error"].includes(pxRoleState.phase))) return null;
  const rejected = recentRejected();
  const open = new Map();
  for (const role of scope ? [scope] : roles.values()) {
    if (recentOpenRole(role, rejected)) open.set(role.id, role);
  }

  const activeStages = new Set(["matchad", "ansokt", "kontaktad", "intresserad", "presenterad", "intervju", "erbjudande"]);
  const ranked = [];
  for (const [id, match] of matches) {
    if (!match || match.id !== id || match.egen || !activeStages.has(stageOf(match))) continue;
    const role = open.get(match.roleId);
    const person = cands.get(match.candId);
    if (!role || !person?.name || person.id !== match.candId || pxClosedPair(match)) continue;

    const rows = pxRequirementRows(role, match);
    const total = rows.length;
    const covered = pxRequirementCount(rows);
    if (!total || 5 * covered <= 4 * total) continue;
    const failed = new Set(pxAssessment(match).missing.map(pxRequirementKey));
    if (rows.some(row => row.status === "Saknas enligt bedömningen" || failed.has(pxRequirementKey(row.label)))) continue;

    ranked.push({ role, person, match, covered, total });
  }
  return ranked.sort((a, b) => b.covered * a.total - a.covered * b.total ||
    a.person.name.localeCompare(b.person.name, "sv") || a.match.id.localeCompare(b.match.id));
}

function pxStrongMatchesHTML(scope = null) {
  if (!recentMayRead()) return "";
  const ranked = pxStrongMatches(scope);
  const heading = scope ? "Kandidater över 80 %" : "Topplistan · Kandidater över 80 %";
  const title = '<h2>' + heading + '</h2>';
  if (!ranked) return '<section class="px-d-pane px-strong-matches">' + title + '<p>Fullständigt underlag för topplistan saknas.</p></section>';
  const list = ranked.map(({ role, person, match, covered, total }) => {
    const exact = 100 * covered / total;
    const rounded = Math.round(exact * 10) / 10;
    const percent = rounded === 80 ? "Över 80" : rounded === 100 && covered < total ? "Under 100" : rounded.toLocaleString("sv-SE");
    const href = "#kandidat=" + encodeURIComponent(match.id);
    const roleLabel = scope ? "" : ' · ' + t([role.ref, role.title].filter(Boolean).join(" · "));
    return '<li><a class="px-agenda-link" href="' + esc(href) + '" data-openm="' + esc(match.id) + '">' + t(person.name) +
      '</a>' + roleLabel + ' · <strong>' + percent + ' %</strong> · ' + covered + ' av ' + total + ' skallkrav styrkta</li>';
  }).join("");
  const content = list ? '<ol>' + list + '</ol>' : '<p>Ingen aktiv matchning med över 80 % styrkta skallkrav.</p>';
  return '<section class="px-d-pane px-strong-matches">' + title + content + '</section>';
}
