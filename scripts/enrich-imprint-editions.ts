import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "./build/pipeline-data";
import type { Book, Imprint, Publisher, PublisherEvidence, SourceRef } from "../lib/types";
import { slugify } from "./build/text";

type Mapping = {
  raw: string;
  imprint: string;
  publisher: string;
  confidence: "high" | "medium" | "low";
};

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    industryIdentifiers?: Array<{ identifier?: string }>;
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

type OpenLibraryEdition = {
  key?: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  isbn_10?: string[];
  isbn_13?: string[];
};

type OpenLibraryBookData = {
  key?: string;
  url?: string;
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
};

type CacheEntry = {
  fetchedAt: string;
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
};

type Candidate = {
  provider: "google_books" | "open_library";
  isbn: string;
  rawPublisher: string;
  title?: string;
  author?: string;
  year?: number;
  sourceUrl: string;
  titleScore: number;
  authorScore: number;
  mapping?: Mapping;
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  year?: number;
  status: "applied" | "unmapped" | "low_confidence" | "ambiguous" | "not_found" | "error";
  selectedImprint?: string;
  selectedPublisher?: string;
  selectedSourceUrl?: string;
  selectedIsbn?: string;
  evidenceSourceUrl?: string;
  evidenceIsbn?: string;
  rawPublishers: string[];
  notes?: string;
};

type GeneratedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  imprints: Record<string, Partial<Imprint>>;
  publishers: Record<string, Partial<Publisher>>;
  sources: Record<string, SourceRef>;
  publisherEvidence: Record<string, PublisherEvidence[]>;
};

type ProviderCache = { generatedAt?: string; entries?: Record<string, CacheEntry> };
type AttemptFile = { generatedAt?: string; attempts?: Record<string, Pick<ReportRow, "status" | "notes"> & { attemptedAt: string; isbnState: string }> };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "sources", "enrichment", "imprint-editions.generated.json");
const reportPath = path.join(root, "data", "reports", "imprint-edition-enrichment-report.json");
const cachePath = path.join(root, "data", "cache", "imprint-edition-provider-cache.json");
const attemptsPath = path.join(root, "data", "cache", "imprint-edition-attempts.json");
const mappingPath = path.join(root, "sources", "imprint-normalization.json");

loadEnvLocal();

const args = parseArgs();
let cacheEntries: Record<string, CacheEntry> = {};
let lastRequestAt = 0;
const batchedOpenLibraryByIsbn = new Map<string, OpenLibraryBookData>();

