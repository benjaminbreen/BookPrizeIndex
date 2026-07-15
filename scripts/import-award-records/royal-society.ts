import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "Royal Society Science Book Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "royal-society-science-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "royal-society-science");
  if (!prize || !category) throw new Error("Missing royal-society-science-book-prize registry entry in sources/prizes.json");

  console.log(`Fetching ${pageTitle} records from MediaWiki...`);
  const records = parseRoyalSociety(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("royal-society.json", records, {
    importer: "scripts/import-award-records/royal-society.ts",
    source: category.sourceLabel,
    notes: "Imports winners and shortlisted books from the deterministic Wikipedia table; official Royal Society pages are retained in registry metadata for later verification.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      shortlisted: records.filter((record) => record.status === "shortlist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Royal Society Science Book Prize records (${yearRange(records)}).`);
}

export function parseRoyalSociety(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "==Shortlisted books==", "== References ==");
  return parseAwardRowsFromWikitable(section)
    .filter((row) => isLikelyTitle(row.title))
    .flatMap(splitMergedShortlistRow)
    .map((row) => ({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: row.year,
      status: statusFromResult(row.result),
      title: row.title,
      authors: normalizeAuthorList(row.author),
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    }))
    .filter((record) => record.status === "winner" || record.status === "shortlist");
}

function splitMergedShortlistRow<T extends { title: string; author: string }>(row: T): T[] {
  const match = row.title.match(/^(.*?)\s+and\s+((?:[A-Z][\p{L}.'’-]+\s+){2,4})for\s+(.+)$/u);
  if (!match) return [row];
  return [
    { ...row, title: match[1].trim() },
    { ...row, title: match[3].trim(), author: match[2].trim() },
  ];
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
