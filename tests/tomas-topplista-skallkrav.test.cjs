const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const source = readFileSync(join(__dirname, "../ats/tomas/topplista-skallkrav.js"), "utf8");

test("Rangordna aktiva kandidatmatchningar på annonsens styrkta skallkrav", () => verifyTopMatches(source));

function verifyTopMatches(moduleSource) {
  const assert = (rule, description) => { if (!rule) throw Error(description); };
  const roles = new Map(), cands = new Map(), matches = new Map();
  const read = new Set(["roles", "matches", "candidates", "bedomningar", "ändringar"]), failedSources = new Set();
  let partner = true;
  const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const api = new Function("roles", "cands", "matches", "arbetsdagRead", "arbetsdagFailed", "recentMayRead",
    "lsData", "lsFel", "lsUpptagen", "ordersState", "pxWorkActor", "pxRoleState", "recentRejected", "recentOpenRole",
    "pxClosedPair", "stageOf", "pxRequirementRows", "pxRequirementCount", "pxAssessment", "pxRequirementKey", "t", "esc",
    moduleSource + "\nreturn {list: pxStrongMatches, html: pxStrongMatchesHTML};")(
    roles, cands, matches, read, failedSources, () => partner, {}, "", false, "ok", () => "tomas", {actor: "tomas", phase: "ready"},
    () => new Set(), role => roles.get(role.id) === role && !role.hidden, match => match.closed, match => match.stage,
    (role, match) => role.labels.map((label, i) => ({label, status: match.statuses[i] || "Att verifiera"})),
    rows => rows.filter(({status}) => ["Belagt", "Bekräftat i samtal"].includes(status)).length,
    match => ({missing: match.missing || []}), label => label.toLowerCase(), esc, esc);
  function role(id, n) {
    const r = {id, title: "Testuppdrag " + id, labels: Array.from({length: n}, (_, i) => "Krav " + i)};
    roles.set(id, r);
    return r;
  }
  function pair(id, role, covered, extras = {}) {
    const candId = id + "-person";
    cands.set(candId, {id: candId, name: "Testperson " + id});
    const match = {id, candId, roleId: role.id, stage: "matchad", statuses: Array(covered).fill("Belagt"), ...extras};
    matches.set(id, match);
    return match;
  }
  const five = role("fem", 5), six = role("sex", 6), many = role("många", 251), unknown = role("tom", 0);
  pair("80", five, 4, {score: 100, cv: true, consent: true});
  pair("0", unknown, 0);
  const near = pair("över", many, 201);
  const best = pair("bäst", six, 6);
  const pending = pair("fem-av-sex", six, 5);
  pending.statuses[4] = "Bekräftat i samtal";
  const veto = pair("uttryckligt-nej", six, 5);
  veto.statuses[5] = "Motstridiga besked"; veto.missing = ["Krav 5"];
  const no = pair("saknas", six, 5); no.statuses[5] = "Saknas enligt bedömningen";
  pair("fel-uppdrag", {id: "inget"}, 6);
  pair("stängd", six, 6, {closed: true});
  pair("okänt-steg", six, 6, {stage: "?"});
  pair("väntar", six, 6, {egen: true});
  const hidden = role("dolt", 1); hidden.hidden = true; pair("dolt", hidden, 1);
  const ids = () => api.list().map(x => x.match.id);
  assert(JSON.stringify(ids()) === JSON.stringify([best.id, pending.id, near.id]), "Exakt gräns, öppna par och sortering");
  assert(api.list(six).length === 2 && api.list(unknown).length === 0, "Rätt uppdrag och kravlista");
  assert(api.html(six).includes("5 av 6") && api.html().includes('data-openm="över"'), "Andel och länk till rätt matchkort");
  assert(!api.html().includes('data-openm="uttryckligt-nej"'), "Uttryckligt nej blockerar");
  for (let i = 0; i < 8; i++) pair("fler" + i, five, 5);
  assert(api.list().length === 11, "Samtliga kvalande matchningar syns");
  const nearly = role("flera", 250);
  pair("liknande-kvot", nearly, 201);
  assert(ids().indexOf("liknande-kvot") < ids().indexOf(near.id), "Sortera på faktisk kvot");
  const lower = role("avrundas-lika", 2601);
  pair("aa-lägre", lower, 2082); pair("zz-högre", lower, 2083);
  assert(ids().indexOf("zz-högre") < ids().indexOf("aa-lägre"), "Samma avrundade procent sorteras exakt");
  failedSources.add("bedomningar");
  assert(api.list() === null && !api.html().includes("data-openm"), "Ofullständiga avvisningar");
  failedSources.clear(); partner = false;
  assert(api.html() === "" && api.list() === null, "Utanför partnervyn");
}
