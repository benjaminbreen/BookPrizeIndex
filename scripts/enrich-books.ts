import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appearancesByBookId, data, getBookStats } from "../lib/data";
import type { Book, SourceRef } from "../lib/types";
import {
  catalogMissingFieldsForBook,
  compareEnrichmentPriority,
  deferredMissingFieldsForBook,
  enrichmentLaneForBook,
  enrichmentPriorityScore,
  isUnproductiveAttempt,
  missingFieldsForSelection,
  parseLane,
  parseMissingFieldSet,
  sameMissingFields,
  type CatalogMissingBookField,
  type DeferredMissingBookField,
  type EnrichmentLane,
} from "./book-enrichment-priority";

type EnrichmentPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  imprints: Record<string, { id: string; name: string; publisherId?: string; sourceIds: string[] }>;
  publishers: Record<string, { id: string; name: string; sourceIds: string[] }>;
  sources: Record<string, SourceRef>;
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  status: "enriched" | "no_missing_fields" | "no_new_fields" | "not_found" | "low_confidence" | "error";
  fields: string[];
  skippedFields?: string[];
  missingFields?: CatalogMissingBookField[];
  deferredFields?: DeferredMissingBookField[];
  rawPublisher?: string;
  matches?: MatchReport[];
  notes?: string;
};

type BookCompletionResult = {
  report: ReportRow;
  bookPatch?: Partial<Book>;
  imprints?: EnrichmentPatch["imprints"];
  publishers?: EnrichmentPatch["publishers"];
  sources?: EnrichmentPatch["sources"];
};

type MetadataMergeResult = {
  bookPatch: Partial<Book>;
  imprints: EnrichmentPatch["imprints"];
  publishers: EnrichmentPatch["publishers"];
  sources: EnrichmentPatch["sources"];
  rawPublisher?: string;
};

type ImprintMapping = {
  raw: string;
  imprint: string;
  publisher: string;
  confidence: "high" | "medium" | "low";
};

type AttemptRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  status: ReportRow["status"];
  attemptedAt: string;
  missingFields?: CatalogMissingBookField[];
  matches?: MatchReport[];
  notes?: string;
};

type MatchReport = {
  provider: "google_books" | "open_library";
  title?: string;
  author?: string;
  url?: string;
  score: number;
  accepted: boolean;
  via?: "isbn" | "search";
};

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  subject?: string[];
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  first_publish_year?: number;
  description?: string;
  key?: string;
  edition_key?: string;
  matchVia?: "isbn" | "search";
};

type OpenLibraryWork = {
  title?: string;
  subjects?: string[];
  description?: string | { value?: string };
};

type OpenLibraryEdition = {
  title?: string;
  subtitle?: string;
  description?: string | { value?: string };
  authors?: { key?: string }[];
  isbn_13?: string[];
  isbn_10?: string[];
  publishers?: string[];
  number_of_pages?: number;
  covers?: number[];
  publish_date?: string;
  key?: string;
  works?: { key?: string }[];
};

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    categories?: string[];
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const attemptsPath = path.join(publicDataDir, "book-enrichment-attempts.json");

loadEnvLocal();

const limit = Number(process.env.BOOK_COMPLETION_LIMIT ?? process.env.ENRICH_LIMIT ?? readArg("--limit") ?? "25");
const minimumScore = Number(process.env.BOOK_COMPLETION_MIN_SCORE ?? process.env.ENRICH_MIN_SCORE ?? readArg("--min-score") ?? "0.58");
const provider = process.env.BOOK_COMPLETION_PROVIDER ?? process.env.ENRICH_PROVIDER ?? "all";
const requestedLane = parseLane(readArg("--lane") ?? process.env.BOOK_COMPLETION_LANE ?? process.env.ENRICH_LANE);
const requestedFields = parseMissingFieldSet(readArg("--fields") ?? process.env.BOOK_COMPLETION_FIELDS ?? process.env.ENRICH_FIELDS);
const concurrency = positiveNumber(process.env.BOOK_COMPLETION_CONCURRENCY ?? process.env.ENRICH_CONCURRENCY ?? readArg("--concurrency"), 3);
const fastMode = hasArg("--fast") || process.env.BOOK_COMPLETION_FAST === "1" || process.env.ENRICH_FAST === "1";
const quietMode = hasArg("--quiet") || process.env.BOOK_COMPLETION_QUIET === "1" || process.env.ENRICH_QUIET === "1";
const checkpointEvery = positiveNumber(process.env.BOOK_COMPLETION_CHECKPOINT_EVERY ?? process.env.ENRICH_CHECKPOINT_EVERY ?? readArg("--checkpoint-every"), 0);
const providerPlan = selectProviderPlan(provider, requestedFields);
let imprintMappingsByRawName = new Map<string, ImprintMapping>();

