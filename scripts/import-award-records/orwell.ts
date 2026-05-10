import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "Orwell Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "orwell-prize");
  const category = prize?.categories.find((entry) => entry.id === "orwell-political-writing");
  if (!prize || !category) throw new Error("Missing orwell-prize registry entry in sources/prizes.json");

  console.log(`Fetching ${pageTitle} Political Writing records from MediaWiki...`);
  const records = parseOrwell(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("orwell.json", records, {
    importer: "scripts/import-award-records/orwell.ts",
    source: category.sourceLabel,
    notes: "Imports only the nonfiction-specific Political Writing category from 2019 onward. The older combined book category is excluded because it mixes fiction and nonfiction.",
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

  console.log(`Imported ${records.length} Orwell Prize Political Writing records (${yearRange(records)}).`);
}

export function parseOrwell(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "===The Orwell Prize for Political Writing", "===Combined book category");
  return parseAwardRowsFromWikitable(section)
    .filter((row) => row.year >= 2019 && isLikelyTitle(row.title))
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
