import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "../lib/data";
import type { Book, PublisherEvidence, SourceRef, WikipediaBookEvidence } from "../lib/types";

type WikipediaGeneratedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
  wikipediaEvidence: Record<string, WikipediaBookEvidence>;
  publisherEvidence: Record<string, PublisherEvidence[]>;
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  status: "enriched" | "not_found" | "low_confidence" | "skipped" | "error";
  pageTitle?: string;
  url?: string;
  score?: number;
  confidence?: "high" | "medium" | "low";
  publisher?: string;
  notes?: string;
};

type QueryPage = {
  pageid?: number;
  ns?: number;
  title: string;
  missing?: boolean;
  pageprops?: {
    wikibase_item?: string;
  };
  revisions?: Array<{
    revid?: number;
    timestamp?: string;
    slots?: {
      main?: {
        "*": string;
        content?: string;
      };
    };
    "*": string;
  }>;
  extract?: string;
};

type CandidatePage = {
  title: string;
  pageId?: number;
  wikidataId?: string;
  revisionId?: number;
  revisionTimestamp?: string;
  extract?: string;
  wikitext: string;
  infobox: WikipediaBookEvidence["infobox"];
};

type MatchResult = {
  page: CandidatePage;
  score: number;
  confidence: "high" | "medium" | "low";
  accepted: boolean;
  matchedBy: string;
  note?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const outputPath = path.join(outputDir, "wikipedia.generated.json");
const reportPath = path.join(publicDataDir, "wikipedia-enrichment-report.json");
const limit = positiveNumber(readArg("--limit") ?? process.env.WIKIPEDIA_ENRICH_LIMIT, 25);
const concurrency = positiveNumber(readArg("--concurrency") ?? process.env.WIKIPEDIA_ENRICH_CONCURRENCY, 1);
const minRequestInterval = positiveNumber(readArg("--request-delay") ?? process.env.WIKIPEDIA_ENRICH_REQUEST_DELAY, 900);
const minScore = Number(readArg("--min-score") ?? process.env.WIKIPEDIA_ENRICH_MIN_SCORE ?? "0.74");
const retry = hasArg("--retry") || process.env.WIKIPEDIA_ENRICH_RETRY === "1";
const requestedBookIds = new Set((readArg("--book-ids") ?? process.env.WIKIPEDIA_ENRICH_BOOK_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
let lastRequestAt = 0;

async function main() {
  const generatedAt = new Date().toISOString();
  const patch = await readExistingPatch(generatedAt);
  const selected = selectBooks(patch).slice(0, limit);
  const results = await mapConcurrent(selected, concurrency, (book, index) => enrichBook(book, index + 1, selected.length, generatedAt, patch));
  const report = results.map((row) => row.report);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(sortPatch(patch), null, 2)}\n`);
  await fs.writeFile(
    reportPath,
    `${JSON.stringify({
      generatedAt,
      limit,
      concurrency,
      minScore,
      requestDelay: minRequestInterval,
      selectedCount: selected.length,
      enrichedCount: report.filter((row) => row.status === "enriched").length,
      cachedEvidenceCount: Object.keys(patch.wikipediaEvidence).length,
      cachedPublisherEvidenceBooks: Object.keys(patch.publisherEvidence).length,
      report,
    }, null, 2)}\n`,
  );

  console.log(`Enriched ${report.filter((row) => row.status === "enriched").length}/${selected.length} books with Wikipedia evidence.`);
}

async function enrichBook(
  book: Book,
  index: number,
  total: number,
  generatedAt: string,
  patch: WikipediaGeneratedPatch,
): Promise<{ report: ReportRow }> {
  const author = book.authors.map((item) => item.name).join(", ");
  try {
    console.log(`[${index}/${total}] Wikipedia lookup for ${book.title} - ${author}`);
    const candidates = await fetchCandidatePages(book);
    const best = candidates.map((page) => scoreCandidate(book, page)).sort((a, b) => b.score - a.score)[0];
    if (!best) return { report: reportRow(book, "not_found", { notes: "No candidate Wikipedia page found." }) };
    if (!best.accepted) {
      return {
        report: reportRow(book, best.score >= minScore ? "low_confidence" : "not_found", {
          pageTitle: best.page.title,
          url: wikipediaUrl(best.page.title),
          score: best.score,
          confidence: best.confidence,
          publisher: best.page.infobox?.publisher,
          notes: best.note ?? "Candidate did not pass title/author/bookness checks.",
        }),
      };
    }

    const sourceId = `source-wikipedia-${book.slug}`;
    const wikidataUrl = best.page.wikidataId ? `https://www.wikidata.org/wiki/${best.page.wikidataId}` : undefined;
    const pageUrl = wikipediaUrl(best.page.title);
    const sourceIds = new Set([...(patch.books[book.id]?.sourceIds ?? book.sourceIds), sourceId]);
    patch.books[book.id] = mergeBookPatch(patch.books[book.id] ?? {}, {
      links: {
        ...(patch.books[book.id]?.links ?? {}),
        wikipedia: pageUrl,
        ...(wikidataUrl ? { wikidata: wikidataUrl } : {}),
      },
      sourceIds: [...sourceIds],
    });
    patch.sources[sourceId] = {
      id: sourceId,
      label: `Wikipedia article for ${book.title}`,
      url: pageUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "book",
      note: best.page.revisionId ? `Matched by ${best.matchedBy}; revision ${best.page.revisionId}.` : `Matched by ${best.matchedBy}.`,
    };

    const publisherEvidenceId = best.page.infobox?.publisher
      ? `publisher-evidence-wikipedia-${book.slug}`
      : undefined;
    patch.wikipediaEvidence[book.id] = {
      bookId: book.id,
      pageTitle: best.page.title,
      pageId: best.page.pageId,
      wikidataId: best.page.wikidataId,
      url: pageUrl,
      revisionId: best.page.revisionId,
      accessedAt: generatedAt,
      extract: cleanExtract(best.page.extract),
      matchedBy: best.matchedBy,
      confidence: best.confidence,
      attribution: {
        label: "Wikipedia",
        url: pageUrl,
        license: "CC BY-SA",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      infobox: best.page.infobox,
      publisherEvidenceId,
    };

    if (publisherEvidenceId && best.page.infobox?.publisher) {
      const evidence: PublisherEvidence = {
        id: publisherEvidenceId,
        bookId: book.id,
        rawName: best.page.infobox.publisher,
        source: "wikipedia_infobox",
        confidence: best.confidence === "low" ? "medium" : best.confidence,
        sourceUrl: pageUrl,
        sourceId,
        note: `Publisher field from the Wikipedia infobox for "${best.page.title}". Normalize through sources/imprint-normalization.json before assigning a public imprint.`,
      };
      patch.publisherEvidence[book.id] = upsertPublisherEvidence(patch.publisherEvidence[book.id] ?? [], evidence);
    }

    return {
      report: reportRow(book, "enriched", {
        pageTitle: best.page.title,
        url: pageUrl,
        score: best.score,
        confidence: best.confidence,
        publisher: best.page.infobox?.publisher,
        notes: best.matchedBy,
      }),
    };
  } catch (error) {
    return { report: reportRow(book, "error", { notes: error instanceof Error ? error.message : String(error) }) };
  }
}

function selectBooks(patch: WikipediaGeneratedPatch) {
  const books = requestedBookIds.size
    ? data.books.filter((book) => requestedBookIds.has(book.id) || requestedBookIds.has(book.slug))
    : data.books;
  return books
    .filter((book) => retry || !book.links.wikipedia || !patch.wikipediaEvidence[book.id])
    .filter((book) => retry || !patch.wikipediaEvidence[book.id])
    .sort((a, b) => wikipediaPriorityScore(b) - wikipediaPriorityScore(a) || a.title.localeCompare(b.title));
}

function wikipediaPriorityScore(book: Book) {
  const stats = getBookStats(book.id);
  let score = stats.majorWins * 40 + stats.wins * 18 + stats.majorShortlists * 9 + stats.score;
  if (!book.publisherId) score += 12;
  if (!book.imprintId) score += 10;
  if (!book.links.wikipedia) score += 8;
  if (!book.summary) score += 3;
  if (!book.isbn13.length) score += 3;
  return score;
}

async function fetchCandidatePages(book: Book): Promise<CandidatePage[]> {
  const titles = [...new Set([
    book.title,
    titleWithoutSubtitle(book.title),
    `${titleWithoutSubtitle(book.title)} (book)`,
    `${book.title} (book)`,
  ].map((title) => title.trim()).filter(Boolean))];
  const exactPages = await fetchPagesByTitle(titles);
  const validExactPages = exactPages.filter((page) => page.wikitext || page.extract);
  if (validExactPages.some((page) => scoreCandidate(book, page).score >= 0.92)) return dedupePages(validExactPages);

  const searchTitles = await searchWikipedia(`${titleWithoutSubtitle(book.title)} ${book.authors[0]?.name ?? ""}`);
  const searchedPages = await fetchPagesByTitle(searchTitles.slice(0, 6));
  return dedupePages([...validExactPages, ...searchedPages]);
}

async function fetchPagesByTitle(titles: string[]): Promise<CandidatePage[]> {
  if (!titles.length) return [];
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    redirects: "1",
    prop: "extracts|pageprops|revisions",
    exintro: "1",
    explaintext: "1",
    rvprop: "ids|timestamp|content",
    rvslots: "main",
    titles: titles.join("|"),
  });
  const json = await fetchJson<{ query?: { pages?: Record<string, QueryPage> } }>(`https://en.wikipedia.org/w/api.php?${params}`);
  return Object.values(json.query?.pages ?? {})
    .filter((page) => !page.missing && page.ns === 0)
    .map(pageToCandidate);
}