async function main() {
  const generatedAt = new Date().toISOString();
  imprintMappingsByRawName = await readImprintMappings();
  const requestedBookIds = new Set((process.env.BOOK_COMPLETION_BOOK_IDS ?? process.env.ENRICH_BOOK_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const retryFailures = hasArg("--retry-failures") || process.env.BOOK_COMPLETION_RETRY_FAILURES === "1" || process.env.ENRICH_RETRY_FAILURES === "1";
  const attempts = await readAttempts();
  const patch = await readExistingPatch(generatedAt);
  const selected = (requestedBookIds.size ? data.books.filter((book) => requestedBookIds.has(book.id) || requestedBookIds.has(book.slug)) : [...data.books])
    .map((book) => selectionRow(book, attempts[book.id]))
    .filter((row) => row.selectedMissingFields.length > 0)
    .filter((row) => !requestedLane || row.lane === requestedLane)
    .filter((row) => retryFailures || !existingPatchSatisfiesFields(patch.books[row.book.id], row.selectedMissingFields))
    .filter((row) => requestedBookIds.size || retryFailures || !isRecentUnproductiveAttempt(attempts[row.book.id], row.book))
    .sort(compareEnrichmentPriority)
    .slice(0, limit);

  const report: ReportRow[] = [];
  const runAttempts = { ...attempts };
  let completedCount = 0;
  let checkpointChain = Promise.resolve();
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(publicDataDir, { recursive: true });

  const checkpoint = async (force = false) => {
    if (!force && (!checkpointEvery || completedCount % checkpointEvery !== 0)) return;
    const progressPayload = progressReportPayload(generatedAt, selected, report, completedCount);
    await fs.writeFile(path.join(outputDir, "books.generated.json"), `${JSON.stringify(patch, null, 2)}\n`);
    await writeReports(progressPayload);
    await writeRawPublisherReview(generatedAt, report);
    await writeAttempts(runAttempts);
    await fs.writeFile(path.join(publicDataDir, "book-enrichment-progress.json"), `${JSON.stringify(progressPayload, null, 2)}\n`);
  };

  await mapConcurrent(selected, concurrency, async (row, index) => {
    const result = await completeBook(row, index + 1, selected.length, generatedAt);
    checkpointChain = checkpointChain.then(async () => {
      report.push(result.report);
      mergeResultIntoPatch(patch, result);
      runAttempts[result.report.bookId] = toAttemptRow(result.report, generatedAt);
      completedCount += 1;
      if (!quietMode && checkpointEvery && completedCount % checkpointEvery === 0) {
        console.log(`Checkpointed ${completedCount}/${selected.length} books.`);
      }
      await checkpoint();
    });
    await checkpointChain;
    return result;
  });
  await checkpointChain;
  await checkpoint(true);
  const enrichedCount = report.filter((row) => row.status === "enriched").length;
  console.log(`Completed ${enrichedCount}/${selected.length} books. Report written to data/public/book-completion-report.json.`);
}

async function readAttempts(): Promise<Record<string, AttemptRow>> {
  try {
    const parsed = JSON.parse(await fs.readFile(attemptsPath, "utf8")) as { attempts?: Record<string, AttemptRow> };
    return parsed.attempts ?? {};
  } catch {
    return {};
  }
}

async function readImprintMappings() {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, "sources", "imprint-normalization.json"), "utf8")) as { mappings?: ImprintMapping[] };
    return new Map((parsed.mappings ?? []).map((mapping) => [normalizePublisherName(mapping.raw), mapping]));
  } catch {
    return new Map<string, ImprintMapping>();
  }
}

