import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Margaret W. Rossiter History of Women in Science Prize";
const prizeId = "rossiter-prize";
const categoryId = "rossiter-history-of-women-in-science";

/**
 * Corrections for specific observed source defects, not substitutes for parsing.
 * - 2009 renders the subtitle break as a period rather than the published colon.
 * - 2017 wraps the publisher's series name inside the italics.
 */
const titleOverrides = new Map<string, string>([
  [
    "2009",
    "Making Women's Medicine Masculine: The Rise of Male Authority in Pre-Modern Gynaecology",
  ],
  [
    "2017",
    "Searching for Scientific Womanpower: Technocratic Feminism and the Politics of National Security, 1940-1980",
  ],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);

  console.log(`Fetching ${pageTitle} recipients from MediaWiki...`);
  const records = parseRossiter(prize, category, await fetchMediaWikiWikitext(pageTitle));
  assertCoverage(records);

  await writeRawAwardRecords("rossiter-prize.json", records, {
    importer: "scripts/import-award-records/rossiter-prize.ts",
    source: category.sourceLabel,
    notes:
      "The prize honours a book in odd-numbered years and an article in even-numbered years; " +
      "only the book years are imported. Book rows are identified by an italic marker anchored " +
      "at the very start of the Work cell — article rows also contain italics, but only for the " +
      "container volume or journal. The importer throws if the anchored-italics signal and the " +
      "odd-year rule ever disagree. The official HSS archive blocks automated fetching (HTTP 403), " +
      `so the cited Wikipedia table is used. Official archive: ${category.officialUrl ?? "https://hssonline.org/page/rossiter"}`,
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    yearRange: yearRange(records),
    coverageNotes: "Winner-only. Even-year article awards are intentionally excluded.",
  });
  console.log(`Imported ${records.length} Rossiter Prize book winners (${yearRange(records)}).`);
}

export function parseRossiter(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "Recipients", "See also");
  const table = section.match(/\{\|\s*class="wikitable"([\s\S]*?)\n\|\}/);
  if (!table) throw new Error("Could not find the Rossiter recipients wikitable");

  const records: RawAwardRecord[] = [];

  for (const block of table[1].split(/^\s*\|-\s*$/m)) {
    const cells = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      .map((line) => line.slice(1).trim());
    if (cells.length < 3) continue;

    const year = Number(cells[0]);
    if (!Number.isInteger(year)) continue;

    const workCell = stripRefs(cells[2]).trim();
    // THE DISCRIMINATOR: a book's Work cell *starts* with italics. Article rows italicise a
    // container volume or journal mid-cell, so an unanchored "''" search would accept them.
    const looksLikeBook = workCell.startsWith("''");
    const isBookYear = year % 2 === 1;
    if (looksLikeBook !== isBookYear) {
      throw new Error(
        `Rossiter ${year}: italic-anchor signal (${looksLikeBook}) disagrees with the odd-year book rule (${isBookYear}): ${workCell}`,
      );
    }
    if (!isBookYear) continue;

    const authors = normalizeAuthorList(cleanText(wikiToPlainText(stripRefs(cells[1]))));
    if (!authors.length) throw new Error(`No authors parsed for Rossiter ${year}: ${cells[1]}`);

    const italic = workCell.slice(2).match(/^([\s\S]*?)''/)?.[1];
    if (italic === undefined) throw new Error(`Unterminated italic title for Rossiter ${year}: ${workCell}`);
    const title = titleOverrides.get(String(year))
      ?? cleanText(wikiToPlainText(italic)).replace(/[.,\s]+$/, "");
    if (!title) throw new Error(`No title parsed for Rossiter ${year}: ${workCell}`);

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "winner",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official archive: ${category.officialUrl}` : undefined,
    });
  }

  return markSharedYears(records).sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
}

function stripRefs(value: string) {
  // Paired refs plus the self-closing form (<ref name=":0" />) used on the 2023 row.
  return value.replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<ref[^>]*\/>/gi, "");
}

function markSharedYears(records: RawAwardRecord[]) {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  return records.map((record) => ({
    ...record,
    status: counts.get(record.year)! > 1 ? "co_winner" as const : "winner" as const,
  }));
}

function sectionBetween(wikitext: string, startLabel: string, endLabel: string) {
  const start = wikitext.search(new RegExp(`^==\\s*${startLabel}\\s*==\\s*$`, "mi"));
  const end = wikitext.search(new RegExp(`^==\\s*${endLabel}\\s*==\\s*$`, "mi"));
  if (start < 0 || end <= start) throw new Error(`Could not find ${startLabel} section`);
  return wikitext.slice(start, end);
}

export function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== 20) throw new Error(`Expected exactly 20 Rossiter book records, got ${records.length}`);
  if (yearRange(records) !== "1987-2025") throw new Error(`Unexpected Rossiter range: ${yearRange(records)}`);
  const years = records.map((record) => record.year).sort((a, b) => a - b);
  if (new Set(years).size !== 20) throw new Error("Rossiter years are not distinct");
  for (const year of years) {
    if (year % 2 !== 1) throw new Error(`Rossiter book year ${year} is not odd`);
  }
  for (let index = 1; index < years.length; index += 1) {
    if (years[index] - years[index - 1] !== 2) {
      throw new Error(`Gap in Rossiter odd years between ${years[index - 1]} and ${years[index]}`);
    }
  }
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