async function searchWikipedia(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "opensearch",
    format: "json",
    namespace: "0",
    limit: "8",
    search: query,
  });
  const json = await fetchJson<[string, string[]]>(`https://en.wikipedia.org/w/api.php?${params}`);
  return json[1] ?? [];
}

function pageToCandidate(page: QueryPage): CandidatePage {
  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.["*"] ?? revision?.slots?.main?.content ?? revision?.["*"] ?? "";
  return {
    title: page.title,
    pageId: page.pageid,
    wikidataId: page.pageprops?.wikibase_item,
    revisionId: revision?.revid,
    revisionTimestamp: revision?.timestamp,
    extract: cleanExtract(page.extract),
    wikitext,
    infobox: parseBookInfobox(wikitext),
  };
}

function scoreCandidate(book: Book, page: CandidatePage): MatchResult {
  const authorText = book.authors.map((item) => item.name).join(" ");
  const titleScore = Math.max(
    similarity(book.title, removeParenthetical(page.title)),
    similarity(titleWithoutSubtitle(book.title), removeParenthetical(page.title)),
    page.infobox?.title ? similarity(book.title, page.infobox.title) : 0,
  );
  const authorScore = Math.max(
    page.infobox?.author ? similarity(authorText, page.infobox.author) : 0,
    containsAuthorSignal(page, book) ? 0.72 : 0,
  );
  const yearScore = book.publicationYear && page.infobox?.publicationDate?.includes(String(book.publicationYear)) ? 0.12 : 0;
  const isbnScore = book.isbn13.some((isbn) => page.infobox?.isbn?.replace(/[^0-9X]/gi, "").includes(isbn.replace(/[^0-9X]/gi, ""))) ? 0.12 : 0;
  const bookness = isBookPage(page) ? 0.12 : 0;
  const score = Number(Math.min(1, titleScore * 0.64 + authorScore * 0.24 + yearScore + isbnScore + bookness).toFixed(3));
  const accepted = score >= minScore && titleScore >= 0.72 && (authorScore >= 0.35 || bookness > 0);
  const confidence = score >= 0.9 && authorScore >= 0.5 ? "high" : score >= minScore ? "medium" : "low";
  return {
    page,
    score,
    confidence,
    accepted,
    matchedBy: `${page.infobox ? "infobox_book" : "page"}:${confidence}`,
    note: accepted ? undefined : `title=${titleScore.toFixed(2)} author=${authorScore.toFixed(2)} bookness=${bookness.toFixed(2)}`,
  };
}

