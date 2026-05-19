import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Book, BookStats, SourceRef } from "../lib/types";
import {
  enrichmentLaneForBook,
  parseLane,
  type EnrichmentAttemptLike,
} from "./book-enrichment-priority";

type CatalogData = {
  books: Book[];
  appearances?: Array<{ bookId: string; year: number }>;
  stats: BookStats[];
  sources?: Record<string, SourceRef> | SourceRef[];
};

type CacheFile = {
  generatedAt?: string;
  entries?: Record<string, {
    fetchedAt: string;
    ok: boolean;
    status?: number;
    body?: unknown;
    error?: string;
  }>;
};

type OpenLibrarySearchDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
};

type OpenLibraryEdition = {
  key?: string;
  title?: string;
  subtitle?: string;
  authors?: { key?: string }[];
  publishers?: string[];
  publish_date?: string;
  publish_places?: string[];
  languages?: { key?: string }[];
  physical_format?: string;
  number_of_pages?: number;
  isbn_13?: string[];
  isbn_10?: string[];
  covers?: number[];
  works?: { key?: string }[];
};

type Candidate = {
  isbn13: string;
  editionKey?: string;
  title?: string;
  publisher?: string;
  publishDate?: string;
  publishYear?: number;
  physicalFormat?: string;
  pages?: number;
  coverId?: number;
  score: number;
  reasons: string[];
  warnings: string[];
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  firstRecognitionYear?: number;
  inputSignature: string;
  recognitionScore: number;
  status: "selected" | "ambiguous" | "not_found" | "low_confidence" | "error";
  selected?: Candidate;
  candidates: Candidate[];
  notes?: string;
};

type IsbnAttemptRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  status: ReportRow["status"];
  attemptedAt: string;
  inputSignature: string;
  selectedIsbn13?: string;
  notes?: string;
  candidates?: Candidate[];
};

type GeneratedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "public", "catalog.json");
const outputPath = path.join(root, "sources", "enrichment", "isbn.generated.json");
const reportPath = path.join(root, "data", "public", "isbn-discovery-report.json");
const reviewPath = path.join(root, "data", "public", "isbn-review-queue.json");
const cachePath = path.join(root, "data", "public", "isbn-discovery-cache.json");
const isbnAttemptsPath = path.join(root, "data", "public", "isbn-discovery-attempts.json");
const attemptsPath = path.join(root, "data", "public", "book-enrichment-attempts.json");
const limit = positiveNumber(readArg("--limit") ?? process.env.ISBN_DISCOVERY_LIMIT, 100);
const minScore = Number(readArg("--min-score") ?? process.env.ISBN_DISCOVERY_MIN_SCORE ?? "0.72");
const concurrency = positiveNumber(readArg("--concurrency") ?? process.env.ISBN_DISCOVERY_CONCURRENCY, 2);
const requestDelayMs = positiveNumber(readArg("--request-delay-ms") ?? process.env.ISBN_DISCOVERY_REQUEST_DELAY_MS, 350);
const checkpointEvery = positiveNumber(readArg("--checkpoint-every") ?? process.env.ISBN_DISCOVERY_CHECKPOINT_EVERY, 0);
const requestedLane = parseLane(readArg("--lane") ?? process.env.ISBN_DISCOVERY_LANE);
const retryFailures = process.argv.includes("--retry-failures") || process.env.ISBN_DISCOVERY_RETRY_FAILURES === "1";
const allowEquivalentEditionTies =
  process.argv.includes("--allow-equivalent-edition-ties") || process.env.ISBN_DISCOVERY_ALLOW_EQUIVALENT_EDITION_TIES === "1";
let cache: NonNullable<CacheFile["entries"]> = {};
let lastRequestAt = 0;

