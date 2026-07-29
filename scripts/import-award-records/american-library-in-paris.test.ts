import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseAmericanLibraryInParis, parseEntryLine, toBlockLines } from "./american-library-in-paris";

const category = (id: string): PrizeCategoryRegistryEntry => ({
  id,
  name: id,
  officialUrl: "https://official.example/",
  sourceUrl: "https://source.example/",
  sourceLabel: "Test source",
  sourceConfidence: "official",
  importStrategy: "test",
});

const prize = (id: string): PrizeRegistryEntry => ({
  id,
  name: id,
  organization: "Test organization",
  geography: "Test geography",
  categories: [category(id)],
});

const award = prize("american-library-in-paris-book-award");
const bucket = category("american-library-in-paris-nonfiction");

test("an inline tag boundary inside a word does not split the title", () => {
  const lines = toBlockLines("<p>Congratulations to <strong>Fran</strong>ce: An Adventure History</p>");
  assert.deepEqual(lines, ["Congratulations to France: An Adventure History"]);
});

test("author-first rows split on the surname, not on a middle initial", () => {
  assert.deepEqual(parseEntryLine("Sean B. Carroll. Brave Genius: A Scientist (Crown)"), {
    title: "Brave Genius: A Scientist",
    authors: ["Sean B. Carroll"],
    publisher: "Crown",
  });
});

test("title-first rows split on the last 'by' and keep both co-authors", () => {
  assert.deepEqual(
    parseEntryLine("In the Forest of No Joy: The Tragedy by J.P. Daughton and Jane Roe (W.W. Norton)"),
    {
      title: "In the Forest of No Joy: The Tragedy",
      authors: ["J.P. Daughton", "Jane Roe"],
      publisher: "W.W. Norton",
    },
  );
});

test("a title's own parenthetical survives; only the trailing publisher is taken", () => {
  const entry = parseEntryLine(
    "Marc Weitzmann. Hate: The Rising Tide of Anti-Semitism in France (and What it Means for Us) (Houghton Mifflin Harcourt)",
  );
  assert.equal(entry?.title, "Hate: The Rising Tide of Anti-Semitism in France (and What it Means for Us)");
  assert.equal(entry?.publisher, "Houghton Mifflin Harcourt");
});

test("an editor marker is stripped rather than parsed as a name", () => {
  assert.deepEqual(parseEntryLine("Americans in Paris by Lynn Gumpert and Debra Bricker Balken, eds. (Hirmer)")?.authors, [
    "Lynn Gumpert",
    "Debra Bricker Balken",
  ]);
});

const page = `
<h4>The 2026 Book Award Longlist</h4>
<h6><em>Baldwin: A Love Story</em> by Nicholas Boggs (Farrar, Straus and Giroux)</h6>
<h6><em>Riverwork</em> by Lisa Robertson (Coach House Books)</h6>
<p>Download the press release here.</p>
<h4>Past Winners</h4>
<div>2025</div><div>2023</div>
<div>2025</div>
<p>The Book Award 2025: Sue Prideaux and Wild Thing: A Life of Paul Gauguin</p>
<p>The shortlist was announced in September 2025:</p>
<p>Creation Lake by Rachel Kushner (Jonathan Cape / Scribner)<br />
Wild Thing: A Life of Paul Gauguin by Sue Prideaux (Norton / Faber &amp; Faber)<br />
Gertrude Stein: An Afterlife by Francesca Wade (Faber &amp; Faber / Scribner)</p>
<p>All 2025 submissions are part of the Library's circulating collection.</p>
<div>2023</div>
<p>The Book Award 2023: Katherine J. Chen and Joan: A Novel</p>
<p>The shortlist was announced in September 2023:</p>
<p>France on Trial: The Case of Marshal P&eacute;tain by Julian Jackson (Allen Lane UK / Belknap Press USA)</p>
<p>All sixty-three submissions are in the Library's collection.</p>
`;

test("the accordion tab strip is skipped and each panel is read as its own year", () => {
  const records = parseAmericanLibraryInParis(award, bucket, page);
  assert.deepEqual(
    records.map((record) => [record.year, record.status, record.title]),
    [
      [2026, "longlist", "Baldwin: A Love Story"],
      [2025, "winner", "Wild Thing: A Life of Paul Gauguin"],
      [2025, "shortlist", "Gertrude Stein: An Afterlife"],
      [2023, "shortlist", "France on Trial: The Case of Marshal Pétain"],
    ],
  );
});

test("fiction is dropped from every list, including a longlist and a winning slot", () => {
  const titles = parseAmericanLibraryInParis(award, bucket, page).map((record) => record.title);
  assert.ok(!titles.includes("Riverwork"));
  assert.ok(!titles.includes("Creation Lake"));
  // Joan won in 2023, so the year contributes shortlist rows but no winner.
  assert.ok(!titles.includes("Joan: A Novel"));
  assert.equal(parseAmericanLibraryInParis(award, bucket, page).filter((r) => r.year === 2023 && r.status === "winner").length, 0);
});

test("an unreviewed title aborts the import instead of being silently classified", () => {
  const withNewTitle = page.replace(
    "<p>All sixty-three submissions are in the Library's collection.</p>",
    "<p>Some Unreviewed Book: A Subtitle by A. N. Author (Some Press)</p>",
  );
  assert.throws(() => parseAmericanLibraryInParis(award, bucket, withNewTitle), /Unclassified 2023 title/);
});

test("a winner missing from the shortlist is rejected unless the winning book is fiction", () => {
  const unknownWinner = page.replace(
    "The Book Award 2023: Katherine J. Chen and Joan: A Novel",
    "The Book Award 2023: Someone Else and An Unlisted Nonfiction Book",
  );
  assert.throws(() => parseAmericanLibraryInParis(award, bucket, unknownWinner), /absent from the shortlist/);
});