function parseBookInfobox(wikitext: string): WikipediaBookEvidence["infobox"] | undefined {
  const template = extractTemplate(wikitext, "infobox book");
  if (!template) return undefined;
  const fields = parseTemplateFields(template);
  const infobox = {
    title: firstField(fields, ["name", "title"]),
    author: firstField(fields, ["author", "authors"]),
    publisher: firstField(fields, ["publisher"]),
    publicationDate: firstField(fields, ["pub_date", "published", "release_date", "publication_date"]),
    publicationPlace: firstField(fields, ["country", "set_in"]),
    pages: firstField(fields, ["pages"]),
    isbn: firstField(fields, ["isbn", "isbn13", "isbn_note"]),
    language: firstField(fields, ["language"]),
    subject: firstField(fields, ["subject"]),
    genre: firstField(fields, ["genre"]),
  };
  const cleaned = Object.fromEntries(Object.entries(infobox).filter(([, value]) => value)) as NonNullable<WikipediaBookEvidence["infobox"]>;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function extractTemplate(wikitext: string, name: string) {
  const pattern = new RegExp(`{{\\s*${escapeRegExp(name)}\\b`, "i");
  const match = pattern.exec(wikitext);
  if (!match) return undefined;
  let depth = 0;
  for (let index = match.index; index < wikitext.length - 1; index += 1) {
    const pair = wikitext.slice(index, index + 2);
    if (pair === "{{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === "}}") {
      depth -= 1;
      index += 1;
      if (depth === 0) return wikitext.slice(match.index, index + 1);
    }
  }
  return undefined;
}

