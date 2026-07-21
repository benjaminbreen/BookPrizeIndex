import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "Hilary Weston Writers' Trust Prize for Nonfiction";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "hilary-weston-writers-trust-prize");
  const category = prize?.categories.find((entry) => entry.id === "hilary-weston-nonfiction");
  if (!prize || !category) throw new Error("Missing Hilary Weston Writers' Trust Prize registry entry");

  console.log(`Fetching ${pageTitle} records from MediaWiki...`);
  const records = parseHilaryWeston(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("hilary-weston.json", records, {
    importer: "scripts/import-award-records/hilary-weston.ts",
    source: category.sourceLabel,
    notes: "Imports winners and finalists from the deterministic secondary table because the official archive is protected by an automated-access checkpoint. The official archive remains linked in registry metadata.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    finalists: records.filter((record) => record.status === "finalist" || record.status === "shortlist").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Hilary Weston Prize records (${yearRange(records)}).`);
}

export function parseHilaryWeston(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "==Nominees and winners==", "==Weston International Award==");
  return parseAwardRowsFromWikitable(section)
    .filter((row) => isLikelyTitle(row.title))
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
      notes: category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
    }))
    .filter((record) => record.status !== "unknown");
}

function sectionBetween(input: string, startMarker: string, endMarker: string) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start: ${startMarker}`);
  const end = input.indexOf(endMarker, start);
  return input.slice(start, end > start ? end : undefined);
}

function statusFromResult(result: string): RawAwardRecordStatus {
  if (/winner/i.test(result)) return "winner";
  if (/finalist/i.test(result)) return "finalist";
  if (/shortlist/i.test(result)) return "shortlist";
  return "unknown";
}

function statusSort(status: RawAwardRecordStatus) {
  if (status === "winner") return 1;
  if (status === "finalist" || status === "shortlist") return 2;
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
