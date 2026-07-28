import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  decodeHtmlEntities,
  fetchHtml,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const wikipediaPageTitle = "Women's Prize for Non-Fiction";
const wikipediaSourceUrl = "https://en.wikipedia.org/wiki/Women%27s_Prize_for_Non-Fiction";
const restBase = "https://womensprize.com/wp-json/wp/v2";
/** `prize_type` taxonomy term for the Women's Prize for Non-Fiction. */
const nonFictionPrizeTypeTerm = 10;
const expectedRecords = 48;
const expectedPerYear = 16;
const expectedYears = [2024, 2025, 2026];

/** Shape of the subset of the womensprize.com `book` REST payload this importer relies on. */
export type WomensPrizeRestBook = {
  title?: { rendered?: string };
  link?: string;
  book_author?: number[];
};

export type WomensPrizeRestTerm = {
  id: number;
  name: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "womens-prize-nonfiction");
  const category = prize?.categories.find((entry) => entry.id === "womens-prize-nonfiction");
  if (!prize || !category) throw new Error("Missing Women's Prize for Non-Fiction registry entries");

  console.log("Fetching the Wikipedia Women's Prize for Non-Fiction winners and shortlist table...");
  const wikiRecords = parseWomensPrizeWikitable(prize, category, await fetchMediaWikiWikitext(wikipediaPageTitle));

  console.log("Resolving womensprize.com prize_year taxonomy terms...");
  const yearTerms = await fetchJson<WomensPrizeRestTerm[]>(`${restBase}/prize_year?per_page=100`);
  const termIdByYear = resolvePrizeYearTerms(yearTerms, expectedYears);

  const longlistRecords: RawAwardRecord[] = [];
  for (const year of expectedYears) {
    const termId = termIdByYear.get(year)!;
    console.log(`Fetching the official ${year} longlist (prize_year term ${termId})...`);
    const books = await fetchJson<WomensPrizeRestBook[]>(
      `${restBase}/book?prize_type=${nonFictionPrizeTypeTerm}&prize_year=${termId}&per_page=100`,
    );
    if (books.length !== expectedPerYear) {
      throw new Error(`Expected ${expectedPerYear} ${year} Women's Prize non-fiction books from the REST API, got ${books.length}`);
    }
    const authorIds = [...new Set(books.flatMap((book) => book.book_author ?? []))];
    const authorTerms = await fetchJson<WomensPrizeRestTerm[]>(
      `${restBase}/book_author?include=${authorIds.join(",")}&per_page=100`,
    );
    const authorNames = new Map(authorTerms.map((term) => [term.id, cleanText(term.name)]));
    longlistRecords.push(...parseWomensPrizeLonglist(prize, category, year, books, authorNames));
  }

  const records = mergeWomensPrizeRecords(wikiRecords, longlistRecords);
  assertCoverage(records);

  const byStatus = (status: RawAwardRecord["status"]) => records.filter((record) => record.status === status).length;
  await writeRawAwardRecords("womens-prize-nonfiction.json", records, {
    importer: "scripts/import-award-records/womens-prize-nonfiction.ts",
    source: "Wikipedia winners/shortlist table joined with the official womensprize.com WordPress REST API longlists",
    notes:
      "Wikipedia carries no longlists for this prize, and the womensprize.com REST API carries no tier field, so the two are joined on normalized author plus title prefix and each book keeps only its highest status. prize_year taxonomy term ids are resolved at import time because they are opaque and unstable.",
    records: records.length,
    winners: byStatus("winner"),
    shortlisted: byStatus("shortlist"),
    longlisted: byStatus("longlist"),
    yearRange: yearRange(records),
    yearCounts: Object.fromEntries(expectedYears.map((year) => [year, records.filter((record) => record.year === year).length])),
  });
  console.log(
    `Imported ${records.length} Women's Prize for Non-Fiction records (${byStatus("winner")} winners, ${byStatus("shortlist")} shortlist, ${byStatus("longlist")} longlist).`,
  );
}

/**
 * Parses the single `wikitable sortable` on the Wikipedia page. Each edition is a rowgroup whose
 * first row carries the year header plus the winner, followed by five shortlist rows sharing a
 * `rowspan="5"` Result cell.
 */
export function parseWomensPrizeWikitable(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const sectionStart = wikitext.indexOf("{| class=\"wikitable sortable\"");
  const sectionEnd = wikitext.indexOf("\n|}", sectionStart);
  if (sectionStart < 0 || sectionEnd < 0) throw new Error("Could not find the Women's Prize for Non-Fiction wikitable");

  const records: RawAwardRecord[] = [];
  let year: number | undefined;
  let result = "";
  for (const rawRow of wikitext.slice(sectionStart, sectionEnd).split(/\n\|-/)) {
    const cells = parseWikiRowCells(rawRow);
    let cursor = 0;
    const headerYear = cells[0]?.header ? cells[0].text.match(/\b(20\d{2})\b/) : undefined;
    if (headerYear) {
      year = Number(headerYear[1]);
      cursor = 1;
    }
    const body = cells.slice(cursor).map((cell) => cell.text).filter(Boolean);
    if (!year || body.length < 2) continue;

    const explicit = body[2];
    if (explicit && /winner|shortlist/i.test(explicit)) result = explicit;
    const status = statusFromResult(result);
    if (!status) continue;

    const authors = normalizeAuthorList(body[0]);
    const title = cleanTitle(body[1]);
    if (!authors.length || !isLikelyTitle(title)) continue;
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status,
      title,
      authors,
      sourceUrl: wikipediaSourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: "secondary",
      notes: "Winner and shortlist tiers come from the cited Wikipedia table; the longlist comes from the official site.",
    });
  }
  return records;
}