function parseTemplateFields(template: string) {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;
  for (const line of template.split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (fieldMatch) {
      currentKey = fieldMatch[1].trim().toLowerCase();
      fields.set(currentKey, fieldMatch[2].trim());
      continue;
    }
    if (currentKey && line.trim()) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ""} ${line.trim()}`.trim());
    }
  }
  return fields;
}

function firstField(fields: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = cleanWikitext(fields.get(key) ?? "");
    if (value) return value;
  }
  return undefined;
}

function cleanWikitext(value: string) {
  let output = value
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref[^/>]*\/>/gi, " ")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/{{\s*ISBN\s*\|\s*([^}|]+)[^}]*}}/gi, "$1")
    .replace(/{{\s*nowrap\s*\|\s*([^}]+)}}/gi, "$1");
  for (let index = 0; index < 4; index += 1) {
    output = output.replace(/{{[^{}]*}}/g, " ");
  }
  return output
    .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, "$2")
    .replace(/\[\[([^\]]+)]]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*[\-|:;]\s*/, "")
    .trim();
}

function cleanExtract(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim();
}

function isBookPage(page: CandidatePage) {
  const text = `${page.extract ?? ""} ${page.wikitext.slice(0, 1800)}`.toLowerCase();
  return Boolean(page.infobox) || /\b(book|non[- ]fiction|memoir|biography|novel|essay collection)\b/.test(text);
}

function containsAuthorSignal(page: CandidatePage, book: Book) {
  const text = `${page.infobox?.author ?? ""} ${page.extract ?? ""} ${page.wikitext.slice(0, 2200)}`.toLowerCase();
  return book.authors.some((author) => {
    const tokens = author.name.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    const surname = tokens.at(-1);
    return Boolean(surname && text.includes(surname) && tokens.some((token) => text.includes(token)));
  });
}

function upsertPublisherEvidence(existing: PublisherEvidence[], incoming: PublisherEvidence[]) : PublisherEvidence[];
function upsertPublisherEvidence(existing: PublisherEvidence[], incoming: PublisherEvidence) : PublisherEvidence[];
function upsertPublisherEvidence(existing: PublisherEvidence[], incoming: PublisherEvidence | PublisherEvidence[]) {
  const incomingItems = Array.isArray(incoming) ? incoming : [incoming];
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incomingItems) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence) || a.rawName.localeCompare(b.rawName));
}

function confidenceRank(confidence: PublisherEvidence["confidence"]) {
  return confidence === "high" ? 0 : confidence === "medium" ? 1 : 2;
}

function reportRow(book: Book, status: ReportRow["status"], values: Partial<ReportRow> = {}): ReportRow {
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((item) => item.name).join(", "),
    status,
    ...values,
  };
}

async function readExistingPatch(generatedAt: string): Promise<WikipediaGeneratedPatch> {
  try {
    const existing = JSON.parse(await fs.readFile(outputPath, "utf8")) as Partial<WikipediaGeneratedPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-wikipedia-books.ts from matched Wikipedia book pages. Wikipedia prose is used only as attributed short reference context; infobox publisher strings are raw evidence for imprint normalization.",
      books: existing.books ?? {},
      sources: existing.sources ?? {},
      wikipediaEvidence: existing.wikipediaEvidence ?? {},
      publisherEvidence: existing.publisherEvidence ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-wikipedia-books.ts from matched Wikipedia book pages. Wikipedia prose is used only as attributed short reference context; infobox publisher strings are raw evidence for imprint normalization.",
      books: {},
      sources: {},
      wikipediaEvidence: {},
      publisherEvidence: {},
    };
  }
}

function sortPatch(patch: WikipediaGeneratedPatch): WikipediaGeneratedPatch {
  return {
    ...patch,
    books: sortObject(patch.books),
    sources: sortObject(patch.sources),
    wikipediaEvidence: sortObject(patch.wikipediaEvidence),
    publisherEvidence: sortObject(patch.publisherEvidence),
  };
}

function sortObject<T>(value: Record<string, T>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function mergeBookPatch(current: Partial<Book>, next: Partial<Book>): Partial<Book> {
  return {
    ...current,
    ...next,
    links: { ...(current.links ?? {}), ...(next.links ?? {}) },
    sourceIds: [...new Set([...(current.sourceIds ?? []), ...(next.sourceIds ?? [])])],
  };
}

function dedupePages(pages: CandidatePage[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = String(page.pageId ?? page.title.toLowerCase());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson<T>(url: string, retries = 4): Promise<T> {
  await throttleRequests();
  const response = await fetch(url, {
    headers: { "User-Agent": "book-prize-index-wikipedia-enrichment/0.1 (metadata enrichment; contact: local)" },
    signal: AbortSignal.timeout(12_000),
  });
  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2500 * (5 - retries);
    await delay(retryDelay);
    return fetchJson<T>(url, retries - 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return await response.json() as T;
}

async function throttleRequests() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + minRequestInterval - now);
  if (wait > 0) await delay(wait);
  lastRequestAt = Date.now();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapConcurrent<T, R>(items: T[], width: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function wikipediaUrl(title: string) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_")).replace(/%2F/g, "/")}`;
}

function titleWithoutSubtitle(input: string) {
  return input.split(/:|\(|\[/)[0]?.trim() || input;
}

function removeParenthetical(input: string) {
  return input.replace(/\s+\([^)]*\)\s*$/g, "").trim();
}

function similarity(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function tokenize(input: string) {
  return removeParenthetical(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["the", "and", "book"].includes(token));
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
