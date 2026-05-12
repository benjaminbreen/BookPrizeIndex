import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const sourceUrl = "https://www.hillmanfoundation.org/hillman-prizes/us/honorees";
const titleFixups = new Map<string, string>([
  ["2026:Michelle Adams", "The Containment: Detroit, the Supreme Court, and the Battle for Racial Justice in the North"],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "hillman-prize-book-journalism");
  const category = prize?.categories.find((entry) => entry.id === "hillman-book-journalism");
  if (!prize || !category) throw new Error("Missing hillman-prize-book-journalism registry entry in sources/prizes.json");

  console.log(`Fetching Hillman previous honorees from ${sourceUrl}...`);
  const html = await fetchHtml(sourceUrl);
  const records = parseHillmanBookRows(prize, category, html);

  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("hillman-book-journalism.json", records, {
    importer: "scripts/import-award-records/hillman-book-journalism.ts",
    source: "Official Hillman Prize previous-honorees table",
    notes: "Importer keeps only U.S. Hillman rows whose category is Book. Multiple Book honorees in the same year are normalized to co_winner.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      coWinners: records.filter((record) => record.status === "co_winner").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Hillman Book Journalism records (${yearRange(records)}).`);
}

export function parseHillmanBookRows(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  input: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  const tableRows = input.split("\n").filter((line) => /^\|\s*\d{4}\s*\|/.test(line));

  if (!tableRows.length && /<tr\b/i.test(input)) {
    return parseHillmanBookHtmlRows(prize, category, input);
  }

  for (const row of tableRows) {
    const cells = splitMarkdownTableRow(row);
    if (cells.length < 5 || cells[1] !== "Book") continue;

    const year = Number(cells[0]);
    const authors = normalizeAuthorList(stripMarkdownLinks(cells[2]));
    const title = titleFixups.get(`${year}:${stripMarkdownLinks(cells[2])}`) ?? cleanTitle(stripMarkdownLinks(cells[3]));
    const publisher = cleanOptional(stripMarkdownLinks(cells[4]));
    const rowSourceUrl = extractFirstMarkdownLink(cells[2]) ?? category.sourceUrl;

    if (!year || !authors.length || !isLikelyTitle(title)) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "winner",
      title,
      authors,
      publisher,
      sourceUrl: rowSourceUrl,
      sourceLabel: `${category.sourceLabel}: ${year}`,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  const winnersByYear = new Map<number, number>();
  for (const record of records) winnersByYear.set(record.year, (winnersByYear.get(record.year) ?? 0) + 1);
  for (const record of records) {
    if ((winnersByYear.get(record.year) ?? 0) > 1) record.status = "co_winner";
  }

  return records;
}

function parseHillmanBookHtmlRows(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(html))) {
    const cells = extractHtmlCells(rowMatch[1]);
    if (cells.category !== "Book") continue;

    const year = Number(cells.year);
    const authors = normalizeAuthorList(cells.honoree ?? "");
    const title = titleFixups.get(`${year}:${cells.honoree}`) ?? cleanTitle(cells.title ?? "");
    const publisher = cleanOptional(cells.publisher ?? "");
    const rowSourceUrl = cells.honoreeUrl ?? category.sourceUrl;

    if (!year || !authors.length || !isLikelyTitle(title)) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "winner",
      title,
      authors,
      publisher,
      sourceUrl: rowSourceUrl,
      sourceLabel: `${category.sourceLabel}: ${year}`,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  const winnersByYear = new Map<number, number>();
  for (const record of records) winnersByYear.set(record.year, (winnersByYear.get(record.year) ?? 0) + 1);
  for (const record of records) {
    if ((winnersByYear.get(record.year) ?? 0) > 1) record.status = "co_winner";
  }

  return records;
}

function extractHtmlCells(rowHtml: string) {
  const cells: {
    year?: string;
    category?: string;
    honoree?: string;
    honoreeUrl?: string;
    title?: string;
    publisher?: string;
  } = {};
  const cellPattern = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let cellMatch: RegExpExecArray | null;

  while ((cellMatch = cellPattern.exec(rowHtml))) {
    const attrs = cellMatch[1];
    const html = cellMatch[2];
    const className = attrs.match(/class="([^"]*)"/)?.[1] ?? "";
    if (className.includes("views-field-field-year")) cells.year = htmlToText(html);
    else if (className.includes("views-field-field-category")) cells.category = htmlToText(html);
    else if (className.includes("views-field-field-honoree")) {
      cells.honoree = htmlToText(html);
      const href = html.match(/<a\b[^>]*href="([^"]+)"/i)?.[1];
      if (href) cells.honoreeUrl = new URL(decodeHtml(href), sourceUrl).toString();
    } else if (className.includes("views-field-title")) cells.title = htmlToText(html);
    else if (className.includes("views-field-field-publisher-airer")) cells.publisher = htmlToText(html);
  }

  return cells;
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`Hillman request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

function splitMarkdownTableRow(row: string) {
  return row
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cleanText(cell));
}

function stripMarkdownLinks(input: string) {
  return cleanText(input.replace(/\[([^\]]+)]\([^)]*\)/g, "$1"));
}

function extractFirstMarkdownLink(input: string) {
  const match = input.match(/\[[^\]]+]\(([^)]*)\)/);
  return match ? match[1] : undefined;
}

function cleanTitle(input: string) {
  return cleanText(input.replace(/^["“”]+|["“”]+$/g, ""));
}

function cleanOptional(input: string) {
  const value = cleanText(input);
  return value || undefined;
}

function htmlToText(input: string) {
  return cleanText(decodeHtml(input.replace(/<[^>]+>/g, " ")));
}

function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 70) throw new Error(`Expected at least 70 Hillman Book rows, got ${records.length}`);
  const years = records.map((record) => record.year);
  if (Math.min(...years) > 1950 || Math.max(...years) < 2025) {
    throw new Error(`Unexpected Hillman year range: ${yearRange(records)}`);
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
