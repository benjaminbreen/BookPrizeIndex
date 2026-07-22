import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { data } from "./build/pipeline-data";
import type { Book, NytBestsellerStats, SourceRef } from "../lib/types";

type NytBook = {
  author?: string;
  primary_isbn10?: string;
  primary_isbn13?: string;
  rank?: number;
  title?: string;
  weeks_on_list?: number;
  isbns?: Array<{ isbn10?: string; isbn13?: string }>;
};

type NytListResponse = {
  _source?: "nyt_api" | "barabasi_research";
  status?: string;
  errors?: string[];
  results?: {
    display_name?: string;
    list_name_encoded?: string;
    published_date?: string;
    books?: NytBook[];
  };
};

type MatchedAppearance = {
  bookId: string;
  listName: string;
  displayName: string;
  publishedDate: string;
  rank: number;
  weeksOnList: number;
  matchedBy: "isbn13" | "title_author";
  source: "nyt_api" | "barabasi_research";
};

type PublicBestsellerData = {
  generatedAt: string;
  provider: "new_york_times";
  coverage: Array<{
    listName: string;
    displayName: string;
    startDate: string;
    endDate: string;
    snapshots: number;
  }>;
  appearances: MatchedAppearance[];
  unmatchedEntries: number;
};

type GeneratedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cacheRoot = path.join(root, "data", "cache", "nyt-bestseller-lists");
const publicOutputPath = path.join(root, "data", "public", "nyt-bestsellers.json");
const patchOutputPath = path.join(root, "sources", "enrichment", "nyt-bestsellers.generated.json");
const reportOutputPath = path.join(root, "data", "reports", "nyt-bestseller-enrichment-report.json");
const sourceId = "source-new-york-times-books-api-bestsellers";
const researchSourceId = "source-barabasi-lab-nyt-bestsellers-2008-2016";
const defaultList = "hardcover-nonfiction";
const defaultStartDate = "2008-06-15";
const postResearchStartDate = "2016-04-17";
const researchDownloadUrl = "https://bestsellers.barabasilab.com/nytb2008-2016.zip";
const execFileAsync = promisify(execFile);

await loadEnvLocal();

const apiKey = process.env.NYT_BOOKS_API_KEY?.trim();
if (!apiKey) throw new Error("NYT_BOOKS_API_KEY is required. Set it in .env.local before running bestsellers:enrich.");

const listNames = (readArg("--lists") ?? defaultList).split(",").map((value) => value.trim()).filter(Boolean);
const historicalOnly = hasArg("--historical-only");
const apiOnly = hasArg("--api-only");
const startDate = readArg("--start-date") ?? (apiOnly ? defaultStartDate : postResearchStartDate);
const requestedEndDate = readArg("--end-date");
const requestedResearchZip = readArg("--historical-zip");
const delayMs = positiveNumber(readArg("--request-delay-ms"), 12_500);
const limit = optionalPositiveNumber(readArg("--limit"));

