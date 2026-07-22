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
import { parseNcrBookAward } from "./ncr-book-award";
import { parseLauraShannon } from "./laura-shannon";
import { parsePfizer } from "./pfizer";
import { parseFrederickDouglass } from "./frederick-douglass";
import { parseGeorgePerkinsMarsh } from "./george-perkins-marsh";
import { parseWainwrightArchive } from "./wainwright";
import { parseNbccOfficialLonglist } from "./nbcc";
import { parseFrederickDouglassArchiveFinalists, parseFrederickDouglassFinalistAnnouncement } from "./frederick-douglass";
import { parseWainwrightLonglist, parseWainwrightShortlists } from "./wainwright";

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

test("NCR parser reads the compact historical winner list", () => {
  const award = prize("ncr-book-award");
  const records = parseNcrBookAward(award, award.categories[0], `
==Winners==
* 1989 [[Joe Simpson (mountaineer)|Joe Simpson]], ''[[Touching the Void (book)|Touching the Void]]'' (Jonathan Cape)
==References==`);
  assert.deepEqual(records.map((record) => [record.year, record.title, record.authors[0]]), [
    [1989, "Touching the Void", "Joe Simpson"],
  ]);
});

test("Laura Shannon parser reads official winner cards", () => {
  const award = prize("laura-shannon-prize");
  const records = parseLauraShannon(award, award.categories[0], `
    <li class="card shannon-prize-card">
      <h2 class="card-title"><a href="/winner/">The Sleepwalkers</a></h2>
      <p><em>Sir Christopher Clark</em></p><p>2015</p>
    </li>`);
  assert.equal(records[0].title, "The Sleepwalkers");
  assert.deepEqual(records[0].authors, ["Christopher Clark"]);
});

test("Pfizer parser handles ill templates and malformed italic title markup", () => {
  const award = prize("pfizer-award");
  const records = parsePfizer(award, award.categories[0], `
== Recipients ==
* 1964 {{ill|Robert E. Schofield|fr}}, ''The Lunar Society of Birmingham'' (Oxford University Press).
* 2002 [[James A. Secord]], ''Victorian Sensation: The Extraordinary Publication, Reception, and Secret Authorship of ''Vestiges of the Natural History of Creation (University of Chicago Press, 2000).
==References==`);
  assert.deepEqual(records[0].authors, ["Robert E. Schofield"]);
  assert.match(records[1].title, /Vestiges of the Natural History of Creation$/);
});

test("Frederick Douglass parser ignores multiline citations and preserves rowspan years", () => {
  const award = prize("frederick-douglass-book-prize");
  const records = parseFrederickDouglass(award, award.categories[0], `
==List of recipients==
{| class="wikitable"
|-
| rowspan="2" |2024 (joint)<ref>{{Cite web |title=Announcement
 |url=https://example.org/ |language=en}}</ref>
|Marlene L. Daut
|''Awakening the Ashes''
|-
|Sara E. Johnson
|''Encyclopédie noire''
|}
==See also==`);
  assert.deepEqual(records.map((record) => [record.year, record.status, record.authors[0], record.title]), [
    [2024, "co_winner", "Marlene L. Daut", "Awakening the Ashes"],
    [2024, "co_winner", "Sara E. Johnson", "Encyclopédie noire"],
  ]);
});

test("Frederick Douglass official parsers read historical and annual finalists", () => {
  const award = prize("frederick-douglass-book-prize");
  const historical = parseFrederickDouglassArchiveFinalists(award, award.categories[0], `
    <h2>2015</h2><p>Finalists:</p>
    <p>Ezra Greenspan, William Wells Brown: An African American Life</p>
    <p>Michael Guasco, Slaves and Englishmen</p><p>More about the 2015 winner</p>`, "https://official.example/archive");
  const annual = parseFrederickDouglassFinalistAnnouncement(award, award.categories[0], `
    <p>The finalists are: Aisha K. Finch for “Rethinking Slave Rebellion in Cuba” (UNC Press);
    Jeff Forret for “Slave Against Slave” (LSU Press); and Matthew S. Hopper for “Slaves of One Master” (Yale).</p>`, 2016, "https://official.example/2016");
  assert.deepEqual(historical.map((record) => record.title), ["William Wells Brown: An African American Life", "Slaves and Englishmen"]);
  assert.deepEqual(annual.map((record) => record.title), ["Rethinking Slave Rebellion in Cuba", "Slave Against Slave", "Slaves of One Master"]);
});

test("NBCC official longlist parser reads ten title-author-publisher lines", () => {
  const award = prize("national-book-critics-circle-awards");
  const rows = Array.from({ length: 10 }, (_, index) => `<p>Book ${index + 1} by Author ${index + 1} (Press ${index + 1})</p>`).join("");
  const records = parseNbccOfficialLonglist(award, award.categories[0], rows, 2025, "https://official.example/longlist");
  assert.equal(records.length, 10);
  assert.deepEqual([records[0].title, records[0].authors[0], records[0].publisher], ["Book 1", "Author 1", "Press 1"]);
});

test("George Perkins Marsh parser stays inside the official book-prize section", () => {
  const award = prize("george-perkins-marsh-prize");
  const records = parseGeorgePerkinsMarsh(award, award.categories[0], `
    George Perkins Marsh Prize
    <p>2024 Tamar Novick, <a href="/milk">Milk and Honey</a>. MIT Press.</p>
    <p>Finalists:</p><p>Someone Else, <a href="/other">Another Book</a>.</p>
    Alice Hamilton Prize`);
  assert.deepEqual(records.map((record) => [record.year, record.title]), [[2024, "Milk and Honey"]]);
});

test("Wainwright parser reads adult winner cards", () => {
  const award = prize("wainwright-prize");
  const records = parseWainwrightArchive(award, award.categories[0], `
    <h5 class="elementor-heading-title"><span>2020</span> Winner</h5>
    <h2 class="elementor-heading-title">Dara McAnulty</h2>
    <h5 class="elementor-heading-title">Diary of A Young Naturalist</h5>`);
  assert.deepEqual(records.map((record) => [record.year, record.authors[0], record.title]), [
    [2020, "Dara McAnulty", "Diary of a Young Naturalist"],
  ]);
});

test("Wainwright parsers read adult shortlist tables and official longlist rows", () => {
  const award = prize("wainwright-prize");
  const nature = category("wainwright-nature-writing");
  const conservation = category("wainwright-conservation-writing");
  const shortlists = parseWainwrightShortlists(award, nature, conservation, `
==Winners and shortlisted titles==
{| class="wikitable"
|-
!Year || Author || Book || Publisher
|-
!2020:<br />Global<br />Conservation
|Benedict Macdonald || ''Rebirding'' || Pelagic
|-
|Chris Goodall || ''What We Need to Do Now'' || Profile
|}
==References==`);
  assert.deepEqual(shortlists.map((record) => [record.categoryId, record.title]), [
    ["wainwright-conservation-writing", "Rebirding"],
    ["wainwright-conservation-writing", "What We Need to Do Now"],
  ]);

  const lines = Array.from({ length: 13 }, (_, index) => `<p>Nature Book ${index + 1}, Author ${index + 1}, Press ${index + 1}</p>`).join("");
  const longlists = parseWainwrightLonglist(award, nature, `<h2>The 2021 Wainwright Prize for UK nature writing longlist is:</h2>${lines}`, 2021, "https://official.example/2021");
  assert.equal(longlists.length, 13);
  assert.equal(longlists[0].status, "longlist");
});
