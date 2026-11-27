const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../ats/tomas/kontaktinfo.js");

const info = globalThis.TomasKontaktinfo;
const contact = { phone: "+46 (0) 123-45", email: "prov@example.test" };

test("Visning av kontaktinfo gäller vald kandidat och inloggad partner", () => {
  const card = (viewer, candidate) => info.render(viewer, candidate, contact);
  assert.match(card("tomas", "c1"), /Lås upp kontaktinfo/);
  assert.doesNotMatch(card("tomas", "c1"), /prov@example|tel:|mailto:/);
  assert.equal(info.toggle("tomas", "c1"), true);
  assert.equal(info.isOpen("tomas", "c1"), true);
  assert.match(card("tomas", "c1"), /href="mailto:prov@example.test"/);
  assert.match(card("tomas", "c1"), /href="tel:/);
  assert.doesNotMatch(card("tomas", "c2"), /prov@example/);
  assert.doesNotMatch(card("annan", "c1"), /prov@example/);
  assert.doesNotMatch(card("tomas", "c1"), /prov@example/);
  assert.equal(card("", "c1"), "");
  info.reset();
});

test("Tomma fält har eget besked utan att ett uppslag eller köp påstås ha gjorts", () => {
  assert.match(info.render("tomas", "c1", {}), /Lås upp kontaktinfo/);
  info.toggle("tomas", "c1");
  const partial = info.render("tomas", "c1", { phone: "123" });
  assert.match(partial, /<dt>Mejl<\/dt><dd>Saknas<\/dd>/);
  assert.doesNotMatch(partial, /mailto:/);
  const missing = info.render("tomas", "c1", {});
  assert.match(missing, /Telefon och mejl saknas/);
  assert.doesNotMatch(missing, /mailto:|tel:|beställning/);
  info.reset();
});

test("Profilens befintliga ändringsfält skapas först när uppgifterna öppnats", () => {
  let count = 0;
  const fields = () => { count++; return '<label>Telefon<input type="tel"></label>'; };
  assert.doesNotMatch(info.render("tomas", "c1", {}, fields), /type="tel"/);
  assert.equal(count, 0);
  info.toggle("tomas", "c1");
  assert.match(info.render("tomas", "c1", {}, fields), /type="tel"/);
  assert.equal(count, 1);
  info.reset();
});

test("Oväntade kontaktvärden blir text och kan inte lägga till kod eller mejlmottagare", () => {
  const candidate = 'id"><img>';
  info.toggle("tomas", candidate);
  const text = info.render("tomas", candidate, {
    email: "a@example.test?bcc=b@example.test",
    phone: "<img>"
  });
  assert.doesNotMatch(text, /<img>|mailto:|tel:/);
  assert.match(text, /&lt;img&gt;/);
  assert.equal(info.toggle("tomas", candidate), false);
  assert.doesNotMatch(info.render("tomas", candidate, contact), /prov@example/);
  info.reset();
});
