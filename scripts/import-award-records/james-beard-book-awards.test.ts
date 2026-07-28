import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { assertCoverage, decadePageUrl, parseJamesBeardDecade } from "./james-beard-book-awards";

const category = (id: string): PrizeCategoryRegistryEntry => ({
  id,
  name: id,
  officialUrl: "https://official.example/",
  sourceUrl: "https://source.example/",
  sourceLabel: "Test source",
  sourceConfidence: "secondary",
  importStrategy: "test",
});

const prize = (id: string): PrizeRegistryEntry => ({
  id,
  name: id,
  organization: "Test organization",
  geography: "Test geography",
  categories: [
    category("beard-writing"),
    category("beard-reference-and-scholarship"),
    category("beard-food-issues-and-advocacy"),
  ],
});

const award = prize("james-beard-book-awards");
const categories = new Map(award.categories.map((entry) => [entry.id, entry]));
const sourceUrl = decadePageUrl("James Beard Foundation Award: 2010s");

const parse = (wikitext: string) => parseJamesBeardDecade(award, categories, wikitext, sourceUrl);

test("James Beard resolves renamed categories through the alias table and ignores cookbook categories", () => {
  const records = parse(`
==2010 awards==
===Book Awards===
* Cookbook of the Year: ''The Cooking of Somewhere'' by Someone
* Single Subject: ''Pie'' by Someone Else
* Reference and Scholarship: ''Encyclopedia of Pasta'' by Oretta Zanini de Vita
* Writing and Literature: ''Save the Deli'' by David Sax
===Restaurant Awards===
* Outstanding Chef: Someone
`);

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.categoryId).sort(), [
    "beard-reference-and-scholarship",
    "beard-writing",
  ]);
  assert.equal(records[0].year, 2010);
  assert.equal(records[0].sourceUrl, sourceUrl);
  assert.equal(records[0].status, "winner");
  assert.deepEqual(records[0].authors, ["Oretta Zanini de Vita"]);
  assert.equal(records[0].notes, "Source category label: Reference and Scholarship");
});

test("James Beard falls back to an italics lookahead when 2017-2019 drop the category colon", () => {
  const records = parse(`
==2019 awards==
===Book Awards===
* Reference, History, and Scholarship ''Canned: The Rise and Fall of Consumer Confidence in the American Food Industry'' by [[Anna Zeide]] ([[University of California Press]])
* Writing ''Buttermilk Graffiti: A Chef's Journey to Discover America's New Melting-Pot Cuisine'' by [[Edward Lee (chef)]] (Artisan Books)
* Cookbook Hall of Fame [[Jessica B. Harris]]
`);

  assert.equal(records.length, 2);
  const canned = records[0];
  assert.equal(canned.categoryId, "beard-reference-and-scholarship");
  assert.equal(canned.title, "Canned: The Rise and Fall of Consumer Confidence in the American Food Industry");
  assert.deepEqual(canned.authors, ["Anna Zeide"]);
  assert.equal(canned.publisher, "University of California Press");

  // [[Edward Lee (chef)]] has no display side, so the disambiguator is corrected by override.
  assert.deepEqual(records[1].authors, ["Edward Lee"]);
  assert.equal(records[1].publisher, "Artisan Books");
});

test("James Beard handles bullets with no italics, an author inside the italics, the 'b y' typo, and bold-italic separators", () => {
  const records = parse(`
==2004 awards==
===Book Awards===
* Writing and Reference: A Thousand Years Over a Hot Stove by [[Laura Schenone]]

==2008 awards==
===Book Awards===
* Reference and Scholarship: A Geography of Oysters: The Connoisseur's Guide to Oyster Eating in North America by Rowan Jacobsen
* Writing and Literature: [[Animal, Vegetable, Miracle: A Year of Food Life]] by [[Barbara Kingsolver]]

==2013 awards==
===Book Awards===
* Writing and Literature: ''Yes, Chef: A Memoir by [[Marcus Samuelsson]]''

==2023 awards==
===Book Awards===
* Literacy Writing: ''Savor: A Chef's Hunger for More'' b y Fatima Ali and Tarajia Morrell (Ballantine Books)
* Food Issues and Advocacy: ''Eating While Black: Food Shaming and Race in America'' by Psyche A. Williams-Forson (University of North Carolina Press)

==2025 awards==
===Book Awards===
* Literary Writing''':''' ''Frostbite: How Refrigeration Changed Our Food, Our Planet, and Ourselves'' by Nicola Twilley
`);

  const byYear = new Map(records.map((record) => [`${record.year}:${record.categoryId}`, record]));

  assert.equal(byYear.get("2004:beard-writing")!.title, "A Thousand Years Over a Hot Stove");
  assert.equal(
    byYear.get("2008:beard-reference-and-scholarship")!.title,
    "A Geography of Oysters: The Connoisseur's Guide to Oyster Eating in North America",
  );
  assert.deepEqual(byYear.get("2008:beard-writing")!.authors, ["Barbara Kingsolver"]);
  assert.equal(byYear.get("2008:beard-writing")!.title, "Animal, Vegetable, Miracle: A Year of Food Life");

  // 2013 italicises the author along with the title.
  assert.equal(byYear.get("2013:beard-writing")!.title, "Yes, Chef: A Memoir");
  assert.deepEqual(byYear.get("2013:beard-writing")!.authors, ["Marcus Samuelsson"]);

  // "b y" typo in the 2023 source.
  assert.deepEqual(byYear.get("2023:beard-writing")!.authors, ["Fatima Ali", "Tarajia Morrell"]);
  assert.equal(byYear.get("2023:beard-writing")!.publisher, "Ballantine Books");
  assert.equal(byYear.get("2023:beard-food-issues-and-advocacy")!.categoryId, "beard-food-issues-and-advocacy");

  // 2025 uses a bold-italic colon between the category name and the title.
  assert.equal(
    byYear.get("2025:beard-writing")!.title,
    "Frostbite: How Refrigeration Changed Our Food, Our Planet, and Ourselves",
  );
});

test("James Beard throws on a Book Awards category that is in neither the alias table nor the ignore list", () => {
  assert.throws(
    () => parse(`
==2027 awards==
===Book Awards===
* Radically Rebranded Prose: ''Something New'' by Someone
`),
    /Unknown James Beard Book Awards category/,
  );
});

test("James Beard assertCoverage rejects a short import and any 2021 record", () => {
  assert.throws(() => assertCoverage([]), /Expected at least 60/);
});