async function main() {
  const generatedAt = new Date().toISOString();
  const [mappingFile, existingPatch, providerCache, attemptFile] = await Promise.all([
    readJson<{ mappings?: Mapping[] }>(mappingPath, {}),
    readJson<Partial<GeneratedPatch>>(outputPath, {}),
    readJson<ProviderCache>(cachePath, {}),
    readJson<AttemptFile>(attemptsPath, {}),
  ]);
  const existingReport = await readJson<{ report?: ReportRow[] }>(reportPath, {});
  cacheEntries = providerCache.entries ?? {};
  const mappings = buildMappingIndex(mappingFile.mappings ?? []);
  const attempts = attemptFile.attempts ?? {};
  const patch: GeneratedPatch = {
    generatedAt,
    notes: "Generated from exact-ISBN Google Books and Open Library edition records. Imprints are applied only when exact ISBN, title/author, year, and a known high-confidence imprint mapping agree.",
    books: existingPatch.books ?? {},
    imprints: existingPatch.imprints ?? {},
    publishers: existingPatch.publishers ?? {},
    sources: existingPatch.sources ?? {},
    publisherEvidence: existingPatch.publisherEvidence ?? {},
  };
  reconcileEvidenceConfidence(patch, existingReport.report ?? []);
  const selected = data.books
    .filter((book) => !book.imprintId && normalizedIsbns(book).length)
    .filter((book) => args.retryFailures || !isCurrentUnproductiveAttempt(attempts[book.id], book))
    .sort((a, b) => getBookStats(b.id).wins - getBookStats(a.id).wins || getBookStats(b.id).score - getBookStats(a.id).score || a.title.localeCompare(b.title))
    .slice(0, args.limit);
  const report: ReportRow[] = [];
  const nextAttempts = { ...attempts };
  let completed = 0;
  let writeChain = Promise.resolve();

  await Promise.all([
    fs.mkdir(path.dirname(outputPath), { recursive: true }),
    fs.mkdir(path.dirname(reportPath), { recursive: true }),
    fs.mkdir(path.dirname(cachePath), { recursive: true }),
  ]);

  if (args.reconcileOnly) {
    await Promise.all([
      fs.writeFile(outputPath, `${JSON.stringify(sortPatch(patch), null, 2)}\n`),
      fs.writeFile(attemptsPath, `${JSON.stringify({ generatedAt, attempts }, null, 2)}\n`),
    ]);
    console.log(`Reconciled evidence confidence for ${existingReport.report?.length ?? 0} report rows.`);
    return;
  }

  if (args.provider !== "google_books") await prefetchOpenLibraryBooks(selected);

  await mapConcurrent(selected, args.concurrency, async (book, index) => {
    if (!args.quiet) console.log(`[${index + 1}/${selected.length}] Resolving ${book.title}`);
    const result = await resolveBook(book, mappings).catch((error): ReportRow => ({
      ...baseReport(book),
      status: "error",
      rawPublishers: [],
      notes: error instanceof Error ? error.message : String(error),
    }));
    writeChain = writeChain.then(async () => {
      report.push(result);
      nextAttempts[book.id] = {
        status: result.status,
        notes: result.notes,
        attemptedAt: generatedAt,
        isbnState: isbnState(book),
      };
      applyResult(patch, book, result, generatedAt, mappings);
      completed += 1;
      if (args.checkpointEvery && completed % args.checkpointEvery === 0) {
        await checkpoint(patch, nextAttempts, report, selected.length, generatedAt);
        console.log(`Checkpointed ${completed}/${selected.length}.`);
      }
    });
    await writeChain;
  });
  await writeChain;
  await checkpoint(patch, nextAttempts, report, selected.length, generatedAt);
  const summary = summarize(report);
  console.log(`Imprint edition enrichment complete: ${summary.applied ?? 0}/${selected.length} applied.`);
}

