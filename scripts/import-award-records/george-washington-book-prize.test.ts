import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseGeorgeWashingtonBookPrize } from "./george-washington-book-prize";

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

const gwPrize = prize("george-washington-book-prize");
const gwCategory = category("george-washington-founding-era");

const parse = (wikitext: string) => parseGeorgeWashingtonBookPrize(gwPrize, gwCategory, wikitext);

const fixture = `== Past winners ==
Some prose that must not be parsed as a table row.

== Past finalists ==
{{blue ribbon}} = winner

{| class="wikitable"
|-
! Year
! Author
! Book
|-
| 2005
| [[Ron Chernow]]
| {{blue ribbon}} ''Alexander Hamilton''
|-
|
| [[Rhys Isaac]]
| ''Landon Carter's Uneasy Kingdom''
|-
| 2015
| [[Nick Bunker]]
| {{blue ribbon}} ''An Empire on the Edge: How Britain Came to Fight America''
|-
|
| [[François Furstenberg]]
| ''When the United States Spoke French: Five Refugees Who Shaped a Nation''
|-
| 2016
| [[Flora Fraser (writer)|Flora Fraser]]
| {{blue ribbon}} ''The Washingtons: George and Martha, "Join’d by Friendship, Crown'd by Love"''
|-
| 2017
| [[Mark Edward Lender]] and [[Garry Wheeler Stone]]
| ''Fatal Sunday: George Washington, the Monmouth Campaign, and the Politics of Battle''
|-
|
| [[Annette Gordon-Reed]] and [[Peter S. Onuf]]
| ''"Most Blessed of the Patriarchs": Thomas Jefferson and the Empire of the Imagination''
|-
| 2024
| [[David Waldstreicher]]
| {{blue ribbon}} ''The Odyssey of Phillis Wheatley: A Poet's Journeys through American Slavery and Independence''
|-
|
| [[Ned Blackhawk]]
| ''[[The Rediscovery of America|The Rediscovery of America: Native Peoples and the Unmaking of U.S. History]]''
|-
|
| [[Jeffrey L. Pasley]]
| ''The First Presidential Contest ''<ref>[https://example.invalid/x "Finalists"], Washington College</ref>
|-
|}

==References==
{{Reflist}}
`;

test("George Washington Prize parsing flags blue-ribbon rows as winners and the rest as finalists", () => {
  const records = parse(fixture);
  const first = records[0];
  assert.equal(first.year, 2005);
  assert.equal(first.status, "winner");
  assert.equal(first.title, "Alexander Hamilton");
  assert.deepEqual(first.authors, ["Ron Chernow"]);
  assert.equal(first.awardId, "george-washington-book-prize");
  assert.equal(first.categoryId, "george-washington-founding-era");
  assert.equal(first.sourceUrl, "https://source.example/");
  assert.equal(first.sourceConfidence, "secondary");

  assert.equal(records[1].status, "finalist");
  assert.equal(records[1].title, "Landon Carter's Uneasy Kingdom");
});

test("George Washington Prize parsing carries a blank year cell forward across continuation rows", () => {
  const records = parse(fixture);
  assert.deepEqual(
    records.map((record) => record.year),
    [2005, 2005, 2015, 2015, 2016, 2017, 2017, 2024, 2024, 2024],
  );
  // The 2024 block includes a continuation row whose year cell is "|" with no trailing space.
  const blackhawk = records.find((record) => record.authors[0] === "Ned Blackhawk");
  assert.equal(blackhawk?.year, 2024);
  assert.equal(blackhawk?.status, "finalist");
  assert.equal(blackhawk?.title, "The Rediscovery of America: Native Peoples and the Unmaking of U.S. History");
});

test("George Washington Prize parsing handles multi-author rows and accented names", () => {
  const records = parse(fixture);
  const lender = records.find((record) => record.title.startsWith("Fatal Sunday"));
  assert.deepEqual(lender?.authors, ["Mark Edward Lender", "Garry Wheeler Stone"]);

  const furstenberg = records.find((record) => record.title.startsWith("When the United States"));
  assert.deepEqual(furstenberg?.authors, ["François Furstenberg"]);
});

test("George Washington Prize parsing keeps internal quotation marks in titles intact", () => {
  const records = parse(fixture);
  assert.equal(
    records.find((record) => record.year === 2016)?.title,
    "The Washingtons: George and Martha, \"Join’d by Friendship, Crown'd by Love\"",
  );
  assert.equal(
    records.find((record) => record.authors[0] === "Annette Gordon-Reed")?.title,
    "\"Most Blessed of the Patriarchs\": Thomas Jefferson and the Empire of the Imagination",
  );
});

test("George Washington Prize parsing strips references and trailing whitespace from titles", () => {
  const records = parse(fixture);
  const pasley = records.find((record) => record.authors[0] === "Jeffrey L. Pasley");
  assert.equal(pasley?.title, "The First Presidential Contest");
});

test("George Washington Prize parsing excludes the Hamilton special achievement award", () => {
  const records = parse(`== Past finalists ==
{| class="wikitable"
|-
! Year
! Author
! Book
|-
| 2015
| [[Lin-Manuel Miranda]]
| {{blue ribbon}} ''Hamilton'' (Special Achievement Award)
|-
|
| [[Nick Bunker]]
| {{blue ribbon}} ''An Empire on the Edge''
|-
|}
`);
  assert.deepEqual(records.map((record) => record.title), ["An Empire on the Edge"]);
});

test("George Washington Prize parsing throws when the finalists section is missing", () => {
  assert.throws(() => parse("== Past winners ==\nNothing here.\n"), /Past finalists/);
});
