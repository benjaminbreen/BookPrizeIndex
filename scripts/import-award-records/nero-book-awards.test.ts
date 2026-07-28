import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseNeroNonfiction } from "./nero-book-awards";

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

const neroPrize = prize("nero-book-awards");
const neroCategory = category("nero-nonfiction");

// Real wikitext from https://en.wikipedia.org/wiki/Nero_Book_Awards, trimmed to the two competing
// year-header layouts: 2023 puts the rowspan year header on the overall-winner row, while 2024 puts
// it on a standalone row followed by an empty `|-`.
const wikitable = `{| class="wikitable sortable"
!Year
!Author
!Title
!Publisher
!Result
!Ref.
|- style="background: lightyellow;"
! rowspan="16" |'''[[2023 in literature|2023]]'''

|'''{{sortname|Paul|Murray|Paul Murray (author)}}'''
|'''''{{sort|Bee Sting|[[The Bee Sting]]}}'''''
|'''[[Hamish Hamilton]]'''
||'''Overall winner<br />Fiction winner'''
||<ref name="bbc2024" />
|-
|{{sortname|Eleanor| Catton}}
|''[[Birnam Wood (novel)|Birnam Wood]]''
|[[Granta]]
| rowspan="3" |Fiction shortlist
| rowspan="3" |<ref name="creamer2023" />
|-
|{{sortname|Megan| Nolan}}
|''Ordinary Human Failings''
|[[Jonathan Cape]]
|-
|{{sortname|Karen| Powell|nolink=1}}
|''Fifteen Wild Decembers''
|[[Europa Publications|Europa]]
|- style="background: lightyellow;"
|{{sortname|Fern|Brady}}
|''[[Strong Female Character]]''
|Brazen
| rowspan="1" |Non-fiction winner
| rowspan="1" |<ref name="creamer2024" />
|-
|{{sortname|Freya| Bromley|nolink=1}}
|''{{sort|Tiday Year|The Tidal Year}}''
|[[Coronet Books|Coronet]]
| rowspan="3" |Non-fiction shortlist
| rowspan="3" |<ref name="creamer2023" />
|-
|{{sortname|Natasha| Carthew}}
|''Undercurrent''
|[[Coronet Books|Coronet]]
|-
|{{sortname|Victoria| Smith|nolink=1}}
|''Hags''
|[[Fleet Publishing|Fleet]]
|- style="background: lightyellow;"
! rowspan="17" |'''[[2024 in literature|2024]]'''
|- style="background: lightyellow;"
|'''{{sortname|Sophie| Elmhirst}}'''
|'''''[[Maurice and Maralyn]]'''''
|'''[[Chatto & Windus]]'''
|'''Overall winner<br />Non-fiction winner'''
|<ref name=cats2024 />
|-
|{{sortname|Ellen |Atlanta}}
|''Pixel Flesh''
|[[Headline Publishing Group|Headline]]
| rowspan="3" |Non-fiction shortlist
| rowspan="3" |<ref name="creamer" />
|-
|{{sortname|Zeinab| Badawi}}
|''{{sort|African History of Africa|An African History of Africa}}''
|[[W. H. Allen & Co.]]
|-
|{{sortname|Orlando| Whitfield|nolink=1}}
|''All That Glitters''
|[[Profile Books]]
|- style="background: lightyellow;"
|{{sortname|Adam S.| Leslie}}
|''Lost in the Garden''
|Dead Ink
|Fiction winner
|<ref name="cats2024" />
|-
|{{sortname|Suzannah| Dunn}}
|''Levitation for Beginners''
|[[Abacus Books|Abacus]]
| rowspan="3" |Fiction shortlist
| rowspan="3" |<ref name="creamer" />
|-
|{{sortname|Jo| Hamya}}
|''{{sort|Hypocrite|[[The Hypocrite (novel)|The Hypocrite]]}}''
|[[Weidenfeld & Nicolson]]
|-
|{{sortname|Donal| Ryan}}
|''Heart, Be at Peace''
|[[Doubleday (publisher)|Doubleday]]
|}
`;

test("Nero parsing keeps only non-fiction rows across both year-header rowspan layouts", () => {
  const records = parseNeroNonfiction(neroPrize, neroCategory, wikitable);
  assert.deepEqual(
    records.map((record) => `${record.year} ${record.status} ${record.authors.join("+")} — ${record.title}`),
    [
      "2024 winner Sophie Elmhirst — Maurice and Maralyn",
      "2024 shortlist Orlando Whitfield — All That Glitters",
      "2024 shortlist Zeinab Badawi — An African History of Africa",
      "2024 shortlist Ellen Atlanta — Pixel Flesh",
      "2023 winner Fern Brady — Strong Female Character",
      "2023 shortlist Victoria Smith — Hags",
      "2023 shortlist Freya Bromley — The Tidal Year",
      "2023 shortlist Natasha Carthew — Undercurrent",
    ],
  );
  // The nastiest failure mode: a fiction title silently filed as non-fiction after a rowspan shift.
  assert.equal(records.some((record) => /Bee Sting|Birnam Wood|Lost in the Garden|Hypocrite/.test(record.title)), false);
});

test("Nero parsing records the Golden Nero as a note on the category winner, not a separate record", () => {
  const records = parseNeroNonfiction(neroPrize, neroCategory, wikitable);
  const elmhirst = records.find((record) => record.year === 2024 && record.status === "winner");
  assert.equal(elmhirst?.notes, "Also named the overall Golden Nero Book of the Year for 2024.");
  // 2023's Golden Nero went to fiction, so the non-fiction winner carries no overall note.
  assert.equal(records.find((record) => record.year === 2023 && record.status === "winner")?.notes, undefined);
  assert.equal(records.filter((record) => record.year === 2024).length, 4);
});

test("Nero parsing populates the publisher column and unwraps sort/link/italic title markup", () => {
  const records = parseNeroNonfiction(neroPrize, neroCategory, wikitable);
  assert.deepEqual(
    records.map((record) => record.publisher),
    ["Chatto & Windus", "Profile Books", "W. H. Allen & Co.", "Headline", "Brazen", "Fleet", "Coronet", "Coronet"],
  );
  assert.ok(records.some((record) => record.title === "The Tidal Year"));
  assert.ok(records.some((record) => record.title === "An African History of Africa"));
  assert.equal(records.every((record) => !/[[\]{}']/.test(record.title)), true);
});
