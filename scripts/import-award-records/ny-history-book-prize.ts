import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";
import { mergeOfficialAwardRows, nyHistoryOfficialRows } from "./official-recent-records";

const pageTitle = "New York Historical book prizes";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "new-york-historical-american-history-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "ny-history-american-history");
  if (!prize || !category) throw new Error("Missing new-york-historical-american-history-book-prize entry in sources/prizes.json");

  console.log(`Fetching New York Historical American History Book Prize list from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = mergeOfficialAwardRows(parseNyHistoryPrize(prize, category, wikitext), prize, nyHistoryOfficialRows);

  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("ny-history-book-prize.json", records, {
    importer: "scripts/import-award-records/ny-history-book-prize.ts",
    source: `MediaWiki historical section for "${pageTitle}" plus official New York Historical recent results`,
    notes: "The secondary table labels rows by publication year, so the importer adds one year to record the year in which the prize was presented. The 2025 and 2026 winners are replaced with official New York Historical records.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} New York Historical American History Book Prize records (${yearRange(records)}).`);
}

export function parseNyHistoryPrize(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = extractSection(wikitext);
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    if (!/^\*\s+\d{4}\s+/.test(line)) continue;
    const parsed = parseWinnerLine(line);
    if (!parsed) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: parsed.year + 1,
      status: "winner",
      title: parsed.title,
      authors: parsed.authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: [
        "Award year is one year after the publication year shown in the historical source.",
        category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      ].filter(Boolean).join(" "),
    });
  }

  return records;
}

function parseWinnerLine(line: string) {
  const withoutRefs = removeRefs(line);
  const match = withoutRefs.match(/^\*\s+(\d{4})\s+(.+?),\s+''(.+?)''/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const authors = normalizeAuthorList(wikiToPlainText(match[2]));
  const title = cleanText(wikiToPlainText(match[3]).replace(/^['" ]+|['" ]+$/g, ""));
  if (!year || !authors.length || !isLikelyTitle(title)) return undefined;

  return { year, title, authors };
}

function extractSection(wikitext: string) {
  const start = wikitext.indexOf("===Winners===");
  if (start < 0) throw new Error("Could not find New York Historical winners section");
  const next = wikitext.indexOf("\n==", start + 1);
  return wikitext.slice(start, next < 0 ? undefined : next);
}

function removeRefs(input: string) {
  return input
    .replace(/<ref\b[^>]*\/>/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 20) throw new Error(`Expected at least 20 New York Historical rows, got ${records.length}`);
  const years = records.map((record) => record.year);
  if (Math.min(...years) > 2006 || Math.max(...years) < 2026) {
    throw new Error(`Unexpected New York Historical year range: ${yearRange(records)}`);
  }
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
