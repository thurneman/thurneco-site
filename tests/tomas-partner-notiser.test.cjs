"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {collect, personalStore} = require("../ats/tomas/partner-notiser.js");

const date = s => "2026-11-" + s;
const NOW = Date.parse(date("27T11:00:00Z"));
const role = (id,at) => ({id,title:id,createdAt:at});
const pair = (id,roleId,at) => ({id,roleId,candId:"c"+id,createdAt:at});
function fixture() {
  const roles = [role("r1",date("26T23:01:00Z")),role("r2",date("26T22:59:00Z")),role("hidden",date("27T08:20:00Z"))];
  const pairs = [pair("a","r1",date("27T09:00:00Z")),pair("b","r2",date("27T09:10:00Z")),pair("c","hidden",date("27T09:11:00Z"))];
  return {actor:"tomas",now:NOW,roles:new Map(roles.map(r=>[r.id,r])),matches:new Map(pairs.map(m=>[m.id,m])),
    people:new Map(pairs.map(m=>[m.candId,{id:m.candId,name:m.id,kontakter:[]} ])), owned:new Set(["r1","hidden"]), order:()=>null,
    sentReplies:[],roleTitle:r=>r.title,visible:r=>r.id!=="hidden",reviewable:()=>true,complete:true,
    stamp(value,now){const stamp=Date.parse(value);return Number.isFinite(stamp)&&stamp<=now?stamp:null;}};
}
const kind = (events,name) => events.filter(r=>r.kind===name);
const mem = () => {const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v)};};
const receipt = m => ({uid:"tomas",matchId:m.id,roleId:m.roleId,candId:m.candId,kvittens:date("27T08:10:00Z")});
function inbound(at, extra={}) {return {roleId:"r1",riktning:"in",kanal:"inmail",at:date(at),...extra};}

test("Dagens synliga uppdrag följer svensk kalenderdag och kandidater kräver eget uppdrag",()=>{
  const d=fixture(), rows=collect(d,personalStore("tomas",mem()));
  assert.deepEqual(kind(rows,"roles").map(x=>x.role),["r1"]);
  assert.deepEqual(kind(rows,"matches").map(x=>x.match),["a"]);
  d.matches.get("a").createdAt=date("26T11:00:00Z");
  d.matches.get("a").updatedAt=date("27T09:00:00Z");
  assert.equal(kind(collect(d,personalStore("tomas",mem())),"matches").length,0);
});
test("Saknade skapandedatum får en tyst baslinje och därefter ett beständigt observationsdatum",()=>{
  const d=fixture(), disk=mem(), state=personalStore("tomas",disk);
  delete d.matches.get("a").createdAt;
  assert.equal(kind(collect(d,state),"matches").length,0);
  const m=pair("d","r1",undefined);d.matches.set(m.id,m);d.people.set(m.candId,{id:m.candId,name:"D"});
  const fresh=kind(collect(d,state),"matches");assert.equal(fresh.length,1);assert.equal(fresh[0].observed,true);
  d.now+=86400000;
  assert.equal(kind(collect(d,personalStore("tomas",disk)),"matches")[0].at,NOW);
  assert.equal(kind(collect(d,personalStore("annan",disk)),"matches").length,0);
});
test("Enbart egna styrkta utskick ger svar och en kollegas mellanliggande utskick utesluter tvetydig avsändare",()=>{
  const d=fixture(),s=personalStore("tomas",mem()),c=d.people.get("ca");
  c.kontakter=[inbound("27T08:00:00Z"),inbound("27T09:00:00Z"),inbound("27T09:10:00Z",{kanal:"telefon"}),inbound("27T09:20:00Z",{roleId:"r2"})];
  d.order=m=>({...receipt(m),uid:"kollega"});assert.equal(kind(collect(d,s),"replies").length,0);
  d.order=m=>({...receipt(m),matchId:"fel"});assert.equal(kind(collect(d,s),"replies").length,0);
  d.order=m=>({...receipt(m),svarAt:date("27T09:00:00Z")});
  assert.equal(kind(collect(d,s),"replies").filter(r=>r.match==="a").length,1);
  d.order=receipt;
  c.kontakter.push(inbound("27T08:40:00Z",{riktning:"ut"}));
  assert.equal(kind(collect(d,s),"replies").length,0);
});
test("Eget skickat partnersvar har rätt matchning, person och verifierad sändtid",()=>{
  const d=fixture(),s=personalStore("tomas",mem());
  d.people.get("ca").kontakter=[inbound("27T09:00:00Z")];
  const q={av:"tomas",matchId:"a",roleId:"r1",candId:"ca",status:"bestalld",at:date("27T08:00:00Z")};d.sentReplies=[q];
  assert.equal(kind(collect(d,s),"replies").length,0);
  Object.assign(q,{status:"skickat",skickatAt:date("27T08:59:00Z")});
  assert.equal(kind(collect(d,s),"replies").length,1);
  q.candId="xx";assert.equal(kind(collect(d,s),"replies").length,0);
});
test("Läst sparas på enskild notis och per konto, inklusive omladdning",()=>{
  const d=fixture(),disk=mem(),first=personalStore("tomas",disk);
  const before=collect(d,first), one=before[0].key;
  first.put("read."+one,"1");
  const reopened=collect(d,personalStore("tomas",disk));
  assert.deepEqual(reopened.filter(r=>r.read).map(r=>r.key),[one]);
  assert.equal(collect({...d,actor:"anna"},personalStore("anna",disk)).some(r=>r.read),false);
});
