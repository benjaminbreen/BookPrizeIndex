import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { assertCoverage, parseRossiter } from "./rossiter-prize";

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

const award = prize("rossiter-prize");
const bucket = category("rossiter-history-of-women-in-science");

const wrap = (rows: string) => `==Recipients==
{| class="wikitable"
|-
!Year
! Winner
! Work
${rows}
|}

==See also==
`;

test("Rossiter keeps odd-year book rows and drops even-year article rows", () => {
  const records = parseRossiter(award, bucket, wrap(`|-
|1987
|[[Regina Morantz-Sanchez|Regina Markell Morantz-Sanchez]]
| ''Sympathy and Science: Women Physicians in American Medicine'' (Oxford: Oxford University Press, 1985).
|-
|1988
|[[Pnina Abir-Am]]
| "Synergy or Clash: Disciplinary and Marital Strategies in the Career of Mathematical Biologist Dorothy Wrinch," in ''Uneasy Careers and Intimate Lives'', edited by Pnina Abir-Am and Dorinda Outram (New Brunswick, N.J.: Rutgers University Press, 1987)`));

  assert.equal(records.length, 1);
  assert.equal(records[0].year, 1987);
  assert.equal(records[0].status, "winner");
  assert.equal(records[0].title, "Sympathy and Science: Women Physicians in American Medicine");
  // Piped author link must resolve to the display side.
  assert.deepEqual(records[0].authors, ["Regina Markell Morantz-Sanchez"]);
});

test("Rossiter is not fooled by italicised container volumes in even-year article rows", () => {
  // 2002 and 2004 both italicise the container volume mid-cell. An unanchored "''" search
  // (what pfizer.ts does) would wrongly emit them as books.
  const records = parseRossiter(award, bucket, wrap(`|-
|2002
|[[Ruth Oldenziel]]
| "Multiple-Entry Visas: Gender and Engineering in the U.S., 1870-1945," in ''Crossing Boundaries, Building Bridges: Comparing the History of Women Engineers, 1870s-1990s'', eds. Annie Canel (Harwood Academic Publishers, 2000), pp.&nbsp;11–50.
|-
|2004
|[[Paula Findlen]]
| "The Scientist's Body: The Nature of Woman Philosopher in Enlightenment Italy" in ''The Faces of Nature in Enlightenment Europe'', (Berlin: Berliner Wissenschafts-Verlag, 2003), pp.&nbsp;211–236.`));

  assert.equal(records.length, 0);
});

test("Rossiter throws when the anchored-italics signal and the odd-year rule disagree", () => {
  assert.throws(
    () => parseRossiter(award, bucket, wrap(`|-
|1990
|[[Ann Hibner Koblitz]]
| ''Science, Women, and the Russian Intelligentsia''`)),
    /disagrees with the odd-year book rule/,
  );
});

test("Rossiter strips a self-closing ref, a trailing comma inside the italics, and applies title overrides", () => {
  const records = parseRossiter(award, bucket, wrap(`|-
|2023
|[[Leah DeVun]]
|''The Shape of Sex: Nonbinary Gender from Genesis to the Renaissance'' (Columbia University Press, 2021).<ref>{{Cite book |title=x}}</ref><ref name=":0" />
|-
|2013
|[[Sally Gregory Kohlstedt]]
|''Teaching Children Science: Hands-On Nature Study in North America, 1890-1930,'' (The University of Chicago Press, 2010).
|-
|2009
|[[Monica Green (historian)|Monica H. Green]]
| ''Making Women's Medicine Masculine. The Rise of Male Authority in Pre-Modern Gynaecology'' (Oxford University Press, 2008).
|-
|2017
|[[Laura Micheletti Puaca]]
|''Searching for Scientific Womanpower: Technocratic Feminism and the Politics of National Security, 1940-1980 (Gender and American Culture)'' (The University of North Carolina Press, 2014).
|-
|2001
|[[Charlotte Furth]]
| ''A Flourishing Yin: Gender in China’s Medical History, 960-1665'' (University of California Press, 1999).<ref>{{Cite book |title=x}}</ref>`));

  assert.equal(records.length, 5);
  const byYear = new Map(records.map((record) => [record.year, record]));

  assert.equal(byYear.get(2023)!.title, "The Shape of Sex: Nonbinary Gender from Genesis to the Renaissance");
  assert.equal(byYear.get(2013)!.title, "Teaching Children Science: Hands-On Nature Study in North America, 1890-1930");
  assert.equal(
    byYear.get(2009)!.title,
    "Making Women's Medicine Masculine: The Rise of Male Authority in Pre-Modern Gynaecology",
  );
  assert.deepEqual(byYear.get(2009)!.authors, ["Monica H. Green"]);
  assert.equal(
    byYear.get(2017)!.title,
    "Searching for Scientific Womanpower: Technocratic Feminism and the Politics of National Security, 1940-1980",
  );
  assert.equal(byYear.get(2001)!.title, "A Flourishing Yin: Gender in China’s Medical History, 960-1665");
  assert.ok(records.every((record) => record.status === "winner"));
});

test("Rossiter assertCoverage rejects a short import", () => {
  assert.throws(() => assertCoverage([]), /Expected exactly 20/);
});
