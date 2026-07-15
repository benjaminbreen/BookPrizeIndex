import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { data, getBookStats } from "../lib/data";
import type { Book, SourceRef } from "../lib/types";
import { cacheDataDir, reportsDataDir, root, sourcesDir } from "./build/paths";
import type { CoverDiscoveryCandidate } from "./discover-book-covers";

type CoverPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources?: Record<string, SourceRef>;
  failures?: Record<string, CoverFailure>;
};

type CoverDiscoveryFile = {
  candidates?: Record<string, CoverDiscoveryCandidate>;
};

type CoverFailure = {
  sourceUrl?: string;
  failedAt: string;
  note?: string;
};

type CoverCacheReport = {
  generatedAt: string;
  summary: Record<CoverCacheStatus, number> & {
    selected: number;
    cachedBooks: number;
  };
  rows: CoverCacheRow[];
};

type CoverCacheStatus = "cached" | "already_local" | "existing_file" | "skipped" | "failed";

type CoverCacheRow = {
  bookId: string;
  title: string;
  status: CoverCacheStatus;
  sourceUrl?: string;
  source?: SourceRef;
  localUrl?: string;
  note?: string;
};

type CoverJob = {
  book: Book;
  sourceUrl: string;
  source?: SourceRef;
};

type CliOptions = {
  limit: number;
  concurrency: number;
  retryFailures: boolean;
  provider?: "openlibrary" | "google" | "all";
  minLists: number;
  requestDelayMs: number;
};