async function main() {
  const generatedAt = new Date().toISOString();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as CatalogData;
  cache = await readCache();
  const attempts = await readAttempts();
  const isbnAttempts = await readIsbnAttempts();
  const previousReviewBookIds = retryFailures ? new Set<string>() : await readPreviousReviewBookIds();
  const statsByBook = new Map(catalog.stats.map((stat) => [stat.bookId, stat]));
  const laneCandidates = catalog.books
    .filter((book) => !book.isbn13.length)
    .filter((book) => !previousReviewBookIds.has(book.id))
    .map((book) => {
      const firstRecognitionYear = firstRecognitionYearForBook(catalog, book.id);
      return { book, stats: statsByBook.get(book.id), firstRecognitionYear, inputSignature: isbnAttemptSignature(book, firstRecognitionYear) };
    })
    .filter((row) => !requestedLane || enrichmentLaneForBook(row.book, statsFor(row.stats), attempts[row.book.id]) === requestedLane);
  const candidates = laneCandidates
    .filter((row) => retryFailures || !isReusableIsbnAttempt(isbnAttempts[row.book.id], row.inputSignature));
  const selected = candidates
    .sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0) || a.book.title.localeCompare(b.book.title))
    .slice(0, limit);

  const report: ReportRow[] = [];
  const existingPatch = await readExistingPatch();
  const catalogPatch = buildCatalogPatch(catalog);
  let completedCount = 0;
  let checkpointChain = Promise.resolve();

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const checkpoint = async (force = false) => {
    if (!force && (!checkpointEvery || completedCount % checkpointEvery !== 0)) return;
    const patch = buildPatch(generatedAt, report, existingPatch, catalogPatch);
    const review = report.filter((row) => row.status !== "selected");
    const nextIsbnAttempts = mergeIsbnAttempts(isbnAttempts, report, generatedAt);
    await fs.writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`);
    await fs.writeFile(isbnAttemptsPath, `${JSON.stringify({ generatedAt, attempts: nextIsbnAttempts }, null, 2)}\n`);
    await fs.writeFile(
      reportPath,
      `${JSON.stringify({
        generatedAt,
        policy: "Select the earliest plausible English trade edition ISBN13 after filtering obvious ebooks, audiobooks, large-print editions, translations, excerpts, and school/library bindings. Award year is not used as the primary selector.",
        limit,
        minScore,
        concurrency,
        requestDelayMs,
        checkpointEvery,
        lane: requestedLane,
        retryFailures,
        allowEquivalentEditionTies,
        skippedPreviousReviewCount: previousReviewBookIds.size,
        skippedPreviousAttemptCount: laneCandidates.length - candidates.length,
        selectedCount: selected.length,
        completedCount,
        summary: summarize(report),
        report,
      }, null, 2)}\n`,
    );
    await fs.writeFile(
      reviewPath,
      `${JSON.stringify({
        generatedAt,
        count: review.length,
        review,
      }, null, 2)}\n`,
    );
    await writeCache();
  };

  await mapConcurrent(selected, concurrency, async ({ book, stats, firstRecognitionYear }, index) => {
    const row = await discoverBookIsbn(book, stats, firstRecognitionYear, index + 1, selected.length);
    checkpointChain = checkpointChain.then(async () => {
      report.push(row);
      completedCount += 1;
      await checkpoint();
    });
    await checkpointChain;
    return row;
  });
  await checkpointChain;
  await checkpoint(true);

  await fs.writeFile(
    reportPath,
    `${JSON.stringify({
      generatedAt,
      policy: "Select the earliest plausible English trade edition ISBN13 after filtering obvious ebooks, audiobooks, large-print editions, translations, excerpts, and school/library bindings. Award year is not used as the primary selector.",
      limit,
      minScore,
      concurrency,
      requestDelayMs,
      checkpointEvery,
      lane: requestedLane,
      retryFailures,
      allowEquivalentEditionTies,
      skippedPreviousReviewCount: previousReviewBookIds.size,
      skippedPreviousAttemptCount: laneCandidates.length - candidates.length,
      selectedCount: selected.length,
      completedCount,
      summary: summarize(report),
      report,
    }, null, 2)}\n`,
  );

  console.log(`Discovered ISBNs for ${report.filter((row) => row.status === "selected").length}/${selected.length} books.`);
  console.log("Report written to data/public/isbn-discovery-report.json.");
}

async function discoverBookIsbn(book: Book, stats: BookStats | undefined, firstRecognitionYear: number | undefined, index: number, total: number): Promise<ReportRow> {
  const author = book.authors.map((item) => item.name).join(", ");
  console.log(`[${index}/${total}] Discovering ISBN for ${book.title}`);
  const base = {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author,
    publicationYear: book.publicationYear,
    firstRecognitionYear,
    inputSignature: isbnAttemptSignature(book, firstRecognitionYear),
    recognitionScore: stats?.score ?? 0,
  };

  try {
    const work = await findOpenLibraryWork(book, author);
    if (!work?.doc.key) return { ...base, status: "not_found", candidates: [], notes: "No strong Open Library work match." };

    const editions = await fetchOpenLibraryEditions(work.doc.key);
    const candidates = editions
      .map((edition) => candidateFromEdition(book, work.doc, edition, firstRecognitionYear))
      .filter((candidate): candidate is Candidate => Boolean(candidate))
      .sort(compareCandidates);

    if (!candidates.length) return { ...base, status: "not_found", candidates: [], notes: "No plausible ISBN13 editions after filtering." };
    const [best, second] = candidates;
    if (best.score < minScore) {
      return { ...base, status: "low_confidence", candidates: candidates.slice(0, 8), notes: "Best candidate did not meet minimum score." };
    }
    if (
      second &&
      best.publishYear === second.publishYear &&
      Math.abs(best.score - second.score) < 0.08 &&
      best.isbn13 !== second.isbn13 &&
      !(allowEquivalentEditionTies && isEquivalentEditionTie(best, second))
    ) {
      return { ...base, status: "ambiguous", candidates: candidates.slice(0, 8), notes: "Multiple earliest plausible ISBN candidates are too close to choose safely." };
    }
    return { ...base, status: "selected", selected: best, candidates: candidates.slice(0, 8) };
  } catch (error) {
    return { ...base, status: "error", candidates: [], notes: error instanceof Error ? error.message : String(error) };
  }
}

async function readAttempts(): Promise<Record<string, EnrichmentAttemptLike>> {
  try {
    const parsed = JSON.parse(await fs.readFile(attemptsPath, "utf8")) as { attempts?: Record<string, EnrichmentAttemptLike> };
    return parsed.attempts ?? {};
  } catch {
    return {};
  }
}

async function readPreviousReviewBookIds(): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(reviewPath, "utf8")) as { review?: Array<{ bookId?: string }> };
    return new Set((parsed.review ?? []).map((row) => row.bookId).filter((bookId): bookId is string => Boolean(bookId)));
  } catch {
    return new Set();
  }
}

async function readIsbnAttempts(): Promise<Record<string, IsbnAttemptRow>> {
  try {
    const parsed = JSON.parse(await fs.readFile(isbnAttemptsPath, "utf8")) as { attempts?: Record<string, IsbnAttemptRow> };
    return parsed.attempts ?? {};
  } catch {
    return {};
  }
}

function isReusableIsbnAttempt(attempt: IsbnAttemptRow | undefined, inputSignature: string) {
  if (!attempt || attempt.inputSignature !== inputSignature) return false;
  return attempt.status === "ambiguous" || attempt.status === "not_found" || attempt.status === "low_confidence" || attempt.status === "error";
}

function mergeIsbnAttempts(existing: Record<string, IsbnAttemptRow>, report: ReportRow[], generatedAt: string) {
  const next = { ...existing };
  for (const row of report) {
    next[row.bookId] = {
      bookId: row.bookId,
      slug: row.slug,
      title: row.title,
      author: row.author,
      status: row.status,
      attemptedAt: generatedAt,
      inputSignature: row.inputSignature,
      selectedIsbn13: row.selected?.isbn13,
      notes: row.notes,
      candidates: row.candidates.slice(0, 5),
    };
  }
  return next;
}

async function findOpenLibraryWork(book: Book, author: string) {
  const docs: OpenLibrarySearchDoc[] = [];
  for (const query of openLibraryQueries(book, author)) {
    const json = await fetchJson<{ docs?: OpenLibrarySearchDoc[] }>(`https://openlibrary.org/search.json?${query}`);
    docs.push(...(json.docs ?? []));
    const best = bestWorkMatch(book, author, docs);
    if (best?.score && best.score >= 0.92) break;
  }
  return bestWorkMatch(book, author, dedupeDocs(docs));
}