/** Builds longlist records from the official REST payload. Pure: callers supply the fetched JSON. */
export function parseWomensPrizeLonglist(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  books: WomensPrizeRestBook[],
  authorNames: Map<number, string>,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  for (const book of books) {
    const title = cleanTitle(decodeHtmlEntities(book.title?.rendered ?? ""));
    const authors = (book.book_author ?? [])
      .map((id) => authorNames.get(id))
      .filter((name): name is string => Boolean(name))
      .flatMap((name) => normalizeAuthorList(name));
    if (!isLikelyTitle(title) || !authors.length) continue;
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "longlist",
      title,
      authors,
      sourceUrl: book.link || category.officialUrl || wikipediaSourceUrl,
      sourceLabel: `Women's Prize official ${year} non-fiction longlist entry`,
      sourceConfidence: "official",
    });
  }
  return records;
}

/**
 * Drops longlist rows whose book already appears with a higher status. The REST API stores short
 * display titles while Wikipedia stores full subtitled forms, so the join is on normalized author
 * plus a title-prefix / main-title comparison rather than exact string equality.
 */
export function mergeWomensPrizeRecords(higher: RawAwardRecord[], longlist: RawAwardRecord[]): RawAwardRecord[] {
  const deduped = uniqueByWork(higher);
  const remaining = longlist.filter((record) => !deduped.some((existing) => sameWork(record, existing)));
  return [...deduped, ...uniqueByWork(remaining)].sort(
    (a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title),
  );
}

export function resolvePrizeYearTerms(terms: WomensPrizeRestTerm[], years: number[]) {
  const byYear = new Map<number, number>();
  for (const term of terms) {
    const match = String(term.name).match(/\b(20\d{2})\b/);
    if (match) byYear.set(Number(match[1]), term.id);
  }
  const missing = years.filter((year) => !byYear.has(year));
  if (missing.length) throw new Error(`Could not resolve womensprize.com prize_year terms for ${missing.join(", ")}`);
  return byYear;
}

function statusFromResult(result: string): RawAwardRecord["status"] | undefined {
  if (/winner/i.test(result)) return "winner";
  if (/shortlist/i.test(result)) return "shortlist";
  return undefined;
}

function cleanTitle(value: string) {
  return cleanText(
    wikiToPlainText(value)
      .replace(/^''+|''+$/g, "")
      .replace(/\s*\(book\)$/i, ""),
  );
}

function parseWikiRowCells(rowBody: string) {
  const cells: Array<{ header: boolean; text: string }> = [];
  let current: string[] = [];
  let header = false;
  const flush = () => {
    if (!current.length) return;
    const raw = current.join("\n").trim();
    cells.push({ header, text: cleanText(wikiToPlainText(stripCellAttributes(raw))) });
    current = [];
  };
  for (const rawLine of rowBody.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^\{\||^\|\}|^\|-|^\|\+/.test(line.trim())) {
      flush();
      continue;
    }
    if (!/^[!|]/.test(line)) {
      if (current.length) current.push(line);
      continue;
    }
    flush();
    header = line.startsWith("!");
    current = [line.replace(/^[!|]+\s*/, "")];
  }
  flush();
  return cells;
}

function workKey(title: string) {
  return slugify(title.split(":")[0]);
}

function sameWork(left: RawAwardRecord, right: RawAwardRecord) {
  if (left.categoryId !== right.categoryId || left.year !== right.year) return false;
  const leftAuthors = left.authors.map(slugify).sort().join("|");
  const rightAuthors = right.authors.map(slugify).sort().join("|");
  if (leftAuthors !== rightAuthors) return false;
  const leftTitle = slugify(left.title);
  const rightTitle = slugify(right.title);
  return (
    leftTitle === rightTitle ||
    leftTitle.startsWith(rightTitle) ||
    rightTitle.startsWith(leftTitle) ||
    workKey(left.title) === workKey(right.title)
  );
}

function uniqueByWork(records: RawAwardRecord[]) {
  const kept: RawAwardRecord[] = [];
  for (const record of records) {
    if (!kept.some((existing) => sameWork(record, existing))) kept.push(record);
  }
  return kept;
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  if (status === "longlist") return 3;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

export function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== expectedRecords) {
    throw new Error(`Expected ${expectedRecords} Women's Prize for Non-Fiction records, got ${records.length}`);
  }
  const range = `${expectedYears[0]}-${expectedYears[expectedYears.length - 1]}`;
  if (yearRange(records) !== range) {
    throw new Error(`Expected Women's Prize for Non-Fiction year range ${range}, got ${yearRange(records)}`);
  }
  for (const year of expectedYears) {
    const yearRecords = records.filter((record) => record.year === year);
    const winners = yearRecords.filter((record) => record.status === "winner");
    if (yearRecords.length !== expectedPerYear) {
      throw new Error(`Expected ${expectedPerYear} Women's Prize non-fiction records for ${year}, got ${yearRecords.length}`);
    }
    if (winners.length !== 1) {
      throw new Error(`Expected exactly 1 Women's Prize non-fiction winner for ${year}, got ${winners.length}`);
    }
    if (yearRecords.filter((record) => record.status === "shortlist").length !== 5) {
      throw new Error(`Expected 5 Women's Prize non-fiction shortlist-only records for ${year}`);
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchHtml(url)) as T;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
