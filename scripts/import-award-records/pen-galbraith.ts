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

const pageTitle = "PEN/John Kenneth Galbraith Award for Nonfiction";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "pen-galbraith-award");
  const category = prize?.categories.find((entry) => entry.id === "pen-galbraith-nonfiction");
  if (!prize || !category) throw new Error("Missing pen-galbraith-award registry entry in sources/prizes.json");

  console.log(`Fetching PEN/Galbraith table from ${pageTitle}...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parsePenGalbraith(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("pen-galbraith.json", records, {
    importer: "scripts/import-award-records/pen-galbraith.ts",
    source: "MediaWiki wikitable for PEN/John Kenneth Galbraith Award winners, runners-up, and finalists",
    notes: "The official PEN America award page is retained in sources/prizes.json, but this first importer uses Wikipedia as a deterministic secondary source. Runner-up rows are normalized to finalist status.",
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

  console.log(`Imported ${records.length} PEN/Galbraith records.`);
  console.log(`${category.name}: ${records.length} records (${yearRange(records)})`);
}

export function parsePenGalbraith(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const table = extractWikitables(wikitext).find((candidate) => /Award winners, runner-ups, and finalists/i.test(candidate));
  if (!table) throw new Error("Could not find PEN/Galbraith honorees table");

  const partials: PartialRecord[] = [];
  let currentYear: number | undefined;

  for (const row of parseWikiTableRows(table)) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    const mapped = mapCells(row);
    const rowYear = extractYear(mapped.year ?? "");
    if (rowYear) currentYear = rowYear;
    if (!currentYear) continue;

    const status = getRowStatus(mapped.resultRaw ?? mapped.result);
    if (!status) continue;

    const authors = normalizeAuthorList(cleanAuthorCell(mapped.authorRaw ?? mapped.author ?? ""));
    const title = cleanTitle(mapped.title ?? "");
    if (!authors.length || !isLikelyTitle(title)) continue;

    addOrMerge(partials, {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status,
      title,
      authors,
      publisher: cleanOptional(mapped.publisher),
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
    const inlineCells = splitTableCells(content, delimiter).map((cell) => cell.trim());
    current = [inlineCells.shift() ?? ""];
    for (const cell of inlineCells) {
      cells.push(current.join("\n"));
      current = [cell];
    }
  }
  if (current.length) cells.push(current.join("\n"));
  return cells.map((cell) => cell.trim());
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTableCells(input: string, delimiter: string) {
  const cells: string[] = [];
  let depth = 0;
  let current = "";

  for (let index = 0; index < input.length; index += 1) {
    const nextTwo = input.slice(index, index + 2);
    if (nextTwo === "{{") {
      depth += 1;
      current += nextTwo;
      index += 1;
      continue;
    }
    if (nextTwo === "}}" && depth > 0) {
      depth -= 1;
      current += nextTwo;
      index += 1;
      continue;
    }
    if (depth === 0 && input.startsWith(delimiter, index)) {
      cells.push(current);
      current = "";
      index += delimiter.length - 1;
      continue;
    }
    current += input[index];
  }

  cells.push(current);
  return cells;
}

function mapCells(row: ParsedRow) {
  const hasYear = extractYear(wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""))) !== undefined;
  const missingLeadingCells = hasYear ? 0 : 1;
  return {
    year: readMappedCell(row, "year", missingLeadingCells),
    authorRaw: readRawMappedCell(row, "author", missingLeadingCells),
    author: readMappedCell(row, "author", missingLeadingCells),
    title: readMappedCell(row, "title", missingLeadingCells),
    publisher: readMappedCell(row, "publisher", missingLeadingCells),
    resultRaw: readRawMappedCell(row, "result", missingLeadingCells),
    result: readMappedCell(row, "result", missingLeadingCells),
  };
}

function readMappedCell(row: ParsedRow, headerPattern: string, missingLeadingCells: number) {
  const raw = readRawMappedCell(row, headerPattern, missingLeadingCells);
  return raw === undefined ? undefined : wikiToPlainText(raw);
}

function readRawMappedCell(row: ParsedRow, headerPattern: string, missingLeadingCells: number) {
  const headerIndex = row.headers.findIndex((header) => header.includes(headerPattern));
  if (headerIndex < 0) return undefined;
  const rawIndex = headerIndex - missingLeadingCells;
  if (rawIndex < 0 || rawIndex >= row.rawCells.length) return undefined;
  return stripCellAttributes(row.rawCells[rawIndex]);
}

function extractYear(input: string) {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function getRowStatus(result?: string): "winner" | "finalist" | undefined {
  if (!result) return undefined;
  const clean = wikiToPlainText(result).toLowerCase();
  if (/\{\{\s*won\s*\}\}/i.test(result) || clean.includes("winner") || clean === "won") return "winner";
  if (/\{\{\s*(?:runner-up|cfinalist|finalist)\s*\}\}/i.test(result) || clean.includes("runner") || clean.includes("finalist")) return "finalist";
  return undefined;
}

function cleanAuthorCell(input: string) {
  return cleanText(wikiToPlainText(input));
}

function cleanTitle(input: string) {
  return cleanText(input.replace(/^"(.+)"$/, "$1"));
}

function cleanOptional(input?: string) {
  const value = cleanText(input ?? "");
  return value || undefined;
}

function addOrMerge(records: PartialRecord[], record: PartialRecord) {
  const key = recordKey(record);
  const existing = records.find((item) => recordKey(item) === key);
  if (!existing) {
    records.push(record);
    return;
  }
  existing.authors = [...new Set([...existing.authors, ...record.authors])];
  existing.publisher ??= record.publisher;
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