async function resolveBook(book: Book, mappings: Map<string, Mapping>): Promise<ReportRow> {
  const candidates: Candidate[] = [];
  const providerErrors: string[] = [];
  for (const isbn of normalizedIsbns(book)) {
    if (args.provider !== "open_library") {
      try {
        candidates.push(...await googleCandidates(book, isbn, mappings));
      } catch (error) {
        providerErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (args.provider !== "google_books" && !candidates.some((candidate) => candidate.mapping)) {
      try {
        candidates.push(...await openLibraryCandidates(book, isbn, mappings));
      } catch (error) {
        providerErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (candidates.some(isStrongCandidate)) break;
  }
  const rawPublishers = [...new Set(candidates.map((candidate) => candidate.rawPublisher))];
  const identityStrong = candidates.filter(isIdentityStrongCandidate);
  const evidence = identityStrong[0] ?? candidates[0];
  const strong = identityStrong.filter(isStrongCandidate);
  const byImprint = new Map(strong.map((candidate) => [normalizeName(candidate.mapping!.imprint), candidate]));
  if (byImprint.size === 1) {
    const selected = [...byImprint.values()][0];
    return {
      ...baseReport(book),
      status: "applied",
      selectedImprint: selected.mapping!.imprint,
      selectedPublisher: selected.mapping!.publisher,
      selectedSourceUrl: selected.sourceUrl,
      selectedIsbn: selected.isbn,
      evidenceSourceUrl: selected.sourceUrl,
      evidenceIsbn: selected.isbn,
      rawPublishers,
      notes: `${providerLabel(selected.provider)} exact ISBN ${selected.isbn}: ${selected.rawPublisher}`,
    };
  }
  const evidenceFields = { evidenceSourceUrl: evidence?.sourceUrl, evidenceIsbn: evidence?.isbn };
  if (byImprint.size > 1) return { ...baseReport(book), ...evidenceFields, status: "ambiguous", rawPublishers, notes: "Multiple high-confidence imprint mappings survived exact-ISBN matching." };
  if (candidates.some((candidate) => candidate.mapping)) return { ...baseReport(book), ...evidenceFields, status: "low_confidence", rawPublishers, notes: "A known mapping was found but title, author, year, or confidence gates did not all pass." };
  if (identityStrong.length) return { ...baseReport(book), ...evidenceFields, status: "unmapped", rawPublishers, notes: "A strong exact-ISBN edition match returned publisher strings that are not yet mapped to an imprint." };
  if (candidates.length) return { ...baseReport(book), ...evidenceFields, status: "low_confidence", rawPublishers, notes: "Exact-ISBN publisher evidence was found, but title, author, or year compatibility was not strong enough." };
  if (providerErrors.length) return { ...baseReport(book), status: "error", rawPublishers: [], notes: providerErrors.join(" | ") };
  return { ...baseReport(book), status: "not_found", rawPublishers: [], notes: "No usable exact-ISBN edition record was found." };
}

async function googleCandidates(book: Book, isbn: string, mappings: Map<string, Mapping>) {
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: "10",
    printType: "books",
    fields: "items(id,volumeInfo(title,authors,publisher,publishedDate,industryIdentifiers,canonicalVolumeLink,infoLink))",
  });
  const key = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (key) params.set("key", key);
  const payload = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
  return (payload.items ?? [])
    .filter((item) => item.volumeInfo?.industryIdentifiers?.some((identifier) => normalizeIsbn(identifier.identifier ?? "") === isbn))
    .flatMap((item) => candidateFromRawPublisher({
      book,
      isbn,
      provider: "google_books",
      rawPublisher: item.volumeInfo?.publisher,
      title: item.volumeInfo?.title,
      author: item.volumeInfo?.authors?.join(", "),
      year: yearFromDate(item.volumeInfo?.publishedDate),
      sourceUrl: item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(item.id ?? "")}`,
      mappings,
    }));
}

async function openLibraryCandidates(book: Book, isbn: string, mappings: Map<string, Mapping>) {
  const batched = batchedOpenLibraryByIsbn.get(isbn);
  if (batched) {
    const title = [batched.title, batched.subtitle].filter(Boolean).join(": ");
    const candidates = (batched.publishers ?? []).flatMap((publisher) => candidateFromRawPublisher({
      book,
      isbn,
      provider: "open_library",
      rawPublisher: publisher.name,
      title,
      author: batched.authors?.map((author) => author.name).filter(Boolean).join(", "),
      year: yearFromDate(batched.publish_date),
      sourceUrl: batched.url ?? (batched.key ? `https://openlibrary.org${batched.key}` : `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}`),
      mappings,
    }));
    if (candidates.length || args.batchOnly) return candidates;
  } else if (args.batchOnly) {
    return [];
  }
  const edition = await fetchJson<OpenLibraryEdition>(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`).catch(() => undefined);
  if (!edition) return [];
  const editionIsbns = [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn);
  if (editionIsbns.length && !editionIsbns.includes(isbn)) return [];
  const title = [edition.title, edition.subtitle].filter(Boolean).join(": ");
  return (edition.publishers ?? []).flatMap((rawPublisher) => candidateFromRawPublisher({
    book,
    isbn,
    provider: "open_library",
    rawPublisher,
    title,
    author: authorText(book),
    year: yearFromDate(edition.publish_date),
    sourceUrl: edition.key ? `https://openlibrary.org${edition.key}` : `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}`,
    mappings,
  }));
}

