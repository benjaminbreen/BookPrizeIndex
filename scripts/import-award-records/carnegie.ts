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

type PartialRecord = Omit<RawAwardRecord, "status"> & { status: RawAwardRecord["status"] };

const pageTitle = "Andrew Carnegie Medals for Excellence in Fiction and Nonfiction";
const annualOfficialPages = Array.from({ length: 15 }, (_value, index) => 2012 + index).map((year) => ({
  year,
  url: `https://www.ala.org/carnegie-medals/${year}-winners`,
}));

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "andrew-carnegie-medals");
  const category = prize?.categories.find((entry) => entry.id === "carnegie-nonfiction");
  if (!prize || !category) throw new Error("Missing andrew-carnegie-medals registry entry in sources/prizes.json");

  console.log(`Fetching Carnegie nonfiction table from ${pageTitle}...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseCarnegieNonfiction(prize, category, wikitext);
  const longlistRecords = await fetchOfficialLonglists(prize, category, records);
  for (const record of longlistRecords) addOrMerge(records, record);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("carnegie.json", records, {
    importer: "scripts/import-award-records/carnegie.ts",
    source: "MediaWiki wikitable for Andrew Carnegie Medals nonfiction winners/finalists plus official ALA annual pages for longlists",
    notes: "Winners and finalists are parsed from the deterministic Wikipedia table; nonfiction longlists are parsed from official ALA Carnegie annual pages where available.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      finalists: records.filter((record) => record.status === "finalist").length,
      longlisted: records.filter((record) => record.status === "longlist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Carnegie nonfiction records.`);
  console.log(`${category.name}: ${records.length} records (${yearRange(records)})`);
}

