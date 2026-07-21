import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "Orwell Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "orwell-prize");
  const politicalWriting = prize?.categories.find((entry) => entry.id === "orwell-political-writing");
  const combinedBook = prize?.categories.find((entry) => entry.id === "orwell-combined-book");
  if (!prize || !politicalWriting || !combinedBook) {
    throw new Error("Missing orwell-prize registry categories in sources/prizes.json");
  }

  console.log(`Fetching ${pageTitle} book records from MediaWiki...`);
  const records = parseOrwell(prize, politicalWriting, combinedBook, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("orwell.json", records, {
    importer: "scripts/import-award-records/orwell.ts",
    source: politicalWriting.sourceLabel,
    notes: "Imports Political Writing from 2019 onward and nonfiction works from the combined 1994-2018 book category. Six explicitly reviewed fiction works are excluded from the combined-category table.",
    categories: [politicalWriting, combinedBook].map((category) => {
      const categoryRecords = records.filter((record) => record.categoryId === category.id);
      return {
        categoryId: category.id,
        categoryName: category.name,
        sourceUrl: category.sourceUrl,
        records: categoryRecords.length,
        winners: categoryRecords.filter((record) => record.status === "winner").length,
        shortlisted: categoryRecords.filter((record) => record.status === "shortlist").length,
        yearRange: yearRange(categoryRecords),
      };
    }),
  });

  console.log(`Imported ${records.length} Orwell Prize book records (${yearRange(records)}).`);
}

const reviewedFictionTitles = new Set([
  "Brick Lane",
  "Moses, Citizen and Me",
  "Two Caravans",
  "An Elegy for Easterly",
  "The Betrayal",
  "Winter",
].map(slugify));

export function parseOrwell(
  prize: PrizeRegistryEntry,
  politicalWriting: PrizeCategoryRegistryEntry,
  combinedBook: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const currentSection = sectionBetween(wikitext, "===The Orwell Prize for Political Writing", "===Combined book category");
  let combinedSection = sectionBetween(wikitext, "===Combined book category", "===The Orwell Prize for Journalism");
  // The secondary table currently repeats 2003 and 2004 for the 2005 and 2006 groups.
  // Anchor the correction to the corresponding winner rows so upstream changes fail visibly.
  combinedSection = combinedSection
    .replace(/(! rowspan="6" \|)2003(?=\n\|\{\{Sortname\|last=Collins)/, (_match, prefix: string) => `${prefix}2005`)
    .replace(/(! rowspan="6" \|)2004(?=\n\|\{\{Sortname\|last=Jarrett-Macauley)/, (_match, prefix: string) => `${prefix}2006`);

  const current = rowsToRecords(prize, politicalWriting, parseAwardRowsFromWikitable(currentSection))
    .filter((record) => record.year >= 2019);
  const historical = rowsToRecords(prize, combinedBook, parseAwardRowsFromWikitable(combinedSection))
    .filter((record) => record.year <= 2018 && !reviewedFictionTitles.has(slugify(record.title)))
    .map((record) => ({
      ...record,
      notes: [record.notes, "The pre-2019 Book Prize accepted both fiction and nonfiction; this record was reviewed as nonfiction."]
        .filter(Boolean)
        .join(" "),
    }));
  return [...current, ...historical];
}

function rowsToRecords(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  rows: ReturnType<typeof parseAwardRowsFromWikitable>,
) {
  return rows
    .filter((row) => isLikelyTitle(row.title))
    .map((row) => ({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: row.year,
      status: statusFromResult(row.result),
      title: normalizeOrwellTitle(row.title),
      authors: normalizeAuthorList(row.author),
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    }))
    .filter((record) => record.status === "winner" || record.status === "shortlist");
}

function normalizeOrwellTitle(title: string) {
  // Correct a one-character transcription error in the secondary table.
  if (title === "t's Our Turn to Eat: The Story of a Kenyan Whistle Blower") {
    return "It's Our Turn to Eat: The Story of a Kenyan Whistle Blower";
  }
  return title;
}

function sectionBetween(input: string, startMarker: string, endMarker: string) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start: ${startMarker}`);
  const end = input.indexOf(endMarker, start);
  return input.slice(start, end > start ? end : undefined);
}

function statusFromResult(result: string): RawAwardRecordStatus {
  if (/winner/i.test(result)) return "winner";
  if (/finalist|shortlist/i.test(result)) return "shortlist";
  return "unknown";
}

function statusSort(status: RawAwardRecordStatus) {
  if (status === "winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
