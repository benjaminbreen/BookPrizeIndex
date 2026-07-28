import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { assertCoverage, parseArthurRoss } from "./arthur-ross-book-award";

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

const award = prize("arthur-ross-book-award");
const bucket = category("arthur-ross-international-affairs");

const wrap = (body: string) => `==List of winners==\n===2000s===\n${body}\n==See also==\n`;

test("Arthur Ross parses a normal three-medal year and maps the tier labels", () => {
  const records = parseArthurRoss(award, bucket, wrap(`
;2016
*Gold Medal – [[Niall Ferguson]] for ''Kissinger: 1923–1968: The Idealist''
*Silver Medal – [[Thomas J. Christensen]] for ''The China Challenge: Shaping the Choices of a Rising Power ''
*Bronze Medal – [[Charles Moore (journalist)|Charles Moore]] for ''Margaret Thatcher: The Authorized Biography—Volume II: Everything She Wants''
`));

  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.status), ["winner", "finalist", "finalist"]);
  assert.deepEqual(records.map((record) => record.notes), ["Gold Medal", "Silver Medal", "Bronze Medal"]);
  assert.equal(records[0].title, "Kissinger: 1923–1968: The Idealist");
  assert.deepEqual(records[0].authors, ["Niall Ferguson"]);
  // Trailing space inside the italics must be trimmed.
  assert.equal(records[1].title, "The China Challenge: Shaping the Choices of a Rising Power");
  // Piped link resolves to the display side.
  assert.deepEqual(records[2].authors, ["Charles Moore"]);
});

test("Arthur Ross maps Honorable Mention and keeps multi-author books as one record", () => {
  const records = parseArthurRoss(award, bucket, wrap(`
; 2002
*Gold Medal – [[Robert Skidelsky]] for ''John Maynard Keynes: Fighting for Freedom 1937–1946''
*Silver Medal – [[Lawrence Freedman]] for ''Kennedy's Wars: Berlin, Cuba, Laos, and Vietnam''
*Honorable Mention – [[Walter Russell Mead]] and [[Richard C. Leone]] for ''Special Providence: American Foreign Policy and How It Changed the World''
`));

  assert.equal(records.length, 3);
  assert.equal(records[2].status, "honorable_mention");
  assert.equal(records[2].notes, "Honorable Mention");
  assert.deepEqual(records[2].authors, ["Walter Russell Mead", "Richard C. Leone"]);
});

test("Arthur Ross handles a ref-tailed year heading, italics inside a pipe-link, and a half-linked author pair", () => {
  const records = parseArthurRoss(award, bucket, wrap(`
;2013<ref>{{cite web |url=http://example.invalid |title=x}}</ref>
*Gold Medal – [[Fredrik Logevall]] for ''[[Embers of War|Embers of War: The Fall of an Empire and the Making of America's Vietnam]]''
*Silver Medal – [[Anne Applebaum]] for ''Iron Curtain: The Crushing of Eastern Europe, 1944–1956 ''
*Honorable Mention – [[Daron Acemoglu]] and [[James A. Robinson (economist)|James A. Robinson]] for ''[[Why Nations Fail|Why Nations Fail: The Origins of Power, Prosperity, and Poverty]]''

;2022
*Gold Medal – [[Carter Malkasian]] for ''[[The American War in Afghanistan: A History]]''
*Silver Medal – [[Mary Elise Sarotte]] for ''[[Not One Inch (book)|Not One Inch: America, Russia, and the Making of a Post-Cold War Stalemate]]''
*Bronze Medal – [[Nicole Perlroth]] for [[This Is How They Tell Me the World Ends: The Cyberweapons Arms Race|''This Is How They Tell Me the World Ends: The Cyberweapons Arms Race'' 7]]

;2023
*Gold Medal – [[Christopher R. Miller]] for ''[[Chip War: The Fight for the World's Most Critical Technology|Chip War: The Fight for the World’s Most Critical Technology]]''
*Silver Medal – [[Susan Shirk]] for ''Overreach: How China Derailed Its Peaceful Rise''
*Bronze Medal – [[Sergei Guriev]] and Daniel Treisman for ''[[Spin Dictators: The Changing Face of Tyranny in the 21st Century]]''
`));

  assert.equal(records.length, 9);
  assert.deepEqual([...new Set(records.map((record) => record.year))].sort(), [2013, 2022, 2023]);

  const logevall = records.find((record) => record.year === 2013 && record.status === "winner")!;
  assert.equal(logevall.title, "Embers of War: The Fall of an Empire and the Making of America's Vietnam");

  // 2013 honorable mention mixes a plain and a piped author link.
  const acemoglu = records.find((record) => record.year === 2013 && record.status === "honorable_mention")!;
  assert.deepEqual(acemoglu.authors, ["Daron Acemoglu", "James A. Robinson"]);

  // 2022 Bronze: italics live *inside* the pipe-link and a stray " 7" trails the title.
  const perlroth = records.find((record) => record.year === 2022 && record.notes === "Bronze Medal")!;
  assert.equal(perlroth.title, "This Is How They Tell Me the World Ends: The Cyberweapons Arms Race");
  assert.deepEqual(perlroth.authors, ["Nicole Perlroth"]);

  // 2023 Bronze mixes a linked and an unlinked author around " and ".
  const guriev = records.find((record) => record.year === 2023 && record.notes === "Bronze Medal")!;
  assert.deepEqual(guriev.authors, ["Sergei Guriev", "Daniel Treisman"]);
  assert.equal(guriev.title, "Spin Dictators: The Changing Face of Tyranny in the 21st Century");
});

test("Arthur Ross rejects an unmapped tier label and a missing section", () => {
  assert.throws(
    () => parseArthurRoss(award, bucket, "==Nope==\n;2016\n*Gold Medal – A for ''B''\n"),
    /Could not find List of winners section/,
  );
});

test("Arthur Ross assertCoverage rejects a short or malformed import", () => {
  assert.throws(() => assertCoverage([]), /Expected exactly 72/);
});
