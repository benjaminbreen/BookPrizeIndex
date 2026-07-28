import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseAuthorCell, parseShaughnessyCohen, stripJuryColumn } from "./shaughnessy-cohen-prize";
import { parseAwardRowsFromWikitable } from "./wikitable";

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

const cohenPrize = prize("shaughnessy-cohen-prize");
const cohenCategory = category("shaughnessy-cohen-political-writing");

const fixture = `==Winners and nominees==
===2000s===
{| class="wikitable" width="100%"
!Year
!width=20%|Jury
!width=30%|Author
!width=30%|Book
!width=10%|Result
!width=2%|Ref.
|-style="background:#FAEB86"
! rowspan="3" | 2001
! rowspan="3" | [[John Crosbie]]<br>Ron Graham<br>[[Peter C. Newman|Peter Newman]]
| '''[[Erna Paris]]'''
| '''''Long Shadows: Truth, Lies and History'''''
| '''Winner'''
| <ref>"Erna Paris wins first Shaughnessy Cohen prize". ''[[Halifax Daily News]]'', May 4, 2001.</ref>
|-
| [[Victoria Freeman]]
| ''Distant Relations: How My Ancestors Colonized North America''
| rowspan=2| Shortlist
| rowspan=2| <ref>"Five authors up for political book award". ''[[Ottawa Citizen]]'', April 6, 2001.</ref>
|-
| [[Carol Off]]
| ''[[The Lion, the Fox & the Eagle|The Lion, the Fox, & the Eagle: A Story of Generals and Justice in Rwanda and Yugoslavia]]''
|-style="background:#FAEB86"
! rowspan="2" | 2002
! rowspan="2" | [[Maggie Siggins]]<br>[[Pamela Wallin]]
| '''[[Daniel Poliquin]] (tr. [[Donald Winkler]])'''
| '''''In the Name of the Father: An Essay on Quebec Nationalism'''''
| '''Winner'''
| <ref name=poliquin/>
|-
| [[Ingeborg Boyens]]
| ''Another Season's Promise''
| Shortlist
| <ref name=boyens/>
|-style="background:#FAEB86"
! rowspan="2" | 2004
! rowspan="2" | [[Clive Doucet]]<br>[[Margaret MacMillan]]
| '''[[Roméo Dallaire]]'''
| '''''[[Shake Hands with the Devil: The Failure of Humanity in Rwanda]]'''''
| '''Winner'''
| <ref name=dallaire/>
|-
| [[Julian Sher]], [[William Marsden (reporter)|William Marsden]]
| ''The Road to Hell: How the Biker Gangs Are Conquering Canada''
| Shortlist
| <ref name=sher/>
|}

==References==
{{Reflist}}
`;

test("Shaughnessy Cohen parsing discards the jury column and labels winners as winners", () => {
  const records = parseShaughnessyCohen(cohenPrize, cohenCategory, fixture);

  assert.deepEqual(
    records.map((record) => [record.year, record.status, record.title, record.authors.join(", ")]),
    [
      [2001, "winner", "Long Shadows: Truth, Lies and History", "Erna Paris"],
      [2001, "shortlist", "Distant Relations: How My Ancestors Colonized North America", "Victoria Freeman"],
      [2001, "shortlist", "The Lion, the Fox, & the Eagle: A Story of Generals and Justice in Rwanda and Yugoslavia", "Carol Off"],
      [2002, "winner", "In the Name of the Father: An Essay on Quebec Nationalism", "Daniel Poliquin"],
      [2002, "shortlist", "Another Season's Promise", "Ingeborg Boyens"],
      [2004, "winner", "Shake Hands with the Devil: The Failure of Humanity in Rwanda", "Roméo Dallaire"],
      [2004, "shortlist", "The Road to Hell: How the Biker Gangs Are Conquering Canada", "Julian Sher, William Marsden"],
    ],
  );

  // No jury member may ever surface as an author or a title.
  const juryNames = ["John Crosbie", "Ron Graham", "Peter Newman", "Maggie Siggins", "Pamela Wallin", "Clive Doucet", "Margaret MacMillan"];
  for (const record of records) {
    for (const name of juryNames) {
      assert.equal(record.authors.includes(name), false, `Jury member ${name} leaked into authors`);
      assert.equal(record.title.includes(name), false, `Jury member ${name} leaked into a title`);
    }
  }

  // Exactly one winner per year, and 2001 is not swallowed by the year-opening row.
  for (const year of [2001, 2002, 2004]) {
    assert.equal(records.filter((record) => record.year === year && record.status === "winner").length, 1);
  }
});

