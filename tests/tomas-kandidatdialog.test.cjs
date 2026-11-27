const test = require("node:test");
const assert = require("node:assert/strict");
const { thread } = require("../ats/tomas/kandidatdialog.js");

const match = { id: "match", roleId: "roll", candId: "person" };
const base = {
  match, candidate: { id: "person" }, actorId: "actor", actorEmail: "partner@example.test",
  now: Date.parse("2026-11-27T09:00:00Z"), unambiguousPair: true
};
const t1 = "2026-11-23T14:00:00Z", t2 = "2026-11-25T14:00:00Z", t3 = "2026-11-26T14:00:00Z";
function contact(direction, at, text, proof = {}) {
  return { roleId: match.roleId, candId: match.candId, riktning: direction, at, kanal: "inmail",
    text: "Intern sammanfattning", partnerMeddelande: { matchId: match.id, text, ...proof } };
}
const order = {
  matchId: match.id, candId: match.candId, roleId: match.roleId, uid: "actor", bestallare: "PARTNER@example.test",
  id: "11", status: "skickat", kvittens: t1, at: "2026-11-20T10:00:00Z", instruktion: "Intern instruktion"
};
const reply = {
  matchId: match.id, candId: match.candId, roleId: match.roleId, id: "r1", typ: "svar",
  status: "skickat", av: "actor", skickatAt: t3, text: "Uppföljning"
};

test("hela den verifierade tråden har exakta texter, båda datumen och väntetid efter uppföljning", () => {
  const before = contact("ut", t1, "Första InMail", { orderId:"11" });
  const incoming = contact("in", t2, "  Kandidatens svar\nordagrant  ", { orderId:"11" });
  const answered = thread({ ...base, order: { ...order, svarAt:t2 }, contacts: [incoming,before] });
  assert.deepEqual(answered.messages, [
    {direction:"ut",channel:"inmail",at:t1,text:"Första InMail"}, {direction:"in",channel:"inmail",at:t2,text:"  Kandidatens svar\nordagrant  "}
  ]);
  assert.deepEqual([answered.lastSentAt,answered.lastReplyAt,answered.waiting,answered.waitingDays], [t1,t2,false,null]);
  const waiting = thread({ ...base, contacts:[before,incoming], replies:[reply] });
  assert.deepEqual([waiting.messages.length,waiting.lastSentAt,waiting.lastReplyAt,waiting.waiting,waiting.waitingDays],
    [3,t3,t2,true,1]);
});

test("bekräftad leverans räcker för väntelistan även om den exakta brödtexten saknas", () => {
  const result = thread({ ...base, order: { ...order, svarText:"Operatörens tolkning" } });
  assert.deepEqual(result.messages, [{ direction:"ut",channel:"inmail",at:t1,text:null }]);
  assert.equal(result.waitingDays,4);
  const alsoAnswered = thread({ ...base, order:{ ...order, svarAt:t2, svarText:"Operatörens tolkning" } });
  assert.deepEqual(alsoAnswered.messages[1], { direction:"in",channel:"inmail",at:t2,text:null });
  assert.equal(thread({ ...base, order:{ ...order, kvittens:null, statusAt:t1, at:t1 } }),null);
  assert.deepEqual(thread({ ...base, order:{ ...order, status:"bestalld" } }).messages,[]);
});

test("skydd mot samma kandidat på annat uppdrag, annan konsult, annan partner och obehörigt utdrag", () => {
  const proper = contact("ut", t1, "Egen text");
  const wrong = [
    { ...proper, roleId:"annan-roll" }, { ...proper, candId:"annan" }, { ...proper, matchId:"annan" },
    { ...proper, partnerMeddelande:{ matchId:"annan", text:"Annat" } },
    { ...proper, partnerMeddelande:null }, { ...proper, kanal:"kommentar-tomas" }
  ];
  assert.equal(thread({ ...base, contacts:wrong, order:{ ...order, uid:"annan" },
    replies:[{ ...reply, av:"annan" },{ ...reply, candId:"annan" },{...reply, av:"annan", status:"bestalld"}] }),null);
  assert.equal(thread({ ...base, actorId:"", actorEmail:"", contacts:[proper] }),null);
  assert.equal(thread({ ...base, candidate:{id:"annan"}, contacts:[proper] }),null);
  assert.equal(thread({ ...base, unambiguousPair:false, order:{ ...order,matchId:null } }),null);
  assert.equal(thread({ ...base, unambiguousPair:false, contacts:[proper] }).messages.length,1);
});

