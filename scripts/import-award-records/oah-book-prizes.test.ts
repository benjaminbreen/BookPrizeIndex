import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { markSharedYears, parseAuthors, parseOahPastWinners } from "./oah-book-prizes";

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

const oah = prize("oah-book-prizes");

/** Wraps paragraph markup in the WordPress toggle skeleton the OAH pages use. */
function page(body: string, wrapperClass = " eplus-wrapper") {
  const paragraphs = body
    .trim()
    .split("\n@@\n")
    .map((paragraph) => `<p class="${wrapperClass}">${paragraph.trim()}</p>`)
    .join("\n\n\n");
  return `<div class="ep_toggle_item_title"><span><strong>Submission Process</strong></span></div><div class="ep_toggle_item_content">
<p class="${wrapperClass}">Mail entries to <span class="__cf_email__" data-cfemail="cbaabc">[email&#160;protected]</span>.</p>
</div></div></div>
<div class="ep_toggle_item_title"><span><strong>Past Winners</strong></span></div><div class="ep_toggle_item_content">
${paragraphs}
</div></div></div>`;
}

test("parses a normal year heading plus winner row and ignores the submission section", () => {
  const records = parseOahPastWinners(
    oah,
    category("oah-frederick-jackson-turner-award"),
    page(`
<strong>2025</strong>
@@
Brianna Nofil, William &amp; Mary. <em>The Migrant&#8217;s Jail: An American History of Mass Incarceration</em><br>(Princeton University Press)
`),
  );

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    awardId: "oah-book-prizes",
    awardName: "oah-book-prizes",
    categoryId: "oah-frederick-jackson-turner-award",
    categoryName: "oah-frederick-jackson-turner-award",
    year: 2025,
    status: "winner",
    title: "The Migrant’s Jail: An American History of Mass Incarceration",
    authors: ["Brianna Nofil"],
    publisher: "Princeton University Press",
    sourceUrl: "https://source.example/",
    sourceLabel: "Test source",
    sourceConfidence: "official",
    notes: undefined,
  });
});

test("splits a paragraph that packs a winner and several honorable mentions behind double <br>", () => {
  const records = parseOahPastWinners(
    oah,
    category("oah-frederick-jackson-turner-award"),
    page(`
<strong>2024</strong>
@@
Michael A. Blaakman, Princeton University, <em>Speculation Nation: Land Mania in the Revolutionary  American Republic</em> (University of Pennsylvania Press)<br><br>Honorable Mention: Wendell Nii Laryea Adjetey, <em>Cross-Border Cosmopolitans: The Making of Pan-African North America</em> (University of North Carolina Press)<br><br>Honorable Mention: Julia Ornelas-Higdon, <em>The Grapes of Conquest: Race, Labor, and the<br>Industrialization of California Wine, 1769&#8211;1920</em> (University of Nebraska Press)
`),
  );

  assert.deepEqual(
    records.map((record) => [record.year, record.status, record.authors[0]]),
    [
      [2024, "winner", "Michael A. Blaakman"],
      [2024, "honorable_mention", "Wendell Nii Laryea Adjetey"],
      [2024, "honorable_mention", "Julia Ornelas-Higdon"],
    ],
  );
  // A single <br> inside a title is a wrap, not a record boundary.
  assert.equal(records[2].title, "The Grapes of Conquest: Race, Labor, and the Industrialization of California Wine, 1769–1920");
});

test("handles the label-only honorable mention form and drops 'No award given.' years", () => {
  const records = parseOahPastWinners(
    oah,
    category("oah-lawrence-w-levine-award"),
    page(`
<strong>2025</strong>
@@
Honorable Mention<br>Laura E. Helton, University of Deleware. <em>Scattered and Fugitive Things</em> (Columbia University Press)
@@
1976
@@
No award given.
`),
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].status, "honorable_mention");
  assert.deepEqual(records[0].authors, ["Laura E. Helton"]);
});

test("recovers the Merle Curti 2002 winner from the year heading inlined with its record, plus its bracket note", () => {
  const records = parseOahPastWinners(
    oah,
    category("oah-merle-curti-award"),
    page(`
<strong>2003</strong>
@@
Helen Lefkowitz Horowitz, Smith College, <em>Rereading Sex</em>&nbsp;(Alfred A. Knopf)
@@
<strong>2002&nbsp;</strong><br>David W. Blight, Amherst College,&nbsp;<em>Race and Reunion: The Civil War in American Memory</em>&nbsp;(Harvard University Press)
@@
[This book won both the Curti social and Curti intellectual awards for 2002.]
`),
  );

  assert.deepEqual(
    records.map((record) => [record.year, record.title]),
    [
      [2003, "Rereading Sex"],
      [2002, "Race and Reunion: The Civil War in American Memory"],
    ],
  );
  assert.equal(records[1].notes, "This book won both the Curti social and Curti intellectual awards for 2002.");
});

