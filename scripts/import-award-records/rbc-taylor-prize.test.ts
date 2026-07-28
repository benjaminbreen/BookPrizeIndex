import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseRbcTaylorPrize } from "./rbc-taylor-prize";

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

const taylorPrize = prize("rbc-taylor-prize");
const taylorCategory = category("rbc-taylor-nonfiction");

const fixture = `==Winners and nominees==
{| class="wikitable"
! Year !! Author !! Title !! Result !! Ref
|-style="background:#cddeff"
! rowspan="3" |2000
|'''{{sortname|Wayne|Johnston|Wayne Johnston (writer)}}'''
|'''''Baltimore's Mansion'''''
|'''Winner'''
|-
|{{sortname|Witold|Rybczynski}}
|''[[A Clearing in the Distance: Frederick Law Olmsted and America in the Nineteenth Century|A Clearing in the Distance: Frederick Law Olmsted and America in the Nineteenth Century]]''
| rowspan="2" |Finalist
|-
|{{sortname|Carol|Shields}}
|''[[Jane Austen (Shields book)|Jane Austen]]''
|-style="background:#cddeff"
! rowspan="2" |2002
|'''{{sortname|Carol|Shields}}'''
|'''''[[Unless (novel)|Unless]]'''''
|'''Winner'''
|-
|{{sortname|Andrew|Nikiforuk}}
|''Saboteurs: Wiebo Ludwig's War Against Big Oil''
|Finalist
|}

==RBC Taylor Emerging Writer Award==
{| class="wikitable"
! Year !! Author !! Result
|-
|2016
|'''Some Unpublished Writer'''
|'''Winner'''
|}
`;

test("RBC Taylor parsing keeps winners and finalists and honours the biennial year gap", () => {
  const records = parseRbcTaylorPrize(taylorPrize, taylorCategory, fixture);

  assert.deepEqual(
    records.map((record) => [record.year, record.status, record.title, record.authors.join(", ")]),
    [
      [2000, "winner", "Baltimore's Mansion", "Wayne Johnston"],
      [2000, "finalist", "A Clearing in the Distance: Frederick Law Olmsted and America in the Nineteenth Century", "Witold Rybczynski"],
      [2000, "finalist", "Jane Austen", "Carol Shields"],
      [2002, "winner", "Unless", "Carol Shields"],
      [2002, "finalist", "Saboteurs: Wiebo Ludwig's War Against Big Oil", "Andrew Nikiforuk"],
    ],
  );

  // No 2001 edition may be synthesised from the rowspan carry-over.
  assert.deepEqual(Array.from(new Set(records.map((record) => record.year))).sort(), [2000, 2002]);
});

test("RBC Taylor parsing excludes the separate Emerging Writer Award section", () => {
  const records = parseRbcTaylorPrize(taylorPrize, taylorCategory, fixture);
  assert.equal(records.some((record) => record.title === "Some Unpublished Writer"), false);
  assert.equal(records.some((record) => record.year === 2016), false);
});

test("RBC Taylor records carry registry provenance", () => {
  const [first] = parseRbcTaylorPrize(taylorPrize, taylorCategory, fixture);
  assert.equal(first.awardId, "rbc-taylor-prize");
  assert.equal(first.categoryId, "rbc-taylor-nonfiction");
  assert.equal(first.sourceUrl, "https://source.example/");
  assert.equal(first.sourceLabel, "Test source");
  assert.equal(first.sourceConfidence, "secondary");
});

test("RBC Taylor parsing throws when the expected section heading is gone", () => {
  assert.throws(() => parseRbcTaylorPrize(taylorPrize, taylorCategory, "==Something else==\n"), /Missing section start/);
});
