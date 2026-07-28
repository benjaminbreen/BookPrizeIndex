import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import {
  mergeWomensPrizeRecords,
  parseWomensPrizeLonglist,
  parseWomensPrizeWikitable,
  resolvePrizeYearTerms,
  type WomensPrizeRestBook,
} from "./womens-prize-nonfiction";

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

const wpPrize = prize("womens-prize-nonfiction");
const wpCategory = category("womens-prize-nonfiction");

// Real wikitext from https://en.wikipedia.org/wiki/Women%27s_Prize_for_Non-Fiction, trimmed to two
// rowgroups: 2024 uses the named {{sortname|last=|first=}} form, 2025 the positional form.
const wikitable = `== Winners and shortlisted writers ==

{| class="wikitable sortable"
|+Women's Prize for Non-fiction winners and shortlist, 2024-
!scope=col |Year
!scope=col |Author
!scope=col |Title
!scope=col |Result
!scope=col class="unsortable"|{{Refh}}
|-  style=background:#cddeff
! scope=rowgroup rowspan="6" |[[2024 in literature|2024]]
|{{sortname|last=Klein |first=Naomi }}
|''[[Doppelganger (Klein book)|Doppelganger ]] ''
|Winner
|<ref name="winner2024">{{cite web |title=Announcing |url=https://womensprize.com/x/ }}</ref>
|-
|{{sortname|last=Cumming |first=Laura }}
|''Thunderclap  ''
| rowspan="5" | Shortlist
| rowspan="5" |<ref name=lipscomb />
|-
|{{sortname|last=Masud |first=Noreen }}
|''{{sort|Flat Place|A Flat Place}} ''
|-
|{{sortname|last=Miles |first=Tiya }}
|''[[All That She Carried]] ''
|-
|{{sortname|last=Murgia| first=Madhumita  }}
|''Code Dependent ''
|-
|{{sortname|last=Sinclair |first=Safiya }}
|''How to Say Babylon''
|-|-  style=background:#cddeff
! rowspan="6" |[[2025 in literature|2025]]
|{{sortname|Rachel|Clarke}}
|''{{Sort|Story of a Heart: Two Families, One Heart, and a Medical Miracle|[[The Story of a Heart: Two Families, One Heart, and a Medical Miracle]]}}''
|Winner
|<ref>{{cite news |title=Yael |url=https://apnews.com/x }}</ref>
|-
|{{sortname|Neneh|Cherry}}
|''{{Sort|Thousand Threads|A Thousand Threads}}''
| rowspan="5" |Shortlist
| rowspan="5" |<ref name="schaub" />
|-
|{{sortname|Chloe|Dalton|Chloe Dalton (author)}}
|''Raising Hare''
|-
|{{sortname|Clare|Mulley}}
|''[[Agent Zo]]: The Untold Story of a Fearless World War II Resistance Fighter''
|-
|{{sortname|Helen|Scales}}
|''What the Wild Sea Can Be: The Future of the World’s Ocean''
|-
|{{sortname|Yuan|Yang|dab=politician}}
|''[[Private Revolutions|Private Revolutions: Four Women Face China's New Social Order]]''
|}
`;

test("Women's Prize wikitable parsing handles both sortname variants and rowspan shortlists", () => {
  const records = parseWomensPrizeWikitable(wpPrize, wpCategory, wikitable);
  assert.equal(records.length, 12);
  assert.deepEqual(
    records.filter((record) => record.status === "winner").map((record) => `${record.year} ${record.authors.join("+")} — ${record.title}`),
    ["2024 Naomi Klein — Doppelganger", "2025 Rachel Clarke — The Story of a Heart: Two Families, One Heart, and a Medical Miracle"],
  );
  // Named sortname (2024) and positional sortname with a dab/link third argument (2025).
  assert.deepEqual(
    records.filter((record) => record.year === 2025 && record.status === "shortlist").map((record) => record.authors[0]),
    ["Neneh Cherry", "Chloe Dalton", "Clare Mulley", "Helen Scales", "Yuan Yang"],
  );
  // {{sort|key|display}} takes argument 2, and [[link|display]] is unwrapped.
  assert.ok(records.some((record) => record.title === "A Flat Place"));
  assert.ok(records.some((record) => record.title === "A Thousand Threads"));
  assert.ok(records.some((record) => record.title === "Agent Zo: The Untold Story of a Fearless World War II Resistance Fighter"));
  assert.ok(records.some((record) => record.title === "What the Wild Sea Can Be: The Future of the World’s Ocean"));
  assert.equal(records.every((record) => record.year === 2024 || record.year === 2025), true);
  assert.equal(records.filter((record) => record.year === 2024).length, 6);
  assert.equal(records.filter((record) => record.year === 2025).length, 6);
});