async function main() {
  const generatedAt = new Date().toISOString();
  await Promise.all([
    fs.mkdir(cacheRoot, { recursive: true }),
    fs.mkdir(path.dirname(publicOutputPath), { recursive: true }),
    fs.mkdir(path.dirname(patchOutputPath), { recursive: true }),
    fs.mkdir(path.dirname(reportOutputPath), { recursive: true }),
  ]);

  const researchResponses = apiOnly ? [] : await loadResearchResponses(requestedResearchZip);
  const responses: NytListResponse[] = [...researchResponses];
  let fetched = 0;
  let cached = 0;

  if (!historicalOnly) {
    for (const listName of listNames) {
      const endDate = requestedEndDate ?? await latestPublishedDate(listName);
      const dates = weeklyDates(startDate, endDate).slice(0, limit);
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index];
        const result = await readOrFetchList(listName, date);
        responses.push(result.response);
        if (result.cached) cached += 1;
        else fetched += 1;
        if ((index + 1) % 25 === 0 || index + 1 === dates.length) {
          console.log(`${listName}: ${index + 1}/${dates.length} snapshots (${fetched} fetched, ${cached} cached)`);
        }
      }
    }
  }

  const { appearances, unmatchedEntries } = matchResponses(responses);
  const patch = buildPatch(appearances, generatedAt);
  const publicData = buildPublicData(appearances, responses, generatedAt, unmatchedEntries);
  const report = {
    generatedAt,
    lists: listNames,
    requestedStartDate: startDate,
    requestedEndDate: requestedEndDate ?? "current",
    fetchedSnapshots: fetched,
    cachedSnapshots: cached,
    totalSnapshots: responses.length,
    researchSnapshots: researchResponses.length,
    nytEntries: responses.reduce((total, response) => total + (response.results?.books?.length ?? 0), 0),
    matchedAppearances: appearances.length,
    matchedBooks: Object.keys(patch.books).length,
    matchedByIsbn: new Set(appearances.filter((row) => row.matchedBy === "isbn13").map((row) => row.bookId)).size,
    matchedByTitleAuthor: new Set(appearances.filter((row) => row.matchedBy === "title_author").map((row) => row.bookId)).size,
    unmatchedEntries,
  };

  await Promise.all([
    fs.writeFile(patchOutputPath, `${JSON.stringify(patch, null, 2)}\n`),
    fs.writeFile(publicOutputPath, `${JSON.stringify(publicData, null, 2)}\n`),
    fs.writeFile(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`),
  ]);
  console.log(`Matched ${report.matchedBooks} catalog books across ${appearances.length} weekly list appearances.`);
}

async function latestPublishedDate(listName: string) {
  const cachePath = path.join(cacheRoot, listName, "current.json");
  const response = await fetchList(`current`, listName);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(response, null, 2)}\n`);
  const publishedDate = response.results?.published_date;
  if (!publishedDate) throw new Error(`NYT did not return a published date for ${listName}.`);
  return publishedDate;
}

async function readOrFetchList(listName: string, date: string) {
  const cachePath = path.join(cacheRoot, listName, `${date}.json`);
  try {
    const response = JSON.parse(await fs.readFile(cachePath, "utf8")) as NytListResponse;
    response._source = "nyt_api";
    return { response, cached: true };
  } catch {
    const response = await fetchList(date, listName);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(response, null, 2)}\n`);
    response._source = "nyt_api";
    return { response, cached: false };
  }
}

async function fetchList(date: string, listName: string) {
  const url = new URL(`https://api.nytimes.com/svc/books/v3/lists/${date}/${listName}.json`);
  url.searchParams.set("api-key", apiKey as string);
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let retryDelay = 1_000 * (attempt + 1);
    if (delayMs) await wait(delayMs);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const json = await response.json() as NytListResponse;
      if (response.ok && json.status === "OK" && json.results) return json;
      const message = json.errors?.join(", ") || `${response.status} ${response.statusText}`;
      if (response.status !== 429 && response.status < 500) throw new Error(`NYT Books API: ${message}`);
      lastError = new Error(`NYT Books API: ${message}`);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        retryDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 15_000 * (attempt + 1);
      }
    } catch (error) {
      lastError = error;
    }
    await wait(retryDelay);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function matchResponses(responses: NytListResponse[]) {
  const byIsbn = new Map<string, Book[]>();
  const byTitle = new Map<string, Book[]>();
  for (const book of data.books) {
    for (const isbn of book.isbn13.flatMap(isbnVariants)) {
      const books = byIsbn.get(isbn) ?? [];
      books.push(book);
      byIsbn.set(isbn, books);
    }
    for (const title of titleKeys(book)) {
      const books = byTitle.get(title) ?? [];
      books.push(book);
      byTitle.set(title, books);
    }
  }

  const deduped = new Map<string, MatchedAppearance>();
  let unmatchedEntries = 0;
  for (const response of responses) {
    const listName = response.results?.list_name_encoded;
    const displayName = response.results?.display_name;
    const publishedDate = response.results?.published_date;
    if (!listName || !displayName || !publishedDate) continue;
    for (const nytBook of response.results?.books ?? []) {
      const match = matchBook(nytBook, byIsbn, byTitle);
      if (!match) {
        unmatchedEntries += 1;
        continue;
      }
      const row: MatchedAppearance = {
        bookId: match.book.id,
        listName,
        displayName,
        publishedDate,
        rank: positiveNumber(nytBook.rank, 0),
        weeksOnList: positiveNumber(nytBook.weeks_on_list, 0),
        matchedBy: match.matchedBy,
        source: response._source ?? "nyt_api",
      };
      const key = `${row.bookId}|${row.listName}|${row.publishedDate}`;
      const existing = deduped.get(key);
      if (!existing || row.rank < existing.rank) deduped.set(key, row);
    }
  }
  return {
    appearances: [...deduped.values()].sort((left, right) => left.publishedDate.localeCompare(right.publishedDate) || left.rank - right.rank),
    unmatchedEntries,
  };
}