async function fetchOpenLibraryEditions(workKey: string) {
  const editions: OpenLibraryEdition[] = [];
  let offset = 0;
  while (offset < 300) {
    const params = new URLSearchParams({ limit: "100", offset: String(offset) });
    const json = await fetchJson<{ entries?: OpenLibraryEdition[] }>(`https://openlibrary.org${workKey}/editions.json?${params}`);
    const entries = json.entries ?? [];
    editions.push(...entries);
    if (entries.length < 100) break;
    offset += 100;
  }
  return editions;
}

function candidateFromEdition(book: Book, work: OpenLibrarySearchDoc, edition: OpenLibraryEdition, firstRecognitionYear?: number): Candidate | undefined {
  const isbn13 = firstIsbn13(edition.isbn_13 ?? []);
  if (!isbn13) return undefined;
  const title = [edition.title, edition.subtitle].filter(Boolean).join(": ");
  const titleScore = Math.max(similarity(book.title, title || work.title), similarity(titleWithoutSubtitle(book.title), title || work.title));
  if (titleScore < 0.62) return undefined;
  const publishYear = yearFromDate(edition.publish_date);
  const physicalFormat = edition.physical_format;
  const publisher = edition.publishers?.find(Boolean);
  const warnings = editionWarnings(edition);
  if (warnings.some((warning) => ["ebook", "audio", "large_print", "translation", "school_or_library_binding", "excerpt", "reprint_publisher", "adapted_edition"].includes(warning))) return undefined;
  if (publishYear && publishYear < 1900) return undefined;
  const baselineYear = book.publicationYear;
  if (baselineYear && publishYear && publishYear > baselineYear + 5) return undefined;
  if (firstRecognitionYear && publishYear && publishYear > firstRecognitionYear + 1) return undefined;

  let score = titleScore * 0.45;
  const reasons = [`title_match:${titleScore.toFixed(2)}`];
  if (publishYear) {
    const earlyBoost = Math.max(0, 0.22 - Math.min(publishYear - 1450, 600) / 6000);
    score += earlyBoost;
    reasons.push(`publish_year:${publishYear}`);
  } else {
    warnings.push("missing_publish_year");
  }
  if (isEnglish(edition)) {
    score += 0.16;
    reasons.push("english");
  } else {
    warnings.push("unknown_or_non_english");
  }
  if (isHardcoverLike(edition)) {
    score += 0.14;
    reasons.push("hardcover_like");
  } else if (isPaperbackLike(edition)) {
    warnings.push("paperback_like");
  }
  if (publisher) {
    score += 0.05;
    reasons.push(`publisher:${publisher}`);
  }
  if (edition.number_of_pages && edition.number_of_pages >= 80) {
    score += 0.04;
    reasons.push(`pages:${edition.number_of_pages}`);
  }
  if (edition.covers?.[0]) {
    score += 0.03;
    reasons.push("cover");
  }

  return {
    isbn13,
    editionKey: edition.key,
    title: title || work.title,
    publisher,
    publishDate: edition.publish_date,
    publishYear,
    physicalFormat,
    pages: edition.number_of_pages,
    coverId: edition.covers?.[0],
    score: Number(score.toFixed(4)),
    reasons,
    warnings,
  };
}

