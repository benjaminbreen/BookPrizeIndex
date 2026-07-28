import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { parseLincolnPrizeArchive, parseLincolnPrizeRecentWinners } from "./lincoln-prize";

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

const testPrize = prize("lincoln-prize");
const testCategory = category("lincoln-prize-civil-war-era");

const parse = (html: string) => parseLincolnPrizeArchive(testPrize, testCategory, html);

test("parses a normal year with an inline First Place and a bulleted finalist list", () => {
  const records = parse(`
<h2 id="prize-2024">
    2024
    </h2>
<p>First Place: <a href="https://www.gettysburg.edu/lincoln-prize/winners">Frances M. Clarke and Rebecca Jo Plant, &ldquo;Of Age: Boy Soldiers and Military Power in the Civil War Era&rdquo;</a></p>
<p>Finalists:</p>
<ul>
<li>Frank J. Cirillo, &ldquo;The Abolitionist Civil War: Immediatists and the Struggle to Transform the Union&rdquo;</li>
<li>John C. Rodrigue, &ldquo;Freedom&rsquo;s Crescent: The Civil War and the Destruction of Slavery&rdquo;</li>
</ul>
`);

  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    awardId: "lincoln-prize",
    awardName: "lincoln-prize",
    categoryId: "lincoln-prize-civil-war-era",
    categoryName: "lincoln-prize-civil-war-era",
    year: 2024,
    status: "winner",
    title: "Of Age: Boy Soldiers and Military Power in the Civil War Era",
    authors: ["Frances M. Clarke", "Rebecca Jo Plant"],
    sourceUrl: "https://source.example/#prize-2024",
    sourceLabel: "Test source (2024)",
    sourceConfidence: "official",
    notes: undefined,
  });
  assert.deepEqual(records.map((record) => record.status), ["winner", "finalist", "finalist"]);
  assert.deepEqual(records[2].authors, ["John C. Rodrigue"]);
});

test("marks bulleted First Place blocks with two authors as co-winners and keeps later labels separate", () => {
  const records = parse(`
<h2 id="prize-2014">
	2014
</h2>
<p>
	First Place:
</p>
<ul>
	<li>Allen C. Guelzo, &ldquo;Gettysburg: The Last Invasion&rdquo;</li>
	<li>Martin P. Johnson, &ldquo;Writing the Gettysburg Address&rdquo;</li>
</ul>
<p>Special Achievement Award: Steven Spielberg, <em>Lincoln</em></p>
<p>Finalists:</p>
<ul>
	<li>Christopher Hager, &ldquo;Word by Word: Emancipation and the Act of Writing&rdquo;</li>
</ul>
`);

  assert.deepEqual(records.map((record) => [record.status, record.title]), [
    ["co_winner", "Gettysburg: The Last Invasion"],
    ["co_winner", "Writing the Gettysburg Address"],
    ["finalist", "Word by Word: Emancipation and the Act of Writing"],
  ]);
});

test("splits an inline First Place paragraph that names two shared winners", () => {
  const records = parse(`
<h2 id="prize-2023">2023</h2>
<p>First Place: <a href="https://www.gettysburg.edu/lincoln-prize/winners">Jon Meachem, &ldquo;And There Was Light: Abraham Lincoln and the American Struggle,&rdquo; and Jonathan W. White, &ldquo;A House Built by Slaves: African American Visitors to the Lincoln White House&rdquo;</a></p>
`);

  assert.deepEqual(records.map((record) => [record.status, record.authors[0], record.title]), [
    ["co_winner", "Jon Meacham", "And There Was Light: Abraham Lincoln and the American Struggle"],
    ["co_winner", "Jonathan W. White", "A House Built by Slaves: African American Visitors to the Lincoln White House"],
  ]);
});

test("excludes the 1991 television miniseries but keeps its finalists", () => {
  const records = parse(`
<h2 id="prize-1991">1991</h2>
<p>First Place: Ken Burns, &ldquo;The Civil War&rdquo;</p>
<p>Finalists:</p>
<ul>
<li>Mark E. Neely, Jr., &ldquo;The Fate of Liberty: Abraham Lincoln and Civil Liberties&rdquo;</li>
</ul>
`);

  assert.deepEqual(records.map((record) => record.title), ["The Fate of Liberty: Abraham Lincoln and Civil Liberties"]);
  assert.deepEqual(records[0].authors, ["Mark E. Neely, Jr."]);
});

