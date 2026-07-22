import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  fetchMediaWikiWikitext,
  htmlToLines,
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

type PartialRecord = Omit<RawAwardRecord, "status"> & { status: "winner" | "finalist" | "longlist" };

const pageTitles: Record<string, string> = {
  "nbcc-nonfiction": "National Book Critics Circle Award for Nonfiction",
  "nbcc-biography": "National Book Critics Circle Award for Biography",
  "nbcc-memoir-and-autobiography": "National Book Critics Circle Award for Memoir and Autobiography",
  "nbcc-criticism": "National Book Critics Circle Award for Criticism",
};

const longlistSources = [
  {
    year: 2024,
    url: "https://www.bookcritics.org/2025/01/19/2024-nbcc-awards-longlists/",
    categories: {
      "nbcc-nonfiction": "NONFICTION",
      "nbcc-biography": "BIOGRAPHY",
      "nbcc-memoir-and-autobiography": "AUTOBIOGRAPHY",
      "nbcc-criticism": "CRITICISM",
    },
  },
  {
    year: 2025,
    urls: {
      "nbcc-criticism": "https://www.bookcritics.org/2025/12/15/2025-nbcc-awards-longlist-criticism/",
      "nbcc-biography": "https://www.bookcritics.org/2025/12/16/2025-nbcc-awards-longlist-biography/",
      "nbcc-memoir-and-autobiography": "https://www.bookcritics.org/2025/12/16/2025-nbcc-awards-longlist-autobiography/",
      "nbcc-nonfiction": "https://www.bookcritics.org/2025/12/17/2025-nbcc-awards-longlist-nonfiction/",
    },
  },
] as const;

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "national-book-critics-circle-awards");
  if (!prize) throw new Error("Missing national-book-critics-circle-awards entry in sources/prizes.json");

  const records: RawAwardRecord[] = [];
  for (const category of prize.categories) {
    const pageTitle = pageTitles[category.id];
    if (!pageTitle) continue;

    console.log(`Fetching ${category.name} from ${pageTitle}...`);
    const wikitext = await fetchMediaWikiWikitext(pageTitle);
    const categoryRecords = parseNbccCategory(prize, category, wikitext);
    records.push(...categoryRecords);
  }

  console.log("Fetching official NBCC longlists for 2024 and 2025...");
  for (const source of longlistSources) {
    if ("url" in source) {
      const html = await fetchHtml(source.url);
      for (const category of prize.categories) {
        const heading = source.categories[category.id as keyof typeof source.categories];
        if (heading) records.push(...parseNbccOfficialLonglist(prize, category, html, source.year, source.url, heading));
      }
    } else {
      for (const category of prize.categories) {
        const url = source.urls[category.id as keyof typeof source.urls];
        if (url) records.push(...parseNbccOfficialLonglist(prize, category, await fetchHtml(url), source.year, url));
      }
    }
  }

  const highestStatusRecords = retainHighestStatus(records);
  records.length = 0;
  records.push(...highestStatusRecords);

  const categoryReports = prize.categories.map((category) => {
    const categoryRecords = records.filter((record) => record.categoryId === category.id);
    return {
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: categoryRecords.length,
      winners: categoryRecords.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      finalists: categoryRecords.filter((record) => record.status === "finalist").length,
      longlisted: categoryRecords.filter((record) => record.status === "longlist").length,
      yearRange: yearRange(categoryRecords),
    };
  });

  records.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("nbcc.json", records, {
    importer: "scripts/import-award-records/nbcc.ts",
    source: "MediaWiki category tables plus official NBCC longlist announcements",
    notes: "Historical winners and finalists use deterministic Wikipedia category tables; 2024 and 2025 longlists use official NBCC announcements. Books that advanced retain only finalist or winner status. Memoir and Autobiography is filtered to 2005 onward to avoid duplicating the earlier Biography/Autobiography lineage.",
    categories: categoryReports,
  });

  console.log(`Imported ${records.length} National Book Critics Circle award records.`);
  for (const report of categoryReports) {
    console.log(`${report.categoryName}: ${report.records} records (${report.yearRange})`);
  }
}