function isEquivalentEditionTie(best: Candidate, second: Candidate) {
  return (
    best.score >= 0.76 &&
    second.score >= 0.76 &&
    titleMatchReason(best) >= 0.95 &&
    titleMatchReason(second) >= 0.9 &&
    !best.warnings.length &&
    !second.warnings.some((warning) => warning !== "paperback_like")
  );
}

function titleMatchReason(candidate: Candidate) {
  const reason = candidate.reasons.find((item) => item.startsWith("title_match:"));
  const value = reason ? Number(reason.split(":")[1]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function firstRecognitionYearForBook(catalog: CatalogData, bookId: string) {
  const years = (catalog.appearances ?? [])
    .filter((appearance) => appearance.bookId === bookId)
    .map((appearance) => appearance.year)
    .filter((year) => Number.isFinite(year));
  return years.length ? Math.min(...years) : undefined;
}

function isbnAttemptSignature(book: Book, firstRecognitionYear: number | undefined) {
  const author = book.authors.map((item) => item.name).join(", ");
  return [
    normalizeForSignature(book.title),
    normalizeForSignature(author),
    book.publicationYear ?? "",
    firstRecognitionYear ?? "",
  ].join("|");
}

function normalizeForSignature(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function readExistingPatch(): Promise<GeneratedPatch | undefined> {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8")) as GeneratedPatch;
  } catch {
    return undefined;
  }
}

function buildCatalogPatch(catalog: CatalogData): GeneratedPatch | undefined {
  const patch: GeneratedPatch = {
    generatedAt: "",
    notes: "",
    books: {},
    sources: {},
  };
  for (const book of catalog.books) {
    const isbnSourceIds = (book.sourceIds ?? []).filter((sourceId) => sourceId.startsWith("source-open-library-isbn-"));
    if (!book.isbn13.length || !isbnSourceIds.length) continue;
    patch.books[book.id] = {
      isbn13: book.isbn13,
      sourceIds: isbnSourceIds,
    };
    for (const sourceId of isbnSourceIds) {
      const source = sourceFromCatalog(catalog, sourceId);
      if (source) patch.sources[sourceId] = source;
    }
  }
  return Object.keys(patch.books).length ? patch : undefined;
}

function sourceFromCatalog(catalog: CatalogData, sourceId: string): SourceRef | undefined {
  if (Array.isArray(catalog.sources)) return catalog.sources.find((source) => source.id === sourceId);
  return catalog.sources?.[sourceId];
}

function buildPatch(generatedAt: string, report: ReportRow[], existingPatch?: GeneratedPatch, catalogPatch?: GeneratedPatch): GeneratedPatch {
  const existing = sanitizeGeneratedPatch(existingPatch);
  const catalog = sanitizeGeneratedPatch(catalogPatch);
  const patch: GeneratedPatch = {
    generatedAt,
    notes: "Generated by scripts/discover-isbns.ts from Open Library work editions. Selects earliest plausible English trade ISBN13 candidates; manual curation may override.",
    books: {
      ...(existing?.books ?? {}),
      ...(catalog?.books ?? {}),
    },
    sources: {
      ...(existing?.sources ?? {}),
      ...(catalog?.sources ?? {}),
    },
  };
  for (const row of report) {
    if (row.status !== "selected" || !row.selected) continue;
    const sourceId = `source-open-library-isbn-${row.slug}`;
    patch.books[row.bookId] = {
      isbn13: [row.selected.isbn13],
      sourceIds: [sourceId],
    };
    patch.sources[sourceId] = {
      id: sourceId,
      label: `Open Library ISBN discovery for ${row.title}`,
      url: row.selected.editionKey ? `https://openlibrary.org${row.selected.editionKey}` : "",
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "isbn13",
      note: `Selected ISBN ${row.selected.isbn13} from the earliest plausible edition candidate. Reasons: ${row.selected.reasons.join("; ")}.`,
    };
  }
  return patch;
}

function sanitizeGeneratedPatch(patch?: GeneratedPatch): GeneratedPatch | undefined {
  if (!patch) return undefined;
  const sanitized: GeneratedPatch = {
    ...patch,
    books: {},
    sources: {},
  };
  for (const [bookId, bookPatch] of Object.entries(patch.books ?? {})) {
    const sourceIds = (bookPatch.sourceIds ?? []).filter((sourceId) => {
      const source = patch.sources?.[sourceId];
      return source && !hasImplausiblePublishYear(source);
    });
    if (!sourceIds.length) continue;
    sanitized.books[bookId] = {
      ...bookPatch,
      sourceIds,
    };
    for (const sourceId of sourceIds) {
      sanitized.sources[sourceId] = patch.sources[sourceId];
    }
  }
  return Object.keys(sanitized.books).length ? sanitized : undefined;
}

function hasImplausiblePublishYear(source: SourceRef) {
  const match = source.note?.match(/publish_year:(\d{3,4})/);
  return match ? Number(match[1]) < 1900 : false;
}

function openLibraryQueries(book: Book, author: string) {
  const mainAuthor = author.split(/\s+(?:and|&)\s+/i)[0]?.trim() || author;
  const shortTitle = titleWithoutSubtitle(book.title);
  return [
    new URLSearchParams({ title: book.title, author: mainAuthor, limit: "8", fields: "key,title,author_name,first_publish_year,edition_count" }),
    new URLSearchParams({ q: `${book.title} ${mainAuthor}`, limit: "8", fields: "key,title,author_name,first_publish_year,edition_count" }),
    ...(shortTitle !== book.title ? [new URLSearchParams({ title: shortTitle, author: mainAuthor, limit: "8", fields: "key,title,author_name,first_publish_year,edition_count" })] : []),
  ];
}

async function fetchJson<T>(url: string): Promise<T> {
  const cached = cache[url];
  if (cached?.ok) return cached.body as T;
  if (cached && cached.status && cached.status !== 429) throw new Error(cached.error ?? `${cached.status} cached error for ${url}`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitForRequestSlot();
    const response = await fetch(url, {
      headers: { "User-Agent": "BookPrizeIndexISBNDiscovery/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = await response.json() as T;
      cache[url] = { fetchedAt: new Date().toISOString(), ok: true, status: response.status, body };
      return body;
    }
    const error = `${response.status} ${response.statusText} for ${url}`;
    if (response.status === 429 && attempt < 3) {
      await delay(requestDelayMs * attempt * 4);
      continue;
    }
    cache[url] = { fetchedAt: new Date().toISOString(), ok: false, status: response.status, error };
    throw new Error(error);
  }
  throw new Error(`Request failed for ${url}`);
}

async function readCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile;
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

async function writeCache() {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: cache }, null, 2)}\n`);
}

function bestWorkMatch(book: Book, author: string, docs: OpenLibrarySearchDoc[]) {
  return docs
    .map((doc) => ({ doc, score: workMatchScore(book.title, author, doc.title, doc.author_name?.join(", ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function compareCandidates(a: Candidate, b: Candidate) {
  const quality = Number(b.score >= minScore) - Number(a.score >= minScore);
  if (quality) return quality;
  const yearA = a.publishYear ?? 9999;
  const yearB = b.publishYear ?? 9999;
  return yearA - yearB || b.score - a.score || a.isbn13.localeCompare(b.isbn13);
}

function summarize(report: ReportRow[]) {
  return report.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

function statsFor(stats: BookStats | undefined): BookStats {
  return stats ?? {
    bookId: "",
    wins: 0,
    lists: 0,
    score: 0,
    majorWins: 0,
    normalWins: 0,
    majorShortlists: 0,
    normalShortlists: 0,
    majorLonglists: 0,
    normalLonglists: 0,
    statuses: {
      winner: 0,
      co_winner: 0,
      finalist: 0,
      shortlist: 0,
      longlist: 0,
      honorable_mention: 0,
      commended: 0,
      notable: 0,
      unknown: 0,
    },
  };
}

function editionWarnings(edition: OpenLibraryEdition) {
  const text = `${edition.title ?? ""} ${edition.subtitle ?? ""} ${edition.physical_format ?? ""} ${(edition.publishers ?? []).join(" ")}`.toLowerCase();
  const warnings: string[] = [];
  if (/\b(ebook|e-book|kindle|digital)\b/.test(text)) warnings.push("ebook");
  if (/\b(audio|audiobook|sound recording|cd audio)\b/.test(text)) warnings.push("audio");
  if (/\b(large print|large-print)\b/.test(text)) warnings.push("large_print");
  if (/\b(school|library binding|turtleback|prebound)\b/.test(text)) warnings.push("school_or_library_binding");
  if (/\b(excerpt|sample|summary|study guide)\b/.test(text)) warnings.push("excerpt");
  if (/\b(young readers|young reader|adapted|abridged|student edition)\b/.test(text)) warnings.push("adapted_edition");
  if (/\b(peter smith|kessinger|nabu press|forgotten books|bibliobazaar|scholar's choice|scholars choice|palala press)\b/.test(text)) warnings.push("reprint_publisher");
  if (!isEnglish(edition) && /\b(spanish|french|german|italian|portuguese|turkish|hebrew|japanese|chinese|dutch|russian)\b/.test(text)) warnings.push("translation");
  return warnings;
}

function isEnglish(edition: OpenLibraryEdition) {
  if (!edition.languages?.length) return true;
  return edition.languages.some((language) => language.key === "/languages/eng");
}

function isHardcoverLike(edition: OpenLibraryEdition) {
  const text = `${edition.physical_format ?? ""} ${edition.title ?? ""}`.toLowerCase();
  return /\b(hardcover|hardback|hard cover|cloth|trade cloth)\b/.test(text);
}

function isPaperbackLike(edition: OpenLibraryEdition) {
  const text = `${edition.physical_format ?? ""} ${edition.title ?? ""}`.toLowerCase();
  return /\b(paperback|pbk|mass market)\b/.test(text);
}

function matchScore(title: string, author: string, candidateTitle = "", candidateAuthor = "") {
  return similarity(title, candidateTitle) * 0.72 + similarity(author, candidateAuthor) * 0.28;
}

function workMatchScore(title: string, author: string, candidateTitle = "", candidateAuthor = "") {
  const titleScore = Math.max(similarity(title, candidateTitle), similarity(titleWithoutSubtitle(title), candidateTitle));
  return titleScore * 0.72 + similarity(author, candidateAuthor) * 0.28;
}

function similarity(a = "", b = "") {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function tokenize(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 1);
}

function dedupeDocs(docs: OpenLibrarySearchDoc[]) {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const key = doc.key ?? `${doc.title}\u0000${doc.author_name?.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstIsbn13(values: string[]) {
  return values.map((value) => value.replace(/[^0-9X]/gi, "")).find((value) => /^\d{13}$/.test(value));
}

function yearFromDate(value: string | undefined) {
  const year = Number(value?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1]);
  return Number.isFinite(year) ? year : undefined;
}

function titleWithoutSubtitle(input: string) {
  return input.split(/:|\(|\[/)[0]?.trim() || input;
}

async function waitForRequestSlot() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < requestDelayMs) await delay(requestDelayMs - elapsed);
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

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
