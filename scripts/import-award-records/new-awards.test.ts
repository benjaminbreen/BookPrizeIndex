import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseFrancisParkman } from "./francis-parkman";
import { parseGeorgePolkBook } from "./george-polk-book";
import { parseDaytonNonfiction } from "./dayton-literary-peace";
import { parseHessellTiltman } from "./hessell-tiltman";
import { parseIreBookPage } from "./ire-books";
import { parseJohnBurroughs } from "./john-burroughs";
import { parseRfkArchive, parseRfkLaureate } from "./rfk-book";
import { parseTrumanCapote } from "./truman-capote-criticism";
import { parseWellcomeNonfiction } from "./wellcome-book-prize";

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

test("RFK archive parsing corrects the duplicated Jack Bass heading and parses official titles", () => {
  const archive = `
    <h2 class="wp-block-heading">1995</h2>
    <h2><a href="https://kennedyhumanrights.org/person/john-egerton/">John Egerton</a></h2>
    <h2 class="wp-block-heading">1995</h2>
    <h2><a href="https://kennedyhumanrights.org/person/jack-bass/">Jack Bass</a></h2>`;
  const candidates = parseRfkArchive(archive);
  assert.deepEqual(candidates.map((item) => item.year), [1995, 1994]);

  const rfkPrize = prize("robert-f-kennedy-book-award");
  const rfkCategory = category("rfk-book-award");
  const record = parseRfkLaureate(rfkPrize, rfkCategory, candidates[1], `
    <p>The 1994 Robert F. Kennedy Book Award was presented to Jack Bass for
    <em>Taming the Storm: The Life and Times of Judge Frank M. Johnson, Jr.</em>.</p>`, ["Jack Bass"]);
  assert.equal(record.year, 1994);
  assert.equal(record.title, "Taming the Storm: The Life and Times of Judge Frank M. Johnson, Jr.");
});

test("RFK detail parsing associates a shared paragraph's second title with the second laureate", () => {
  const rfkPrize = prize("robert-f-kennedy-book-award");
  const rfkCategory = category("rfk-book-award");
  const record = parseRfkLaureate(rfkPrize, rfkCategory, {
    year: 1991,
    authorLabel: "Andrew Revkin",
    detailUrl: "https://kennedyhumanrights.org/person/andrew-revkin/",
  }, `<p>The Robert F. Kennedy Book Award was presented to Myles Horton and Herbert and Judith Kohl for
    <em>The Long Haul</em> and Andrew Revkin for
    <em>The Burning Season: The Murder of Chico Mendes and the Fight for the Amazon Rain Forest</em>.
    Andrew Revkin received honorable mention.</p>`, ["Myles Horton and Herbert and Judith Kohl", "Andrew Revkin"]);
  assert.equal(record.title, "The Burning Season: The Murder of Chico Mendes and the Fight for the Amazon Rain Forest");
  assert.equal(record.status, "honorable_mention");
});

test("Francis Parkman parser keeps suffixes in author names and skips the special-achievement section", () => {
  const award = prize("francis-parkman-prize");
  const records = parseFrancisParkman(award, award.categories[0], `
== Winners ==
* 1957 – [[George F. Kennan]] for ''Russia Leaves the War''
* 1996 – [[Robert D. Richardson, Jr.]] for ''Emerson: The Mind on Fire''
== Francis Parkman Prize for Special Achievement ==
* 1962 – Allan Nevins`);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1].authors, ["Robert D. Richardson, Jr."]);
  assert.equal(records[1].title, "Emerson: The Mind on Fire");
});

test("John Burroughs parser omits no-award, poetry, and fiction rows while removing illustrators", () => {
  const award = prize("john-burroughs-medal");
  const records = parseJohnBurroughs(award, award.categories[0], `
== List of recipients of the John Burroughs Medal ==
* 1928 - [[John Russell McCarthy]], ''Nature Poems''
* 1931 - no award
* 1946 - [[Florence Page Jaques]] and [[Francis Lee Jaques]] (illustrator), ''Snowshoe Country''
* 1955 - [[Wallace Byron Grange]], ''Those of the Forest''
* 2017 - [[Brian Doyle]], ''Martin Marten''
== References ==`);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Snowshoe Country");
  assert.deepEqual(records[0].authors, ["Florence Page Jaques"]);
});

