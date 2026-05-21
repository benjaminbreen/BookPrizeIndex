import { createReadStream, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { appearancesByBookId, data, getBookStats } from "../lib/data";
import type { Book, BookSubjectCategory, SourceRef } from "../lib/types";
import {
  catalogMissingFieldsForBook,
  compareEnrichmentPriority,
  enrichmentLaneForBook,
  enrichmentPriorityScore,
  isUnproductiveAttempt,
  sameMissingFields,
  type CatalogMissingBookField,
  type EnrichmentAttemptLike,
  type EnrichmentLane,
} from "./book-enrichment-priority";

type Provider = "all" | "open_library" | "google_books" | "open_library_dump";

type GeneratedSummaryPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
};

type CacheFile = {
  generatedAt?: string;
  entries?: Record<string, { fetchedAt: string; json: unknown }>;
};

type AttemptRow = EnrichmentAttemptLike & {
  attemptedAt?: string;
  title?: string;
  author?: string;
  provider?: string;
  notes?: string;
};

type OpenLibraryEdition = {
  key?: string;
  title?: string;
  subtitle?: string;
  description?: string | { value?: string };
  isbn_10?: string[];
  isbn_13?: string[];
  number_of_pages?: number;
  publish_date?: string;
  works?: { key?: string }[];
  subjects?: string[];
};

type OpenLibraryWork = {
  key?: string;
  title?: string;
  description?: string | { value?: string };
  subjects?: string[];
};

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  subject?: string[];
  edition_key?: string[];
};

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    pageCount?: number;
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    categories?: string[];
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

type Candidate = {
  provider: "open_library_dump" | "open_library" | "google_books";
  via: "isbn" | "search" | "dump";
  title?: string;
  author?: string;
  description?: string;
  subjects?: string[];
  categories?: string[];
  isbn13?: string;
  pageCount?: number;
  publicationYear?: number;
  url?: string;
  score: number;
  sourceId: string;
};

