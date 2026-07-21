import assert from "node:assert/strict";
import test from "node:test";
import { parseAwardRowsFromWikitable } from "./wikitable";

test("parses article-prefix and display-value sort templates without leaking parameters", () => {
  const rows = parseAwardRowsFromWikitable(`
{| class="wikitable"
! Year
! Author
! Title
! Result
|-
! 2020
| Example Author
| {{sort|1=A|2=Disappearance in Damascus}}
| Winner
|-
! 2021
| Another Author
| {{sort|1=Geography of Blood|2=''[[A Geography of Blood]]''}}
| Winner
|}
`);

  assert.deepEqual(rows.map((row) => row.title), [
    "A Disappearance in Damascus",
    "A Geography of Blood",
  ]);
});

test("does not split sort-template parameters at pipes inside wiki links", () => {
  const rows = parseAwardRowsFromWikitable(`
{| class="wikitable"
! Year
! Author
! Title
! Result
|-
! 2022
| Example Author
| {{Sort|Betrayal, The|''[[The Betrayal (novel)|The Betrayal]]''}}
| Shortlist
|}
`);

  assert.equal(rows[0]?.title, "The Betrayal");
});