async function prefetchOpenLibraryBooks(books: Book[]) {
  const isbns = [...new Set(books.flatMap(normalizedIsbns))];
  const chunks = chunk(isbns, 50);
  for (const [index, values] of chunks.entries()) {
    const bibkeys = values.map((isbn) => `ISBN:${isbn}`).join(",");
    const params = new URLSearchParams({ bibkeys, jscmd: "data", format: "json" });
    const payload = await fetchJson<Record<string, OpenLibraryBookData>>(`https://openlibrary.org/api/books?${params}`);
    for (const [bibkey, book] of Object.entries(payload)) {
      const isbn = normalizeIsbn(bibkey.replace(/^ISBN:/i, ""));
      if (isbn) batchedOpenLibraryByIsbn.set(isbn, book);
    }
    if (!args.quiet) console.log(`Loaded Open Library ISBN batch ${index + 1}/${chunks.length}.`);
  }
}

function candidateFromRawPublisher(input: {
  book: Book;
  isbn: string;
  provider: Candidate["provider"];
  rawPublisher?: string;
  title?: string;
  author?: string;
  year?: number;
  sourceUrl: string;
  mappings: Map<string, Mapping>;
}): Candidate[] {
  if (!input.rawPublisher || isDisallowedPublisher(input.rawPublisher)) return [];
  return rawPublisherVariants(input.rawPublisher).map((rawPublisher) => ({
    provider: input.provider,
    isbn: input.isbn,
    rawPublisher,
    title: input.title,
    author: input.author,
    year: input.year,
    sourceUrl: input.sourceUrl,
    titleScore: titleSimilarity(input.book.title, input.title ?? ""),
    authorScore: similarity(authorText(input.book), input.author ?? ""),
    mapping: input.mappings.get(normalizeName(rawPublisher)),
  }));
}

function isStrongCandidate(candidate: Candidate) {
  if (!candidate.mapping || candidate.mapping.confidence !== "high") return false;
  if (isBroadParent(candidate.mapping.imprint) && normalizeName(candidate.mapping.imprint) === normalizeName(candidate.mapping.publisher)) return false;
  return isIdentityStrongCandidate(candidate);
}

function isIdentityStrongCandidate(candidate: Candidate) {
  if (candidate.titleScore < 0.58 || candidate.authorScore < 0.5) return false;
  const book = data.books.find((item) => item.isbn13.some((isbn) => normalizeIsbn(isbn) === candidate.isbn));
  if (book?.publicationYear && candidate.year && Math.abs(book.publicationYear - candidate.year) > 8) return false;
  return true;
}

function applyResult(patch: GeneratedPatch, book: Book, result: ReportRow, generatedAt: string, mappings: Map<string, Mapping>) {
  if (result.rawPublishers.length) {
    const sourceUrl = result.evidenceSourceUrl ?? result.selectedSourceUrl ?? book.links.publisher ?? "";
    const evidenceSourceId = `source-imprint-edition-evidence-${book.slug}`;
    patch.sources[evidenceSourceId] = {
      id: evidenceSourceId,
      label: `Exact-ISBN publisher evidence for ${book.title}`,
      url: sourceUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "publisher",
      note: [result.notes, result.evidenceIsbn ? `Exact ISBN: ${result.evidenceIsbn}.` : undefined].filter(Boolean).join(" "),
    };
    patch.publisherEvidence[book.id] = [{
      id: `publisher-evidence-imprint-edition-${book.slug}`,
      bookId: book.id,
      rawName: result.rawPublishers[0],
      source: "catalog_metadata",
      confidence: result.status === "applied" ? "high" : result.status === "unmapped" ? "medium" : "low",
      sourceUrl,
      sourceId: evidenceSourceId,
      note: result.notes,
    }];
  }
  if (result.status !== "applied" || !result.selectedImprint || !result.selectedPublisher) return;
  const mapping = [...mappings.values()].find((item) => item.imprint === result.selectedImprint && item.publisher === result.selectedPublisher);
  if (!mapping) return;
  const publisherId = `publisher-${slugify(result.selectedPublisher)}`;
  const imprintId = `imprint-${slugify(result.selectedImprint)}`;
  const sourceId = `source-imprint-edition-${book.slug}`;
  patch.publishers[publisherId] = { id: publisherId, name: result.selectedPublisher, sourceIds: [sourceId] };
  patch.imprints[imprintId] = { id: imprintId, name: result.selectedImprint, publisherId, sourceIds: [sourceId] };
  patch.books[book.id] = { publisherId, imprintId, sourceIds: [...new Set([...book.sourceIds, sourceId])] };
  patch.sources[sourceId] = {
    id: sourceId,
    label: `Exact-ISBN imprint evidence for ${book.title}`,
    url: result.selectedSourceUrl ?? book.links.publisher ?? "",
    accessedAt: generatedAt,
    confidence: "catalog",
    field: "publisher",
    note: [result.notes, result.selectedIsbn ? `Exact ISBN: ${result.selectedIsbn}.` : undefined].filter(Boolean).join(" "),
  };
}

