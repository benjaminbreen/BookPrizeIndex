import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Book, Imprint, Publisher, SourceRef } from "../lib/types";
import { slugify } from "./build/text";

type CatalogData = {
  books: Book[];
  publishers: Publisher[];
  imprints: Imprint[];
};

type MappingConfidence = "high" | "medium" | "low";

type ImprintMapping = {
  raw: string;
  imprint: string;
  publisher: string;
  confidence: MappingConfidence;
  note?: string;
};

type GeneratedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  imprints: Record<string, Partial<Imprint>>;
  publishers: Record<string, Partial<Publisher>>;
  sources: Record<string, SourceRef>;
};

type Candidate = {
  provider: "current_publisher" | "google_books" | "open_library";
  rawPublisher: string;
  rawVariant: string;
  mapped?: ImprintMapping;
  title?: string;
  author?: string;
  publishedYear?: number;
  sourceUrl?: string;
  score: number;
  yearCompatible: boolean;
};

type QueueRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  year?: number;
  publisherId: string;
  publisherName: string;
  reason: string;
};

type ReportRow = QueueRow & {
  status: "applied" | "ambiguous" | "low_confidence" | "unmapped_candidate" | "parent_only" | "not_found" | "error";
  selectedImprint?: string;
  selectedPublisher?: string;
  selectedRawPublisher?: string;
  selectedSourceUrl?: string;
  candidates: Candidate[];
  notes?: string;
};

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  key?: string;
};

type ProviderCache = {
  generatedAt?: string;
  entries?: Record<string, {
    fetchedAt: string;
    ok: boolean;
    status?: number;
    body?: unknown;
    error?: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "public", "catalog.json");
const mappingPath = path.join(root, "sources", "imprint-normalization.json");
const outputPath = path.join(root, "sources", "enrichment", "imprints.resolved.generated.json");
const queuePath = path.join(root, "data", "public", "imprint-resolution-queue.json");
const reportPath = path.join(root, "data", "public", "imprint-resolution-report.json");
const cachePath = path.join(root, "data", "public", "imprint-resolution-provider-cache.json");
const limit = positiveNumber(readArg("--limit") ?? process.env.IMPRINT_RESOLUTION_LIMIT, 250);
const concurrency = positiveNumber(readArg("--concurrency") ?? process.env.IMPRINT_RESOLUTION_CONCURRENCY, 3);
const minScore = Number(readArg("--min-score") ?? process.env.IMPRINT_RESOLUTION_MIN_SCORE ?? "0.74");
const provider = readArg("--provider") ?? process.env.IMPRINT_RESOLUTION_PROVIDER ?? "all";
const requestDelayMs = positiveNumber(readArg("--request-delay-ms") ?? process.env.IMPRINT_RESOLUTION_REQUEST_DELAY_MS, 300);
const sourceIdPrefix = "source-imprint-resolution";
let providerCache: NonNullable<ProviderCache["entries"]> = {};
let lastRequestAt = 0;

async function main() {
  const generatedAt = new Date().toISOString();
  providerCache = await readProviderCache();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as CatalogData;
  const mappings = await readMappings();
  const publishersById = new Map(catalog.publishers.map((publisher) => [publisher.id, publisher]));
  const queue = catalog.books
    .filter((book) => book.publisherId && !book.imprintId)
    .map((book) => toQueueRow(book, publishersById))
    .filter((row): row is QueueRow => Boolean(row))
    .sort((a, b) => b.reason.localeCompare(a.reason) || a.title.localeCompare(b.title))
    .slice(0, limit);

  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(
    queuePath,
    `${JSON.stringify({
      generatedAt,
      policy: "Resolve broad parent publishers to the first US/UK trade edition imprint only when catalog evidence produces one strong known-imprint candidate.",
      limit,
      count: queue.length,
      queue,
    }, null, 2)}\n`,
  );

  const report = await mapConcurrent(queue, concurrency, (row, index) => resolveRow(row, mappings, index + 1, queue.length));
  const patch = buildPatch(generatedAt, report);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`);
  await writeProviderCache();
  await fs.writeFile(
    reportPath,
    `${JSON.stringify({
      generatedAt,
      policy: "First US/UK trade edition imprint when supported by strong catalog evidence. Ambiguous edition/reprint conflicts remain manual review items.",
      limit,
      minScore,
      concurrency,
      provider,
      requestDelayMs,
      providerCacheEntries: Object.keys(providerCache).length,
      selectedCount: queue.length,
      summary: summarize(report),
      report,
    }, null, 2)}\n`,
  );

  console.log(`Resolved ${report.filter((row) => row.status === "applied").length}/${queue.length} broad-parent publisher rows.`);
  console.log(`Report written to data/public/imprint-resolution-report.json.`);
}

async function readMappings() {
  const parsed = JSON.parse(await fs.readFile(mappingPath, "utf8")) as { mappings?: ImprintMapping[] };
  const mappings = new Map<string, ImprintMapping>();
  for (const mapping of parsed.mappings ?? []) {
    mappings.set(normalizePublisherName(mapping.raw), mapping);
  }
  return mappings;
}

async function readProviderCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as ProviderCache;
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

async function writeProviderCache() {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: providerCache }, null, 2)}\n`);
}

