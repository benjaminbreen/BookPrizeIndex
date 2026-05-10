import { pathToFileURL } from "node:url";
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
  rawCells: string[];
  cells: string[];
};

type PartialRecord = Omit<RawAwardRecord, "status"> & { status: "winner" | "finalist" };

const pageTitle = "Kirkus Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "kirkus-prize");
  const category = prize?.categories.find((entry) => entry.id === "kirkus-nonfiction");
  if (!prize || !category) throw new Error("Missing kirkus-prize registry entry in sources/prizes.json");

  console.log(`Fetching Kirkus nonfiction table from ${pageTitle}...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseKirkusNonfiction(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("kirkus.json", records, {
    importer: "scripts/import-award-records/kirkus.ts",
    source: "MediaWiki wikitable for Kirkus Prize nonfiction winners and finalists",
    notes: "The official Kirkus prize page is retained in sources/prizes.json, but this first importer uses Wikipedia as a deterministic secondary source.",
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

  console.log(`Imported ${records.length} Kirkus nonfiction records.`);
  console.log(`${category.name}: ${records.length} records (${yearRange(records)})`);
}

export function parseKirkusNonfiction(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const nonfictionTable = extractWikitables(wikitext).find((table) => /Kirkus Prize for Nonfiction winners and finalists/i.test(table));
  if (!nonfictionTable) throw new Error("Could not find Kirkus nonfiction table");

  const partials: PartialRecord[] = [];
  let currentYear: number | undefined;
  let currentResult: "winner" | "finalist" | undefined;

  for (const row of parseWikiTableRows(nonfictionTable)) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    const mapped = mapCells(row);
    const rowYear = extractYear(mapped.year ?? "");
    if (rowYear) currentYear = rowYear;
    if (!currentYear) continue;

    const rowStatus = getRowStatus(row, mapped.result);
    if (rowStatus) currentResult = rowStatus;
    if (!currentResult) continue;

    const authors = normalizeAuthorList(cleanAuthorCell(mapped.authorRaw ?? mapped.author ?? ""));
    const title = cleanTitle(mapped.title ?? "");
    if (!authors.length || !isLikelyTitle(title)) continue;

    addOrMerge(partials, {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: currentResult,
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  return normalizeCoWinners(partials);
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
  const headers = headerLines.flatMap(parseCells).map((cell) => wikiToPlainText(stripCellAttributes(cell)).toLowerCase());

  return table
    .split(/\n\|-/)
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const firstLine = lines.shift() ?? "";
      const style = /^[!|]/.test(firstLine) ? "" : firstLine.trim();
      if (!style) lines.unshift(firstLine);
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

function parseCells(rowBody: string) {
  const cells: string[] = [];
  let current: string[] = [];

  for (const rawLine of rowBody.split("\n")) {
    const line = rawLine.trimEnd();
    if (!/^[!|]/.test(line)) {
      if (current.length) current.push(line);
      continue;
    }

    if (current.length) cells.push(current.join("\n"));
    current = [];

    const marker = line.startsWith("!") ? "!" : "|";
    const delimiter = marker === "!" ? "!!" : "||";
    const content = line.replace(/^[!|]\s*/, "");
    const inlineCells = content.split(new RegExp(`\\s*${escapeRegExp(delimiter)}\\s*`)).map((cell) => cell.trim()).filter(Boolean);
    current = [inlineCells.shift() ?? ""];
    for (const cell of inlineCells) {
      cells.push(current.join("\n"));
      current = [cell];
    }
  }
  if (current.length) cells.push(current.join("\n"));
  return cells.map((cell) => cell.trim()).filter(Boolean);
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapCells(row: ParsedRow) {
  const hasYear = extractYear(wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""))) !== undefined;
  const missingLeadingCells = hasYear ? 0 : 1;
  return {
    year: readMappedCell(row, "year", missingLeadingCells),
    authorRaw: readRawMappedCell(row, "author", missingLeadingCells),
    author: readMappedCell(row, "author", missingLeadingCells),
    title: readMappedCell(row, "book", missingLeadingCells),
    result: readResultCell(row, missingLeadingCells),
  };
}

function readRawMappedCell(row: ParsedRow, headerPattern: string, missingLeadingCells: number) {
  const headerIndex = row.headers.findIndex((header) => header.includes(headerPattern));
  if (headerIndex < 0) return undefined;
  const rawIndex = headerIndex - missingLeadingCells;
  if (rawIndex < 0 || rawIndex >= row.rawCells.length) return undefined;
  return stripCellAttributes(row.rawCells[rawIndex]);
}

function readMappedCell(row: ParsedRow, headerPattern: string, missingLeadingCells: number) {
  const headerIndex = row.headers.findIndex((header) => header.includes(headerPattern));
  if (headerIndex < 0) return undefined;
  const rawIndex = headerIndex - missingLeadingCells;
  if (rawIndex < 0 || rawIndex >= row.rawCells.length) return undefined;
  return wikiToPlainText(stripCellAttributes(row.rawCells[rawIndex]));
}

function readResultCell(row: ParsedRow, missingLeadingCells: number) {
  const mapped = readMappedCell(row, "result", missingLeadingCells);
  return isResultValue(mapped) ? mapped : row.cells.find(isResultValue);
}

function isResultValue(input?: string) {
  return Boolean(input && /^(?:winner|finalist)$/i.test(input));
}

function extractYear(input: string) {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function getRowStatus(row: ParsedRow, result?: string): "winner" | "finalist" | undefined {
  if (result && /winner/i.test(result)) return "winner";
  if (result && /finalist/i.test(result)) return "finalist";
  if (/background\s*:\s*lightyellow/i.test(row.style)) return "winner";
  return undefined;
}

function cleanAuthorCell(input: string) {
  const withoutTranslatorLines = input
    .split(/<br\s*\/?>/i)
    .filter((part) => !/\b(?:translator|tr\.)\b/i.test(part))
    .join(" ");
  return cleanText(wikiToPlainText(withoutTranslatorLines).replace(/\s*\([^)]*(?:translator|tr\.)[^)]*\)\s*/gi, " "));
}

function cleanTitle(input: string) {
  return cleanText(input.replace(/^"(.+)"$/, "$1"));
}

function addOrMerge(records: PartialRecord[], record: PartialRecord) {
  const key = recordKey(record);
  const existing = records.find((item) => recordKey(item) === key);
  if (!existing) {
    records.push(record);
    return;
  }
  existing.authors = [...new Set([...existing.authors, ...record.authors])];
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
