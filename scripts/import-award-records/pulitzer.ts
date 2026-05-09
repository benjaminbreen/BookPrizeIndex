import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

type ParsedRow = {
  style: string;
  headers: string[];
  cells: string[];
  rawCells: string[];
};

type PartialRecord = Omit<RawAwardRecord, "status"> & { status: "winner" | "finalist" };

const categoryPageTitles: Record<string, string> = {
  "pulitzer-general-nonfiction": "Pulitzer Prize for General Nonfiction",
  "pulitzer-history": "Pulitzer Prize for History",
  "pulitzer-biography-or-autobiography": "Pulitzer Prize for Biography",
  "pulitzer-memoir-or-autobiography": "Pulitzer Prize for Memoir or Autobiography",
};

async function main() {
  const registry = await readPrizeRegistry();
  const pulitzer = registry.find((entry) => entry.id === "pulitzer-prize");
  if (!pulitzer) throw new Error("Missing pulitzer-prize entry in sources/prizes.json");

  const records: RawAwardRecord[] = [];
  const categoryReports = [];

  for (const category of pulitzer.categories) {
    const pageTitle = categoryPageTitles[category.id];
    if (!pageTitle) continue;
    console.log(`Fetching ${category.name} from ${pageTitle}...`);
    const wikitext = await fetchMediaWikiWikitext(pageTitle);
    const categoryRecords = parsePulitzerCategory(pulitzer, category, wikitext);
    records.push(...categoryRecords);
    categoryReports.push({
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: categoryRecords.length,
      winners: categoryRecords.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      finalists: categoryRecords.filter((record) => record.status === "finalist").length,
      yearRange: yearRange(categoryRecords),
    });
  }

  records.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("pulitzer.json", records, {
    importer: "scripts/import-award-records/pulitzer.ts",
    source: "MediaWiki wikitables for Pulitzer category pages",
    notes: "Pulitzer official pages are retained in sources/prizes.json, but this first importer uses Wikipedia as a deterministic secondary source because pulitzer.org blocks command-line fetches.",
    categories: categoryReports,
  });

  console.log(`Imported ${records.length} Pulitzer award records.`);
  for (const report of categoryReports) {
    console.log(`${report.categoryName}: ${report.records} records (${report.yearRange})`);
  }
}

export function parsePulitzerCategory(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const rows = extractWikitables(wikitext).flatMap(parseWikiTableRows);
  const partials: PartialRecord[] = [];

  let currentYear: number | undefined;
  let currentTitle = "";
  let currentPublisher = "";

  for (const row of rows) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    const rowYear = extractYear(row.cells[0]);
    const hasYear = rowYear !== undefined;
    if (hasYear) currentYear = rowYear;
    if (!currentYear) continue;

    const rowStatus = getRowStatus(row);
    const authorCell = getCellByHeader(row, "author");
    const rawAuthorCell = getRawCellByHeader(row, "author");
    const titleCell = getCellByHeader(row, "title") ?? getCellByHeader(row, "work") ?? getCellByHeader(row, "book");
    const publisherCell = getCellByHeader(row, "publisher");

    if (authorCell && titleCell) {
      const authors = normalizeAuthorList(authorCell);
      const title = cleanTitle(titleCell);
      const publisher = cleanPublisher(publisherCell ?? currentPublisher);
      if (!authors.length || !isLikelyTitle(title)) continue;
      currentTitle = title;
      currentPublisher = publisher;
      addOrMerge(partials, makeRecord(prize, category, currentYear, rowStatus, title, authors, publisher));
      continue;
    }

    if (authorCell && currentTitle && rawAuthorCell?.toLowerCase().includes("sortname")) {
      const authors = normalizeAuthorList(authorCell);
      if (authors.length) {
        addOrMerge(partials, makeRecord(prize, category, currentYear, rowStatus, currentTitle, authors, currentPublisher));
      }
    }
  }

  return normalizeCoWinners(partials);
}

function makeRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  status: "winner" | "finalist",
  title: string,
  authors: string[],
  publisher: string,
): PartialRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title,
    authors,
    publisher: publisher || undefined,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official category URL: ${category.officialUrl}` : undefined,
  };
}

function addOrMerge(records: PartialRecord[], record: PartialRecord) {
  const key = recordKey(record);
  const existing = records.find((item) => recordKey(item) === key);
  if (!existing) {
    records.push(record);
    return;
  }
  existing.authors = [...new Set([...existing.authors, ...record.authors])];
  if (!existing.publisher && record.publisher) existing.publisher = record.publisher;
}

function normalizeCoWinners(records: PartialRecord[]): RawAwardRecord[] {
  const winnersByCategoryYear = new Map<string, PartialRecord[]>();
  for (const record of records.filter((item) => item.status === "winner")) {
    const key = `${record.categoryId}:${record.year}`;
    winnersByCategoryYear.set(key, [...(winnersByCategoryYear.get(key) ?? []), record]);
  }

  return records.map((record) => {
    if (record.status !== "winner") return record;
    const winners = winnersByCategoryYear.get(`${record.categoryId}:${record.year}`) ?? [];
    const distinctWinningTitles = new Set(winners.map((item) => slugify(item.title)));
    return {
      ...record,
      status: distinctWinningTitles.size > 1 ? "co_winner" : "winner",
    };
  });
}

function recordKey(record: Pick<RawAwardRecord, "categoryId" | "year" | "status" | "title">) {
  return `${record.categoryId}:${record.year}:${record.status}:${slugify(record.title)}`;
}

function extractWikitables(wikitext: string) {
  const tables: string[] = [];
  const tablePattern = /\{\|\s*class="?wikitable/g;
  for (const match of wikitext.matchAll(tablePattern)) {
    const start = match.index;
    const end = wikitext.indexOf("\n|}", start);
    if (end !== -1) tables.push(wikitext.slice(start, end));
  }
  if (!tables.length) throw new Error("Could not find wikitable");
  return tables;
}

function parseWikiTableRows(table: string): ParsedRow[] {
  const headerLines: string[] = [];
  let sawHeader = false;
  for (const line of table.split("\n")) {
    if (line.startsWith("!")) {
      sawHeader = true;
      headerLines.push(line);
      continue;
    }
    if (sawHeader && line.startsWith("|-")) break;
  }
  const headers = headerLines
    .map((line) => wikiToPlainText(stripCellAttributes(line.replace(/^!\s*/, ""))).toLowerCase());

  return table
    .split(/\n\|-/)
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const style = lines.shift()?.trim() ?? "";
      const rawCells = parseCells(lines.join("\n"));
      return {
        style,
        headers,
        rawCells,
        cells: rawCells.map((cell) => wikiToPlainText(stripCellAttributes(cell))),
      };
    })
    .filter((row) => row.cells.length > 0);
}

function getRowStatus(row: ParsedRow) {
  const result = getCellByHeader(row, "result");
  if (result && /winner/i.test(result)) return "winner";
  if (result && /finalist/i.test(result)) return "finalist";
  return row.style.includes("lightyellow") ? "winner" : "finalist";
}

function getCellByHeader(row: ParsedRow, pattern: string) {
  const raw = getRawCellByHeader(row, pattern);
  return raw ? wikiToPlainText(stripCellAttributes(raw)) : undefined;
}

function getRawCellByHeader(row: ParsedRow, pattern: string) {
  const headerIndex = row.headers.findIndex((header) => header.includes(pattern));
  if (headerIndex < 1) return undefined;
  const hasYearCell = extractYear(wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""))) !== undefined;
  return row.rawCells[hasYearCell ? headerIndex : headerIndex - 1];
}

function parseCells(rowBody: string) {
  const cells: string[] = [];
  let current: string[] = [];

  for (const line of rowBody.split("\n")) {
    if (/^[!|]/.test(line)) {
      if (current.length) cells.push(current.join("\n"));
      current = [line.replace(/^[!|]\s*/, "")];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) cells.push(current.join("\n"));
  return cells.map((cell) => cell.trim()).filter(Boolean);
}

function extractYear(input: string) {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function cleanTitle(input: string) {
  return cleanText(input.replace(/^"(.+)"$/, "$1"));
}

function cleanPublisher(input: string) {
  return cleanText(input.replace(/\(.*?\)/g, ""));
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
