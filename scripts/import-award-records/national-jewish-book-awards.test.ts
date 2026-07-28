import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import {
  findCategorySection,
  headingFromSourceUrl,
  parseAwardYear,
  parseCategoryRecords,
  parseSectionRows,
  resolveAuthorCell,
  resolveTitleCell,
  unwrapSortTemplates,
} from "./national-jewish-book-awards";

const category = (id: string, name: string, anchor: string): PrizeCategoryRegistryEntry => ({
  id,
  name,
  officialUrl: "https://www.jewishbookcouncil.org/awards",
  sourceUrl: `https://en.wikipedia.org/wiki/List_of_winners_of_the_National_Jewish_Book_Award#${anchor}`,
  sourceLabel: "Wikipedia: List of winners of the National Jewish Book Award",
  sourceConfidence: "secondary",
  importStrategy: "mediawiki-wikitable",
});

const prize = (categories: PrizeCategoryRegistryEntry[]): PrizeRegistryEntry => ({
  id: "national-jewish-book-awards",
  name: "National Jewish Book Awards",
  organization: "Jewish Book Council",
  geography: "North America",
  categories,
});

const tableHeader = `{| class="wikitable sortable" style="width:100%"
|+Category award winners
! scope="col" style="width:10%"| Year
! scope="col" style="width:40%"| Title
! scope="col" style="width:40%"| Author
! scope="col" style="width:10%"| {{Ref heading}}`;

test("{{Sort}} titles resolve to argument 2, not the article-stripped sort key", () => {
  // Plain second argument.
  assert.equal(
    resolveTitleCell(
      "''{{Sort|Rebbe: The Life and Afterlife of Menachem Mendel Schneerson|The Rebbe: The Life and Afterlife of Menachem Mendel Schneerson}}''",
    ),
    "The Rebbe: The Life and Afterlife of Menachem Mendel Schneerson",
  );
  // Second argument is a piped wikilink whose display text is italicised.
  assert.equal(
    resolveTitleCell(
      "''{{Sort|Fortress in Brooklyn: Race, Real Estate|[[A Fortress in Brooklyn|''A Fortress in Brooklyn: Race, Real Estate'']]}}''",
    ),
    "A Fortress in Brooklyn: Race, Real Estate",
  );
  // Sort template not wrapped in italics, second argument is a piped wikilink.
  assert.equal(
    resolveTitleCell(
      "{{Sort|Chosen: The Hidden History|[[The Chosen (Karabel book)|''The Chosen: The Hidden History'']]}}",
    ),
    "The Chosen: The Hidden History",
  );
  // Bare wikilink as the second argument.
  assert.equal(resolveTitleCell("''{{Sort|World That We Knew|[[The World That We Knew]]}}''"), "The World That We Knew");
  // Lowercase template name with padding spaces, as used on a handful of rows.
  assert.equal(
    resolveTitleCell("''{{sort |The Prosecutor: One Man's Battle|The Prosecutor: One Man's Battle}}''"),
    "The Prosecutor: One Man's Battle",
  );
  // Titles with no Sort wrapper are untouched apart from italics.
  assert.equal(resolveTitleCell("''Tree of Souls: The Mythology of Judaism''"), "Tree of Souls: The Mythology of Judaism");
});

test("unwrapSortTemplates keeps the display argument verbatim", () => {
  assert.equal(unwrapSortTemplates("{{Sort|Key|Display}}"), "Display");
  assert.equal(unwrapSortTemplates("{{Sort|1=Key|2=Display}}"), "Display");
  assert.equal(unwrapSortTemplates("no template here"), "no template here");
});

test("parseAwardYear normalizes combined award years to the later year", () => {
  assert.deepEqual(parseAwardYear("2008"), { year: 2008 });
  assert.deepEqual(parseAwardYear("2002-2003"), { year: 2003, combinedLabel: "2002-2003" });
  assert.deepEqual(parseAwardYear("2002 - 2003"), { year: 2003, combinedLabel: "2002 - 2003" });
  assert.equal(parseAwardYear("n/a"), undefined);
});

test("author cells resolve {{Sortname}} and strip editor/translator roles", () => {
  assert.deepEqual(resolveAuthorCell("{{Sortname|Benny|Morris}}"), { authors: ["Benny Morris"], roles: [] });
  assert.deepEqual(resolveAuthorCell("{{Sortname|Eli|Yassif|nolink=1}}"), { authors: ["Eli Yassif"], roles: [] });
  assert.deepEqual(resolveAuthorCell("{{Sortname |Jack |Fairweather |Jack Fairweather (writer)}}"), {
    authors: ["Jack Fairweather"],
    roles: [],
  });
  assert.deepEqual(
    resolveAuthorCell("{{Sortname|Shmuel|Spector|nolink=1}} (ed.-in-chief) and [[Geoffrey Wigoder]] (consulting ed.)"),
    { authors: ["Shmuel Spector", "Geoffrey Wigoder"], roles: ["ed.-in-chief", "consulting ed."] },
  );
  assert.deepEqual(resolveAuthorCell("{{Sortname|Elisabeth|Gallas|nolink=1}} with Alex Skinner (trans.)"), {
    authors: ["Elisabeth Gallas", "Alex Skinner"],
    roles: ["trans."],
  });
  // Accented / non-ASCII names survive.
  assert.deepEqual(resolveAuthorCell("{{Sortname|Zosa|Szajkowski}}"), { authors: ["Zosa Szajkowski"], roles: [] });
});