test("en order och ett partnersvar registreras en gång även vid olika klockslag i källorna", () => {
  const second = { ...contact("ut", t3, "Uppföljning", {partnerSvarId:"r1"}), kontaktId:"2" };
  const first = { ...contact("ut", t1, "Första InMail", { orderId:"11" }), kontaktId:1 };
  const result = thread({ ...base, order:{ ...order, kvittens:"2026-11-23T14:00:02Z" },
    contacts:[first,second,{...first,kontaktId:"1"}],
    replies:[{ ...reply, skickatAt:"2026-11-26T14:00:02Z" }, reply] });
  assert.deepEqual(result.messages.map(m=>m.at),[t1,t3]);
});

test("två olika, kvitterade utskick av samma text vid samma tid är två händelser", () => {
  const a = { ...contact("ut", t3, "Uppföljning"), kontaktId:"a" };
  const b = { ...a, kontaktId:"b" };
  const result = thread({ ...base, contacts:[a,b], replies:[reply,{...reply,id:"r2"}] });
  assert.equal(result.messages.length,2);
  assert.equal(thread({ ...base, contacts:[a,contact("in",t3,"Mitt svar")] }).waiting,false);
});

test("väntetid räknar lokala kalenderdagar över midnatt och båda tidsomställningarna", () => {
  for (const [sent,now,days] of [
    ["2026-03-28T22:55:00Z","2026-03-28T23:05:00Z",1],
    ["2026-03-28T23:55:00Z","2026-03-29T22:05:00Z",1],
    ["2026-10-24T22:05:00Z","2026-10-25T22:55:00Z",0]
  ]) {
    assert.equal(thread({ ...base, now:Date.parse(now), contacts:[contact("ut",sent,"Hej")] }).waitingDays,days);
  }
});

test("visa odaterade meddelanden men lämna okänd tid okänd", () => {
  const out = contact("ut",null,"Utan skickattid");
  assert.deepEqual(thread({ ...base, contacts:[out] }), {
    messages:[{direction:"ut",channel:"inmail",at:null,text:"Utan skickattid"}],pending:[],pendingAt:null,
    lastSentAt:null,lastReplyAt:null,waiting:true,waitingDays:null,unknownTiming:false
  });
  const uncertain = thread({ ...base, contacts:[out,contact("in",t2,"Hej")] });
  assert.equal(uncertain.unknownTiming,true);
  assert.equal(uncertain.waiting,false);
  const future = contact("ut","2040-01-01T00:00:00Z","För tidig");
  assert.equal(thread({ ...base, contacts:[future] }),null);
});

test("ett nyare oplacerat InMail-svar stoppar räknaren utan att bli synligt", () => {
  const unscoped = { ...contact("in",t2,""), partnerMeddelande:null, text:"Hör möjligen till annan beställare" };
  for (const at of [t2,t1,null]) {
    const result = thread({ ...base, order, contacts:[{ ...unscoped, at }] });
    assert.deepEqual(result, {
      messages:[{direction:"ut",channel:"inmail",at:t1,text:null}],pending:[],pendingAt:null,lastSentAt:t1,lastReplyAt:null,
      unknownTiming:true,waiting:false,waitingDays:null
    });
  }
  for (const delta of [
    {at:"2026-11-22T08:00:00Z"}, {roleId:"annan-roll"}, {candId:"annan-person"},
    {partnerMeddelande:{matchId:"annan-match",text:"Hör till annat uppdrag"}},
    {kanal:"kommentar-tomas"}, {at:"2040-01-02T12:05:00Z"}
  ]) {
    const result = thread({ ...base, order, contacts:[{ ...unscoped, ...delta }] });
    assert.deepEqual([result.waiting,result.unknownTiming,result.waitingDays,result.messages.length],[true,false,4,1]);
  }
  assert.equal(thread({ ...base, contacts:[unscoped] }),null);
  const answered = thread({ ...base, order, contacts:[unscoped, contact("in",t3,"Bekräftat svar")] });
  assert.equal(answered.unknownTiming,false);
  assert.equal(answered.lastReplyAt,t3);
});