function toQueueRow(book: Book, publishersById: Map<string, Publisher>): QueueRow | undefined {
  if (!book.publisherId) return undefined;
  const publisherName = publishersById.get(book.publisherId)?.name;
  if (!publisherName) return undefined;
  const broadReason = broadParentReason(publisherName);
  if (!broadReason) return undefined;
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    year: book.publicationYear,
    publisherId: book.publisherId,
    publisherName,
    reason: broadReason,
  };
}

async function resolveRow(row: QueueRow, mappings: Map<string, ImprintMapping>, index: number, total: number): Promise<ReportRow> {
  console.log(`[${index}/${total}] Resolving imprint for ${row.title}`);
  try {
    const [googleResult, openLibraryResult] = await Promise.allSettled([
      shouldUseProvider("google_books") ? fetchGoogleCandidates(row, mappings) : Promise.resolve([]),
      shouldUseProvider("open_library") ? fetchOpenLibraryCandidates(row, mappings) : Promise.resolve([]),
    ]);
    const providerErrors = [googleResult, openLibraryResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    const candidates = [
      ...publisherCandidates("current_publisher", row.publisherName, row, mappings, 1, undefined),
      ...(googleResult.status === "fulfilled" ? googleResult.value : []),
      ...(openLibraryResult.status === "fulfilled" ? openLibraryResult.value : []),
    ].sort(compareCandidates);

    const classified = classifyCandidates(row, candidates);
    if (providerErrors.length && classified.status !== "applied") {
      classified.notes = [classified.notes, `Provider errors: ${providerErrors.join(" | ")}`].filter(Boolean).join(" ");
    }
    return classified;
  } catch (error) {
    return {
      ...row,
      status: "error",
      candidates: [],
      notes: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchGoogleCandidates(row: QueueRow, mappings: Map<string, ImprintMapping>) {
  const queries = [
    row.year ? `intitle:${quote(row.title)} inauthor:${quote(primaryAuthor(row.author))} ${row.year}` : "",
    `intitle:${quote(row.title)} inauthor:${quote(primaryAuthor(row.author))}`,
  ].filter(Boolean);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`;
    const payload = await fetchJson<{ items?: GoogleVolume[] }>(url);
    for (const item of payload.items ?? []) {
      const info = item.volumeInfo;
      if (!info?.publisher) continue;
      const score = matchScore(row.title, row.author, info.title, info.authors?.join(", "));
      if (score < 0.5) continue;
      const publishedYear = yearFromDate(info.publishedDate);
      const sourceUrl = info.canonicalVolumeLink ?? info.infoLink;
      for (const candidate of publisherCandidates("google_books", info.publisher, row, mappings, score, sourceUrl, info.title, info.authors?.join(", "), publishedYear)) {
        const key = `${candidate.provider}:${candidate.rawVariant}:${candidate.sourceUrl ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
    if (candidates.some((candidate) => candidate.mapped && candidate.score >= minScore)) break;
  }
  return candidates;
}

async function fetchOpenLibraryCandidates(row: QueueRow, mappings: Map<string, ImprintMapping>) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(row.title)}&author=${encodeURIComponent(primaryAuthor(row.author))}&limit=10&fields=title,author_name,publisher,first_publish_year,key`;
  const payload = await fetchJson<{ docs?: OpenLibraryDoc[] }>(url);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const doc of payload.docs ?? []) {
    const score = matchScore(row.title, row.author, doc.title, doc.author_name?.join(", "));
    if (score < 0.5) continue;
    const sourceUrl = doc.key ? `https://openlibrary.org${doc.key}` : undefined;
    for (const publisher of doc.publisher ?? []) {
      for (const candidate of publisherCandidates("open_library", publisher, row, mappings, score, sourceUrl, doc.title, doc.author_name?.join(", "), doc.first_publish_year)) {
        const key = `${candidate.provider}:${candidate.rawVariant}:${candidate.sourceUrl ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function publisherCandidates(
  provider: Candidate["provider"],
  rawPublisher: string,
  row: QueueRow,
  mappings: Map<string, ImprintMapping>,
  score: number,
  sourceUrl?: string,
  title?: string,
  author?: string,
  publishedYear?: number,
): Candidate[] {
  return rawPublisherVariants(rawPublisher).map((rawVariant) => {
    const mapped = mappings.get(normalizePublisherName(rawVariant));
    return {
      provider,
      rawPublisher,
      rawVariant,
      mapped,
      title,
      author,
      publishedYear,
      sourceUrl,
      score,
      yearCompatible: isYearCompatible(row.year, publishedYear),
    };
  });
}

function classifyCandidates(row: QueueRow, candidates: Candidate[]): ReportRow {
  const meaningful = candidates.filter((candidate) => candidate.provider !== "current_publisher" || candidate.mapped);
  const mapped = meaningful.filter((candidate) => candidate.mapped && parentMatches(row.publisherName, candidate.mapped.publisher));
  const nonParentMapped = mapped.filter((candidate) => candidate.mapped && normalizePublisherName(candidate.mapped.imprint) !== normalizePublisherName(candidate.mapped.publisher));
  const strong = nonParentMapped.filter((candidate) => candidate.score >= minScore && candidate.yearCompatible && candidate.mapped?.confidence === "high");
  const strongImprints = new Map(strong.map((candidate) => [normalizePublisherName(candidate.mapped!.imprint), candidate]));

  if (strongImprints.size === 1) {
    const selected = [...strongImprints.values()].sort(compareCandidates)[0];
    return {
      ...row,
      status: "applied",
      selectedImprint: selected.mapped!.imprint,
      selectedPublisher: selected.mapped!.publisher,
      selectedRawPublisher: selected.rawVariant,
      selectedSourceUrl: selected.sourceUrl,
      candidates: meaningful,
    };
  }

  if (strongImprints.size > 1) {
    return { ...row, status: "ambiguous", candidates: meaningful, notes: "Multiple strong imprint candidates survived matching." };
  }

  if (nonParentMapped.length) {
    return { ...row, status: "low_confidence", candidates: meaningful, notes: "Known imprint candidates exist, but title/author/year/confidence gates were not strong enough." };
  }

  if (meaningful.some((candidate) => candidate.mapped)) {
    return { ...row, status: "parent_only", candidates: meaningful, notes: "Only parent-publisher mappings were found." };
  }

  if (meaningful.length) {
    return { ...row, status: "unmapped_candidate", candidates: meaningful, notes: "Catalog sources returned publisher strings that are not in sources/imprint-normalization.json." };
  }

  return { ...row, status: "not_found", candidates: [], notes: "No usable catalog publisher candidates found." };
}

function buildPatch(generatedAt: string, report: ReportRow[]): GeneratedPatch {
  const patch: GeneratedPatch = {
    generatedAt,
    notes: "Generated by scripts/resolve-broad-publisher-imprints.ts from broad parent publisher rows. Applies only high-confidence first US/UK trade edition imprint candidates resolved through sources/imprint-normalization.json.",
    books: {},
    imprints: {},
    publishers: {},
    sources: {},
  };

  for (const row of report.filter((item) => item.status === "applied")) {
    if (!row.selectedImprint || !row.selectedPublisher) continue;
    const publisherId = `publisher-${slugify(row.selectedPublisher)}`;
    const imprintId = `imprint-${slugify(row.selectedImprint)}`;
    const sourceId = `${sourceIdPrefix}-${row.slug}`;
    patch.publishers[publisherId] = { id: publisherId, name: row.selectedPublisher, sourceIds: [sourceId] };
    patch.imprints[imprintId] = { id: imprintId, name: row.selectedImprint, publisherId, sourceIds: [sourceId] };
    patch.books[row.bookId] = {
      publisherId,
      imprintId,
      sourceIds: [sourceId],
    };
    patch.sources[sourceId] = {
      id: sourceId,
      label: `Catalog imprint evidence for ${row.title}`,
      url: row.selectedSourceUrl ?? "",
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "publisher",
      note: `Resolved broad parent publisher "${row.publisherName}" to imprint "${row.selectedImprint}" using raw catalog publisher "${row.selectedRawPublisher}".`,
    };
  }

  return patch;
}

function rawPublisherVariants(value: string) {
  const normalizedSpaces = value.replace(/\s+/g, " ").trim();
  const variants = new Set<string>([normalizedSpaces]);
  const splitPatterns = [
    /\s*,?\s+an imprint of\s+/i,
    /\s*,?\s+imprint of\s+/i,
    /\s*,?\s+a division of\s+/i,
    /\s*,?\s+division of\s+/i,
    /\s*,?\s+subsidiary of\s+/i,
    /\s*,?\s+part of\s+/i,
  ];
  for (const pattern of splitPatterns) {
    const [prefix] = normalizedSpaces.split(pattern);
    if (prefix && prefix !== normalizedSpaces) variants.add(prefix.trim());
  }
  if (normalizedSpaces.includes("/")) {
    for (const part of normalizedSpaces.split("/")) variants.add(part.trim());
  }
  return [...variants].filter((item) => item.length > 1);
}

function broadParentReason(name: string) {
  const normalized = normalizePublisherName(name);
  if (/\bpenguin random house\b/.test(normalized)) return "broad_penguin_random_house_parent";
  if (/\bmacmillan\b/.test(normalized)) return "broad_macmillan_parent";
  if (/\bhachette\b/.test(normalized)) return "broad_hachette_parent";
  if (/\bharpercollins\b/.test(normalized)) return "broad_harpercollins_parent";
  if (/\bsimon schuster\b/.test(normalized)) return "broad_simon_schuster_parent";
  if (/\bwiley\b/.test(normalized) || /\bjohn wiley sons\b/.test(normalized)) return "broad_wiley_parent";
  if (/\bspringer\b/.test(normalized)) return "broad_springer_parent";
  if (/\btaylor francis\b/.test(normalized)) return "broad_taylor_francis_parent";
  if (/\belsevier\b/.test(normalized)) return "broad_elsevier_parent";
  return undefined;
}

function parentMatches(currentPublisher: string, mappedPublisher: string) {
  const current = normalizePublisherName(currentPublisher);
  const mapped = normalizePublisherName(mappedPublisher);
  return current === mapped || current.includes(mapped) || mapped.includes(current) || parentAlias(current) === parentAlias(mapped);
}

function parentAlias(value: string) {
  if (value.includes("penguin random house")) return "penguin random house";
  if (value.includes("macmillan")) return "macmillan";
  if (value.includes("hachette")) return "hachette";
  if (value.includes("harpercollins")) return "harpercollins";
  if (value.includes("simon schuster")) return "simon schuster";
  if (value.includes("wiley") || value.includes("john wiley sons")) return "wiley";
  if (value.includes("springer")) return "springer";
  if (value.includes("taylor francis")) return "taylor francis";
  if (value.includes("elsevier")) return "elsevier";
  return value;
}

function compareCandidates(a: Candidate, b: Candidate) {
  return Number(Boolean(b.mapped)) - Number(Boolean(a.mapped)) || b.score - a.score || Number(b.yearCompatible) - Number(a.yearCompatible) || a.rawVariant.localeCompare(b.rawVariant);
}

function summarize(report: ReportRow[]) {
  return report.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

function shouldUseProvider(name: "google_books" | "open_library") {
  return provider === "all" || provider === name;
}

async function fetchJson<T>(url: string): Promise<T> {
  const cached = providerCache[url];
  if (cached?.ok) return cached.body as T;
  if (cached && cached.status && cached.status !== 429) throw new Error(cached.error ?? `${cached.status} cached error for ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await waitForRequestSlot();
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "BookPrizeIndexMetadataResolver/1.0" },
      });
      if (response.ok) {
        const body = await response.json() as T;
        providerCache[url] = { fetchedAt: new Date().toISOString(), ok: true, status: response.status, body };
        return body;
      }
      const error = `${response.status} ${response.statusText} for ${url}`;
      if (response.status === 429 && attempt < 3) {
        await delay(requestDelayMs * attempt * 4);
        continue;
      }
      providerCache[url] = { fetchedAt: new Date().toISOString(), ok: false, status: response.status, error };
      throw new Error(error);
    }
    throw new Error(`Request failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
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

function matchScore(title: string, author: string, candidateTitle = "", candidateAuthor = "") {
  return similarity(title, candidateTitle) * 0.72 + similarity(author, candidateAuthor) * 0.28;
}

function similarity(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function tokenize(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 1);
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

function isYearCompatible(bookYear?: number, candidateYear?: number) {
  if (!bookYear || !candidateYear) return true;
  return Math.abs(bookYear - candidateYear) <= 3;
}

function yearFromDate(value: string | undefined) {
  const year = Number(value?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1]);
  return Number.isFinite(year) ? year : undefined;
}

function primaryAuthor(authorText: string) {
  return authorText.split(/,|\band\b|&/i)[0]?.trim() ?? authorText;
}

function quote(input: string) {
  return `"${input.replaceAll('"', "")}"`;
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