test("REST longlist parsing decodes HTML entities and resolves author term ids", () => {
  const books: WomensPrizeRestBook[] = [
    { title: { rendered: "Why Fish Don&#8217;t Exist: A Story of Loss, Love and the Hidden Order of Life" }, link: "https://womensprize.com/library/why-fish-dont-exist/", book_author: [1169] },
    { title: { rendered: "Private Revolutions: Coming of Age in a New China" }, link: "https://womensprize.com/library/private-revolutions/", book_author: [1193] },
    { title: { rendered: "The Story of a Heart" }, link: "https://womensprize.com/library/the-story-of-a-heart/", book_author: [1197] },
  ];
  const authors = new Map([
    [1169, "Lulu Miller"],
    [1193, "Yuan Yang"],
    [1197, "Rachel Clarke"],
  ]);
  const records = parseWomensPrizeLonglist(wpPrize, wpCategory, 2025, books, authors);
  assert.equal(records.length, 3);
  assert.equal(records[0].title, "Why Fish Don’t Exist: A Story of Loss, Love and the Hidden Order of Life");
  assert.equal(records[0].sourceConfidence, "official");
  assert.equal(records[0].sourceUrl, "https://womensprize.com/library/why-fish-dont-exist/");
  assert.equal(records.every((record) => record.status === "longlist"), true);
});

test("merging keeps the highest status when REST short titles differ from Wikipedia subtitled titles", () => {
  const higher = parseWomensPrizeWikitable(wpPrize, wpCategory, wikitable).filter((record) => record.year === 2025);
  const longlist = parseWomensPrizeLonglist(
    wpPrize,
    wpCategory,
    2025,
    [
      // Same book as the winner, but the REST title omits the subtitle entirely.
      { title: { rendered: "The Story of a Heart" }, link: "https://womensprize.com/library/a/", book_author: [1] },
      // Same book as a shortlist row, but with a completely DIFFERENT subtitle.
      { title: { rendered: "Private Revolutions: Coming of Age in a New China" }, link: "https://womensprize.com/library/b/", book_author: [2] },
      // Same book as a shortlist row, but the REST subtitle is longer.
      { title: { rendered: "Agent Zo: The Untold Story of Courageous WW2 Resistance Fighter Elżbieta Zawacka" }, link: "https://womensprize.com/library/c/", book_author: [3] },
      // A genuine longlist-only book.
      { title: { rendered: "Ootlin" }, link: "https://womensprize.com/library/d/", book_author: [4] },
    ],
    new Map([
      [1, "Rachel Clarke"],
      [2, "Yuan Yang"],
      [3, "Clare Mulley"],
      [4, "Jenni Fagan"],
    ]),
  );
  const merged = mergeWomensPrizeRecords(higher, longlist);
  assert.equal(merged.length, 7);
  assert.equal(merged.filter((record) => record.status === "longlist").length, 1);
  assert.equal(merged.find((record) => record.status === "longlist")?.title, "Ootlin");
  // No author appears twice — that is the double-counting failure mode this join exists to prevent.
  const authorKeys = merged.map((record) => record.authors.join("+"));
  assert.equal(new Set(authorKeys).size, authorKeys.length);
});

test("prize_year term ids are resolved from the taxonomy rather than hardcoded", () => {
  const terms = [
    { id: 11, name: "2023" },
    { id: 8, name: "2024" },
    { id: 1117, name: "2025" },
    { id: 1302, name: "2026" },
  ];
  const resolved = resolvePrizeYearTerms(terms, [2024, 2025, 2026]);
  assert.equal(resolved.get(2024), 8);
  assert.equal(resolved.get(2025), 1117);
  assert.equal(resolved.get(2026), 1302);
  assert.throws(() => resolvePrizeYearTerms(terms, [2027]), /prize_year terms for 2027/);
});
