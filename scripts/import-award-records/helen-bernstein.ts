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

const pageTitle = "Helen Bernstein Book Award for Excellence in Journalism";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "helen-bernstein-book-award");
  const category = prize?.categories.find((entry) => entry.id === "helen-bernstein-journalism");
  if (!prize || !category) throw new Error("Missing helen-bernstein-book-award entry in sources/prizes.json");

  console.log(`Fetching Helen Bernstein page from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseHelenBernsteinList(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("helen-bernstein.json", records, {
    importer: "scripts/import-award-records/helen-bernstein.ts",
    source: `MediaWiki bullet list for "${pageTitle}"`,
    notes: "Initial importer uses Wikipedia as a deterministic secondary source. The first two historical honorees were not book records and are intentionally skipped. Nested nominee bullets are normalized to finalist status.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      finalists: records.filter((record) => record.status === "finalist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Helen Bernstein records (${yearRange(records)}).`);
}

export function parseHelenBernsteinList(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  let currentYear: number | undefined;

  for (const rawLine of wikitext.split("\n")) {
    const line = rawLine.trim();
    if (/^\*\s+\d{4}/.test(line)) {
      const parsed = parseWinnerLine(line);
      currentYear = parsed?.year;
      if (parsed) records.push(toRecord(prize, category, parsed.year, "winner", parsed.title, parsed.authors));
      continue;
    }

    if (/^\*\*\s+/.test(line) && currentYear) {
      const parsed = parseFinalistLine(line);
      if (parsed) records.push(toRecord(prize, category, currentYear, "finalist", parsed.title, parsed.authors));
    }
  }

  return normalizeCoWinners(records);
}

function parseWinnerLine(line: string) {
  const withoutRefs = removeRefs(line);
  const year = Number(withoutRefs.match(/^\*\s+(\d{4})/)?.[1]);
  const afterDash = withoutRefs.split(/\s+[–-]\s+/).slice(1).join(" - ");
  if (!year || !afterDash || !/''/.test(afterDash)) return undefined;

  const [authorRaw, titleRaw] = splitWinnerAuthorAndTitle(afterDash);
  const title = parseTitle(titleRaw);
  const authors = parseAuthors(authorRaw);
  if (!authors.length || !isLikelyTitle(title)) return undefined;

  return { year, title, authors };
}

function parseFinalistLine(line: string) {
  const withoutRefs = removeRefs(line.replace(/^\*\*\s+/, ""));
  const byMatch = withoutRefs.match(/^(.+?)\s+by\s+(.+)$/i);
  if (!byMatch) return undefined;

  const title = parseTitle(byMatch[1]);
  const authors = parseAuthors(byMatch[2]);
  if (!authors.length || !isLikelyTitle(title)) return undefined;

  return { title, authors };
}

function splitWinnerAuthorAndTitle(input: string) {
  const marker = input.match(/\s+for\s+/i);
  if (!marker || marker.index === undefined) return ["", input];
  return [input.slice(0, marker.index), input.slice(marker.index + marker[0].length)];
}

function parseTitle(input: string) {
  const plain = wikiToPlainText(input)
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/^['" ]+|['" ]+$/g, "")
    .replace(/''/g, "");
  return cleanText(plain);
}

function parseAuthors(input: string) {
  return normalizeAuthorList(wikiToPlainText(input))
    .map((author) => author === "Mix Hixenbaugh" ? "Mike Hixenbaugh" : author)
    .filter(Boolean);
}

function removeRefs(input: string) {
  return input
    .replace(/<ref\b[^>]*\/>/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "");
}

function toRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  status: Extract<RawAwardRecordStatus, "winner" | "finalist">,
  title: string,
  authors: string[],
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title,
    authors,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
  };
}

function normalizeCoWinners(records: RawAwardRecord[]): RawAwardRecord[] {
  const winnerCountsByYear = new Map<number, number>();
  for (const record of records.filter((item) => item.status === "winner")) {
    winnerCountsByYear.set(record.year, (winnerCountsByYear.get(record.year) ?? 0) + 1);
  }
  return records.map((record) => record.status === "winner" && (winnerCountsByYear.get(record.year) ?? 0) > 1
    ? { ...record, status: "co_winner" }
    : record);
}

function statusSort(status: RawAwardRecordStatus): number {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist") return 2;
  return 9;
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 60) throw new Error(`Expected at least 60 Helen Bernstein rows, got ${records.length}`);
  const winners = records.filter((record) => record.status === "winner" || record.status === "co_winner");
  if (winners.length < 35) throw new Error(`Expected at least 35 Helen Bernstein winners, got ${winners.length}`);
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