test("moves the Intellectual/Social History track prefix into notes and marks same-status co-winners", () => {
  const records = markSharedYears(
    parseOahPastWinners(
      oah,
      category("oah-merle-curti-award"),
      page(`
<strong>2020</strong>
@@
Intellectual History: Katrina Forrester, Harvard University, <em>In the Shadows of Justice</em> (Princeton University Press)<br><br>Social History: Stephanie E. Jones-Rogers, University of California, Berkeley, <em>They Were Her Property</em> (Yale University Press)
@@
Honorable Mention: Kali Nicole Gross, Emory University, <em>Hannah Mary Tabbs and the Disembodied Torso</em> (Oxford University Press)
`),
    ),
  );

  assert.deepEqual(
    records.map((record) => [record.status, record.notes]),
    [
      ["co_winner", "Intellectual History award."],
      ["co_winner", "Social History award."],
      ["honorable_mention", undefined],
    ],
  );
  // The lone honorable mention must not be promoted by the two winners sharing the year.
  assert.equal(records[2].status, "honorable_mention");
});

test("reads the Liberty Legacy finalist slate and a legacy-name note, tolerating an unclosed publisher paren", () => {
  const records = parseOahPastWinners(
    oah,
    category("oah-civil-war-and-reconstruction-book-award"),
    page(`
1988
@@
William E. Gienapp,&nbsp;<em>The Origins of the Republican Party 1852&#8211;1856</em>&nbsp;(Oxford University Press
@@
Finalists for the inaugural year (2003) of the award are:
@@
Greta De Jong,&nbsp;<em>A Different Day</em>&nbsp;(University of North Carolina Press)
`),
    { legacyName: { note: "Awarded as the Avery O. Craven Award.", through: 2020 } },
  );

  assert.equal(records[0].publisher, "Oxford University Press");
  assert.equal(records[0].status, "winner");
  assert.equal(records[0].notes, "Awarded as the Avery O. Craven Award.");
  assert.equal(records[1].status, "finalist");
});

test("matches the leading-space wrapper class used by older snapshots and the space-free one", () => {
  const body = `<strong>2011</strong>
@@
Aaron Sachs, Cornell University, <em>Arcadian America</em> (Yale University Press)`;
  for (const wrapperClass of [" eplus-wrapper", "eplus-wrapper", "wp-block-paragraph eplus-wrapper"]) {
    const records = parseOahPastWinners(oah, category("oah-lawrence-w-levine-award"), page(body, wrapperClass));
    assert.equal(records.length, 1, wrapperClass);
    assert.equal(records[0].year, 2011);
  }
});

test("strips institutional affiliations while keeping every co-author", () => {
  assert.deepEqual(parseAuthors("Adria L. Imada, University of California, San Diego,"), ["Adria L. Imada"]);
  assert.deepEqual(parseAuthors("Crystal N. Feimster, The University of North Carolina, Chapel Hill,"), [
    "Crystal N. Feimster",
  ]);
  assert.deepEqual(parseAuthors("Charles F. Fanning, Jr.,"), ["Charles F. Fanning, Jr."]);
  assert.deepEqual(parseAuthors("Brianna Nofil, William &amp; Mary."), ["Brianna Nofil"]);
  assert.deepEqual(
    parseAuthors("Jacquelyn Hall, James Leloudis, Robert Korstad, Mary Murphy, Lu Ann Jones and Christopher B. Daly,"),
    ["Jacquelyn Hall", "James Leloudis", "Robert Korstad", "Mary Murphy", "Lu Ann Jones", "Christopher B. Daly"],
  );
  assert.deepEqual(
    parseAuthors("Cornelia H. Dayton, University of Connecticut, and Sharon V. Salinger, University of California, Irvine,"),
    ["Cornelia H. Dayton", "Sharon V. Salinger"],
  );
  assert.deepEqual(
    parseAuthors(
      "Brian K. Mitchell, University of Arkansas at Little Rock, Barrington S. Edwards, teacher/artist/publisher of comics and graphic media, and Nick Weldon, The Historic New Orleans Collection,",
    ),
    ["Brian K. Mitchell", "Barrington S. Edwards", "Nick Weldon"],
  );
});

test("throws loudly when the Past Winners toggle is missing", () => {
  assert.throws(
    () => parseOahPastWinners(oah, category("oah-ellis-w-hawley-prize"), "<html><body>403 Forbidden</body></html>"),
    /Past Winners/,
  );
});
