import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { assertCoverage, parseElizabethLongford } from "./elizabeth-longford-prize";

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

const award = prize("elizabeth-longford-prize");
const bucket = category("elizabeth-longford-historical-biography");

const wrap = (body: string) => `==Winners==\n\n=== 2020s ===\n${body}\n==References==\n`;

test("Elizabeth Longford parses a Winner:/Shortlist: year with publishers", () => {
  const records = parseElizabethLongford(award, bucket, wrap(`
'''2024'''

* Winner: Jackie Wullschläger for ''[[Monet: The Restless Vision]]'' ([[Allen Lane (imprint)|Allen Lane]])

Shortlist:

* [[Deborah E. Lipstadt]] for ''Golda Meir: Israel’s Matriarch'' ([[Yale Press]])
* [[Matthew Cobb]] for ''Crick: A Mind in Motion - from DNA to the Brain'' ([[Profile Books]])
`));

  assert.equal(records.length, 3);
  const winner = records[0];
  assert.equal(winner.status, "winner");
  assert.equal(winner.title, "Monet: The Restless Vision");
  assert.deepEqual(winner.authors, ["Jackie Wullschläger"]);
  assert.equal(winner.publisher, "Allen Lane");

  const lipstadt = records.find((record) => record.authors[0] === "Deborah E. Lipstadt")!;
  assert.equal(lipstadt.status, "shortlist");
  // [[Yale Press]] is a redirect; normalized to the real imprint name.
  assert.equal(lipstadt.publisher, "Yale University Press");
});

test("Elizabeth Longford treats pre-2019 bullets, which carry no 'Winner:' prefix, as winners", () => {
  const records = parseElizabethLongford(award, bucket, wrap(`
'''2018'''
* [[Giles Tremlett]] for ''[[Isabella of Castile]]: Europe's First Great Queen''<ref>{{Cite web|title=News & Archive|url=https://elhb.uk/archive/}}</ref>
'''2017'''
* [[John Bew (historian)|John Bew]] for ''Citizen Clem: A Biography of Attlee''
'''2011'''
* [[Philip Ziegler]] for ''Edward Heath'' (bio of [[Edward Heath]])<ref>PRIZES. (2011).</ref>
`));

  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.status), ["winner", "winner", "winner"]);
  assert.equal(records[0].title, "Isabella of Castile: Europe's First Great Queen");
  assert.deepEqual(records[1].authors, ["John Bew"]);
  // "(bio of Edward Heath)" is an annotation, not a publisher.
  assert.equal(records[2].publisher, undefined);
});

test("Elizabeth Longford handles the scrambled 2025 winner row, a missing 'for', split italics, and the Allen King typo", () => {
  const records = parseElizabethLongford(award, bucket, wrap(`
'''2025'''

* Winner: ''Augustus the Strong:'' [[Tim Blanning]] for ''A Study in Artistic Greatness and Political Fiasco'' ''([[Allen Lane (imprint)|Allen Lane]])''<ref>{{Cite web |title=x |url=https://elhb.uk/}}</ref>

Shortlist:

* [[Stephen Alford]] for ''All His Spies: The Secret World of Robert Cecil'' ([[Allen Lane (imprint)|Allen Lane]])

'''2024'''

* Winner: Jackie Wullschläger for ''[[Monet: The Restless Vision]]'' ([[Allen Lane (imprint)|Allen Lane]])

Shortlist:<ref>{{cite web |title=x |url=https://elhb.uk/}}</ref>

* Kal Raustiala ''The Absolutely Indispensable Man: Ralph Bunche, the United Nations,'' ''and the Fight to End Empire'' ([[Oxford University Press]])
* M.W. Rowe for ''J.L. Austin:Philosopher and D-Day Intelligence Officer'' ''([[Oxford University Press]])''
* Leanda de Lisle for ''Henrietta Maria: Conspirator, Warrior, Phoenix Queen'' ''(''[[Chatto & Windus]]) [[Vintage Books]]

'''2021'''

* Winner: [[Fredrik Logevall]] for ''JFK: Vol 1'' ([[Penguin Books]])

Shortlist:

* [[Sudhir Hazareesingh]] for ''Black Spartacus: The Epic Life of Toussaint Louverture'' (Allen King)
`));

  const blanning = records.find((record) => record.year === 2025 && record.status === "winner")!;
  assert.equal(blanning.title, "Augustus the Strong: A Study in Artistic Greatness and Political Fiasco");
  assert.deepEqual(blanning.authors, ["Tim Blanning"]);

  // Bullet is missing the word "for"; the title is split across two adjacent italic runs.
  const raustiala = records.find((record) => record.authors[0] === "Kal Raustiala")!;
  assert.equal(raustiala.status, "shortlist");
  assert.equal(
    raustiala.title,
    "The Absolutely Indispensable Man: Ralph Bunche, the United Nations, and the Fight to End Empire",
  );
  assert.equal(raustiala.publisher, "Oxford University Press");

  // Publisher parenthetical sits inside the italics.
  const rowe = records.find((record) => record.authors[0] === "M.W. Rowe")!;
  assert.equal(rowe.publisher, "Oxford University Press");

  // Two dangling publishers; only the parenthesised one is taken.
  const deLisle = records.find((record) => record.authors[0] === "Leanda de Lisle")!;
  assert.equal(deLisle.title, "Henrietta Maria: Conspirator, Warrior, Phoenix Queen");
  assert.equal(deLisle.publisher, "Chatto & Windus");

  // "Allen King" is a source typo for Allen Lane; the row is kept but the typo is not propagated.
  const hazareesingh = records.find((record) => record.authors[0] === "Sudhir Hazareesingh")!;
  assert.equal(hazareesingh.title, "Black Spartacus: The Epic Life of Toussaint Louverture");
  assert.equal(hazareesingh.publisher, undefined);

  assert.equal(records.filter((record) => record.status === "winner").length, 3);
});

test("Elizabeth Longford assertCoverage rejects a short import", () => {
  assert.throws(() => assertCoverage([]), /Expected exactly 54/);
});
