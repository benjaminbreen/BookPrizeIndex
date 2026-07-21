import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseFrancisParkman } from "./francis-parkman";
import { parseJohnBurroughs } from "./john-burroughs";
import { parseRfkArchive, parseRfkLaureate } from "./rfk-book";

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