test("a normal row parses year, title and author", () => {
  const rows = parseSectionRows(`${tableHeader}
|-
|2008
|[[1948: A History of the First Arab–Israeli War|''1948: A History of the First Arab-Israeli War'']]
|{{Sortname|Benny|Morris}}
|<ref>{{Cite magazine |last=Remnick |title=Blood and Sand}}</ref>
|}`);
  assert.deepEqual(rows, [
    {
      year: 2008,
      title: "1948: A History of the First Arab-Israeli War",
      authors: ["Benny Morris"],
      roles: [],
      combinedYearLabel: undefined,
    },
  ]);
});

test("the lowercase 'date' year header is still recognised", () => {
  const rows = parseSectionRows(`{| class="wikitable sortable" style="width:100%"
|+Sephardic Culture award winners<ref name="JBC-Sephardic-culture" />
!date
! scope="col" style="width:40%"| Title
! scope="col" style="width:40%"| Author
! scope="col" style="width:10%"| {{Ref heading}}
|-
|2005
|''{{Sort|Schocken Book of Modern Sephardic Literature|The Schocken Book of Modern Sephardic Literature}}''
|{{Sortname|Ilan|Stavans}} (ed.)
|
|}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].year, 2005);
  assert.equal(rows[0].title, "The Schocken Book of Modern Sephardic Literature");
  assert.deepEqual(rows[0].authors, ["Ilan Stavans"]);
  assert.deepEqual(rows[0].roles, ["ed."]);
});

test("duplicated year cells become co_winner records", () => {
  const holocaust = category("njba-holocaust", "Holocaust", "Holocaust");
  const records = parseCategoryRecords(
    prize([holocaust]),
    holocaust,
    `== Holocaust ==
${tableHeader}
|-
|1968
|''And the Crooked Shall Be Made Straight''
|{{Sortname|Jacob|Robinson|nolink=1}}
|
|-
|1969
|''{{Sort|Holocaust: the Destruction of European Jewry|The Holocaust: the Destruction of European Jewry}}''
|{{Sortname|Nora|Levin}}
|
|-
|1969
|''{{Sort|Story of the Jewish Catastrophe in Europe|The Story of the Jewish Catastrophe in Europe}}''
|{{Sortname|Judah|Pilch|nolink=1}}
|
|-
|2002-2003
|''Resilience and Courage: Women, Men and the Holocaust''
|{{Sortname|Nechama|Tec}}
|
|}
== Next section ==
`,
  );
  assert.deepEqual(
    records.map((record) => [record.year, record.status, record.title]),
    [
      [1968, "winner", "And the Crooked Shall Be Made Straight"],
      [1969, "co_winner", "The Holocaust: the Destruction of European Jewry"],
      [1969, "co_winner", "The Story of the Jewish Catastrophe in Europe"],
      [2003, "winner", "Resilience and Courage: Women, Men and the Holocaust"],
    ],
  );
  assert.match(records[3].notes ?? "", /combined award year "2002-2003"; normalized to 2003/);
  assert.equal(records[0].awardId, "national-jewish-book-awards");
  assert.equal(records[0].categoryId, "njba-holocaust");
  assert.equal(records[0].sourceConfidence, "secondary");
  assert.match(records[0].sourceUrl, /^https:\/\/en\.wikipedia\.org\//);
});

test("the Reference category section is selected by position, not by the colliding anchor", () => {
  const reference = category("njba-reference", "Reference", "References");
  const wikitext = `== Poetry ==
some prose
== References ==
${tableHeader}
|-
|1999
|''{{Sort|Hebrew Folktale: History, Genre, Meaning|The Hebrew Folktale: History, Genre, Meaning}}''
|{{Sortname|Eli|Yassif|nolink=1}}
|
|}
== Scholarship ==
another table
==References==
{{Reflist|30em}}
== External links ==
`;
  const section = findCategorySection(reference, wikitext);
  assert.ok(section);
  assert.match(section.body, /wikitable/);
  const records = parseCategoryRecords(prize([reference]), reference, wikitext);
  assert.deepEqual(records.map((record) => record.title), ["The Hebrew Folktale: History, Genre, Meaning"]);
});

test("headings are derived from the registry anchor", () => {
  assert.equal(headingFromSourceUrl("https://example.test/page#Jewish_history"), "Jewish history");
  assert.equal(headingFromSourceUrl("https://example.test/page#Women's_Studies"), "Women's Studies");
  assert.equal(headingFromSourceUrl("https://example.test/page"), undefined);
});

test("extra Illustrator/Translator columns do not shift the parsed columns", () => {
  const rows = parseSectionRows(`{| class="wikitable sortable"
! Year
! Title
! Author
! Illustrator
! {{Ref heading}}
|-
|2019
|''Hello World''
|{{Sortname|Ada|Lovelace}}
|{{Sortname|Grace|Hopper}}
|
|}`);
  assert.deepEqual(rows, [
    { year: 2019, title: "Hello World", authors: ["Ada Lovelace"], roles: [], combinedYearLabel: undefined },
  ]);
});

test("the Jewish Lives Series programme row is dropped as a non-book record", () => {
  const bookOfYear = category("njba-jewish-book-of-the-year", "Jewish Book of the Year", "Jewish_Book_of_the_Year");
  const records = parseCategoryRecords(
    prize([bookOfYear]),
    bookOfYear,
    `== Jewish Book of the Year ==
${tableHeader}
|-
|2014
|Jewish Lives Series
|{{Sortname|Ileene|Smith|nolink=1}} (editorial director)
|
|-
|2015
|''{{Sort|Book of Aron|[[The Book of Aron]]}}''
|{{Sortname|Jim|Shepard}}
|
|}`,
  );
  assert.deepEqual(records.map((record) => record.title), ["The Book of Aron"]);
});
