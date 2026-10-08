// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
global.window = {};
require("../data/traits.js");
const L = require("../logic.js");
const T = L.loadTraits(window.CONSENSUS_DATA);

test("exact name match is first, then traits ordered by species", () => {
  const r = L.searchTraits(T, "plant height");
  assert.strictEqual(r[0].trait.full_name, "Plant height");
  assert.ok(r[0].exact);
  const rest = r.filter(x => !x.exact && !x.partial).map(x => x.trait.num_species);
  assert.deepStrictEqual(rest, [...rest].sort((a, b) => b - a));
});

test("CamelCase short names find the same trait", () => {
  assert.strictEqual(L.searchTraits(T, "PlantHeight")[0].trait.consensus_id, "BICT:00001");
});

test("traits containing every typed word come before partial matches", () => {
  const r = L.searchTraits(T, "drought tolerance");
  const firstPartial = r.findIndex(x => x.partial);
  assert.ok(firstPartial === -1 || r.slice(firstPartial).every(x => x.partial));
});

test("method class agreement comes from the database alternatives", () => {
  const c = L.classConsensus(T.find(t => t.consensus_id === "BICT:00001"), "method_class");
  assert.strictEqual(c.value, "Measurement");
  assert.strictEqual(c.total, 39);
  assert.strictEqual(c.level, "strong");
});

test("text agreement is measured across matching traits, weighted by definitions", () => {
  const r = L.searchTraits(T, "plant height"), pool = r.filter(x => !x.partial).map(x => x.trait);
  const c = L.textConsensus(r[0].trait, pool, "trait_entity");
  assert.strictEqual(c.value, "plant");
  assert.ok(c.agreement > 0.5 && c.agreement <= 1);
});

test("categories parse for ordinal and nominal scales", () => {
  assert.deepStrictEqual(L.parseCategories("1=Low; 2=High"), [["1", "Low"], ["2", "High"]]);
  assert.deepStrictEqual(L.nominalCategories("1=White; 2=Red"), ["White", "Red"]);
  assert.deepStrictEqual(L.nominalCategories("red; green"), ["red", "green"]);
});

test("scale options fall back to the best matching trait that uses the class", () => {
  const r = L.searchTraits(T, "plant height"), sel = r[0].trait, pool = r.map(x => x.trait);
  assert.strictEqual(L.scaleSource(sel, pool, "Numerical"), sel);
  const ord = L.scaleSource(sel, pool, "Ordinal");
  assert.ok(ord === null || (ord.scale_class === "Ordinal" && ord.scale_categories));
});

test("single-source fields are 'limited', not 'strong'", () => {
  assert.strictEqual(L.level(1, 1), "limited");
  assert.strictEqual(L.level(0.9, 30), "strong");
  assert.strictEqual(L.level(0.4, 30), "weak");
});

test("short names are rebuilt from the full name when they fit in 16 characters", () => {
  assert.strictEqual(L.shortName({ full_name: "Drought tolerance", name: "DroughtToleranc" }), "DroughtTolerance");
  assert.strictEqual(L.shortName({ full_name: "Plant height to neck of peduncle", name: "PlHeToNeOfPe" }), "PlHeToNeOfPe");
});
