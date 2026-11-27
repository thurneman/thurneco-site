const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "ats/tomas/matchkort-uppgifter.js"), "utf8");
const helpers = new Function(source + "\nreturn TomasMatchkort;")();

function last(contacts, replies = [], override = {}) {
  return helpers.latestMessage({
    match: { id:"pair", roleId:"role", candId:"person" }, candidate:{ id:"person", name:"Konsulten" },
    contacts, replies, actorId:"partner-id", actorEmail:"partner@example.test", actorName:"Partner A",
    unambiguousPair:true, preview:false, now:Date.parse("2025-04-12T18:00:00Z"), ...override
  });
}
const incoming = { roleId:"role", kanal:"inmail", riktning:"in", text:"Mitt svar", at:"2025-04-12T12:00:00Z" };
const sent = { matchId:"pair", roleId:"role", candId:"person", typ:"svar", status:"skickat", av:"partner-id",
  avNamn:"Partner A", skickatAt:"2025-04-12T12:10:00Z", text:"Mitt skickade svar" };

test("Senast skickat eller mottaget meddelande inom samma relation med rätt aktör", () => {
  assert.equal(last([incoming], [sent]).text, sent.text);
  assert.equal(last([incoming], [], {unambiguousPair:false}), null);
  assert.equal(last([{...incoming,matchId:"pair"}], [], {unambiguousPair:false}).sender, "Konsulten");
  assert.equal(last([{...incoming,at:"2025-04-12T12:20:00Z"}], [sent]).sender, "Konsulten");
  assert.equal(last([{...incoming,riktning:"ut",av:"partner@example.test"}]).sender, "Partner A");
  assert.equal(last([incoming, {...incoming,riktning:"ut",av:"annan",at:sent.skickatAt}], []).text, incoming.text);
  assert.equal(last([incoming], [{...sent,matchId:"annan"}]).text, incoming.text);
  assert.equal(last([], [sent], {preview:true,actorId:"owner-id"}).sender, "Partner A");
  assert.equal(last([], [{...sent,av:"owner-id",avNamn:"Partner A"}], {preview:true,actorId:"owner-id"}), null);
});
test("Uppdrag, kön, kommentarer, samtal, osäkra tidpunkter och instruktioner kan inte ersätta en text", () => {
  for (const delta of [{roleId:"annat"},{roleId:null},{candId:"annan"},{matchId:"annan"},{riktning:""},
    {text:"  "},{kanal:"kommentar-tomas"},{kanal:"telefon"},{kanal:"annat"},{at:"fel"},{at:"2030-01-01T12:00:00Z"}]) {
    assert.equal(last([{...incoming,...delta}]), null);
  }
  for (const delta of [{status:"bestalld"},{status:"skickas"},{skickatAt:"",at:incoming.at},
    {typ:"kommentar"},{roleId:"annat"},{candId:"annan"},{av:"annan"},{text:""}]) {
    assert.equal(last([], [{...sent,...delta}]), null);
  }
});
test("Kvitterade Recruiter-utskick använder partnerprojektionens match och brödtext", () => {
  const outgoing={...incoming, riktning:"ut", av:"Kandidatkontakt (uppgift)", text:"En kvittensrad",
    partnerMeddelande:{matchId:"pair",text:"Det här skickades faktiskt."}};
  assert.equal(last([outgoing]).sender,"Skickat via Recruiter");
  assert.equal(last([outgoing]).text,outgoing.partnerMeddelande.text);
  assert.equal(last([outgoing, {...incoming,at:"2025-04-12T13:00:00Z"}]).text,incoming.text);
  assert.equal(last([{...outgoing,partnerMeddelande:null}]),null);
  assert.equal(last([{...outgoing,partnerMeddelande:{matchId:"annan",text:"Fel tråd"}}]),null);
  assert.equal(last([{...outgoing,partnerMeddelande:{matchId:"pair",text:"   "}}]),null);
  for (const directory of ["ats/tomas","ats/test/tomas-som"]) {
    const code=fs.readFileSync(path.join(root,directory+"/ats-runtime.js"),"utf8");
    const start=code.indexOf("function kontaktDoc(r) {"), end=code.indexOf("\n  function sortKontakter",start);
    const map = new Function("PARTNER","isObj","hasOwn","tsOut",code.slice(start,end)+"\nreturn kontaktDoc;")(
      true,x=>Boolean(x)&&typeof x==="object", (x,k)=>Object.prototype.hasOwnProperty.call(x,k), x=>x);
    const raw={role_id:"role",kanal:"inmail",riktning:"ut",text:"En kvittensrad",av:"Kandidatkontakt (uppgift)",at:incoming.at};
    assert.equal(last([map({...raw,partner_meddelande:outgoing.partnerMeddelande})]).text,"Det här skickades faktiskt.");
    // Another partner's receipt is null on the server. A forged legacy extra cannot supply a message.
    assert.equal(last([map({...raw,partner_meddelande:null,extra:{partnerMeddelande:outgoing.partnerMeddelande,brodtext:"Annan order"}})]),null);
  }
});
test("Endast administrativa rader räknas bort", () => {
  for (const s of ["Bifoga ett aktuellt CV","Kontaktuppgifter","Kandidatens OK för uppdraget","CV ska bifogas.",
    "Konsultens godkännande till presentation","Kandidatens OK och timpris för uppdraget","Kandidatens bekräftelse","Kandidatens bekräftelse för uppdraget"]) {
    assert.equal(helpers.isSubmissionTask(s), true);
  }
  for (const s of ["Verifierad erfarenhet av CV-granskning","Erfarenhet av telefonförsäljning",
    "Tre års arbete med kundkontakt","CV ska visa minst två års erfarenhet av Java","Yrkesbevis ska bifogas","Bekräftelse av betalningar i SAP"]) {
    assert.equal(helpers.isSubmissionTask(s), false);
  }
});

