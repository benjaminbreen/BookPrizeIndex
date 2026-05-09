import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import { pathToFileURL } from "node:url";
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
  caption: string;
  section: string;
  style: string;
  headers: string[];
  cells: string[];
  rawCells: string[];
};

type PartialRecord = Omit<RawAwardRecord, "status"> & { status: "winner" | "finalist" | "honorable_mention" };

const pageTitle = "National Book Award for Nonfiction";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "national-book-awards");
  const baseCategory = prize?.categories.find((entry) => entry.id === "national-book-awards-nonfiction");
  if (!prize || !baseCategory) throw new Error("Missing national-book-awards registry entry in sources/prizes.json");

  console.log(`Fetching National Book Awards nonfiction tables from ${pageTitle}...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseNationalBookAwards(prize, baseCategory, wikitext);

  records.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  const categoryReports = categoryReport(records);
  await writeRawAwardRecords("national-book-awards.json", records, {
    importer: "scripts/import-award-records/national-book-awards.ts",
    source: "MediaWiki wikitable for National Book Award for Nonfiction",
    notes: "The official National Book Foundation archive is retained in sources/prizes.json, but this first importer uses Wikipedia as a deterministic secondary source so the corpus can be expanded before verification and publisher enrichment.",
    categories: categoryReports,
  });

  console.log(`Imported ${records.length} National Book Awards nonfiction records.`);
  for (const report of categoryReports) {
    console.log(`${report.categoryName}: ${report.records} records (${report.yearRange})`);
  }
}

export function parseNationalBookAwards(prize: PrizeRegistryEntry, baseCategory: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const rows = extractWikitables(wikitext)
    .filter(({ table }) => /Author|Title|Result/i.test(table))
    .flatMap(parseWikiTableRows);
  const partials: PartialRecord[] = [];

  let currentYear: number | undefined;
  let currentCategory = baseCategory.name;
  let currentStatus: PartialRecord["status"] | undefined;
  let currentCaption = "";

  for (const row of rows) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    if (row.caption !== currentCaption) {
      currentCaption = row.caption;
      currentCategory = inferCategory(row, baseCategory.name);
      currentStatus = undefined;
    }

    const mapped = mapCells(row);
    const rowYear = extractYear(mapped.year ?? "");
    if (rowYear) currentYear = rowYear;
    if (!currentYear) continue;

    const rowCategory = mapped.category;
    if (rowCategory && !/^category$/i.test(rowCategory)) currentCategory = normalizeCategoryName(rowCategory, row.section);
    const categoryName = currentCategory;
    const categoryId = categoryIdFor(categoryName);

    const status = getRowStatus(row, mapped.result) ?? (row.style.includes("LemonChiffon") ? "winner" : currentStatus ?? "finalist");
    currentStatus = status;

    const authorCell = mapped.author;
    const titleCell = mapped.title;
    if (!authorCell || !titleCell) continue;

    const authors = normalizeAuthorList(cleanAuthorCell(authorCell));
    const title = cleanTitle(titleCell);
    if (!authors.length || !isLikelyTitle(title)) continue;

    addOrMerge(partials, {
      awardId: prize.id,
      awardName: prize.name,
      categoryId,
      categoryName,
      year: currentYear,
      status,
      title,
      authors,
      sourceUrl: baseCategory.sourceUrl,
      sourceLabel: baseCategory.sourceLabel,
      sourceConfidence: baseCategory.sourceConfidence,
      notes: cleanText([
        baseCategory.officialUrl ? `Official archive URL: ${baseCategory.officialUrl}` : "",
        row.caption ? `Imported table: ${row.caption}` : "",
      ].filter(Boolean).join(" ")),
    });
  }

  return normalizeCoWinners(partials);
}

function extractWikitables(wikitext: string) {
  const tables: Array<{ table: string; section: string }> = [];
  const tablePattern = /\{\|\s*class="?wikitable/g;
  for (const match of wikitext.matchAll(tablePattern)) {
    const start = match.index;
    const end = wikitext.indexOf("\n|}", start);
    if (end !== -1) {
      tables.push({
        table: wikitext.slice(start, end),
        section: nearestSectionHeading(wikitext.slice(0, start)),
      });
    }
  }
  if (!tables.length) throw new Error("Could not find wikitable");
  return tables;
}

function parseWikiTableRows({ table, section }: { table: string; section: string }): ParsedRow[] {
  const caption = cleanText(wikiToPlainText(table.split("\n").find((line) => line.startsWith("|+"))?.replace(/^\|\+\s*/, "") ?? ""));
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
        caption,
        section,
        style,
        headers,
        rawCells,
        cells: rawCells.map((cell) => wikiToPlainText(stripCellAttributes(cell))),
      };
    })
    .filter((row) => row.cells.length > 0);
}

function nearestSectionHeading(prefix: string) {
  const matches = [...prefix.matchAll(/^={3,6}\s*([^=\n]+?)\s*=+\s*$/gm)];
  return cleanText(matches.at(-1)?.[1] ?? "");
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
    const inlineCells = splitInlineCells(content, delimiter);
    current = [inlineCells.shift() ?? ""];
    for (const cell of inlineCells) {
      cells.push(current.join("\n"));
      current = [cell];
    }
  }
  if (current.length) cells.push(current.join("\n"));
  return cells.map((cell) => cell.trim()).filter(Boolean);
}

function splitInlineCells(input: string, delimiter: "!!" | "||") {
  return input
    .split(new RegExp(`\\s*${escapeRegExp(delimiter)}\\s*`))
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getYear(row: ParsedRow) {
  const yearCell = getCellByHeader(row, "year") ?? row.cells[0];
  return extractYear(yearCell ?? "");
}

function extractYear(input: string) {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function getRowStatus(row: ParsedRow, mappedResult?: string): PartialRecord["status"] | undefined {
  const result = mappedResult ?? getCellByHeader(row, "result");
  if (!result) return undefined;
  if (/winner/i.test(result)) return "winner";
  if (/finalist|runner.?up|close second/i.test(result)) return "finalist";
  if (/honou?rable mention/i.test(result)) return "honorable_mention";
  return undefined;
}

function mapCells(row: ParsedRow) {
  const hasYear = extractYear(wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""))) !== undefined;
  const hasCategoryHeader = row.headers.some((header) => header.includes("category"));

  if (hasCategoryHeader) {
    const firstCell = wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""));
    const categoryPresent = row.rawCells.length >= row.headers.length - 1 || isFormatCategory(firstCell);
    const missingLeadingCells = hasYear ? 0 : categoryPresent ? 1 : 2;
    return {
      year: readMappedCell(row, "year", missingLeadingCells),
      category: readMappedCell(row, "category", missingLeadingCells),
      author: readMappedCell(row, "author", missingLeadingCells),
      title: readMappedCell(row, "title", missingLeadingCells) ?? readMappedCell(row, "work", missingLeadingCells) ?? readMappedCell(row, "book", missingLeadingCells),
      result: readResultCell(row, missingLeadingCells),
    };
  }

  const missingLeadingCells = hasYear ? 0 : 1;
  return {
    year: readMappedCell(row, "year", missingLeadingCells),
    category: undefined,
    author: readMappedCell(row, "author", missingLeadingCells),
    title: readMappedCell(row, "title", missingLeadingCells) ?? readMappedCell(row, "work", missingLeadingCells) ?? readMappedCell(row, "book", missingLeadingCells),
    result: readResultCell(row, missingLeadingCells),
  };
}

function readResultCell(row: ParsedRow, missingLeadingCells: number) {
  const mapped = readMappedCell(row, "result", missingLeadingCells);
  return isResultValue(mapped) ? mapped : findResultCell(row);
}

function readMappedCell(row: ParsedRow, headerPattern: string, missingLeadingCells: number) {
  const headerIndex = row.headers.findIndex((header) => header.includes(headerPattern));
  if (headerIndex < 0) return undefined;
  const rawIndex = headerIndex - missingLeadingCells;
  if (rawIndex < 0 || rawIndex >= row.rawCells.length) return undefined;
  return wikiToPlainText(stripCellAttributes(row.rawCells[rawIndex]));
}

function findResultCell(row: ParsedRow) {
  return row.cells.find(isResultValue);
}

function isResultValue(input?: string) {
  return Boolean(input && /^(?:winner|finalist|runner.?up|close second|honou?rable mention)$/i.test(input));
}

function getCellByHeader(row: ParsedRow, pattern: string) {
  const raw = getRawCellByHeader(row, pattern);
  return raw ? wikiToPlainText(stripCellAttributes(raw)) : undefined;
}

function getRawCellByHeader(row: ParsedRow, pattern: string) {
  const headerIndex = row.headers.findIndex((header) => header.includes(pattern));
  if (headerIndex < 0) return undefined;
  const firstCellIsYear = extractYear(wikiToPlainText(stripCellAttributes(row.rawCells[0] ?? ""))) !== undefined;
  return row.rawCells[firstCellIsYear ? headerIndex : headerIndex - 1];
}

function inferCategory(row: ParsedRow, fallback: string) {
  if (/nonfiction/i.test(row.caption)) return fallback;
  if (row.section && !/^\d{4}/.test(row.section) && !/recipients|multiple nonfiction categories/i.test(row.section)) return cleanCategory(row.section);
  return fallback;
}

function normalizeCategoryName(input: string, section: string) {
  const category = cleanCategory(input);
  const cleanSection = cleanCategory(section);
  if (/^(?:hardcover|paperback)$/i.test(category) && cleanSection && !/^\d{4}/.test(cleanSection)) {
    return `${cleanSection} ${category}`;
  }
  return category;
}

function isFormatCategory(input: string) {
  return /(?:hardcover|paperback)$/i.test(input);
}

function cleanCategory(input: string) {
  return cleanText(input.replace(/^["']|["']$/g, "").replace(/\s*\/\s*/g, "/"));
}

function categoryIdFor(categoryName: string) {
  return `national-book-awards-${slugify(categoryName)}`;
}

function cleanAuthorCell(input: string) {
  return cleanText(input.replace(/\s*\([^)]*\)\s*$/g, ""));
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
  if (status === "honorable_mention") return 3;
  return 9;
}

function categoryReport(records: RawAwardRecord[]) {
  return Object.values(
    records.reduce<Record<string, {
      categoryId: string;
      categoryName: string;
      records: number;
      winners: number;
      finalists: number;
      yearRange: string;
      years: number[];
    }>>((acc, record) => {
      const current = acc[record.categoryId] ?? {
        categoryId: record.categoryId,
        categoryName: record.categoryName,
        records: 0,
        winners: 0,
        finalists: 0,
        yearRange: "",
        years: [],
      };
      current.records += 1;
      if (record.status === "winner" || record.status === "co_winner") current.winners += 1;
      if (record.status === "finalist") current.finalists += 1;
      current.years.push(record.year);
      acc[record.categoryId] = current;
      return acc;
    }, {}),
  )
    .map((report) => ({
      ...report,
      yearRange: `${Math.min(...report.years)}-${Math.max(...report.years)}`,
      years: undefined,
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