const outputDir = path.join(root, "public", "book-covers");
const patchPath = path.join(sourcesDir, "enrichment", "covers.generated.json");
const reportPath = path.join(reportsDataDir, "cover-cache-report.json");
const discoveryPath = path.join(cacheDataDir, "cover-discovery-candidates.json");
const defaultLimit = 100;
const defaultConcurrency = 4;
const timeoutMs = 12_000;
const minImageBytes = 800;
const knownPlaceholderHashes = new Set([
  "1eaa7e0f5efaebddaaa22d54d640e391852271d9dfcb50f67496175c3c8a0ea0",
]);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const existingPatch = await readPatch();
  const discovery = await readDiscoveryCandidates();
  const selected = data.books
    .map((book) => coverJobForBook(book, discovery.candidates?.[book.id]))
    .filter((job): job is CoverJob => job ? shouldSelectBook(job, existingPatch, options) : false)
    .sort(compareBooksForCoverCaching)
    .slice(0, options.limit);

  await fs.mkdir(outputDir, { recursive: true });

  const rows = await runPool(selected, options.concurrency, (job) => cacheCoverForBook(job, existingPatch, options.requestDelayMs));
  const nextPatch = mergePatch(existingPatch, rows);
  await fs.writeFile(patchPath, `${JSON.stringify(nextPatch, null, 2)}\n`);

  const summary = summarize(rows, selected.length, Object.keys(nextPatch.books).length);
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: nextPatch.generatedAt,
        summary,
        rows,
      } satisfies CoverCacheReport,
      null,
      2,
    )}\n`,
  );

  console.log(
    `Cached ${summary.cached} covers. Reused ${summary.existing_file} existing files. ` +
      `Patch now contains ${summary.cachedBooks} local cover URLs. Report written to data/reports/cover-cache-report.json.`,
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    limit: defaultLimit,
    concurrency: defaultConcurrency,
    retryFailures: false,
    provider: "all",
    minLists: 0,
    requestDelayMs: 0,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--limit" && next) {
      options.limit = parsePositiveInteger(next, "limit");
      index += 1;
    } else if (arg === "--concurrency" && next) {
      options.concurrency = parsePositiveInteger(next, "concurrency");
      index += 1;
    } else if (arg === "--retry-failures") {
      options.retryFailures = true;
    } else if (arg === "--provider" && next) {
      if (next !== "openlibrary" && next !== "google" && next !== "all") {
        throw new Error(`Unsupported provider: ${next}`);
      }
      options.provider = next;
      index += 1;
    } else if (arg === "--min-lists" && next) {
      options.minLists = parsePositiveInteger(next, "min-lists");
      index += 1;
    } else if (arg === "--request-delay-ms" && next) {
      options.requestDelayMs = parseNonNegativeInteger(next, "request-delay-ms");
      index += 1;
    }
  }

  return options;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`--${label} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${label} must be a non-negative integer.`);
  return parsed;
}

async function readPatch(): Promise<CoverPatch> {
  const failures = await readPreviousFailures();
  try {
    const patch = JSON.parse(await fs.readFile(patchPath, "utf8")) as CoverPatch;
    return {
      ...patch,
      failures: sortRecord({ ...failures, ...(patch.failures ?? {}) }),
    };
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      notes: "Generated by scripts/cache-book-covers.ts. Downloads remote catalog cover thumbnails into public/book-covers and rewrites thumbnailUrl to local static assets.",
      books: {},
      sources: {},
      failures,
    };
  }
}

async function readDiscoveryCandidates(): Promise<CoverDiscoveryFile> {
  try {
    return JSON.parse(await fs.readFile(discoveryPath, "utf8")) as CoverDiscoveryFile;
  } catch {
    return {};
  }
}

async function readPreviousFailures() {
  try {
    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as CoverCacheReport;
    const failures: Record<string, CoverFailure> = {};
    for (const result of report.rows) {
      if (result.status !== "failed") continue;
      failures[result.bookId] = {
        sourceUrl: result.sourceUrl,
        failedAt: report.generatedAt,
        note: result.note,
      };
    }
    return sortRecord(failures);
  } catch {
    return {};
  }
}

function coverJobForBook(book: Book, candidate: CoverDiscoveryCandidate | undefined): CoverJob | undefined {
  if (book.thumbnailUrl && !isLocalCoverUrl(book.thumbnailUrl)) {
    return {
      book,
      sourceUrl: book.thumbnailUrl,
      source: candidate?.source ?? sourceForExistingThumbnail(book, book.thumbnailUrl),
    };
  }
  if (!book.thumbnailUrl && candidate) return { book, sourceUrl: candidate.sourceUrl, source: candidate.source };
  return undefined;
}

function shouldSelectBook(job: CoverJob, patch: CoverPatch, options: CliOptions) {
  const { book, sourceUrl } = job;
  if (getBookStats(book.id).lists < options.minLists) return false;
  if (!sourceUrl || isLocalCoverUrl(sourceUrl)) return false;
  if (!options.retryFailures && patch.books[book.id]?.thumbnailUrl && isLocalCoverUrl(patch.books[book.id]?.thumbnailUrl)) return false;
  if (!options.retryFailures && patch.failures?.[book.id]?.sourceUrl === sourceUrl) return false;
  if (options.provider === "openlibrary" && !isOpenLibraryCover(sourceUrl)) return false;
  if (options.provider === "google" && !isGoogleBooksCover(sourceUrl)) return false;
  return isOpenLibraryCover(sourceUrl) || isGoogleBooksCover(sourceUrl);
}

function compareBooksForCoverCaching(a: CoverJob, b: CoverJob) {
  const scoreDelta = coverPriorityScore(b.book) - coverPriorityScore(a.book);
  if (scoreDelta !== 0) return scoreDelta;
  return a.book.title.localeCompare(b.book.title);
}

function coverPriorityScore(book: Book) {
  const stats = getBookStats(book.id);
  const recognition = (stats.wins ?? 0) * 12 + (stats.lists ?? 0) * 3;
  const sourceScore = isOpenLibraryCover(book.thumbnailUrl) ? 2 : 1;
  return recognition + sourceScore;
}

async function cacheCoverForBook(job: CoverJob, patch: CoverPatch, requestDelayMs: number): Promise<CoverCacheRow> {
  const { book, source, sourceUrl } = job;
  if (isLocalCoverUrl(sourceUrl)) return row(book, "already_local", { localUrl: sourceUrl });

  const downloadUrl = normalizedDownloadUrl(sourceUrl);
  const extension = extensionForUrl(downloadUrl);
  const fileName = `${book.id}.${extension}`;
  const filePath = path.join(outputDir, fileName);
  const localUrl = `/book-covers/${fileName}`;

  if (patch.books[book.id]?.thumbnailUrl === localUrl) {
    return row(book, "already_local", { sourceUrl, localUrl });
  }

  try {
    const existing = await fs.stat(filePath);
    if (existing.size >= minImageBytes) return row(book, "existing_file", { sourceUrl, source, localUrl });
  } catch {
    // File is not cached yet.
  }

  try {
    if (requestDelayMs) await delay(requestDelayMs);
    const bytes = await downloadImage(downloadUrl);
    await fs.writeFile(filePath, bytes);
    return row(book, "cached", { sourceUrl, source, localUrl });
  } catch (error) {
    return row(book, "failed", {
      sourceUrl,
      source,
      note: error instanceof Error ? error.message : String(error),
    });
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "BookPrizeIndex/1.0 (https://resobscura.substack.com)",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`Unexpected content-type: ${contentType || "unknown"}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < minImageBytes) throw new Error(`Image response too small: ${buffer.length} bytes`);
    validateImage(buffer, contentType, url);
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

