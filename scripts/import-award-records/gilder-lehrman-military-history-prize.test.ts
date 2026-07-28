import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseGilderLehrmanMilitaryHistory } from "./gilder-lehrman-military-history-prize";

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
  categories: [category(id)],
});

const glPrize = prize("gilder-lehrman-military-history-prize");
const glCategory = category("gilder-lehrman-military-history");

const parse = (wikitext: string) => parseGilderLehrmanMilitaryHistory(glPrize, glCategory, wikitext);

const fixture = `==Barbara and David Zalaznick Book Prize in American History==

===Winners===
* 2005 [[Ron Chernow]], ''Alexander Hamilton''

==New-York Historical Society Children's History Book Prize==

===Winners===
* 2010 [[Somebody Else]], ''A Children's Book''

==Gilder Lehrman Prize for Military History==
'''The Gilder Lehrman Prize for Military History''' was first awarded in 2016.

===Winners===
* 2013 [[Allen C. Guelzo]], ''Gettysburg: The Last Invasion'' '<ref name=Penn>{{cite news |title=Gettysburg book wins $50,000 history prize |url=http://example.invalid/x |work=PennLive}}</ref>
* 2014 [[Alexander Watson (historian)|Alexander Watson]], ''[[Ring of Steel: Germany and Austria-Hungary at War, 1914-1918]]''<ref>{{cite web |url=http://example.invalid/y |title=Watson wins}}</ref>
* 2016  [[Peter Cozzens]], ''[[Peter Cozzens#The Earth Is Weeping|The Earth is Weeping: The Epic Story of the Indian Wars for the American West]]''<ref>{{cite web |url=http://example.invalid/z |title=Cozzens}}</ref>
* 2019 [[John C. McManus]], ''Fire and Fortitude: The US Army in the Pacific War, 1941–1943 ''
* 2022 [[Bruce Henderson (author)|Bruce Henderson]], ''Bridge to the Sun: The Secret Role of the Japanese Americans Who Fought in the Pacific in World War II''
* Not a winner line at all
* [[Someone]], ''Missing year''

==See also==
* [[List of history awards]]
`;

test("Gilder Lehrman military history parsing reads only its own section", () => {
  const records = parse(fixture);
  assert.deepEqual(records.map((record) => record.year), [2013, 2014, 2016, 2019, 2022]);
  assert.ok(!records.some((record) => record.title === "Alexander Hamilton"));
  assert.ok(!records.some((record) => record.title === "A Children's Book"));
});

test("Gilder Lehrman military history records carry registry-backed provenance", () => {
  const [first] = parse(fixture);
  assert.equal(first.awardId, "gilder-lehrman-military-history-prize");
  assert.equal(first.categoryId, "gilder-lehrman-military-history");
  assert.equal(first.status, "winner");
  assert.equal(first.year, 2013);
  assert.equal(first.title, "Gettysburg: The Last Invasion");
  assert.deepEqual(first.authors, ["Allen C. Guelzo"]);
  assert.equal(first.sourceUrl, "https://source.example/");
  assert.equal(first.sourceConfidence, "secondary");
  assert.match(first.notes ?? "", /Guggenheim-Lehrman/);
});

test("Gilder Lehrman military history parsing handles piped links, double spaces and trailing whitespace", () => {
  const records = parse(fixture);
  const watson = records.find((record) => record.year === 2014);
  assert.deepEqual(watson?.authors, ["Alexander Watson"]);
  assert.equal(watson?.title, "Ring of Steel: Germany and Austria-Hungary at War, 1914-1918");

  const cozzens = records.find((record) => record.year === 2016);
  assert.deepEqual(cozzens?.authors, ["Peter Cozzens"]);
  assert.equal(cozzens?.title, "The Earth is Weeping: The Epic Story of the Indian Wars for the American West");

  const mcmanus = records.find((record) => record.year === 2019);
  assert.equal(mcmanus?.title, "Fire and Fortitude: The US Army in the Pacific War, 1941–1943");
});

test("Gilder Lehrman military history parsing records the year as printed, without shifting it", () => {
  const records = parse(fixture);
  assert.equal(records.find((record) => record.authors[0] === "Bruce Henderson")?.year, 2022);
});

test("Gilder Lehrman military history parsing throws when the section is missing", () => {
  assert.throws(() => parse("==Some Other Prize==\n===Winners===\n* 2013 [[X]], ''Y''\n"), /Gilder Lehrman/);
});