async function writeAttempts(attempts: Record<string, AttemptRow>) {
  await fs.writeFile(attemptsPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), attempts }, null, 2)}\n`);
}

async function completeBook(
  row: ReturnType<typeof selectionRow>,
  index: number,
  total: number,
  generatedAt: string,
): Promise<BookCompletionResult> {
  const book = row.book;
  const author = book.authors.map((item) => item.name).join(" ");
  const selectedMissingFields = row.selectedMissingFields;
  const deferredFields = deferredMissingFieldsForBook(book);
  if (!selectedMissingFields.length) {
    return { report: { bookId: book.id, slug: book.slug, title: book.title, author, status: "no_missing_fields", fields: [] } };
  }

  try {
    if (!quietMode) console.log(`[${index}/${total}] Completing ${book.title} - ${author}`);
    const useOpenLibrary = shouldUseOpenLibrary(selectedMissingFields);
    const useGoogleBooks = shouldUseGoogleBooks(selectedMissingFields);
    const [openLibraryResult, googleResult] = await Promise.allSettled([
      useOpenLibrary ? fetchOpenLibrary(book, author, selectedMissingFields) : Promise.resolve(undefined),
      useGoogleBooks ? fetchGoogleBooks(book, author) : Promise.resolve(undefined),
    ]);
    const openLibrary = openLibraryResult.status === "fulfilled" ? openLibraryResult.value : undefined;
    const google = googleResult.status === "fulfilled" ? googleResult.value : undefined;
    const matches = [
      google ? matchReport("google_books", book, author, google.item.volumeInfo?.title, google.item.volumeInfo?.authors?.join(" "), google.item.volumeInfo?.canonicalVolumeLink ?? google.item.volumeInfo?.infoLink, google.score, google.via) : undefined,
      openLibrary ? matchReport("open_library", book, author, openLibrary.doc.title, openLibrary.doc.author_name?.join(" "), openLibrary.doc.edition_key ? `https://openlibrary.org${openLibrary.doc.edition_key}` : openLibrary.doc.key ? `https://openlibrary.org${openLibrary.doc.key}` : undefined, openLibrary.score, openLibrary.doc.matchVia) : undefined,
    ].filter(Boolean) as MatchReport[];
    const hasAcceptedMatch = matches.some((match) => match.accepted);

    if (!hasAcceptedMatch) {
      return {
        report: {
          bookId: book.id,
          slug: book.slug,
          title: book.title,
          author,
          status: matches.length ? "low_confidence" : "not_found",
          fields: [],
          missingFields: selectedMissingFields,
          deferredFields,
          matches,
          notes: rejectionNotes([openLibraryResult, googleResult]),
        },
      };
    }

    const enriched = mergeMetadata(
      book,
      openLibrary && isAcceptedProviderMatch(book, author, openLibrary.doc.title, openLibrary.doc.author_name?.join(" "), openLibrary.score, openLibrary.doc.matchVia) ? openLibrary.doc : undefined,
      google && isAcceptedProviderMatch(book, author, google.item.volumeInfo?.title, google.item.volumeInfo?.authors?.join(" "), google.score, google.via) ? google.item : undefined,
      generatedAt,
      requestedFields,
    );
    if (!Object.keys(enriched.bookPatch).length) {
      return {
        report: {
          bookId: book.id,
          slug: book.slug,
          title: book.title,
          author,
          status: "no_new_fields",
          fields: [],
          missingFields: selectedMissingFields,
          deferredFields,
          matches,
          notes: rejectionNotes([openLibraryResult, googleResult]),
        },
      };
    }

    return {
      bookPatch: enriched.bookPatch,
      imprints: enriched.imprints,
      publishers: enriched.publishers,
      sources: enriched.sources,
      report: {
        bookId: book.id,
        slug: book.slug,
        title: book.title,
        author,
        status: "enriched",
        fields: Object.keys(enriched.bookPatch),
        skippedFields: selectedMissingFields.filter((field) => !Object.keys(enriched.bookPatch).includes(fieldToPatchKey(field))),
        missingFields: selectedMissingFields,
        deferredFields,
        rawPublisher: enriched.rawPublisher,
        matches,
      },
    };
  } catch (error) {
    return {
      report: {
        bookId: book.id,
        slug: book.slug,
        title: book.title,
        author,
        status: "error",
        fields: [],
        notes: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function selectionRow(book: Book, attempt?: AttemptRow) {
  const stats = getBookStats(book.id);
  const lane = enrichmentLaneForBook(book, stats, attempt);
  const missingFields = catalogMissingFieldsForBook(book);
  return {
    book,
    title: book.title,
    lane,
    score: stats.score,
    priorityScore: enrichmentPriorityScore(book, stats, lane),
    missingFields,
    selectedMissingFields: missingFieldsForSelection(book, requestedFields),
  };
}

function summarizeSelectedLanes(rows: Array<ReturnType<typeof selectionRow>>) {
  const summary: Record<string, number> = {};
  for (const row of rows) summary[row.lane] = (summary[row.lane] ?? 0) + 1;
  return summary;
}

function progressReportPayload(generatedAt: string, selected: Array<ReturnType<typeof selectionRow>>, report: ReportRow[], completedCount: number) {
  return {
    generatedAt,
    updatedAt: new Date().toISOString(),
    limit,
    minimumScore,
    provider,
    providerPlan,
    concurrency,
    fastMode,
    quietMode,
    checkpointEvery,
    lane: requestedLane,
    fields: requestedFields ? [...requestedFields] : undefined,
    selectedCount: selected.length,
    completedCount,
    remainingCount: Math.max(0, selected.length - completedCount),
    selectedLanes: summarizeSelectedLanes(selected),
    summary: completionSummary(data.books),
    report,
  };
}

async function writeReports(payload: ReturnType<typeof progressReportPayload>) {
  await fs.writeFile(path.join(publicDataDir, "book-completion-report.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "book-enrichment-report.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "enrichment-report.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

function mergeResultIntoPatch(patch: EnrichmentPatch, result: BookCompletionResult) {
  if (result.bookPatch) patch.books[result.report.bookId] = mergePatch(patch.books[result.report.bookId] ?? {}, result.bookPatch);
  if (result.imprints) Object.assign(patch.imprints, result.imprints);
  if (result.publishers) Object.assign(patch.publishers, result.publishers);
  if (result.sources) Object.assign(patch.sources, result.sources);
}

function existingPatchSatisfiesFields(bookPatch: Partial<Book> | undefined, fields: CatalogMissingBookField[]) {
  if (!bookPatch) return false;
  return fields.every((field) => patchHasField(bookPatch, field));
}

function patchHasField(bookPatch: Partial<Book>, field: CatalogMissingBookField) {
  if (field === "publisherLink") return Boolean(bookPatch.links?.publisher);
  if (field === "isbn13") return Boolean(bookPatch.isbn13?.length);
  return Boolean(bookPatch[fieldToPatchKey(field) as keyof Book]);
}

function toAttemptRow(row: ReportRow, attemptedAt: string): AttemptRow {
  return {
    bookId: row.bookId,
    slug: row.slug,
    title: row.title,
    author: row.author,
    status: row.status,
    attemptedAt,
    missingFields: row.missingFields,
    matches: row.matches,
    notes: row.notes,
  };
}

async function writeRawPublisherReview(generatedAt: string, report: ReportRow[]) {
  const rows = report.filter((row) => row.rawPublisher && row.missingFields?.includes("publisherId"));
  const grouped = new Map<string, {
    rawPublisher: string;
    bookCount: number;
    sampleBooks: Array<{ bookId: string; title: string; author: string; status: ReportRow["status"]; matchTitle?: string; matchAuthor?: string; matchScore?: number }>;
  }>();
  for (const row of rows) {
    const rawPublisher = row.rawPublisher!;
    const key = normalizePublisherName(rawPublisher);
    const current = grouped.get(key) ?? { rawPublisher, bookCount: 0, sampleBooks: [] };
    current.bookCount += 1;
    if (current.sampleBooks.length < 8) {
      const match = row.matches?.[0];
      current.sampleBooks.push({
        bookId: row.bookId,
        title: row.title,
        author: row.author,
        status: row.status,
        matchTitle: match?.title,
        matchAuthor: match?.author,
        matchScore: match?.score,
      });
    }
    grouped.set(key, current);
  }
  await fs.writeFile(
    path.join(publicDataDir, "raw-publisher-review-report.json"),
    `${JSON.stringify({
      generatedAt,
      count: grouped.size,
      note: "Raw catalog publisher strings found during enrichment but not promoted because they are missing from sources/imprint-normalization.json.",
      review: [...grouped.values()].sort((a, b) => b.bookCount - a.bookCount || a.rawPublisher.localeCompare(b.rawPublisher)),
    }, null, 2)}\n`,
  );
}

function isRecentUnproductiveAttempt(attempt: AttemptRow | undefined, book: Book) {
  return isUnproductiveAttempt(attempt) && sameMissingFields(attempt?.missingFields, catalogMissingFieldsForBook(book));
}

async function readExistingPatch(generatedAt: string): Promise<EnrichmentPatch> {
  try {
    const existing = JSON.parse(await fs.readFile(path.join(outputDir, "books.generated.json"), "utf8")) as Partial<EnrichmentPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Existing generated patches are merged, not replaced. Manual curation may override these fields. This pass promotes catalog metadata, not inferred imprints.",
      books: existing.books ?? {},
      imprints: existing.imprints ?? {},
      publishers: existing.publishers ?? {},
      sources: existing.sources ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Manual curation may override these fields. This pass promotes catalog metadata, not inferred imprints.",
      books: {},
      imprints: {},
      publishers: {},
      sources: {},
    };
  }
}

async function fetchOpenLibrary(book: Book, author: string, missingFields: CatalogMissingBookField[]): Promise<{ doc: OpenLibraryDoc; score: number } | undefined> {
  const isbnMatch = await fetchOpenLibraryByIsbn(book, author);
  if (isbnMatch) return isbnMatch;

  const docs: OpenLibraryDoc[] = [];
  for (const params of openLibraryQueries(book, author)) {
    const json = await fetchJson<{ docs?: OpenLibraryDoc[] }>(`https://openlibrary.org/search.json?${params}`);
    docs.push(...(json.docs ?? []));
    const earlyMatch = bestOpenLibraryMatch(book, author, docs);
    if (earlyMatch?.score >= 0.92) break;
    await delay(150);
  }
  const match = bestOpenLibraryMatch(book, author, dedupeOpenLibraryDocs(docs));
  if (!match?.doc.key || match.score < minimumScore) return match;
  if (fastMode && !needsOpenLibraryDetail(missingFields)) return match;

  const [editions, work] = await Promise.all([
    fetchOpenLibraryEditions(match.doc.key),
    fetchOpenLibraryWork(match.doc.key),
  ]);
  const bestEdition = bestOpenLibraryEdition(match.doc, editions);
  if (!bestEdition && !work.subjects?.length) return match;

  return {
    ...match,
    doc: {
      ...(bestEdition ? mergeOpenLibraryEdition(match.doc, bestEdition) : match.doc),
      subject: [...new Set([...(match.doc.subject ?? []), ...(work.subjects ?? [])])],
      description: match.doc.description ?? descriptionText(work.description),
      matchVia: "search",
    },
  };
}

async function fetchOpenLibraryByIsbn(book: Book, author: string): Promise<{ doc: OpenLibraryDoc; score: number } | undefined> {
  const isbn = book.isbn13.find((value) => /^\d{13}$/.test(value.replaceAll("-", "")))?.replaceAll("-", "");
  if (!isbn) return undefined;
  const edition = await fetchJson<OpenLibraryEdition>(`https://openlibrary.org/isbn/${isbn}.json`).catch(() => undefined);
  if (!edition) return undefined;
  const workKey = edition.works?.[0]?.key;
  const work = workKey ? await fetchOpenLibraryWork(workKey).catch(() => undefined) : undefined;
  const title = [edition.title, edition.subtitle].filter(Boolean).join(": ") || work?.title;
  const doc = mergeOpenLibraryEdition(
    {
      title,
      author_name: [author],
      isbn: [isbn],
      key: workKey,
      subject: [],
      description: descriptionText(edition.description) ?? descriptionText(work?.description),
      matchVia: "isbn",
    },
    edition,
  );
  return {
    doc: {
      ...doc,
      subject: [...new Set([...(doc.subject ?? []), ...(work?.subjects ?? [])])],
      description: doc.description ?? descriptionText(work?.description),
      matchVia: "isbn",
    },
    score: 1,
  };
}

async function fetchGoogleBooks(book: Book, author: string): Promise<{ item: GoogleVolume; score: number; via: "isbn" | "search" } | undefined> {
  const items: GoogleVolume[] = [];
  for (const isbn of book.isbn13) {
    const normalized = isbn.replaceAll("-", "");
    if (!/^\d{13}$/.test(normalized)) continue;
    const params = googleVolumeParams(`isbn:${normalized}`);
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
    const isbnItems = dedupeGoogleVolumes(json.items ?? []);
    const isbnMatch = bestGoogleMatch(book, author, isbnItems);
    if (isbnMatch?.score && isbnMatch.score >= 0.5) return { ...isbnMatch, via: "isbn" };
  }
  for (const query of googleQueries(book, author)) {
    const params = googleVolumeParams(query);
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
    items.push(...(json.items ?? []));
    const earlyMatch = bestGoogleMatch(book, author, items);
    if (earlyMatch?.score >= 0.92) break;
    await delay(250);
  }
  const match = bestGoogleMatch(book, author, dedupeGoogleVolumes(items));
  return match ? { ...match, via: "search" } : undefined;
}

function googleVolumeParams(query: string) {
  const params = new URLSearchParams({ q: query, maxResults: "5", printType: "books" });
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (apiKey) params.set("key", apiKey);
  return params;
}

async function fetchJson<T>(url: string, retries = 2): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": "book-prize-index-enrichment/0.1" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429 && retries > 0) {
    await delay(1200 * (3 - retries));
    return fetchJson<T>(url, retries - 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${redactUrlSecrets(url)}`);
  return (await response.json()) as T;
}

function redactUrlSecrets(url: string) {
  return url.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
}

async function fetchOpenLibraryEditions(workKey: string): Promise<OpenLibraryEdition[]> {
  const params = new URLSearchParams({ limit: requestedFields?.has("publisherId") ? "50" : "12" });
  const json = await fetchJson<{ entries?: OpenLibraryEdition[] }>(`https://openlibrary.org${workKey}/editions.json?${params}`);
  return json.entries ?? [];
}

async function fetchOpenLibraryWork(workKey: string): Promise<OpenLibraryWork> {
  return fetchJson<OpenLibraryWork>(`https://openlibrary.org${workKey}.json`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = readFileSync(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local env file.
    }
  }
}

function bestOpenLibraryMatch(book: Book, author: string, docs: OpenLibraryDoc[]) {
  return docs
    .map((doc) => ({ doc, score: matchScore(book.title, author, doc.title, doc.author_name?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function bestGoogleMatch(book: Book, author: string, items: GoogleVolume[]) {
  return items
    .map((item) => ({ item, score: matchScore(book.title, author, item.volumeInfo?.title, item.volumeInfo?.authors?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function openLibraryQueries(book: Book, author: string) {
  const mainAuthor = author.split(/\s+(?:and|&)\s+/i)[0]?.trim() || author;
  const shortTitle = titleWithoutSubtitle(book.title);
  const queries = [
    new URLSearchParams({ title: book.title, author, limit: "5" }),
    new URLSearchParams({ q: `${book.title} ${author}`, limit: "5" }),
    ...(shortTitle !== book.title ? [new URLSearchParams({ title: shortTitle, author: mainAuthor, limit: "5" })] : []),
    new URLSearchParams({ q: `${shortTitle} ${mainAuthor}`, limit: "5" }),
  ];
  return fastMode ? queries.slice(0, 2) : queries;
}

function googleQueries(book: Book, author: string) {
  const mainAuthor = author.split(/\s+(?:and|&)\s+/i)[0]?.trim() || author;
  const shortTitle = titleWithoutSubtitle(book.title);
  const queries = [
    `intitle:${quote(book.title)} inauthor:${quote(author)}`,
    `${quote(book.title)} ${quote(author)}`,
    ...(shortTitle !== book.title ? [`intitle:${quote(shortTitle)} inauthor:${quote(mainAuthor)}`] : []),
    `${quote(shortTitle)} ${quote(mainAuthor)}`,
  ];
  return fastMode ? queries.slice(0, 2) : queries;
}

function dedupeOpenLibraryDocs(docs: OpenLibraryDoc[]) {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const key = doc.key ?? `${doc.title}\u0000${doc.author_name?.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeGoogleVolumes(items: GoogleVolume[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function bestOpenLibraryEdition(work: OpenLibraryDoc, editions: OpenLibraryEdition[]) {
  return editions
    .filter(isPlausibleOpenLibraryEdition)
    .map((edition) => ({ edition, score: openLibraryEditionScore(work, edition) }))
    .sort((a, b) => b.score - a.score)[0]?.edition;
}

function isPlausibleOpenLibraryEdition(edition: OpenLibraryEdition) {
  const pageCount = edition.number_of_pages;
  const hasCatalogFields = Boolean(edition.isbn_13?.length || edition.publishers?.length || edition.covers?.length);
  return hasCatalogFields && (!pageCount || pageCount >= 20);
}

function openLibraryEditionScore(work: OpenLibraryDoc, edition: OpenLibraryEdition) {
  let score = 0;
  if (edition.isbn_13?.some((isbn) => /^\d{13}$/.test(isbn.replaceAll("-", "")))) score += 8;
  if (edition.number_of_pages && edition.number_of_pages >= 80) score += 4;
  if (edition.covers?.length || work.cover_i) score += 3;
  if (edition.publishers?.some((publisher) => isUsableCatalogPublisher(publisher))) score += requestedFields?.has("publisherId") ? 10 : 2;
  if (edition.title && work.title) score += similarity(work.title, edition.title);
  return score;
}

function mergeOpenLibraryEdition(work: OpenLibraryDoc, edition: OpenLibraryEdition): OpenLibraryDoc {
  return {
    ...work,
    isbn: [...(work.isbn ?? []), ...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])],
    publisher: firstUsablePublishers(work.publisher) ?? firstUsablePublishers(edition.publishers),
    number_of_pages_median: work.number_of_pages_median ?? edition.number_of_pages,
    cover_i: work.cover_i ?? edition.covers?.[0],
    first_publish_year: work.first_publish_year ?? firstYear([edition.publish_date]),
    description: work.description ?? descriptionText(edition.description),
    edition_key: work.edition_key ?? edition.key,
  };
}

function mergeMetadata(
  book: Book,
  openLibrary: OpenLibraryDoc | undefined,
  google: GoogleVolume | undefined,
  generatedAt: string,
  allowedFields: Set<CatalogMissingBookField> | undefined,
) : MetadataMergeResult {
  const sourceIds = new Set(book.sourceIds);
  const sources: Record<string, SourceRef> = {};
  const imprints: EnrichmentPatch["imprints"] = {};
  const publishers: EnrichmentPatch["publishers"] = {};
  const links = { ...book.links };
  const isbn13 = firstIsbn13([...(google?.volumeInfo?.industryIdentifiers?.map((item) => item.identifier) ?? []), ...(openLibrary?.isbn ?? [])]);
  const publisherName = google?.volumeInfo?.publisher ?? openLibrary?.publisher?.[0];
  const publicationYear = firstYear([google?.volumeInfo?.publishedDate, openLibrary?.first_publish_year]);
  const googleUrl = google?.volumeInfo?.canonicalVolumeLink ?? google?.volumeInfo?.infoLink;
  const openLibraryUrl = openLibrary?.edition_key ? `https://openlibrary.org${openLibrary.edition_key}` : openLibrary?.key ? `https://openlibrary.org${openLibrary.key}` : undefined;

  if (googleUrl) {
    links.publisher ??= googleUrl;
    const sourceId = `source-google-books-${book.slug}`;
    sourceIds.add(sourceId);
    sources[sourceId] = {
      id: sourceId,
      label: `Google Books metadata for ${book.title}`,
      url: googleUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "book",
    };
  }
  if (openLibraryUrl) {
    links.publisher ??= openLibraryUrl;
    const sourceId = `source-open-library-${book.slug}`;
    sourceIds.add(sourceId);
    sources[sourceId] = {
      id: sourceId,
      label: `Open Library metadata for ${book.title}`,
      url: openLibraryUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "book",
    };
  }

  const bookPatch: Partial<Book> = {};
  const subjectCategories = [
    ...(google?.volumeInfo?.categories ?? []).map((label) => ({
      source: "google_books" as const,
      scheme: "google_books_category",
      label,
      sourceId: googleUrl ? `source-google-books-${book.slug}` : undefined,
    })),
    ...(openLibrary?.subject?.slice(0, 24) ?? []).map((label) => ({
      source: "open_library" as const,
      scheme: "open_library_subject",
      label,
      sourceId: openLibraryUrl ? `source-open-library-${book.slug}` : undefined,
    })),
  ];
  if (!allowedFields?.size && subjectCategories.length) {
    bookPatch.subjectCategories = mergeSubjectCategories(book.subjectCategories ?? [], subjectCategories);
  }
  if (allowsField(allowedFields, "isbn13") && !book.isbn13.length && isbn13) bookPatch.isbn13 = [isbn13];
  if (allowsField(allowedFields, "publicationYear") && !book.publicationYear && publicationYear && isPlausiblePublicationYear(book, publicationYear)) {
    bookPatch.publicationYear = publicationYear;
  }
  if (allowsField(allowedFields, "pageCount") && !book.pageCount && (google?.volumeInfo?.pageCount || openLibrary?.number_of_pages_median)) {
    bookPatch.pageCount = google?.volumeInfo?.pageCount ?? openLibrary?.number_of_pages_median;
  }
  const summary = google?.volumeInfo?.description ?? openLibrary?.description;
  if (allowsField(allowedFields, "summary") && !book.summary && summary) bookPatch.summary = trimDescription(summary);
  const thumbnail = google?.volumeInfo?.imageLinks?.thumbnail ?? google?.volumeInfo?.imageLinks?.smallThumbnail;
  if (allowsField(allowedFields, "thumbnailUrl") && !book.thumbnailUrl && thumbnail) bookPatch.thumbnailUrl = thumbnail.replace(/^http:/, "https:");
  if (allowsField(allowedFields, "thumbnailUrl") && !book.thumbnailUrl && openLibrary?.cover_i) {
    bookPatch.thumbnailUrl = `https://covers.openlibrary.org/b/id/${openLibrary.cover_i}-L.jpg`;
  }
  if (allowsField(allowedFields, "publisherLink") && !book.links.publisher && links.publisher) bookPatch.links = links;
  if (sourceIds.size > book.sourceIds.length) bookPatch.sourceIds = [...sourceIds];
  let rawPublisher: string | undefined;
  if (allowsField(allowedFields, "publisherId") && !book.publisherId && publisherName && isUsableCatalogPublisher(publisherName)) {
    const mapping = imprintMappingsByRawName.get(normalizePublisherName(publisherName));
    if (mapping) {
      const publisherId = `publisher-${slugify(mapping.publisher)}`;
      const imprintId = `imprint-${slugify(mapping.imprint)}`;
      const sourceId = `source-publisher-catalog-${slugify(publisherName)}`;
      bookPatch.publisherId = publisherId;
      if (!book.imprintId) bookPatch.imprintId = imprintId;
      publishers[publisherId] = {
        id: publisherId,
        name: mapping.publisher,
        sourceIds: [sourceId],
      };
      imprints[imprintId] = {
        id: imprintId,
        name: mapping.imprint,
        publisherId,
        sourceIds: [sourceId],
      };
      sources[sourceId] = {
        id: sourceId,
        label: `Publisher/imprint name from catalog metadata: ${publisherName}`,
        url: googleUrl ?? openLibraryUrl ?? "",
        accessedAt: generatedAt,
        confidence: "catalog",
        field: "publisher",
        note: `Normalized via sources/imprint-normalization.json to publisher "${mapping.publisher}" and imprint "${mapping.imprint}".`,
      };
    }
  }
  if (allowsField(allowedFields, "publisherId") && !book.publisherId && publisherName && isUsableCatalogPublisher(publisherName) && !imprintMappingsByRawName.has(normalizePublisherName(publisherName))) {
    rawPublisher = publisherName;
    const sourceId = `source-publisher-catalog-${slugify(publisherName)}`;
    sources[sourceId] = {
      id: sourceId,
      label: `Unmapped catalog publisher string for ${book.title}: ${publisherName}`,
      url: googleUrl ?? openLibraryUrl ?? "",
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "publisher",
      note: "Raw publisher string was not promoted to publisherId because it lacks a curated imprint-normalization mapping.",
    };
  }

  const substantiveFields = Object.keys(bookPatch).filter((key) => key !== "sourceIds");
  if (!substantiveFields.length) return { bookPatch: {}, imprints: {}, publishers: {}, sources: {}, rawPublisher };

  return { bookPatch, imprints, publishers, sources, rawPublisher };
}

function allowsField(fields: Set<CatalogMissingBookField> | undefined, field: CatalogMissingBookField) {
  return !fields?.size || fields.has(field);
}

function mergeSubjectCategories(existing: NonNullable<Book["subjectCategories"]>, incoming: NonNullable<Book["subjectCategories"]>) {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter((category) => {
    const key = `${category.source}\u0000${category.scheme ?? ""}\u0000${category.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergePatch(current: Partial<Book>, next: Partial<Book>): Partial<Book> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next) as [keyof Book, Book[keyof Book]][]) {
    if (value === undefined) continue;
    if (key === "links") {
      merged.links = { ...(merged.links ?? {}), ...(value as Book["links"]) };
    } else if (key === "sourceIds") {
      merged.sourceIds = [...new Set([...(merged.sourceIds ?? []), ...((value as string[]) ?? [])])];
    } else if (key === "isbn13") {
      merged.isbn13 = [...new Set([...(merged.isbn13 ?? []), ...((value as string[]) ?? [])])];
    } else if (merged[key] === undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function fieldToPatchKey(field: CatalogMissingBookField) {
  return field === "publisherLink" ? "links" : field;
}

function matchReport(
  provider: MatchReport["provider"],
  book: Book,
  author: string,
  candidateTitle: string | undefined,
  candidateAuthor: string | undefined,
  url: string | undefined,
  score: number,
  via: "isbn" | "search" | undefined,
): MatchReport {
  return {
    provider,
    title: candidateTitle,
    author: candidateAuthor,
    url,
    score: Number(score.toFixed(3)),
    accepted: isAcceptedProviderMatch(book, author, candidateTitle, candidateAuthor, score, via),
    via,
  };
}

function isAcceptedProviderMatch(book: Book, author: string, candidateTitle: string | undefined, candidateAuthor: string | undefined, score: number, via: "isbn" | "search" | undefined) {
  if (via === "isbn" && candidateTitle && !isDisallowedEdition(normalizeForMatch(candidateTitle), normalizeForMatch(book.title))) return true;
  return isAcceptedMatch(book, author, candidateTitle, candidateAuthor, score);
}

function isPlausiblePublicationYear(book: Book, publicationYear: number) {
  const firstRecognitionYear = Math.min(...(appearancesByBookId.get(book.id) ?? []).map((appearance) => appearance.year));
  if (Number.isFinite(firstRecognitionYear) && publicationYear > firstRecognitionYear + 1) return false;
  return true;
}

function isAcceptedMatch(book: Book, author: string, candidateTitle: string | undefined, candidateAuthor: string | undefined, score: number) {
  if (!candidateTitle) return false;
  const title = normalizeForMatch(book.title);
  const shortTitle = normalizeForMatch(titleWithoutSubtitle(book.title));
  const candidate = normalizeForMatch(candidateTitle);
  const candidateShort = normalizeForMatch(titleWithoutSubtitle(candidateTitle));
  if (isDisallowedEdition(candidate, title)) return false;
  const titleScore = similarity(book.title, candidateTitle);
  const authorScore = similarity(author, candidateAuthor ?? "");
  const shortTitleMatch = Boolean(shortTitle) && (candidate === shortTitle || candidateShort === shortTitle);
  const containedMainTitle = shortTitle.length >= 8 && candidate.startsWith(shortTitle);
  if (authorScore >= 0.55 && (shortTitleMatch || containedMainTitle)) return true;
  return score >= minimumScore && authorScore >= 0.55 && titleScore >= 0.58;
}

function isDisallowedEdition(candidate: string, title: string) {
  const disallowed = ["adaptation", "young readers", "study guide", "summary", "companion", "collection set", "illustrated"];
  if (disallowed.some((term) => candidate.includes(term) && !title.includes(term))) return true;
  if (candidate.includes("short history of") && !title.includes("short history")) return true;
  if (/\bvolumes?\b/.test(candidate) && !/\bvolumes?\b|\bvol\.?\b/.test(title)) return true;
  if (/\bv\s*\d+\b/.test(candidate) && !/\bv\s*\d+\b|\bvol\.?\s*\d+\b|\bvolume\s*\d+\b/.test(title)) return true;
  return false;
}

function firstIsbn13(values: string[]) {
  return values.map((value) => value.replaceAll("-", "")).find((value) => /^\d{13}$/.test(value));
}

function firstYear(values: Array<string | number | undefined>) {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function descriptionText(value: OpenLibraryWork["description"] | OpenLibraryEdition["description"] | undefined) {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.value;
}

function completionSummary(books: Book[]) {
  const fields: CatalogMissingBookField[] = ["isbn13", "publicationYear", "publisherId", "imprintId", "pageCount", "summary", "thumbnailUrl", "publisherLink"];
  const missingByField = Object.fromEntries(fields.map((field) => [field, 0])) as Record<CatalogMissingBookField, number>;
  let completeCoreBooks = 0;
  for (const book of books) {
    const missing = catalogMissingFieldsForBook(book);
    for (const field of missing) missingByField[field] += 1;
    if (!missing.filter((field) => field !== "imprintId").length) completeCoreBooks += 1;
  }
  return {
    totalBooks: books.length,
    completeCoreBooks,
    missingByField,
    note: "imprintId remains a manual or normalization task unless source data clearly distinguishes imprint from parent publisher.",
  };
}

function trimDescription(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 900);
}

function matchScore(title: string, author: string, candidateTitle = "", candidateAuthor = "") {
  return (similarity(title, candidateTitle) * 0.7) + (similarity(author, candidateAuthor) * 0.3);
}

function similarity(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function tokenize(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 1);
}

function normalizeForMatch(input: string) {
  return tokenize(input).join(" ");
}

function quote(input: string) {
  return `"${input.replaceAll('"', "")}"`;
}

function titleWithoutSubtitle(input: string) {
  return input.split(/:|\(|\[/)[0]?.trim() || input;
}

function slugify(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function normalizePublisherName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|and|inc|incorporated|llc|ltd|limited|company|co|publishing|publishers?|press)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLikelyAudioPublisher(value: string) {
  const normalized = value.toLowerCase();
  return /\b(audio|audiobook|spoken word|recorded books|blackstone|tantor)\b/.test(normalized);
}

function firstUsablePublishers(values: string[] | undefined) {
  const publisher = values?.map((value) => value.trim()).find(isUsableCatalogPublisher);
  return publisher ? [publisher] : undefined;
}

function isUsableCatalogPublisher(value: string | undefined) {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  if (!normalized || normalized.length < 2) return false;
  if (isLikelyAudioPublisher(normalized)) return false;
  if (/\b(self[-\s]?published|independently published|unknown|not stated|publisher not identified)\b/.test(normalized)) return false;
  return true;
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

function selectProviderPlan(providerName: string, fields: Set<CatalogMissingBookField> | undefined) {
  const normalized = providerName.toLowerCase().replaceAll("-", "_");
  const googleDisabled = process.env.BOOK_COMPLETION_GOOGLE === "0" || process.env.ENRICH_GOOGLE === "0" || hasArg("--no-google");
  const explicitOpenLibrary = normalized === "open_library" || normalized === "openlibrary";
  const explicitGoogle = normalized === "google_books" || normalized === "google";
  const fieldList = [...(fields ?? [])];
  const onlyImprint = fieldList.length > 0 && fieldList.every((field) => field === "imprintId");
  const googleUseful = !fields?.size || fieldList.some((field) => ["isbn13", "publicationYear", "publisherId", "pageCount", "summary", "thumbnailUrl", "publisherLink"].includes(field));
  const openLibraryUseful = !fields?.size || fieldList.some((field) => ["isbn13", "publicationYear", "publisherId", "pageCount", "summary", "thumbnailUrl", "publisherLink"].includes(field));

  return {
    openLibrary: !onlyImprint && !explicitGoogle && openLibraryUseful,
    googleBooks: !onlyImprint && !googleDisabled && !explicitOpenLibrary && googleUseful,
  };
}

function shouldUseOpenLibrary(missingFields: CatalogMissingBookField[]) {
  return providerPlan.openLibrary && (!requestedFields?.size || missingFields.some((field) => ["isbn13", "publicationYear", "publisherId", "pageCount", "summary", "thumbnailUrl", "publisherLink"].includes(field)));
}

function shouldUseGoogleBooks(missingFields: CatalogMissingBookField[]) {
  return providerPlan.googleBooks && (!requestedFields?.size || missingFields.some((field) => ["isbn13", "publicationYear", "publisherId", "pageCount", "summary", "thumbnailUrl", "publisherLink"].includes(field)));
}

function needsOpenLibraryDetail(missingFields: CatalogMissingBookField[]) {
  return missingFields.some((field) => ["isbn13", "pageCount", "summary", "thumbnailUrl", "publisherLink"].includes(field));
}

function rejectionNotes(results: PromiseSettledResult<unknown>[]) {
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    .join("; ");
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