test("recovers both books from a Lifetime Achievement First Place citation", () => {
  const records = parse(`
<h2 id="prize-1997">1997</h2>
<p>First Place: Don Fehrenbacher, Lifetime Achievement with special recognition of &ldquo;Prelude to Greatness: Lincoln in the 1850s&rdquo; and &ldquo;The Dred Scott Case: Its Significance in American Law and Politics&rdquo;</p>
`);

  assert.deepEqual(records.map((record) => [record.status, record.authors[0], record.title]), [
    ["winner", "Don Fehrenbacher", "Prelude to Greatness: Lincoln in the 1850s"],
    ["winner", "Don Fehrenbacher", "The Dred Scott Case: Its Significance in American Law and Politics"],
  ]);
  assert.match(records[0].notes ?? "", /Lifetime Achievement/);
});

test("repairs stray commas inside single author names and skips non-book honours", () => {
  const records = parse(`
<h2 id="prize-2018">2018</h2>
<p>First Place: Edward Ayers, &ldquo;The Thin Light of Freedom&rdquo;</p>
<p>Finalists:</p>
<ul>
<li>Ron, Chernow, &ldquo;Grant&rdquo;</li>
<li>Graham A., Peck, &ldquo;Making an Antislavery Nation&rdquo;</li>
<li>David Silkenat, &ldquo;Raising the White Flag (University of North Carolina Press)&rdquo;</li>
</ul>
<p>Lifetime Achievement Award: Richard N. Current, University Distinguished Professor of History Emeritus</p>
<p>E-Lincoln Prize: John Adler for &ldquo;HarpWeek Presents Lincoln and the Civil War.com&rdquo; (website)</p>
`);

  assert.deepEqual(records.map((record) => [record.authors, record.title]), [
    [["Edward Ayers"], "The Thin Light of Freedom"],
    [["Ron Chernow"], "Grant"],
    [["Graham A. Peck"], "Making an Antislavery Nation"],
    [["David Silkenat"], "Raising the White Flag"],
  ]);
});

test("splits an unclosed list item that merges two honorable mentions", () => {
  const records = parse(`
<h2 id="prize-2009">2009</h2>
<p>Honorable Mentions:</p>
<ul>
<li>Jacqueline Jones, &ldquo;Saving Savannah: The City and the Civil War&rdquo;
<li>Fred Kaplan, &ldquo;Lincoln: The Biography of a Writer and William Lee Miller,&rdquo; &ldquo;President Lincoln: The Duty of a Statesman&rdquo;</li>
</ul>
`);

  assert.deepEqual(records.map((record) => [record.status, record.authors[0], record.title]), [
    ["honorable_mention", "Jacqueline Jones", "Saving Savannah: The City and the Civil War"],
    ["honorable_mention", "Fred Kaplan", "Lincoln: The Biography of a Writer"],
    ["honorable_mention", "William Lee Miller", "President Lincoln: The Duty of a Statesman"],
  ]);
});

test("throws when the archive introduces an unrecognised label", () => {
  assert.throws(
    () => parse(`<h2 id="prize-2027">2027</h2><p>Grand Prize: Someone, &ldquo;A Book&rdquo;</p>`),
    /Unrecognised Lincoln Prize label in 2027/,
  );
});

test("takes only post-archive winners from the Wikipedia recipient table", () => {
  const wikitext = `
{| class="wikitable"
! Year !! Recipient !! Work
|-
|2024
|Frances M. Clarke and Rebecca Jo Plant
|''Of Age: Boy Soldiers and Military Power in the Civil War Era''
|-
|2025
| [[Edda L. Fields-Black]]
|''COMBEE: Harriet Tubman, the Combahee River Raid, and Black Freedom during the Civil War''
|-
|2026
|[[Richard Carwardine]]
|''Righteous Strife: How Religious Nationalists Forged Lincoln's Union''
|}

==See also==
*[[American Civil War]]
`;

  const records = parseLincolnPrizeRecentWinners(testPrize, testCategory, wikitext);
  assert.deepEqual(records.map((record) => [record.year, record.authors[0], record.title]), [
    [2025, "Edda L. Fields-Black", "COMBEE: Harriet Tubman, the Combahee River Raid, and Black Freedom during the Civil War"],
    [2026, "Richard Carwardine", "Righteous Strife: How Religious Nationalists Forged Lincoln's Union"],
  ]);
  assert.equal(records[0].sourceConfidence, "secondary");
  assert.equal(records[0].sourceUrl, "https://en.wikipedia.org/wiki/Lincoln_Prize");
  assert.match(records[1].notes ?? "", /finalist slate is not covered/);
});