export function parseCarnegieNonfiction(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, wikitext: string): RawAwardRecord[] {
  const nonfictionTable = extractWikitables(wikitext).find((table) => /Winners and finalists in nonfiction/i.test(table));
  if (!nonfictionTable) throw new Error("Could not find Carnegie nonfiction table");

  const partials: PartialRecord[] = [];
  let currentYear: number | undefined;

  for (const row of parseWikiTableRows(nonfictionTable)) {
    if (!row.cells.length || row.cells.some((cell) => /^year$/i.test(cell))) continue;

    const mapped = mapCells(row);
    const rowYear = extractYear(mapped.year ?? "");
    if (rowYear) currentYear = rowYear;
    if (!currentYear) continue;
    if (row.cells.some((cell) => /no award given/i.test(cell))) continue;

    const authors = normalizeAuthorList(cleanAuthorCell(mapped.author ?? ""));
    const title = cleanTitle(mapped.title ?? "");
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

async function fetchOfficialLonglists(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  existingRecords: RawAwardRecord[],
) {
  const existingHigherStatusKeys = new Set(
    existingRecords
      .filter((record) => record.status === "winner" || record.status === "co_winner" || record.status === "finalist")
      .map((record) => `${record.year}:${slugify(record.title)}`),
  );
  const records: PartialRecord[] = [];

  for (const page of annualOfficialPages) {
    const html = await fetchOfficialPage(page.url);
    if (!html) continue;
    const entries = parseOfficialNonfictionLonglist(html);
    for (const entry of entries) {
      if (existingHigherStatusKeys.has(`${page.year}:${slugify(entry.title)}`)) continue;
      addOrMerge(records, {
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year: page.year,
        status: "longlist",
        title: entry.title,
        authors: entry.authors,
        sourceUrl: page.url,
        sourceLabel: `ALA Carnegie Medals ${page.year} annual page`,
        sourceConfidence: "official",
        notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      });
    }
  }

  return records;
}

async function fetchOfficialPage(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`ALA Carnegie request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

function parseOfficialNonfictionLonglist(html: string) {
  const lines = htmlToLines(html);
  const start = findNonfictionLonglistStart(lines);
  if (start < 0) return [];
  const block = lines.slice(start, findLonglistEnd(lines, start)).filter(isContentLine).flatMap(splitMergedEntries);
  return block.some((line) => /^published by\b/i.test(line)) ? parseTitleFirstLonglist(block) : parseAuthorFirstLonglist(block);
}

function findNonfictionLonglistStart(lines: string[]) {
  const direct = lines.findIndex((line) => /^(?:##\s*)?nonfiction longlist$/i.test(line));
  if (direct >= 0) return direct + 1;

  let inLonglist = false;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].replace(/^##\s*/, "");
    if (/^longlist$/i.test(heading)) inLonglist = true;
    else if (/^shortlist$/i.test(heading)) inLonglist = false;
    else if (inLonglist && /^nonfiction:?$/i.test(heading)) return index + 1;
  }
  return -1;
}

function findLonglistEnd(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s*(?:social media|resources|book seals|press kit|sponsors|more|meet the|previous|fiction|nonfiction finalists|shortlist)/i.test(line)) return index;
    if (/^(?:email|print|cite|share this page)$/i.test(line)) return index;
  }
  return lines.length;
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n## ")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function decodeHtml(input: string) {
  const entities: Record<string, string> = {
    aacute: "á",
    Aacute: "Á",
    eacute: "é",
    Eacute: "É",
    iacute: "í",
    Iacute: "Í",
    oacute: "ó",
    Oacute: "Ó",
    uacute: "ú",
    Uacute: "Ú",
    egrave: "è",
    Egrave: "È",
    ntilde: "ñ",
    Ntilde: "Ñ",
    ouml: "ö",
    Ouml: "Ö",
  };
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\"")
    .replace(/&ldquo;/g, "\"")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([A-Za-z]+);/g, (match, entity: string) => entities[entity] ?? match);
}

function isContentLine(line: string) {
  return !/^##/.test(line)
    && !/^click images? to enlarge$/i.test(line)
    && !/^image:/i.test(line)
    && !/^read the booklist review/i.test(line)
    && !/^press release:/i.test(line)
    && !/^share your/i.test(line)
    && !/^explore the full longlist/i.test(line)
    && !/^winners? announced/i.test(line);
}

function parseTitleFirstLonglist(lines: string[]) {
  const entries: Array<{ title: string; authors: string[] }> = [];
  let title = "";
  let authorLines: string[] = [];

  for (const line of lines) {
    if (/^published by\b/i.test(line)) {
      const authors = normalizeOfficialAuthors(authorLines);
      if (isLikelyTitle(title) && authors.length) entries.push({ title: cleanOfficialTitle(title), authors });
      title = "";
      authorLines = [];
      continue;
    }
    if (!title) title = line;
    else authorLines.push(line);
  }

  return entries;
}

function parseAuthorFirstLonglist(lines: string[]) {
  const entries: Array<{ title: string; authors: string[] }> = [];

  if (!lines.some((line) => /^\([^)]+\)$/.test(line)) && lines.some((line) => parseInlineAuthorTitleLine(line))) {
    for (const line of lines) {
      const parsed = parseInlineAuthorTitleLine(line);
      if (parsed) entries.push(parsed);
    }
    return entries;
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    const authorLine = lines[index];
    const translatorLine = /^translated by\b/i.test(lines[index + 1] ?? "") ? lines[index + 1] : undefined;
    const titleLine = lines[index + (translatorLine ? 2 : 1)];
    if (!looksLikeOfficialAuthor(authorLine) || !isLikelyTitle(titleLine)) continue;
    entries.push({
      title: cleanOfficialTitle(titleLine),
      authors: normalizeOfficialAuthors([authorLine, translatorLine].filter((line): line is string => Boolean(line))),
    });
    index += translatorLine ? 3 : 2;
  }

  return entries;
}

function parseInlineAuthorTitleLine(line: string) {
  const withoutPublisher = line.replace(/\s*\([^()]+\)\.?\s*$/g, "").trim();
  let authorPart = "";
  let titlePart = "";
  const periodDelimiter = withoutPublisher.match(/^(.{3,90}?)\.\s+(.+)$/);
  if (periodDelimiter) {
    authorPart = periodDelimiter[1];
    titlePart = periodDelimiter[2];
    if (/\b[A-Z]$/.test(authorPart)) authorPart = `${authorPart}.`;
  } else {
    const firstComma = withoutPublisher.indexOf(",");
    const secondComma = firstComma >= 0 ? withoutPublisher.indexOf(",", firstComma + 1) : -1;
    if (secondComma < 0) return undefined;
    authorPart = withoutPublisher.slice(0, secondComma);
    titlePart = withoutPublisher.slice(secondComma + 1);
  }

  const authors = normalizeOfficialAuthors([authorPart]);
  const title = cleanOfficialTitle(titlePart);
  if (!authors.length || !isLikelyTitle(title)) return undefined;
  return { title, authors };
}

function looksLikeOfficialAuthor(line: string) {
  return /^[A-ZÀ-ÖØ-Þ][^.!?]{1,80},\s*[^.!?]{1,80}\.?$/u.test(line) || /\band\b/i.test(line);
}

function normalizeOfficialAuthors(lines: string[]) {
  const authorLine = lines.find((line) => !/^translated by\b/i.test(line));
  if (!authorLine) return [];
  const translatorLine = lines.find((line) => /^translated by\b/i.test(line));
  const authors = normalizeAuthorList(invertAuthorNames(stripTerminalPeriod(authorLine)));
  if (!translatorLine) return authors;
  const translator = stripTerminalPeriod(translatorLine).replace(/^Translated by\b/, "translated by");
  return authors.map((author, index) => index === 0 ? `${author}, ${translator}` : author);
}

function invertAuthorNames(input: string) {
  return input
    .split(/\s+(?:and|&)\s+|;\s*/)
    .map((part) => {
      const cleaned = cleanText(part);
      const match = cleaned.match(/^([^,]+),\s*(.+)$/);
      return match ? `${match[2]} ${match[1]}` : cleaned;
    })
    .join(" and ");
}

function cleanOfficialTitle(input: string) {
  return cleanTitle(input.replace(/\.$/, "").replace(/:(?=\S)/g, ": "));
}

// The ALA annual pages sometimes merge two "Lastname, Firstname. Title. (Publisher)"
// entries into a single paragraph with no separator after the publisher paren.
function splitMergedEntries(line: string) {
  return line
    .split(/(?<=\))\s*(?=[A-ZÀ-ÖØ-Þ][\p{L}'’-]+,\s)/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTerminalPeriod(input: string) {
  const trimmed = cleanText(input);
  return /\b[A-Z]\.$/.test(trimmed) ? trimmed : trimmed.replace(/\.$/, "");
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
    author: readMappedCell(row, "winner", missingLeadingCells) ?? readMappedCell(row, "author", missingLeadingCells),
    title: readMappedCell(row, "work", missingLeadingCells) ?? readMappedCell(row, "title", missingLeadingCells),
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
  const mapped = readMappedCell(row, "finalists", missingLeadingCells) ?? readMappedCell(row, "result", missingLeadingCells);
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
  return /background\s*:\s*#cddeff/i.test(row.style) ? "winner" : "finalist";
}

function cleanAuthorCell(input: string) {
  return cleanText(input.replace(/<br\s*\/?>/gi, " and ").replace(/\s*\([^)]*\)\s*$/g, ""));
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