export function parseNbccOfficialLonglist(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  year: number,
  sourceUrl: string,
  heading?: string,
): RawAwardRecord[] {
  let lines = htmlToLines(html);
  if (heading) {
    const start = lines.findIndex((line) => line.toUpperCase() === `${heading} LONGLIST:`);
    if (start < 0) throw new Error(`Could not find ${heading} longlist in ${sourceUrl}`);
    const endOffset = lines.slice(start + 1).findIndex((line) => / LONGLIST:$/.test(line.toUpperCase()));
    lines = lines.slice(start + 1, endOffset < 0 ? undefined : start + 1 + endOffset);
  }

  const records: RawAwardRecord[] = [];
  for (const line of lines) {
    const parsed = parseOfficialLonglistLine(line);
    if (!parsed) continue;
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "longlist",
      title: canonicalNbccLonglistTitle(year, category.id, parsed.title),
      authors: normalizeAuthorList(parsed.author),
      publisher: parsed.publisher,
      sourceUrl,
      sourceLabel: `National Book Critics Circle ${year} official longlist`,
      sourceConfidence: "official",
    });
  }
  if (records.length !== 10) {
    throw new Error(`Expected 10 NBCC ${category.name} longlist books for ${year}, got ${records.length}`);
  }
  return records;
}

function canonicalNbccLonglistTitle(year: number, categoryId: string, title: string) {
  const corrections: Record<string, string> = {
    "2025:nbcc-criticism:to-save-and-to-destro-y-writing-as-an-other": "To Save and to Destroy: Writing as an Other",
    "2025:nbcc-memoir-and-autobiography:paper-girl": "Paper Girl: A Memoir of Home and Family in a Fractured America",
  };
  return corrections[`${year}:${categoryId}:${slugify(title)}`] ?? title;
}

function parseOfficialLonglistLine(line: string) {
  let split = line.match(/^(.+?)\s*,?\s+by\s+(.+)$/i);
  if (!split && /^A Return to Self:/i.test(line)) {
    const comma = line.lastIndexOf(",");
    if (comma > 0) split = [line, line.slice(0, comma), line.slice(comma + 1)] as RegExpMatchArray;
  }
  if (!split) return undefined;
  const title = cleanText(split[1].replace(/\s+,$/, ""));
  const publisherMatch = split[2].match(/\s+\(([\s\S]*)\)\s*$/);
  if (!publisherMatch) return undefined;
  const publisher = cleanText(publisherMatch[1]);
  const author = cleanText(split[2].slice(0, publisherMatch.index).replace(/,\s*(?:translated|illustrated)\b[\s\S]*$/i, ""));
  if (!isLikelyTitle(title) || !author) return undefined;
  return { title, author, publisher };
}

function retainHighestStatus(records: RawAwardRecord[]) {
  const rank = (status: RawAwardRecord["status"]) => status === "winner" || status === "co_winner" ? 3 : status === "finalist" ? 2 : status === "longlist" ? 1 : 0;
  const byKey = new Map<string, RawAwardRecord>();
  for (const record of records) {
    const key = `${record.categoryId}:${record.year}:${slugify(record.title)}`;
    const existing = byKey.get(key);
    if (!existing || rank(record.status) > rank(existing.status)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

export function parseNbccCategory(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const rows = extractWikitables(wikitext).flatMap(parseWikiTableRows);
  const partials: PartialRecord[] = [];

  let currentYear: number | undefined;

  for (const row of rows) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    const mapped = mapCells(row);
    const rowYear = extractYear(mapped.year ?? "");
    if (rowYear) currentYear = rowYear;
    if (!currentYear) continue;
    if (category.id === "nbcc-memoir-and-autobiography" && currentYear < 2005) continue;

    const authorCell = mapped.author;
    const titleCell = mapped.title;
    if (!authorCell || !titleCell) continue;

    const authors = normalizeAuthorList(cleanAuthorCell(authorCell));
    const title = cleanTitle(titleCell);
    if (!authors.length || !isLikelyTitle(title)) continue;

    addOrMerge(partials, {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: getRowStatus(row, mapped.result),
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
    author: readMappedCell(row, "author", missingLeadingCells),
    title: readMappedCell(row, "title", missingLeadingCells) ?? readMappedCell(row, "work", missingLeadingCells) ?? readMappedCell(row, "book", missingLeadingCells),
    result: readResultCell(row, missingLeadingCells),
  };
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

function getRowStatus(row: ParsedRow, result?: string): "winner" | "finalist" {
  if (result && /winner/i.test(result)) return "winner";
  if (result && /finalist/i.test(result)) return "finalist";
  return /background\s*:\s*(?:#cddeff|LemonChiffon)/i.test(row.style) ? "winner" : "finalist";
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
  if (status === "longlist") return 3;
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