function reconcileEvidenceConfidence(patch: GeneratedPatch, report: ReportRow[]) {
  for (const row of report) {
    const confidence: PublisherEvidence["confidence"] = row.status === "applied" ? "high" : row.status === "unmapped" ? "medium" : "low";
    const evidence = patch.publisherEvidence[row.bookId];
    if (!evidence) continue;
    patch.publisherEvidence[row.bookId] = evidence.map((item) => ({ ...item, confidence }));
  }
}

async function checkpoint(patch: GeneratedPatch, attempts: NonNullable<AttemptFile["attempts"]>, report: ReportRow[], selectedCount: number, generatedAt: string) {
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(sortPatch(patch), null, 2)}\n`),
    fs.writeFile(cachePath, `${JSON.stringify({ generatedAt, entries: cacheEntries }, null, 2)}\n`),
    fs.writeFile(attemptsPath, `${JSON.stringify({ generatedAt, attempts }, null, 2)}\n`),
    fs.writeFile(reportPath, `${JSON.stringify({ generatedAt, selectedCount, summary: summarize(report), report }, null, 2)}\n`),
  ]);
}

async function fetchJson<T>(url: string): Promise<T> {
  const cacheKey = redactUrlSecrets(url);
  const cached = cacheEntries[cacheKey];
  if (cached?.ok) return cached.body as T;
  if (cached && cached.status && cached.status !== 429) throw new Error(cached.error ?? `${cached.status} cached error`);
  await throttle();
  const response = await fetch(url, {
    headers: { "User-Agent": "BookPrizeIndex/1.0 (https://resobscura.substack.com)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = `${response.status} ${response.statusText} for ${cacheKey}`;
    cacheEntries[cacheKey] = { fetchedAt: new Date().toISOString(), ok: false, status: response.status, error };
    throw new Error(error);
  }
  const body = await response.json() as T;
  cacheEntries[cacheKey] = { fetchedAt: new Date().toISOString(), ok: true, status: response.status, body };
  return body;
}

function buildMappingIndex(mappings: Mapping[]) {
  const index = new Map<string, Mapping>();
  for (const mapping of mappings) index.set(normalizeName(mapping.raw), mapping);
  for (const imprint of data.imprints) {
    const publisher = imprint.publisherId ? data.publishers.find((item) => item.id === imprint.publisherId) : undefined;
    if (!publisher || isBroadParent(imprint.name)) continue;
    const key = normalizeName(imprint.name);
    if (!index.has(key)) index.set(key, { raw: imprint.name, imprint: imprint.name, publisher: publisher.name, confidence: "high" });
  }
  return index;
}

function rawPublisherVariants(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const variants = new Set([normalized]);
  for (const pattern of [/\s*,?\s+an imprint of\s+/i, /\s*,?\s+a division of\s+/i, /\s*,?\s+division of\s+/i]) {
    const prefix = normalized.split(pattern)[0]?.trim();
    if (prefix) variants.add(prefix);
  }
  return [...variants];
}

function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/\b(the|and|inc|incorporated|llc|ltd|limited|company|co|publishing|publishers?|press)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isBroadParent(value: string) {
  return /\b(penguin random house|macmillan|hachette|harpercollins|simon\s*(?:and|&)\s*schuster|springer|wiley|taylor\s*(?:and|&)\s*francis|elsevier)\b/i.test(value);
}

function isDisallowedPublisher(value: string) {
  return /\b(audio|audiobook|books on tape|blackstone|tantor|large print|self[-\s]?published|independently published|publisher not identified|unknown)\b/i.test(value);
}

function baseReport(book: Book) {
  return { bookId: book.id, slug: book.slug, title: book.title, author: authorText(book), year: book.publicationYear };
}

function authorText(book: Book) { return book.authors.map((author) => author.name).join(", "); }
function normalizedIsbns(book: Book) { return book.isbn13.map(normalizeIsbn).filter(Boolean); }
function normalizeIsbn(value: string) { const result = value.replace(/[^0-9X]/gi, "").toUpperCase(); return /^\d{13}$/.test(result) || /^\d{9}[\dX]$/.test(result) ? result : ""; }
function isbnState(book: Book) { return normalizedIsbns(book).sort().join(","); }
function yearFromDate(value?: string) { const match = value?.match(/\b(1[5-9]\d{2}|20\d{2})\b/); return match ? Number(match[1]) : undefined; }
function providerLabel(value: Candidate["provider"]) { return value === "google_books" ? "Google Books" : "Open Library"; }
function redactUrlSecrets(url: string) { return url.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]"); }

function similarity(a: string, b: string) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return (2 * overlap) / (left.size + right.size);
}

function titleSimilarity(a: string, b: string) {
  const leftMain = a.split(/[:.;]\s+/)[0]?.trim() ?? a;
  const rightMain = b.split(/[:.;]\s+/)[0]?.trim() ?? b;
  return Math.max(similarity(a, b), similarity(leftMain, rightMain));
}

function tokens(value: string) {
  return normalizeName(value).split(" ").filter((token) => token.length > 1 && !["of", "in", "on", "for", "to", "with", "by", "a", "an"].includes(token));
}

function isCurrentUnproductiveAttempt(attempt: NonNullable<AttemptFile["attempts"]>[string] | undefined, book: Book) {
  return Boolean(attempt && ["unmapped", "low_confidence", "ambiguous", "not_found"].includes(attempt.status) && attempt.isbnState === isbnState(book));
}

function sortPatch(patch: GeneratedPatch): GeneratedPatch {
  const sort = <T>(value: Record<string, T>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return { ...patch, books: sort(patch.books), imprints: sort(patch.imprints), publishers: sort(patch.publishers), sources: sort(patch.sources), publisherEvidence: sort(patch.publisherEvidence) };
}

function summarize(report: ReportRow[]) {
  return report.reduce<Record<string, number>>((result, row) => { result[row.status] = (result[row.status] ?? 0) + 1; return result; }, {});
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function mapConcurrent<T>(items: T[], width: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, Math.max(items.length, 1)) }, async () => {
    while (next < items.length) { const index = next; next += 1; await worker(items[index], index); }
  }));
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < args.requestDelayMs) await new Promise((resolve) => setTimeout(resolve, args.requestDelayMs - elapsed));
  lastRequestAt = Date.now();
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")) as T; } catch { return fallback; }
}

function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path.join(root, filename), "utf8").split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch { /* Optional. */ }
  }
}

function parseArgs() {
  const raw = process.argv.slice(2);
  const value = (name: string) => { const index = raw.indexOf(`--${name}`); return index >= 0 ? raw[index + 1] : undefined; };
  const provider = value("provider") ?? "all";
  if (!new Set(["all", "google_books", "open_library"]).has(provider)) throw new Error("--provider must be all, google_books, or open_library");
  return {
    limit: positiveNumber(value("limit"), 1500),
    concurrency: positiveNumber(value("concurrency"), 3),
    requestDelayMs: positiveNumber(value("request-delay-ms"), 350),
    checkpointEvery: positiveNumber(value("checkpoint-every"), 50),
    retryFailures: raw.includes("--retry-failures"),
    reconcileOnly: raw.includes("--reconcile-only"),
    batchOnly: raw.includes("--batch-only"),
    provider: provider as "all" | "google_books" | "open_library",
    quiet: raw.includes("--quiet"),
  };
}

function positiveNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