test("the shared wikitable parser corrupts this six-column table unless the jury cell is stripped", () => {
  // Regression guard: this is exactly the failure mode the importer exists to avoid.
  const raw = parseAwardRowsFromWikitable(fixture);
  // Every winner is silently relabelled, the 2001 winner disappears entirely,
  // and jury members are promoted into the author column.
  assert.equal(raw.some((row) => /winner/i.test(row.result)), false);
  assert.equal(raw.length, 6);
  assert.equal(raw.some((row) => row.author.includes("Maggie Siggins")), true);
  assert.equal(raw.some((row) => row.title === "Roméo Dallaire"), true);

  const stripped = parseAwardRowsFromWikitable(stripJuryColumn(fixture));
  assert.equal(stripped.length, 7);
  assert.equal(stripped.filter((row) => /winner/i.test(row.result)).length, 3);
  assert.equal(stripped.some((row) => row.author.includes("Maggie Siggins")), false);
});

test("Shaughnessy Cohen parsing handles irregular short years without assuming five titles", () => {
  const records = parseShaughnessyCohen(cohenPrize, cohenCategory, fixture);
  assert.equal(records.filter((record) => record.year === 2004).length, 2);
  assert.equal(records.some((record) => record.year === 2003), false);
});

test("comma-joined co-authors split while suffixes stay attached", () => {
  assert.deepEqual(parseAuthorCell("Julian Sher, William Marsden").authors, ["Julian Sher", "William Marsden"]);
  assert.deepEqual(parseAuthorCell("Janice Gross Stein, Eugene Lang").authors, ["Janice Gross Stein", "Eugene Lang"]);
  assert.deepEqual(parseAuthorCell("Sammy Davis, Jr.").authors, ["Sammy Davis, Jr."]);
});

test("translator parentheticals move from the author list into notes", () => {
  assert.deepEqual(parseAuthorCell("Daniel Poliquin (tr. Donald Winkler)"), {
    authors: ["Daniel Poliquin"],
    translator: "Donald Winkler",
  });
  assert.deepEqual(parseAuthorCell("Max Nemni, Monique Nemni (tr. William Johnson)"), {
    authors: ["Max Nemni", "Monique Nemni"],
    translator: "William Johnson",
  });

  const records = parseShaughnessyCohen(cohenPrize, cohenCategory, fixture);
  const poliquin = records.find((record) => record.year === 2002 && record.status === "winner");
  assert.match(poliquin?.notes ?? "", /Translator: Donald Winkler\./);
});

test("Shaughnessy Cohen records carry registry provenance", () => {
  const [first] = parseShaughnessyCohen(cohenPrize, cohenCategory, fixture);
  assert.equal(first.awardId, "shaughnessy-cohen-prize");
  assert.equal(first.categoryId, "shaughnessy-cohen-political-writing");
  assert.equal(first.sourceUrl, "https://source.example/");
  assert.equal(first.sourceConfidence, "secondary");
});

test("Shaughnessy Cohen parsing throws when the expected section heading is gone", () => {
  assert.throws(() => parseShaughnessyCohen(cohenPrize, cohenCategory, "==Nope==\n"), /Missing section start/);
});
