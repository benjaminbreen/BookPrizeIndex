import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "RBC Taylor Prize";

const expectedYears = [2000, 2002, ...Array.from({ length: 17 }, (_, index) => 2004 + index)];
const expectedRecordCount = 89;
const expectedWinnerCount = 19;

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "rbc-taylor-prize");
  const category = prize?.categories.find((entry) => entry.id === "rbc-taylor-nonfiction");
  if (!prize || !category) throw new Error("Missing RBC Taylor Prize registry entry");

  console.log(`Fetching ${pageTitle} records from MediaWiki...`);
  const records = parseRbcTaylorPrize(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  assertCoverage(records);

  await writeRawAwardRecords("rbc-taylor-prize.json", records, {
    importer: "scripts/import-award-records/rbc-taylor-prize.ts",
    source: category.sourceLabel,
    notes:
      "Imports winners and finalists from the deterministic secondary table. The official rbctaylorprize.ca domain has lapsed and now redirects to an unrelated site, so the prize archive cannot be re-verified against a primary source and confidence stays secondary. The separate RBC Taylor Emerging Writer Award (for unpublished writers) is excluded.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    finalists: records.filter((record) => record.status === "finalist").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} RBC Taylor Prize records (${yearRange(records)}).`);
}

export function parseRbcTaylorPrize(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "==Winners and nominees==", "==RBC Taylor Emerging Writer Award==");
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

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== expectedRecordCount) {
    throw new Error(`RBC Taylor import expected ${expectedRecordCount} records but parsed ${records.length}.`);
  }

  const winners = records.filter((record) => record.status === "winner");
  if (winners.length !== expectedWinnerCount) {
    throw new Error(`RBC Taylor import expected ${expectedWinnerCount} winners but parsed ${winners.length}.`);
  }

  const parsedYears = Array.from(new Set(records.map((record) => record.year))).sort((a, b) => a - b);
  if (parsedYears.join(",") !== expectedYears.join(",")) {
    throw new Error(
      `RBC Taylor import expected editions ${expectedYears.join(", ")} but parsed ${parsedYears.join(", ")}.`,
    );
  }

  const badWinnerYears = expectedYears.filter(
    (year) => winners.filter((record) => record.year === year).length !== 1,
  );
  if (badWinnerYears.length) {
    throw new Error(`RBC Taylor import expected exactly one winner per edition; wrong for ${badWinnerYears.join(", ")}.`);
  }
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