test("senaste kända datum finns kvar när ett annat verifierat meddelande saknar tid", () => {
  const sent = contact("ut",t1,"Skickat"), received = contact("in",t2,"Svar");
  const unknownSent = contact("ut",null,"Odaterat ut"), unknownReply = contact("in",null,"Odaterat in");
  const uncertain = thread({ ...base, contacts:[sent,received,unknownSent,unknownReply] });
  assert.deepEqual([uncertain.lastSentAt,uncertain.lastReplyAt,uncertain.unknownTiming,uncertain.waitingDays],
    [t1,t2,true,null]);
  const waiting = thread({ ...base, contacts:[sent,unknownSent] });
  assert.deepEqual([waiting.lastSentAt,waiting.waiting,waiting.waitingDays],[t1,true,null]);
  const definitelyAnswered = thread({ ...base, contacts:[sent,received,unknownReply] });
  assert.deepEqual([definitelyAnswered.lastReplyAt,definitelyAnswered.unknownTiming,definitelyAnswered.waiting],
    [t2,false,false]);
});

test("projektionens order-id avgör vilken kvittens som kan slås ihop", () => {
  const row = { ...order, orderId:"991", id:"legacy", kvittens:t2 };
  const related = contact("ut",t1,"Exakt text",{orderId:991});
  const unrelated = contact("ut",t2,"Separat utskick",{orderId:"992"});
  const result = thread({ ...base, order:row, contacts:[unrelated,related] });
  assert.deepEqual(result.messages.map(m=>m.text),["Exakt text","Separat utskick"]);
  assert.equal(thread({ ...base, order:row, contacts:[unrelated] }).messages.length,2);
});

test("beställd kontakt eller partnersvar i kö syns separat och räknas aldrig som skickat", () => {
  const requested = { ...order, kvittens:null, status:"bestalld", at:t1,statusAt:t2 };
  const queued = { ...reply, kanal:"mail", status:"skickas", at:t2, statusAt:t3 };
  const result = thread({ ...base, order:requested, replies:[queued] });
  assert.deepEqual(result, { messages:[],lastSentAt:null,lastReplyAt:null,waiting:false,waitingDays:null,unknownTiming:false,
    pendingAt:t3,pending:[
      {kind:"reply",channel:"mail",status:"skickas",at:t2,statusAt:t3},
      {kind:"order",channel:"inmail",status:"bestalld",at:t1,statusAt:t2}
    ] });
  const historical = thread({ ...base, order:requested, contacts:[contact("in",t1,"Tack")] });
  assert.deepEqual([historical.messages.length,historical.pending.length,historical.waiting],[1,1,false]);
  assert.equal(thread({ ...base, order:{...requested,status:"angrad"} }),null);
  assert.equal(thread({ ...base, order:{...requested,uid:"någon annan"} }),null);
  assert.equal(thread({ ...base, replies:[{...queued,matchId:"annan"}] }),null);
});

test("behörighetsstyrda mejl kan besvara ett InMail och hålls isär från kvittenser i annan kanal", () => {
  const outgoing = { ...contact("ut",t1,"Mejl som skickades", {orderId:order.id}),kanal:"mail" };
  const incoming = { ...contact("in",t2,"Svar via mejl"),kanal:"mail" };
  const result = thread({ ...base, order, contacts:[outgoing,incoming] });
  assert.deepEqual(result.messages.map(m=>[m.direction,m.channel,m.text]), [
    ["ut","mail","Mejl som skickades"],["ut","inmail",null],["in","mail","Svar via mejl"]
  ]);
  assert.deepEqual([result.waiting,result.lastReplyAt,result.pendingAt],[false,t2,null]);
  const unscoped = { ...incoming, text:"Internt mejl",partnerMeddelande:null };
  assert.equal(thread({ ...base, contacts:[unscoped] }),null);
  const unsafe = thread({ ...base, order, contacts:[unscoped] });
  assert.deepEqual([unsafe.messages.length,unsafe.unknownTiming,unsafe.waitingDays],[1,true,null]);
});

test("flera inkommande svar med samma order-ID behåller sin egen tid", () => {
  const early = contact("in",t1,"Meddelande ett",{orderId:order.id});
  const later = contact("in",t2,"Meddelande två",{orderId:order.id});
  const result = thread({ ...base, order:{ ...order,svarAt:t3 }, contacts:[early,later] });
  assert.deepEqual(result.messages.filter(m=>m.direction==="in").map(m=>[m.at,m.text]),[
    [t1,"Meddelande ett"],[t2,"Meddelande två"],[t3,null]
  ]);
});