test("George Polk parser reads only explicitly labeled Book rows from official year sections", () => {
  const award = prize("george-polk-awards");
  const records = parseGeorgePolkBook(award, award.categories[0], `
    <h5><a name="2007">2007 George Polk Award Winners</a></h5>
    <p><strong>Book:</strong> <strong>Jeremy Scahill,</strong> <strong>“<em>Blackwater</em>”</strong></p>
    <p><strong>Foreign Reporting:</strong> Example Reporter</p>`);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Blackwater");
});

test("Dayton parser preserves a rowspan year instead of mistaking a year inside a title for the award year", () => {
  const award = prize("dayton-literary-peace-prize");
  const records = parseDaytonNonfiction(award, award.categories[0], `
=== Nonfiction ===
{| class="wikitable"
!Year
!Author
!Title
!Result
|-
! rowspan="2" |2011
|Wilbert Rideau
|''In the Place of Justice''
|Winner
|-
|Kai Bird
|''Crossing Mandelbaum Gate: Coming of Age, 1956–1978''
|Finalist
|}
=== Lifetime Achievement Award ===`);
  assert.deepEqual(records.map((record) => record.year), [2011, 2011]);
});

test("Hessell-Tiltman parser marks two blue-ribbon books in one year as co-winners", () => {
  const award = prize("pen-hessell-tiltman-prize");
  const records = parseHessellTiltman(award, award.categories[0], `
==Winners and shortlist==
====2005====
*{{blue ribbon}} Paul Fussell, ''The Boys' Crusade''
*{{blue ribbon}} Richard Overy, ''The Dictators''
*Mark Mazower, ''Salonica, City of Ghosts''
==See also==`);
  assert.deepEqual(records.map((record) => record.status), ["co_winner", "co_winner", "shortlist"]);
});

test("Truman Capote parser splits the official 2000 co-winner entry into the correct author-title pairs", () => {
  const award = prize("truman-capote-award-criticism");
  const records = parseTrumanCapote(award, award.categories[0], `
    <h5>2000 - Elaine Scarry &amp; Philip Fisher</h5>
    <p>for <em>Dreaming by the Book</em></p>
    <p><em>Still the New World</em></p>
    <h5>1999 - Charles Rosen</h5><p>for <em>Romantic Poets</em></p>`);
  assert.deepEqual(records.map((record) => [record.authors[0], record.title]), [
    ["Elaine Scarry", "Dreaming by the Book"],
    ["Philip Fisher", "Still the New World"],
    ["Charles Rosen", "Romantic Poets"],
  ]);
});

test("IRE parser handles a status-prefixed title and ignores the publisher dash as an author", () => {
  const award = prize("ire-awards");
  const records = parseIreBookPage(award, award.categories[0], `
    <h3>Books</h3><h6>Winner: “The Scientist and the Serial Killer” — Random House</h6>
    <p>by Lise Olsen</p><h3>Student Award - Individual</h3>`, "https://example.org/2025", 2025);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].authors, ["Lise Olsen"]);
  assert.equal(records[0].status, "winner");
});

test("Wellcome parser retains reviewed nonfiction and omits fiction from the mixed table", () => {
  const award = prize("wellcome-book-prize");
  const records = parseWellcomeNonfiction(award, award.categories[0], `
==Winners and shortlisted nominees==
{| class="wikitable"
|-
!Year
!Winner
!Work
!Shortlisted nominees
|-
!2010
|Rebecca Skloot
|''The Immortal Life of Henrietta Lacks''
!{{bulleted list |Emma Henderson, ''Grace Williams Says it Loud''|Tim Parks, ''Teach Us to Sit Still: A Sceptic's Search for Health and Healing''}}
|ref
|}
==References==`);
  assert.deepEqual(records.map((record) => record.title), [
    "The Immortal Life of Henrietta Lacks",
    "Teach Us to Sit Still: A Sceptic's Search for Health and Healing",
  ]);
});
