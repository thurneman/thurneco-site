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
test("Endast tillgängliga CV och direkta kontaktvägar får en markering", () => {
  const labels=(candidate,upload,contact)=>helpers.availabilityHTML(helpers.availableDetails(candidate,upload,contact));
  assert.equal(labels({cv:"CV nämns i dialogen"},{filnamn:"cv.pdf"},{linkedin:"https://www.linkedin.com/in/demo"}),"");
  assert.equal(labels({cv:"https://"},{url:"javascript:alert(1)"},{phone:"saknas",email:"—"}),"");
  const cvOnly=labels({cv:"https://example.test/cv.pdf"},null,{});
  assert.match(cvOnly,/CV finns!/);
  assert.doesNotMatch(cvOnly,/Kontaktuppgifter/);
  for(const contact of [{phone:"+46 (0)70-123 45 67"},{email:"demo@example.test"}]){
    const contactOnly=labels({},null,contact);
    assert.match(contactOnly,/Kontaktuppgifter finns!/);
    assert.doesNotMatch(contactOnly,/CV finns!/);
    assert.match(labels({},{assetId:"cv-1"},contact),/CV finns!.*Kontaktuppgifter finns!/);
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

const samplePair={id:"pair",roleId:"role",candId:"person"};
const sampleCall={id:"23",match_id:"pair",role_id:"role",cand_id:"person",utfall:"ja_presentation",at:incoming.at};
const checkedAt=Date.parse("2025-04-12T20:00:00Z");
test("Dialog bygger på ett daterat inkommande meddelande i en synlig relation",()=>{
  const has=(message,pairs=[samplePair])=>helpers.earlierDialog({id:"person",kontakter:[message]},pairs,checkedAt);
  assert.equal(has(incoming),true);
  for(const change of [{riktning:"ut"},{typ:"kommentar"},{kanal:"telefon"},{roleId:"annan"},{candId:"annan"},{matchId:"annan"},{text:" "},{at:"2040-01-01"}])
    assert.equal(has({...incoming,...change}),false);
  assert.equal(has(incoming,[]),false);
  assert.equal(has(incoming,[samplePair,{...samplePair,id:"två"}]),false);
  assert.equal(has({...incoming,matchId:"pair"},[samplePair,{...samplePair,id:"två"}]),true);
});
test("Enbart aktuellt presentationsbesked styr samtycket",()=>{
  const signals=(...rows)=>helpers.callSignals(samplePair,rows,checkedAt);
  assert.deepEqual(signals(sampleCall),{hasDialog:true,hasConsent:true});
  const later={...sampleCall,at:"2025-04-12T14:00:00Z",id:"24"};
  assert.deepEqual(signals(sampleCall,{...later,utfall:"ej_natt"}),{hasDialog:true,hasConsent:true});
  assert.deepEqual(signals({...later,utfall:"nej"},sampleCall),{hasDialog:true,hasConsent:false});
  assert.equal(signals(sampleCall,{...sampleCall,id:"24",utfall:"nej"}).hasConsent,false);
  assert.equal(signals({...sampleCall,utfall:"vill_veta_mer"}).hasConsent,false);
  assert.deepEqual(signals({...sampleCall,utfall:"ej_natt"}),{hasDialog:false,hasConsent:false});
  for(const change of [{match_id:"annan"},{role_id:"annan"},{cand_id:"annan"},{at:"2040-01-01"},{utfall:"intresserad"}])
    assert.deepEqual(signals({...sampleCall,...change}),{hasDialog:false,hasConsent:false});
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
  const build=new Function("TomasMatchkort","pxAssessment","pxCommentsReady","pxCallNotes","pxCardSignals","esc", names.map(declaration).join("\n")+"\nreturn pxRequirementSummary;");
  test(filename+" laddar samtycke enbart för det öppna matchkortet och visar rätt gröna markeringar",async()=>{
    const badge={dataset:{pxCardSignals:"pair"},innerHTML:""};
    const read=new Function("TomasMatchkort","window","document","linksForCand","pxVisibleDetailRole","contactOf",
      'let pxCallSnapshot=null;const userId="partner",cvs=new Map(),view="matchning",selected="role",focusPick={role:"pair"};\n'+declaration("pxCardSignals")+"\nreturn pxCardSignals;");
    const person={id:"person",cv:"https://example.test/cv.pdf",email:"demo@example.test",kontakter:[incoming]};
    const rt={callOutcomes:async m=>m.id===samplePair.id?[sampleCall]:[],visaSom:()=>filename.includes("/test/")?"partner":""};
    const render=read(helpers,{ATS_RUNTIME:rt},{querySelector:()=>badge},()=>[samplePair],()=>true,c=>c);
    assert.doesNotMatch(render(samplePair,person),/Givit samtycke/);
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(badge.innerHTML,/Tidigare dialog.*CV finns!.*Kontaktuppgifter finns!.*Givit samtycke/);
    const other=render({...samplePair,id:"annan"},{id:"person"});
    assert.doesNotMatch(other,/Givit samtycke/);
  });
  test(filename+" begränsar samtalsläsningen till den visade partnern och matchningen",async()=>{
    const code=fs.readFileSync(path.join(root,path.dirname(filename),"ats-runtime.js"),"utf8");
    const start=code.indexOf("async callOutcomes(match)"),end=code.indexOf("\n    },",start);
    assert.ok(start>=0 && end>start);
    const method=new Function("sb","ctx","PARTNER","SOM","return ({"+code.slice(start,end)+"\n}}).callOutcomes;");
    if(filename.includes("/test/")){
      const api={rpc:async(name,args)=>{
        assert.equal(name,"ats_visa_som");assert.deepEqual(args,{p_vem:"test@partner.example",p_kalla:"samtalsutfall"});
        return {data:[{...sampleCall,rad:"Privat samtalsanteckning"},{...sampleCall,role_id:"annan"}]};
      }};
      assert.deepEqual(await method(api,{visaSom:true},true,"test@partner.example")(samplePair),[sampleCall]);
      assert.deepEqual(await method({},null,true,"")(samplePair),[]);
    } else {
      const queries=[],api={from(table){
        assert.equal(table,"samtalsutfall");
        const q={filters:{},select(cols){assert.equal(cols,"id,match_id,cand_id,role_id,utfall,at");return this;},
          eq(k,v){this.filters[k]=v;return this;},in(k,values){this.types=values;return this;},lte(){return this;},
          order(){return this;},limit(n){assert.equal(n,1);queries.push(this);return Promise.resolve({data:[]});}};
        return q;
      }};
      assert.deepEqual(await method(api,{roll:"partner"},true,"")(samplePair),[]);
      assert.equal(queries.length,2);
      for(const q of queries)assert.deepEqual(q.filters,{match_id:"pair",cand_id:"person",role_id:"role"});
      assert.deepEqual(await method({}, {roll:"agare"},true,"")(samplePair),[]);
    }
  });
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
    const renderCard=build(helpers,assess,true,()=>[],(m,c)=>helpers.availabilityHTML(helpers.availableDetails(c,null,c)),String);
    const details={id:"person",cv:"https://example.test/cv.pdf",email:"demo@example.test"};
    assert.match(renderCard(role,pair,details),/50 % · 1 av 2 skallkrav styrkta<\/strong><div data-px-card-signals="pair"><div class="px-match-availability">.*CV finns!.*Kontaktuppgifter finns!/);
    assert.doesNotMatch(renderCard(role,pair,{id:"person"}),/px-match-availability/);
    assert.match(renderCard({id:"role",brief:"Endast rollbeskrivning"},pair,details),/Underlag saknas.*CV finns!/);
    assert.doesNotMatch(renderCard({id:"role",brief:"Endast rollbeskrivning"},pair,details),/%/);
  });
}