function matchBook(nytBook: NytBook, byIsbn: Map<string, Book[]>, byTitle: Map<string, Book[]>) {
  const isbns = [
    nytBook.primary_isbn13,
    nytBook.primary_isbn10,
    ...(nytBook.isbns ?? []).flatMap((value) => [value.isbn13, value.isbn10]),
  ].flatMap(isbnVariants);
  for (const isbn of isbns) {
    const candidates = byIsbn.get(isbn) ?? [];
    if (candidates.length === 1) return { book: candidates[0], matchedBy: "isbn13" as const };
    if (candidates.length > 1) {
      const titled = candidates.find((book) => titleKeys(book).includes(normalizeTitle(nytBook.title ?? "")));
      if (titled) return { book: titled, matchedBy: "isbn13" as const };
    }
  }

  const title = normalizeTitle(nytBook.title ?? "");
  const candidates = byTitle.get(title) ?? [];
  const author = normalizeText(nytBook.author ?? "");
  const authorMatches = candidates.filter((book) => book.authors.some((person) => authorsMatch(normalizeText(person.name), author)));
  if (authorMatches.length === 1) return { book: authorMatches[0], matchedBy: "title_author" as const };
  return undefined;
}

function buildPatch(appearances: MatchedAppearance[], generatedAt: string): GeneratedPatch {
  const grouped = groupBy(appearances, (row) => row.bookId);
  const books: Record<string, Partial<Book>> = {};
  for (const [bookId, rows] of grouped) {
    const byList = groupBy(rows, (row) => row.listName);
    const stats: NytBestsellerStats = {
      provider: "new_york_times",
      matchedBy: rows.some((row) => row.matchedBy === "isbn13") ? "isbn13" : "title_author",
      firstPublishedDate: minString(rows.map((row) => row.publishedDate)),
      latestPublishedDate: maxString(rows.map((row) => row.publishedDate)),
      bestRank: Math.min(...rows.map((row) => row.rank)),
      weeksOnList: Math.max(new Set(rows.map((row) => row.publishedDate)).size, ...rows.map((row) => row.weeksOnList)),
      appearances: rows.length,
      lists: [...byList.entries()].map(([listName, listRows]) => ({
        listName,
        displayName: listRows[0].displayName,
        firstPublishedDate: minString(listRows.map((row) => row.publishedDate)),
        latestPublishedDate: maxString(listRows.map((row) => row.publishedDate)),
        bestRank: Math.min(...listRows.map((row) => row.rank)),
        weeksOnList: Math.max(new Set(listRows.map((row) => row.publishedDate)).size, ...listRows.map((row) => row.weeksOnList)),
        appearances: listRows.length,
      })).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    };
    const sourceIds = [...new Set(rows.map((row) => row.source === "barabasi_research" ? researchSourceId : sourceId))];
    books[bookId] = { nytBestseller: stats, sourceIds };
  }
  return {
    generatedAt,
    notes: "Generated from cached weekly New York Times Books API list snapshots. Matches use ISBN first and exact title plus author only as a fallback.",
    books,
    sources: {
      [sourceId]: {
        id: sourceId,
        label: "New York Times Books API — Best Sellers lists",
        url: "https://developer.nytimes.com/docs/books-product/1/overview",
        accessedAt: generatedAt.slice(0, 10),
        field: "nytBestseller",
        confidence: "official",
        note: "Weekly list snapshots from the official Books API; API keys are never stored in generated data.",
      },
      [researchSourceId]: {
        id: researchSourceId,
        label: "Barabási Lab — NYT hardcover bestseller rankings, 2008–2016",
        url: researchDownloadUrl,
        accessedAt: generatedAt.slice(0, 10),
        field: "nytBestseller",
        confidence: "secondary",
        note: "Weekly rankings released with the peer-reviewed Success in Books study; used for the historical API backfill.",
      },
    },
  };
}

function buildPublicData(appearances: MatchedAppearance[], responses: NytListResponse[], generatedAt: string, unmatchedEntries: number): PublicBestsellerData {
  const grouped = groupBy(responses.filter((response) => response.results?.published_date), (response) => response.results?.list_name_encoded ?? "unknown");
  const coverage = [...grouped.entries()].map(([listName, rows]) => {
    const dates = rows.map((row) => row.results?.published_date).filter((value): value is string => Boolean(value));
    return {
      listName,
      displayName: rows.find((row) => row.results?.display_name)?.results?.display_name ?? listName,
      startDate: minString(dates),
      endDate: maxString(dates),
      snapshots: new Set(dates).size,
    };
  });
  return { generatedAt, provider: "new_york_times", coverage, appearances, unmatchedEntries };
}

