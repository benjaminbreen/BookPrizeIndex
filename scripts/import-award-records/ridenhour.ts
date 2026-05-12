import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "The Ridenhour Prizes";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "ridenhour-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "ridenhour-book");
  if (!prize || !category) throw new Error("Missing ridenhour-book-prize entry in sources/prizes.json");

  console.log(`Fetching Ridenhour Book Prize list from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseRidenhourBookPrize(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("ridenhour.json", records, {
    importer: "scripts/import-award-records/ridenhour.ts",
    source: `MediaWiki section for "${pageTitle}"`,
    notes: "Initial importer uses Wikipedia as a deterministic secondary source and keeps only the Ridenhour Book Prize section.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Ridenhour Book Prize records (${yearRange(records)}).`);
}

export function parseRidenhourBookPrize(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = extractSection(wikitext, "=== The Ridenhour Book Prize ===");
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    if (!/^\*\s+\d{4}:/.test(line)) continue;
    const parsed = parseBookPrizeLine(line);
    if (!parsed) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: parsed.year,
      status: "winner",
      title: parsed.title,
      authors: parsed.authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  return normalizeCoWinners(records);
}

function parseBookPrizeLine(line: string) {
  const withoutRefs = removeRefs(line);
  const match = withoutRefs.match(/^\*\s+(\d{4}):\s+(.+?)\s*,?\s+for\s+(.+)$/i);
  if (!match) return undefined;

  const year = Number(match[1]);
  const authors = normalizeAuthorList(wikiToPlainText(match[2]));
  const title = parseTitle(match[3]);
  if (!year || !authors.length || !isLikelyTitle(title)) return undefined;

  return { year, title, authors };
}

function extractSection(wikitext: string, heading: string) {
  const start = wikitext.indexOf(heading);
  if (start < 0) throw new Error(`Could not find section ${heading}`);
  const next = wikitext.indexOf("\n===", start + heading.length);
  return wikitext.slice(start, next < 0 ? undefined : next);
}

function parseTitle(input: string) {
  const plain = wikiToPlainText(input)
    .replace(/,\s*$/, "")
    .replace(/^['" ]+|['" ]+$/g, "")
    .replace(/''/g, "");
  return cleanText(plain);
}

function removeRefs(input: string) {
  return input
    .replace(/<ref\b[^>]*\/>/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "");
}

function normalizeCoWinners(records: RawAwardRecord[]): RawAwardRecord[] {
  const winnerCountsByYear = new Map<number, number>();
  for (const record of records) winnerCountsByYear.set(record.year, (winnerCountsByYear.get(record.year) ?? 0) + 1);
  return records.map((record) => (winnerCountsByYear.get(record.year) ?? 0) > 1
    ? { ...record, status: "co_winner" as RawAwardRecordStatus }
    : record);
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 20) throw new Error(`Expected at least 20 Ridenhour Book Prize rows, got ${records.length}`);
  const years = records.map((record) => record.year);
  if (Math.min(...years) > 2004 || Math.max(...years) < 2024) {
    throw new Error(`Unexpected Ridenhour year range: ${yearRange(records)}`);
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