for (const filename of ["ats/tomas/index.html", "ats/test/tomas-som/index.html"]) {
  const html = fs.readFileSync(path.join(root, filename), "utf8");
  function declaration(name) {
    const start=html.indexOf("function "+name+"(");
    assert.ok(start>=0,name);
    const end=html.indexOf("\n}",start);
    // pxListedRequirements is deliberately one line.
    if (name==="pxListedRequirements") return html.slice(start,html.indexOf("\n",start));
    return html.slice(start,end+2);
  }
  const names=["pxRequirementKey","pxKravUnderlag","pxListedRequirements","pxRequirementRows","pxRequirementCount","pxRequirementSummary"];
  const build=new Function("TomasMatchkort","pxAssessment","pxCommentsReady","pxCallNotes", names.map(declaration).join("\n")+"\nreturn pxRequirementSummary;");
  test(filename+" visar samma kravräkning och samma koppling till Historik", () => {
    assert.ok(html.includes('${pxLatestMessageHTML(m,c)}'));
    assert.ok(html.includes('src="/ats/tomas/matchkort-uppgifter.js"'));
    const role={id:"role",brief:"Skallkrav (5)\n- Java\n- Svenska\n- Bifoga CV\n- Kontaktuppgifter\n- Kandidatens OK för uppdraget"};
    const pair={id:"pair",roleId:"role"};
    const assess=()=>({evidence:["Java","Bifoga CV"],missing:[],verify:[]});
    const summary=build(helpers,assess,true,()=>[{kravSamtal:{krav:"Svenska"}}]);
    assert.match(summary(role,pair),/100 % · 2 av 2 skallkrav styrkta/);
    assert.match(summary(role,pair),/Belagda i underlaget · 1/);
    assert.match(summary(role,pair),/Bekräftade i samtal · 1/);
    assert.match(build(helpers,assess,false,()=>[])(role,pair),/50 % · 1 av 2 skallkrav styrkta/);
    assert.match(build(helpers,()=>({evidence:[],missing:[],verify:[]}),true,()=>[])(role,pair),/0 % · 0 av 2 skallkrav styrkta/);
    assert.match(build(helpers,()=>({evidence:["Java"],missing:["Java"],verify:[]}),true,()=>[])(role,pair),/0 % · 0 av 2 skallkrav styrkta/);
    assert.match(summary({id:"role",brief:"Skallkrav (6)\n- Java"},pair),/Underlag saknas/);
    assert.match(summary({id:"role",brief:"Skallkrav (2)\n- Bifoga CV\n- Kontaktuppgifter"},pair),/0 kompetenskrav/);
    const unknown=summary({id:"role",brief:"Endast rollbeskrivning"},pair);
    assert.match(unknown,/Underlag saknas/);
    assert.ok(!unknown.includes("%"));
    const zero=summary({id:"role",brief:"Skallkrav (0)"},pair);
    assert.match(zero,/0 skallkrav/);
    assert.ok(!zero.includes("%"));
    const six={id:"role",brief:"Skallkrav (6)\n- Java\n- Svenska\n- SQL\n- Python\n- C#\n- Finska"};
    const four=build(helpers,()=>({evidence:["Java","Svenska","SQL","Python"],missing:[],verify:[]}),true,()=>[]);
    assert.match(four(six,pair),/67 % · 4 av 6 skallkrav styrkta/);
  });
}