function weeklyDates(start: string, end: string) {
  const dates: string[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(endDate.getTime())) throw new Error("Dates must use YYYY-MM-DD.");
  for (; date <= endDate; date.setUTCDate(date.getUTCDate() + 7)) dates.push(date.toISOString().slice(0, 10));
  return dates;
}

async function loadResearchResponses(explicitZipPath: string | undefined): Promise<NytListResponse[]> {
  const zipPath = explicitZipPath
    ? path.resolve(explicitZipPath)
    : path.join(root, "data", "cache", "nyt-bestseller-history", "nytb2008-2016.zip");
  try {
    await fs.access(zipPath);
  } catch {
    console.log("Downloading the Barabási Lab 2008–2016 ranking archive...");
    const response = await fetch(researchDownloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Could not download historical bestseller archive: ${response.status} ${response.statusText}`);
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  }
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, "nytb2008-2016Nonfiction.csv"], {
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  const { stdout: infoCsv } = await execFileAsync("unzip", ["-p", zipPath, "isbnToInfo.csv"], {
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  const infoRows = parseCsv(infoCsv);
  const infoHeader = infoRows[0].map((value) => value.replace(/^\uFEFF/, ""));
  const isbnIndex = infoHeader.indexOf("isbn");
  const authorIndex = infoHeader.indexOf("Author_NY");
  const titleIndex = infoHeader.indexOf("Title_NY");
  const infoByIsbn = new Map(infoRows.slice(1).map((row) => [normalizeIsbn(row[isbnIndex]), {
    author: decodeHtml(row[authorIndex] ?? ""),
    title: decodeHtml(row[titleIndex] ?? ""),
  }]));
  const lines = stdout.trim().split(/\r?\n/);
  const ranks = lines[0].split(",").slice(1).map(Number);
  return lines.slice(1).map((line) => {
    const [publishedDate, ...isbns] = line.split(",");
    return {
      _source: "barabasi_research",
      status: "OK",
      results: {
        display_name: "Hardcover Nonfiction",
        list_name_encoded: defaultList,
        published_date: publishedDate,
        books: isbns.map((isbn, index) => {
          const info = infoByIsbn.get(normalizeIsbn(isbn));
          return { primary_isbn10: isbn, rank: ranks[index], author: info?.author, title: info?.title };
        }),
      },
    } satisfies NytListResponse;
  });
}

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function decodeHtml(value: string) {
  return value.replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function titleKeys(book: Book) {
  return [...new Set([
    normalizeTitle(book.title),
    normalizeTitle(`${book.title} ${book.subtitle ?? ""}`),
  ].filter(Boolean))];
}

function normalizeTitle(value: string) {
  return normalizeText(value).replace(/\b(?:a|an|the)\b/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function authorsMatch(catalogAuthor: string, nytAuthor: string) {
  if (!catalogAuthor || !nytAuthor) return false;
  if (catalogAuthor === nytAuthor || nytAuthor.includes(catalogAuthor) || catalogAuthor.includes(nytAuthor)) return true;
  const catalogLast = catalogAuthor.split(" ").at(-1);
  const nytTokens = new Set(nytAuthor.split(" "));
  return Boolean(catalogLast && catalogLast.length >= 4 && nytTokens.has(catalogLast));
}

function normalizeIsbn(value: string | undefined) {
  return (value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function isbnVariants(value: string | undefined) {
  const normalized = normalizeIsbn(value);
  if (!normalized) return [];
  const variants = [normalized];
  if (/^978\d{10}$/.test(normalized)) {
    const body = normalized.slice(3, 12);
    let sum = 0;
    for (let index = 0; index < body.length; index += 1) sum += Number(body[index]) * (10 - index);
    const remainder = (11 - (sum % 11)) % 11;
    variants.push(`${body}${remainder === 10 ? "X" : remainder}`);
  } else if (/^\d{9}[\dX]$/.test(normalized)) {
    const body = `978${normalized.slice(0, 9)}`;
    let sum = 0;
    for (let index = 0; index < body.length; index += 1) sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
    variants.push(`${body}${(10 - (sum % 10)) % 10}`);
  }
  return [...new Set(variants)];
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function minString(values: string[]) {
  return [...values].sort()[0] ?? "";
}

function maxString(values: string[]) {
  return [...values].sort().at(-1) ?? "";
}

function positiveNumber(value: string | number | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || process.env[match[1]] !== undefined) continue;
        process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      }
    } catch {
      // Optional file.
    }
  }
}

await main();