function mergePatch(existingPatch: CoverPatch, rows: CoverCacheRow[]): CoverPatch {
  const books = { ...existingPatch.books };
  const sources = { ...(existingPatch.sources ?? {}) };
  const failures = { ...(existingPatch.failures ?? {}) };
  for (const result of rows) {
    if ((result.status === "cached" || result.status === "existing_file") && result.localUrl) {
      books[result.bookId] = {
        ...(books[result.bookId] ?? {}),
        thumbnailUrl: result.localUrl,
        ...(result.source ? { sourceIds: [result.source.id] } : {}),
      };
      if (result.source) sources[result.source.id] = result.source;
      delete failures[result.bookId];
    } else if (result.status === "failed") {
      failures[result.bookId] = {
        sourceUrl: result.sourceUrl,
        failedAt: new Date().toISOString(),
        note: result.note,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    notes: existingPatch.notes,
    books: sortRecord(books),
    sources: sortRecord(sources),
    failures: sortRecord(failures),
  };
}

function sourceForExistingThumbnail(book: Book, sourceUrl: string): SourceRef | undefined {
  const provider = isOpenLibraryCover(sourceUrl) ? "open-library" : isGoogleBooksCover(sourceUrl) ? "google-books" : undefined;
  if (!provider) return undefined;
  const id = `source-cover-${provider}-${book.slug}`;
  return {
    id,
    label: `${provider === "open-library" ? "Open Library" : "Google Books"} cover for ${book.title}`,
    url: book.links.publisher ?? sourceUrl,
    accessedAt: new Date().toISOString(),
    confidence: "catalog",
    field: "book",
  };
}

function validateImage(buffer: Buffer, contentType: string, sourceUrl: string) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (knownPlaceholderHashes.has(hash)) throw new Error("Provider returned a known no-cover placeholder image.");
  if (isGoogleBooksCover(sourceUrl) && contentType.includes("image/png") && buffer.length === 1269) {
    throw new Error("Google Books returned its no-cover placeholder image.");
  }
  const dimensions = imageDimensions(buffer);
  if (dimensions && (dimensions.width < 70 || dimensions.height < 70)) {
    throw new Error(`Image dimensions are too small: ${dimensions.width}x${dimensions.height}.`);
  }
}

function imageDimensions(buffer: Buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    if (length < 2) break;
    offset += length;
  }
  return undefined;
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

function summarize(rows: CoverCacheRow[], selected: number, cachedBooks: number): CoverCacheReport["summary"] {
  const summary = {
    cached: 0,
    already_local: 0,
    existing_file: 0,
    skipped: 0,
    failed: 0,
    selected,
    cachedBooks,
  };
  for (const result of rows) summary[result.status] += 1;
  return summary;
}

function row(book: Book, status: CoverCacheStatus, detail: Omit<CoverCacheRow, "bookId" | "title" | "status"> = {}): CoverCacheRow {
  return {
    bookId: book.id,
    title: book.title,
    status,
    ...detail,
  };
}

function normalizedDownloadUrl(url: string) {
  if (isOpenLibraryCover(url)) {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/-([SML])\.jpg$/i, "-M.jpg");
    parsed.searchParams.set("default", "false");
    return parsed.toString();
  }
  return url.replace(/^http:\/\//, "https://");
}

function extensionForUrl(url: string) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "png";
  if (pathname.endsWith(".webp")) return "webp";
  return "jpg";
}

function isLocalCoverUrl(url: string | undefined): url is string {
  return Boolean(url?.startsWith("/book-covers/"));
}

function isOpenLibraryCover(url: string | undefined) {
  return Boolean(url?.includes("covers.openlibrary.org"));
}

function isGoogleBooksCover(url: string | undefined) {
  return Boolean(url?.includes("books.google.com/books/content"));
}

function sortRecord<T>(record: Record<string, T>) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) as Record<string, T>;
}