type SelectionRow = {
  book: Book;
  lane: EnrichmentLane;
  missingFields: CatalogMissingBookField[];
  priorityScore: number;
  score: number;
  title: string;
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  status: "enriched" | "no_new_fields" | "not_found" | "low_confidence" | "error";
  fields: string[];
  provider?: Candidate["provider"];
  via?: Candidate["via"];
  matchScore?: number;
  matchTitle?: string;
  notes?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const outputPath = path.join(outputDir, "summaries.generated.json");
const reportPath = path.join(publicDataDir, "summary-enrichment-report.json");
const cachePath = path.join(publicDataDir, "summary-enrichment-provider-cache.json");
const attemptsPath = path.join(publicDataDir, "summary-enrichment-attempts.json");
const isbnDiscoveryReportPath = path.join(publicDataDir, "isbn-discovery-report.json");

loadEnvLocal();

const args = parseArgs();
const requestDelayMs = positiveNumber(args["request-delay-ms"], args.provider === "google_books" ? 1200 : 350);
const refreshCacheProviders = new Set((args["refresh-cache-provider"] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
let lastRequestAt = 0;

async function main() {
  const generatedAt = new Date().toISOString();
  const [existingPatch, cache, attempts] = await Promise.all([readExistingPatch(generatedAt), readCache(), readAttempts()]);
  const requestedBookIds = new Set((args["book-ids"] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (args["isbn-report-selected"]) {
    for (const bookId of await readSelectedIsbnReportBookIds()) requestedBookIds.add(bookId);
  }
  const retryStatuses = new Set((args["retry-status"] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const excludedAttemptProviders = new Set((args["exclude-attempt-provider"] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const retryFailures = Boolean(args["retry-failures"]);
  const selected = data.books
    .filter((book) => !book.summary)
    .filter((book) => !args["isbn-only"] || normalizedIsbns(book).length > 0)
    .filter((book) => !requestedBookIds.size || requestedBookIds.has(book.id) || requestedBookIds.has(book.slug))
    .filter((book) => !excludedAttemptProviders.has(attempts[book.id]?.provider ?? ""))
    .map((book) => selectionRow(book, attempts[book.id]))
    .filter((row) => !existingPatch.books[row.book.id]?.summary)
    .filter((row) => !retryStatuses.size || retryStatuses.has(attempts[row.book.id]?.status ?? ""))
    .filter((row) => retryFailures || !isRecentUnproductiveAttempt(attempts[row.book.id], row.book))
    .sort(compareEnrichmentPriority)
    .slice(0, args.limit);

  const localCandidates = await loadLocalDumpCandidates(selected);
  const report: ReportRow[] = [];
  const runAttempts = { ...attempts };
  let completedCount = 0;
  let checkpointChain = Promise.resolve();

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(publicDataDir, { recursive: true });

  const checkpoint = async (force = false) => {
    if (args["dry-run"]) return;
    if (!force && (!args["checkpoint-every"] || completedCount % args["checkpoint-every"] !== 0)) return;
    existingPatch.generatedAt = generatedAt;
    await fs.writeFile(outputPath, `${JSON.stringify(sortPatch(existingPatch), null, 2)}\n`);
    await writeCache(cache);
    await fs.writeFile(attemptsPath, `${JSON.stringify({ generatedAt, attempts: runAttempts }, null, 2)}\n`);
    const progressPayload = reportPayload(generatedAt, selected, report, localCandidates);
    await fs.writeFile(reportPath, `${JSON.stringify(progressPayload, null, 2)}\n`);
  };

  await mapConcurrent(selected, args.concurrency, async (row, index) => {
    const result = await enrichRow(row, index + 1, selected.length, generatedAt, localCandidates, cache);
    checkpointChain = checkpointChain.then(async () => {
      report.push(result.report);
      runAttempts[row.book.id] = toAttempt(result.report, generatedAt);
      if (result.patch) existingPatch.books[row.book.id] = mergeBookPatch(existingPatch.books[row.book.id] ?? {}, result.patch);
      if (result.source) existingPatch.sources[result.source.id] = result.source;
      completedCount += 1;
      if (!args.quiet && result.report.status === "enriched") {
        console.log(`[${index + 1}/${selected.length}] ${row.book.title}: ${result.report.fields.join(", ")} from ${result.report.provider}`);
      }
      await checkpoint();
    });
    await checkpointChain;
  });
  await checkpointChain;

  existingPatch.generatedAt = generatedAt;
  if (!args["dry-run"]) {
    await checkpoint(true);
  }

  const payload = reportPayload(generatedAt, selected, report, localCandidates);
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Summary enrichment complete: ${payload.summary.enriched ?? 0}/${selected.length} enriched. Report written to ${path.relative(root, reportPath)}.`);
}

async function readSelectedIsbnReportBookIds() {
  try {
    const parsed = JSON.parse(await fs.readFile(isbnDiscoveryReportPath, "utf8")) as { report?: Array<{ bookId?: string; status?: string }> };
    return (parsed.report ?? [])
      .filter((row) => row.status === "selected" && row.bookId)
      .map((row) => row.bookId as string);
  } catch {
    return [];
  }
}

function reportPayload(generatedAt: string, selected: SelectionRow[], report: ReportRow[], localCandidates: Map<string, Candidate>) {
  return {
    generatedAt,
    dryRun: Boolean(args["dry-run"]),
    limit: args.limit,
    selectedCount: selected.length,
    provider: args.provider,
    concurrency: args.concurrency,
    localDump: {
      editions: args["open-library-editions-dump"],
      works: args["open-library-works-dump"],
      matches: localCandidates.size,
    },
    summary: summarize(report),
    report,
    outputPath: path.relative(root, outputPath),
  };
}

function selectionRow(book: Book, attempt?: AttemptRow): SelectionRow {
  const stats = getBookStats(book.id);
  const lane = enrichmentLaneForBook(book, stats, attempt);
  return {
    book,
    lane,
    missingFields: catalogMissingFieldsForBook(book),
    priorityScore: enrichmentPriorityScore(book, stats, lane),
    score: stats.score,
    title: book.title,
  };
}

async function enrichRow(
  row: SelectionRow,
  index: number,
  total: number,
  generatedAt: string,
  localCandidates: Map<string, Candidate>,
  cache: CacheFile,
): Promise<{ report: ReportRow; patch?: Partial<Book>; source?: SourceRef }> {
  const book = row.book;
  const author = authorText(book);
  if (!args.quiet) console.log(`[${index}/${total}] Enriching summary for ${book.title} - ${author}`);
  try {
    const candidate =
      localCandidates.get(book.id) ??
      (args["local-only"] ? undefined : await fetchBestCandidate(book, author, cache));
    if (!candidate) return { report: baseReport(row, "not_found", { notes: "No provider candidate found." }) };
    if (!isAcceptedCandidate(book, author, candidate)) {
      return {
        report: baseReport(row, "low_confidence", {
          provider: candidate.provider,
          via: candidate.via,
          matchScore: round(candidate.score),
          matchTitle: candidate.title,
        }),
      };
    }

    const { patch, fields, source } = buildPatch(book, candidate, generatedAt);
    if (!fields.length) {
      return {
        report: baseReport(row, "no_new_fields", {
          provider: candidate.provider,
          via: candidate.via,
          matchScore: round(candidate.score),
          matchTitle: candidate.title,
          notes: "Candidate matched but did not provide usable new catalog text.",
        }),
      };
    }
    return {
      patch,
      source,
      report: baseReport(row, "enriched", {
        fields,
        provider: candidate.provider,
        via: candidate.via,
        matchScore: round(candidate.score),
        matchTitle: candidate.title,
      }),
    };
  } catch (error) {
    return { report: baseReport(row, "error", { notes: error instanceof Error ? error.message : String(error) }) };
  }
}

async function fetchBestCandidate(book: Book, author: string, cache: CacheFile) {
  const candidates: Candidate[] = [];
  if (args.provider === "all" || args.provider === "open_library") {
    const openLibrary = args.provider === "open_library"
      ? await fetchOpenLibraryCandidate(book, author, cache)
      : await fetchOpenLibraryCandidate(book, author, cache).catch(() => undefined);
    if (openLibrary) candidates.push(openLibrary);
  }
  if (!candidates.some((candidate) => candidate.description) && (args.provider === "all" || args.provider === "google_books")) {
    const google = args.provider === "google_books"
      ? await fetchGoogleCandidate(book, author, cache)
      : await fetchGoogleCandidate(book, author, cache).catch(() => undefined);
    if (google) candidates.push(google);
  }
  return candidates.sort((a, b) => candidateRank(b) - candidateRank(a))[0];
}

async function fetchOpenLibraryCandidate(book: Book, author: string, cache: CacheFile): Promise<Candidate | undefined> {
  for (const isbn of normalizedIsbns(book)) {
    const edition = await fetchJson<OpenLibraryEdition>(`https://openlibrary.org/isbn/${isbn}.json`, cache).catch(() => undefined);
    if (!edition) continue;
    const workKey = edition.works?.[0]?.key;
    const work = workKey ? await fetchJson<OpenLibraryWork>(`https://openlibrary.org${workKey}.json`, cache).catch(() => undefined) : undefined;
    return openLibraryCandidateFromEdition(book, author, edition, work, "open_library", "isbn", 1);
  }
  if (args["isbn-only"]) return undefined;

  const docs: OpenLibraryDoc[] = [];
  for (const params of openLibraryQueries(book, author)) {
    const json = await fetchJson<{ docs?: OpenLibraryDoc[] }>(`https://openlibrary.org/search.json?${params}`, cache);
    docs.push(...(json.docs ?? []));
    const early = bestOpenLibraryDoc(book, author, docs);
    if (early?.score && early.score >= 0.92) break;
  }
  const match = bestOpenLibraryDoc(book, author, dedupeOpenLibraryDocs(docs));
  if (!match?.doc.key || match.score < args.minScore) return match ? openLibraryCandidateFromDoc(book, author, match.doc, undefined, match.score) : undefined;
  const work = await fetchJson<OpenLibraryWork>(`https://openlibrary.org${match.doc.key}.json`, cache).catch(() => undefined);
  return openLibraryCandidateFromDoc(book, author, match.doc, work, match.score);
}

async function fetchGoogleCandidate(book: Book, author: string, cache: CacheFile): Promise<Candidate | undefined> {
  const items: GoogleVolume[] = [];
  for (const isbn of normalizedIsbns(book)) {
    const params = googleVolumeParams(`isbn:${isbn}`);
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`, cache);
    const match = bestGoogleMatch(book, author, json.items ?? []);
    if (match?.score && match.score >= 0.5) return googleCandidate(book, match.item, match.score, "isbn");
  }
  if (args["isbn-only"]) return undefined;
  for (const query of googleQueries(book, author)) {
    const params = googleVolumeParams(query);
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`, cache);
    items.push(...(json.items ?? []));
    const early = bestGoogleMatch(book, author, items);
    if (early?.score && early.score >= 0.92) break;
  }
  const match = bestGoogleMatch(book, author, dedupeGoogleVolumes(items));
  return match ? googleCandidate(book, match.item, match.score, "search") : undefined;
}

function googleVolumeParams(query: string) {
  const params = new URLSearchParams({
    q: query,
    maxResults: "5",
    printType: "books",
    fields: "items(id,volumeInfo(title,authors,description,pageCount,publishedDate,industryIdentifiers,categories,canonicalVolumeLink,infoLink))",
  });
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (apiKey) params.set("key", apiKey);
  return params;
}

async function loadLocalDumpCandidates(rows: SelectionRow[]) {
  const candidates = new Map<string, Candidate>();
  const editionDump = args["open-library-editions-dump"];
  if (!editionDump || !rows.length) return candidates;
  const isbnToRows = new Map<string, SelectionRow[]>();
  for (const row of rows) {
    for (const isbn of normalizedIsbns(row.book)) {
      const list = isbnToRows.get(isbn) ?? [];
      list.push(row);
      isbnToRows.set(isbn, list);
    }
  }
  if (!isbnToRows.size) return candidates;

  const workKeysByBook = new Map<string, Set<string>>();
  await streamOpenLibraryDump(editionDump, (record) => {
    const edition = record as OpenLibraryEdition;
    const isbns = [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn).filter(Boolean);
    for (const isbn of isbns) {
      const matches = isbnToRows.get(isbn);
      if (!matches) continue;
      for (const row of matches) {
        const candidate = openLibraryCandidateFromEdition(row.book, authorText(row.book), edition, undefined, "open_library_dump", "dump", 1);
        candidates.set(row.book.id, candidate);
        for (const work of edition.works ?? []) {
          if (!work.key) continue;
          const keys = workKeysByBook.get(row.book.id) ?? new Set<string>();
          keys.add(work.key);
          workKeysByBook.set(row.book.id, keys);
        }
      }
    }
  });

  const worksDump = args["open-library-works-dump"];
  if (!worksDump || !workKeysByBook.size) return candidates;
  const neededWorkKeys = new Set([...workKeysByBook.values()].flatMap((keys) => [...keys]));
  await streamOpenLibraryDump(worksDump, (record, key) => {
    if (!key || !neededWorkKeys.has(key)) return;
    const work = record as OpenLibraryWork;
    for (const [bookId, keys] of workKeysByBook.entries()) {
      if (!keys.has(key)) continue;
      const current = candidates.get(bookId);
      if (!current) continue;
      candidates.set(bookId, {
        ...current,
        description: current.description ?? descriptionText(work.description),
        subjects: [...new Set([...(current.subjects ?? []), ...(work.subjects ?? [])])],
      });
    }
  });

  return candidates;
}

async function streamOpenLibraryDump(filePath: string, onRecord: (record: unknown, key?: string) => void | Promise<void>) {
  const input = filePath.endsWith(".gz") ? createReadStream(filePath).pipe(createGunzip()) : createReadStream(filePath);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const jsonText = parts[4] ?? parts.at(-1);
    if (!jsonText) continue;
    try {
      await onRecord(JSON.parse(jsonText), parts[1]);
    } catch {
      // Skip malformed dump rows.
    }
  }
}

function openLibraryCandidateFromEdition(
  book: Book,
  author: string,
  edition: OpenLibraryEdition,
  work: OpenLibraryWork | undefined,
  provider: "open_library" | "open_library_dump",
  via: Candidate["via"],
  score: number,
): Candidate {
  const title = [edition.title, edition.subtitle].filter(Boolean).join(": ") || work?.title;
  const key = edition.key ?? work?.key;
  const url = key ? `https://openlibrary.org${key}` : undefined;
  return {
    provider,
    via,
    title,
    author,
    description: descriptionText(edition.description) ?? descriptionText(work?.description),
    subjects: [...new Set([...(edition.subjects ?? []), ...(work?.subjects ?? [])])],
    isbn13: firstIsbn13([...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])]),
    pageCount: edition.number_of_pages,
    publicationYear: firstYear([edition.publish_date]),
    url,
    score,
    sourceId: `source-${provider.replaceAll("_", "-")}-${book.slug}`,
  };
}

function openLibraryCandidateFromDoc(
  book: Book,
  author: string,
  doc: OpenLibraryDoc,
  work: OpenLibraryWork | undefined,
  score: number,
): Candidate {
  const url = doc.key ? `https://openlibrary.org${doc.key}` : undefined;
  return {
    provider: "open_library",
    via: "search",
    title: doc.title ?? work?.title,
    author: doc.author_name?.join(", ") ?? author,
    description: descriptionText(work?.description),
    subjects: [...new Set([...(doc.subject ?? []), ...(work?.subjects ?? [])])],
    isbn13: firstIsbn13(doc.isbn ?? []),
    publicationYear: doc.first_publish_year,
    url,
    score,
    sourceId: `source-open-library-summary-${book.slug}`,
  };
}

function googleCandidate(book: Book, item: GoogleVolume, score: number, via: Candidate["via"]): Candidate {
  const info = item.volumeInfo;
  const url = info?.canonicalVolumeLink ?? info?.infoLink;
  return {
    provider: "google_books",
    via,
    title: info?.title,
    author: info?.authors?.join(", "),
    description: info?.description,
    categories: info?.categories,
    isbn13: firstIsbn13(info?.industryIdentifiers?.map((identifier) => identifier.identifier ?? "") ?? []),
    pageCount: info?.pageCount,
    publicationYear: firstYear([info?.publishedDate]),
    url,
    score,
    sourceId: `source-google-books-summary-${book.slug}`,
  };
}

function buildPatch(book: Book, candidate: Candidate, generatedAt: string) {
  const patch: Partial<Book> = {};
  const fields: string[] = [];
  const sourceIds = new Set(book.sourceIds);
  const source: SourceRef = {
    id: candidate.sourceId,
    label: `${providerLabel(candidate.provider)} summary metadata for ${book.title}`,
    url: candidate.url ?? "",
    accessedAt: generatedAt,
    confidence: "catalog",
    field: "summary",
  };
  sourceIds.add(source.id);

  const summary = trimDescription(candidate.description);
  if (!book.summary && !summary) return { fields, patch, source };
  if (!book.summary && summary) {
    patch.summary = summary;
    fields.push("summary");
  }
  if (!book.pageCount && candidate.pageCount && candidate.pageCount >= 20) {
    patch.pageCount = candidate.pageCount;
    fields.push("pageCount");
  }
  if (!book.publicationYear && candidate.publicationYear && isPlausiblePublicationYear(book, candidate.publicationYear)) {
    patch.publicationYear = candidate.publicationYear;
    fields.push("publicationYear");
  }
  if (!book.isbn13.length && candidate.isbn13) {
    patch.isbn13 = [candidate.isbn13];
    fields.push("isbn13");
  }
  if (!book.links.publisher && candidate.url) {
    patch.links = { ...book.links, publisher: candidate.url };
    fields.push("links");
  }
  const subjectCategories = subjectCategoriesFor(candidate, source.id);
  if (subjectCategories.length) {
    patch.subjectCategories = mergeSubjectCategories(book.subjectCategories ?? [], subjectCategories);
    fields.push("subjectCategories");
  }
  if (fields.length) patch.sourceIds = [...sourceIds];
  return { fields, patch, source };
}

async function fetchJson<T>(url: string, cache: CacheFile, retries = 2): Promise<T> {
  cache.entries ??= {};
  const cacheKey = redactUrlSecrets(url);
  const cached = cache.entries[cacheKey];
  if (cached && !shouldRefreshCache(url)) return cached.json as T;
  await throttle();
  const response = await fetch(url, {
    headers: { "User-Agent": "book-prize-index-summary-enrichment/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429 && retries > 0) {
    await delay(requestDelayMs * (4 - retries) * 2);
    return fetchJson<T>(url, cache, retries - 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${redactUrlSecrets(url)}`);
  const json = await response.json() as T;
  cache.entries[cacheKey] = { fetchedAt: new Date().toISOString(), json };
  return json;
}

function shouldRefreshCache(url: string) {
  if (refreshCacheProviders.has("google_books") && url.includes("www.googleapis.com/books/")) return true;
  if (refreshCacheProviders.has("open_library") && url.includes("openlibrary.org/")) return true;
  return false;
}

function redactUrlSecrets(url: string) {
  return url.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < requestDelayMs) await delay(requestDelayMs - elapsed);
  lastRequestAt = Date.now();
}

function openLibraryQueries(book: Book, author: string) {
  const mainAuthor = author.split(/\s+(?:and|&)\s+/i)[0]?.trim() || author;
  const shortTitle = titleWithoutSubtitle(book.title);
  const fields = "key,title,author_name,first_publish_year,isbn,subject,edition_key";
  return [
    new URLSearchParams({ title: book.title, author, limit: "5", fields }),
    new URLSearchParams({ q: `${book.title} ${author}`, limit: "5", fields }),
    ...(shortTitle !== book.title ? [new URLSearchParams({ title: shortTitle, author: mainAuthor, limit: "5", fields })] : []),
    new URLSearchParams({ q: `${shortTitle} ${mainAuthor}`, limit: "5", fields }),
  ];
}

function googleQueries(book: Book, author: string) {
  const mainAuthor = author.split(/\s+(?:and|&)\s+/i)[0]?.trim() || author;
  const shortTitle = titleWithoutSubtitle(book.title);
  return [
    `intitle:${quote(book.title)} inauthor:${quote(author)}`,
    `${quote(book.title)} ${quote(author)}`,
    ...(shortTitle !== book.title ? [`intitle:${quote(shortTitle)} inauthor:${quote(mainAuthor)}`] : []),
    `${quote(shortTitle)} ${quote(mainAuthor)}`,
  ];
}

function bestOpenLibraryDoc(book: Book, author: string, docs: OpenLibraryDoc[]) {
  return docs
    .map((doc) => ({ doc, score: matchScore(book.title, author, doc.title, doc.author_name?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function bestGoogleMatch(book: Book, author: string, items: GoogleVolume[]) {
  return items
    .map((item) => ({ item, score: matchScore(book.title, author, item.volumeInfo?.title, item.volumeInfo?.authors?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function isAcceptedCandidate(book: Book, author: string, candidate: Candidate) {
  if (candidate.via === "isbn" || candidate.via === "dump") return Boolean(candidate.title && !isDisallowedEdition(normalizeForMatch(candidate.title), normalizeForMatch(book.title)));
  if (!candidate.title) return false;
  const titleScore = similarity(book.title, candidate.title);
  const authorScore = similarity(author, candidate.author ?? "");
  const shortTitle = normalizeForMatch(titleWithoutSubtitle(book.title));
  const candidateTitle = normalizeForMatch(candidate.title);
  const containedMainTitle = shortTitle.length >= 8 && candidateTitle.startsWith(shortTitle);
  if (authorScore >= 0.55 && containedMainTitle) return true;
  return candidate.score >= args.minScore && authorScore >= 0.55 && titleScore >= 0.58;
}

function matchScore(title: string, author: string, candidateTitle?: string, candidateAuthor?: string) {
  if (!candidateTitle) return 0;
  const titleScore = Math.max(similarity(title, candidateTitle), similarity(titleWithoutSubtitle(title), titleWithoutSubtitle(candidateTitle)));
  const authorScore = candidateAuthor ? similarity(author, candidateAuthor) : 0.5;
  return titleScore * 0.72 + authorScore * 0.28;
}

function similarity(a: string, b: string) {
  const aTokens = new Set(normalizeForMatch(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeForMatch(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function normalizeForMatch(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|in|on|for|to|with|by)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleWithoutSubtitle(title: string) {
  return title.split(/[:.;]\s+/)[0]?.trim() || title;
}

function isDisallowedEdition(candidate: string, title: string) {
  const disallowed = ["adaptation", "young readers", "study guide", "summary", "companion", "collection set", "illustrated"];
  if (disallowed.some((term) => candidate.includes(term) && !title.includes(term))) return true;
  if (candidate.includes("short history of") && !title.includes("short history")) return true;
  if (/\bvolumes?\b/.test(candidate) && !/\bvolumes?\b|\bvol\.?\b/.test(title)) return true;
  return false;
}

function trimDescription(description?: string) {
  if (!description) return undefined;
  const cleaned = description
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 80) return undefined;
  return cleaned.slice(0, 1400).trim();
}

function subjectCategoriesFor(candidate: Candidate, sourceId: string): BookSubjectCategory[] {
  return [
    ...(candidate.subjects ?? []).slice(0, 24).map((label) => ({
      source: "open_library" as const,
      scheme: "open_library_subject",
      label,
      sourceId,
    })),
    ...(candidate.categories ?? []).slice(0, 8).map((label) => ({
      source: "google_books" as const,
      scheme: "google_books_category",
      label,
      sourceId,
    })),
  ];
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

function mergeBookPatch(current: Partial<Book>, next: Partial<Book>): Partial<Book> {
  const merged: Partial<Book> = { ...current, ...next };
  const isbn13 = [...new Set([...(current.isbn13 ?? []), ...(next.isbn13 ?? [])])];
  const links = { ...(current.links ?? {}), ...(next.links ?? {}) };
  const sourceIds = [...new Set([...(current.sourceIds ?? []), ...(next.sourceIds ?? [])])];
  const subjectCategories = mergeSubjectCategories(current.subjectCategories ?? [], next.subjectCategories ?? []);
  if (isbn13.length) merged.isbn13 = isbn13;
  else delete merged.isbn13;
  if (Object.keys(links).length) merged.links = links;
  else delete merged.links;
  if (sourceIds.length) merged.sourceIds = sourceIds;
  else delete merged.sourceIds;
  if (subjectCategories.length) merged.subjectCategories = subjectCategories;
  else delete merged.subjectCategories;
  return merged;
}

function isPlausiblePublicationYear(book: Book, publicationYear: number) {
  const firstRecognitionYear = Math.min(...(appearancesByBookId.get(book.id) ?? []).map((appearance) => appearance.year));
  if (Number.isFinite(firstRecognitionYear) && publicationYear > firstRecognitionYear + 1) return false;
  return publicationYear >= 1500 && publicationYear <= new Date().getFullYear() + 1;
}

function candidateRank(candidate: Candidate) {
  return candidate.score + (candidate.description ? 1 : 0) + (candidate.via === "isbn" || candidate.via === "dump" ? 0.5 : 0);
}

function baseReport(row: SelectionRow, status: ReportRow["status"], extra: Partial<ReportRow> = {}): ReportRow {
  return {
    bookId: row.book.id,
    slug: row.book.slug,
    title: row.book.title,
    author: authorText(row.book),
    status,
    fields: [],
    ...extra,
  };
}

function toAttempt(row: ReportRow, attemptedAt: string): AttemptRow {
  return {
    status: row.status,
    attemptedAt,
    title: row.title,
    author: row.author,
    provider: row.provider,
    notes: row.notes,
    missingFields: ["summary"],
  };
}

function isRecentUnproductiveAttempt(attempt: AttemptRow | undefined, book: Book) {
  return isUnproductiveAttempt(attempt) && sameMissingFields(attempt?.missingFields, catalogMissingFieldsForBook(book).filter((field) => field === "summary"));
}

function normalizedIsbns(book: Book) {
  return book.isbn13.map(normalizeIsbn).filter(Boolean);
}

function normalizeIsbn(value: string | undefined) {
  const normalized = (value ?? "").replace(/[^0-9X]/gi, "");
  return /^\d{13}$/.test(normalized) || /^\d{9}[\dX]$/i.test(normalized) ? normalized : "";
}

function firstIsbn13(values: string[]) {
  return values.map(normalizeIsbn).find((value) => /^\d{13}$/.test(value));
}

function firstYear(values: Array<string | number | undefined>) {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function descriptionText(value: OpenLibraryEdition["description"] | OpenLibraryWork["description"] | undefined) {
  return typeof value === "string" ? value : value?.value;
}

function authorText(book: Book) {
  return book.authors.map((author) => author.name).join(", ");
}

function quote(input: string) {
  return `"${input.replaceAll('"', "")}"`;
}

function providerLabel(provider: Candidate["provider"]) {
  if (provider === "google_books") return "Google Books";
  if (provider === "open_library_dump") return "Open Library dump";
  return "Open Library";
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

async function readExistingPatch(generatedAt: string): Promise<GeneratedSummaryPatch> {
  try {
    const parsed = JSON.parse(await fs.readFile(outputPath, "utf8")) as Partial<GeneratedSummaryPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-summaries.ts from Open Library dumps/APIs and Google Books fallback. Focused on sourced catalog text for semantic search; manual curation may override.",
      books: parsed.books ?? {},
      sources: parsed.sources ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-summaries.ts from Open Library dumps/APIs and Google Books fallback. Focused on sourced catalog text for semantic search; manual curation may override.",
      books: {},
      sources: {},
    };
  }
}

async function readCache(): Promise<CacheFile> {
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile;
  } catch {
    return { entries: {} };
  }
}

async function writeCache(cache: CacheFile) {
  cache.generatedAt = new Date().toISOString();
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function readAttempts(): Promise<Record<string, AttemptRow>> {
  try {
    const parsed = JSON.parse(await fs.readFile(attemptsPath, "utf8")) as { attempts?: Record<string, AttemptRow> };
    return parsed.attempts ?? {};
  } catch {
    return {};
  }
}

function sortPatch(patch: GeneratedSummaryPatch): GeneratedSummaryPatch {
  const books = Object.entries(patch.books).map(([id, book]) => [id, sanitizeBookPatch(book)] as [string, Partial<Book>]);
  return {
    ...patch,
    books: Object.fromEntries(books.sort(([a], [b]) => a.localeCompare(b))),
    sources: Object.fromEntries(Object.entries(patch.sources).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function sanitizeBookPatch(book: Partial<Book>) {
  const sanitized = { ...book };
  if (sanitized.links && !Object.keys(sanitized.links).length) delete sanitized.links;
  if (sanitized.isbn13 && !sanitized.isbn13.length) delete sanitized.isbn13;
  if (sanitized.sourceIds && !sanitized.sourceIds.length) delete sanitized.sourceIds;
  if (sanitized.subjectCategories && !sanitized.subjectCategories.length) delete sanitized.subjectCategories;
  return sanitized;
}

function summarize(report: ReportRow[]) {
  return report.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
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

function round(value: number) {
  return Number(value.toFixed(3));
}

function parseArgs() {
  const raw = process.argv.slice(2);
  const value = (name: string) => {
    const index = raw.indexOf(`--${name}`);
    return index >= 0 ? raw[index + 1] : undefined;
  };
  const provider = (value("provider") ?? "all") as Provider;
  if (!["all", "open_library", "google_books", "open_library_dump"].includes(provider)) {
    throw new Error("--provider must be one of all, open_library, google_books, open_library_dump");
  }
  return {
    "book-ids": value("book-ids"),
    "checkpoint-every": positiveNumber(value("checkpoint-every"), 0),
    concurrency: positiveNumber(value("concurrency"), 2),
    "dry-run": raw.includes("--dry-run"),
    "exclude-attempt-provider": value("exclude-attempt-provider"),
    "refresh-cache-provider": value("refresh-cache-provider"),
    "isbn-only": raw.includes("--isbn-only"),
    limit: positiveNumber(value("limit"), 200),
    "local-only": raw.includes("--local-only") || provider === "open_library_dump",
    minScore: Number(value("min-score") ?? "0.68"),
    "open-library-editions-dump": value("open-library-editions-dump") ?? process.env.OPEN_LIBRARY_EDITIONS_DUMP,
    "open-library-works-dump": value("open-library-works-dump") ?? process.env.OPEN_LIBRARY_WORKS_DUMP,
    provider,
    quiet: raw.includes("--quiet"),
    "request-delay-ms": value("request-delay-ms"),
    "retry-failures": raw.includes("--retry-failures"),
    "retry-status": value("retry-status"),
    "isbn-report-selected": raw.includes("--isbn-report-selected"),
  };
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
