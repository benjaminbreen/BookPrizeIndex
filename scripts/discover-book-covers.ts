import fs from "node:fs/promises";
import path from "node:path";
import { data } from "./build/pipeline-data";
import type { Book, SourceRef } from "../lib/types";
import { cacheDataDir, reportsDataDir, root } from "./build/paths";

type ProviderCache = {
  entries?: Record<string, { fetchedAt?: string; json?: unknown }>;
};

export type CoverDiscoveryCandidate = {
  bookId: string;
  title: string;
  provider: "google" | "openlibrary";
  method: "google_volume_id" | "google_cache_match" | "google_isbn" | "google_title_search" | "openlibrary_cache_match" | "openlibrary_isbn_search" | "openlibrary_title_search" | "openlibrary_link_cache" | "openlibrary_isbn_cache";
  sourceUrl: string;
  source: SourceRef;
};

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
    };
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

type CoverAttempt = {
  attemptedAt: string;
  status: "found" | "not_found" | "no_cover" | "error";
  note?: string;
};

type GoogleIsbnResult = {
  attempt: CoverAttempt;
  candidate?: CoverDiscoveryCandidate;
};

type AttemptFile = { attempts?: Record<string, CoverAttempt> };
type GoogleProviderCache = { entries?: Record<string, { fetchedAt: string; json: { items?: GoogleVolume[] } }> };

type CliOptions = {
  dryRun: boolean;
  googleIsbn: boolean;
  googleTitle: boolean;
  openLibraryIsbn: boolean;
  openLibraryTitle: boolean;
  limit: number;
  concurrency: number;
  requestDelayMs: number;
  checkpointEvery: number;
  retryFailures: boolean;
};

type CandidateFile = {
  generatedAt: string;
  candidates: Record<string, CoverDiscoveryCandidate>;
};

type OpenLibraryRecord = {
  cover_i?: number;
  covers?: number[];
};

const providerCachePath = path.join(cacheDataDir, "summary-enrichment-provider-cache.json");
const candidatePath = path.join(cacheDataDir, "cover-discovery-candidates.json");
const attemptPath = path.join(cacheDataDir, "cover-discovery-attempts.json");
const googleProviderCachePath = path.join(cacheDataDir, "cover-discovery-google-cache.json");
const googleTitleAttemptPath = path.join(cacheDataDir, "cover-discovery-google-title-attempts.json");
const googleTitleProviderCachePath = path.join(cacheDataDir, "cover-discovery-google-title-cache.json");
const openLibraryAttemptPath = path.join(cacheDataDir, "cover-discovery-openlibrary-attempts.json");
const openLibraryProviderCachePath = path.join(cacheDataDir, "cover-discovery-openlibrary-cache.json");
const openLibraryTitleAttemptPath = path.join(cacheDataDir, "cover-discovery-openlibrary-title-attempts.json");
const openLibraryTitleProviderCachePath = path.join(cacheDataDir, "cover-discovery-openlibrary-title-cache.json");
const reportPath = path.join(reportsDataDir, "cover-discovery-report.json");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await loadEnvLocal();
  const options = parseArgs(process.argv.slice(2));
  const dryRun = options.dryRun;
  const providerCache = await readJson<ProviderCache>(providerCachePath, {});
  const entries = providerCache.entries ?? {};
  const openLibraryIsbnCache = await readJson<ProviderCache>(openLibraryProviderCachePath, {});
  const openLibraryTitleCache = await readJson<ProviderCache>(openLibraryTitleProviderCachePath, {});
  const googleIsbnCache = await readJson<ProviderCache>(googleProviderCachePath, {});
  const googleTitleCache = await readJson<ProviderCache>(googleTitleProviderCachePath, {});
  const candidates: Record<string, CoverDiscoveryCandidate> = {};
  const generatedAt = new Date().toISOString();

  for (const book of data.books) {
    if (book.thumbnailUrl) continue;
    const linkedRecord = openLibraryRecordForLink(book.links.publisher, entries);
    const isbnRecord = openLibraryRecordForIsbns(book.isbn13, entries);
    const openLibraryMatch = linkedRecord ?? isbnRecord;
    const coverId = firstCoverId(openLibraryMatch?.record);

    if (coverId) {
      const sourcePageUrl = openLibraryMatch?.sourcePageUrl ?? `https://openlibrary.org/isbn/${book.isbn13[0]}`;
      const sourceId = `source-cover-open-library-${book.slug}`;
      candidates[book.id] = {
        bookId: book.id,
        title: book.title,
        provider: "openlibrary",
        method: linkedRecord ? "openlibrary_link_cache" : "openlibrary_isbn_cache",
        sourceUrl: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`,
        source: {
          id: sourceId,
          label: `Open Library cover for ${book.title}`,
          url: sourcePageUrl,
          accessedAt: generatedAt,
          confidence: "catalog",
          field: "book",
          note: `Cover ID ${coverId} recovered from cached Open Library catalog metadata.`,
        },
      };
      continue;
    }

    const googleVolume = googleVolumeForLink(book.links.publisher);
    if (!googleVolume) continue;
    const sourceId = `source-cover-google-books-${book.slug}`;
    candidates[book.id] = {
      bookId: book.id,
      title: book.title,
      provider: "google",
      method: "google_volume_id",
      sourceUrl: `https://books.google.com/books/content?id=${encodeURIComponent(googleVolume.id)}&printsec=frontcover&img=1&zoom=1&source=gbs_api`,
      source: {
        id: sourceId,
        label: `Google Books cover for ${book.title}`,
        url: googleVolume.sourcePageUrl,
        accessedAt: generatedAt,
        confidence: "catalog",
        field: "book",
        note: `Cover candidate derived from the existing Google Books volume ID ${googleVolume.id}.`,
      },
    };
  }

  addCachedOpenLibraryCandidates(candidates, entries, generatedAt);
  addCachedOpenLibraryCandidates(candidates, openLibraryIsbnCache.entries ?? {}, generatedAt);
  addCachedOpenLibraryCandidates(candidates, openLibraryTitleCache.entries ?? {}, generatedAt);
  addCachedGoogleCandidates(candidates, entries, generatedAt);
  addCachedGoogleCandidates(candidates, googleIsbnCache.entries ?? {}, generatedAt);
  addCachedGoogleCandidates(candidates, googleTitleCache.entries ?? {}, generatedAt);
  const googleIsbnSummary = options.googleIsbn && !dryRun
    ? await discoverGoogleIsbnCovers(candidates, generatedAt, options)
    : emptyOnlineSummary();
  const googleTitleSummary = options.googleTitle && !dryRun
    ? await discoverGoogleTitleCovers(candidates, generatedAt, options)
    : emptyOnlineSummary();
  const openLibraryIsbnSummary = options.openLibraryIsbn && !dryRun
    ? await discoverOpenLibraryIsbnCovers(candidates, generatedAt, options)
    : emptyOnlineSummary();
  const openLibraryTitleSummary = options.openLibraryTitle && !dryRun
    ? await discoverOpenLibraryTitleCovers(candidates, generatedAt, options)
    : emptyOnlineSummary();
  const rows = Object.values(candidates).sort((a, b) => a.title.localeCompare(b.title));
  const byMethod = Object.fromEntries(
    ["google_volume_id", "google_cache_match", "google_isbn", "google_title_search", "openlibrary_cache_match", "openlibrary_isbn_search", "openlibrary_title_search", "openlibrary_link_cache", "openlibrary_isbn_cache"].map((method) => [
      method,
      rows.filter((row) => row.method === method).length,
    ]),
  );
  const report = {
    generatedAt,
    dryRun,
    summary: {
      catalogBooks: data.books.length,
      booksMissingCovers: data.books.filter((book) => !book.thumbnailUrl).length,
      candidates: rows.length,
      byMethod,
      onlineSummary: {
        googleIsbn: googleIsbnSummary,
        googleTitle: googleTitleSummary,
        openLibraryIsbn: openLibraryIsbnSummary,
        openLibraryTitle: openLibraryTitleSummary,
      },
    },
    rows,
  };

  await fs.mkdir(cacheDataDir, { recursive: true });
  await fs.mkdir(reportsDataDir, { recursive: true });
  if (!dryRun) {
    const output: CandidateFile = {
      generatedAt,
      candidates: Object.fromEntries(rows.map((row) => [row.bookId, row])),
    };
    await fs.writeFile(candidatePath, `${JSON.stringify(output, null, 2)}\n`);
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${dryRun ? "Found" : "Queued"} ${rows.length} cover candidates: ` +
      `${byMethod.openlibrary_link_cache} cached Open Library links, ` +
      `${byMethod.openlibrary_isbn_cache} cached Open Library ISBNs, ` +
      `${byMethod.openlibrary_cache_match} cached Open Library catalog matches, ` +
      `${byMethod.google_volume_id} Google volume IDs, ` +
      `${byMethod.google_cache_match} cached Google catalog matches, ` +
      `${byMethod.google_isbn} Google ISBN matches, ` +
      `${byMethod.google_title_search} Google title/author matches, ` +
      `${byMethod.openlibrary_isbn_search} Open Library ISBN search matches, ` +
      `${byMethod.openlibrary_title_search} Open Library title/author search matches.`,
  );
}

function addCachedOpenLibraryCandidates(
  candidates: Record<string, CoverDiscoveryCandidate>,
  entries: NonNullable<ProviderCache["entries"]>,
  generatedAt: string,
) {
  const coverByWorkKey = new Map<string, number>();
  for (const [cacheUrl, cached] of Object.entries(entries)) {
    let url: URL;
    try {
      url = new URL(cacheUrl);
    } catch {
      continue;
    }
    if (url.hostname !== "openlibrary.org" || !/^\/works\/OL\d+W\.json$/.test(url.pathname)) continue;
    const coverId = firstCoverId(cached.json as OpenLibraryRecord | undefined);
    if (coverId) coverByWorkKey.set(url.pathname.replace(/\.json$/, ""), coverId);
  }
  const missingBooks = data.books.filter((book) => !book.thumbnailUrl);
  const booksByIsbn = new Map<string, Book[]>();
  const booksByTitle = new Map<string, Book[]>();
  for (const book of missingBooks) {
    for (const isbn of book.isbn13.map(normalizeIsbn).filter(Boolean)) appendMap(booksByIsbn, isbn, book);
    for (const title of titleKeys(book.title)) appendMap(booksByTitle, title, book);
  }
  for (const [cacheUrl, cached] of Object.entries(entries)) {
    if (!cacheUrl.startsWith("openlibrary:")) {
      let url: URL;
      try {
        url = new URL(cacheUrl);
      } catch {
        continue;
      }
      if (url.hostname !== "openlibrary.org" || url.pathname !== "/search.json") continue;
    }
    const json = cached.json as { docs?: OpenLibrarySearchDoc[] } | undefined;
    for (const doc of json?.docs ?? []) {
      const book = cachedOpenLibraryBookMatch(doc, booksByIsbn, booksByTitle);
      const coverId = doc.cover_i && doc.cover_i > 0 ? doc.cover_i : doc.key ? coverByWorkKey.get(doc.key) : undefined;
      if (!book || candidates[book.id]?.provider === "openlibrary" || !doc.key || !coverId) continue;
      const sourceId = `source-cover-open-library-${book.slug}`;
      candidates[book.id] = {
        bookId: book.id,
        title: book.title,
        provider: "openlibrary",
        method: "openlibrary_cache_match",
        sourceUrl: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`,
        source: {
          id: sourceId,
          label: `Open Library cover for ${book.title}`,
          url: `https://openlibrary.org${doc.key}`,
          accessedAt: generatedAt,
          confidence: "catalog",
          field: "book",
          note: `Cover ID ${coverId} recovered from a uniquely matched cached Open Library title/author or ISBN result and cached work metadata; the image is validated before use.`,
        },
      };
    }
  }
}

function cachedOpenLibraryBookMatch(
  doc: OpenLibrarySearchDoc,
  booksByIsbn: Map<string, Book[]>,
  booksByTitle: Map<string, Book[]>,
) {
  const isbnMatches = new Set((doc.isbn ?? []).flatMap((value) => booksByIsbn.get(normalizeIsbn(value)) ?? []));
  if (isbnMatches.size === 1) return [...isbnMatches][0];
  const titleMatches = new Set(titleKeys(doc.title ?? "").flatMap((title) => booksByTitle.get(title) ?? []));
  const authorMatches = [...titleMatches].filter((book) => authorsOverlap(book, doc.author_name ?? []));
  return authorMatches.length === 1 ? authorMatches[0] : undefined;
}

function emptyOnlineSummary() {
  return { selected: 0, completed: 0, found: 0, notFound: 0, noCover: 0, errors: 0 };
}

async function discoverOpenLibraryIsbnCovers(
  candidates: Record<string, CoverDiscoveryCandidate>,
  generatedAt: string,
  options: CliOptions,
) {
  const attemptFile = await readJson<AttemptFile>(openLibraryAttemptPath, {});
  const attempts = { ...(attemptFile.attempts ?? {}) };
  const providerCacheFile = await readJson<{ entries?: Record<string, { fetchedAt: string; json: { docs?: OpenLibrarySearchDoc[] } }> }>(openLibraryProviderCachePath, {});
  const providerEntries = { ...(providerCacheFile.entries ?? {}) };
  const selected = data.books
    .filter((book) => !book.thumbnailUrl && book.isbn13.length > 0 && candidates[book.id]?.provider !== "openlibrary")
    .filter((book) => options.retryFailures || !attempts[book.id])
    .slice(0, options.limit);
  const summary = { ...emptyOnlineSummary(), selected: selected.length };
  const batches = chunk(selected, 25);

  const checkpoint = async () => {
    await Promise.all([
      writeCandidateFile(candidates, generatedAt),
      fs.writeFile(openLibraryAttemptPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), attempts }, null, 2)}\n`),
      fs.writeFile(openLibraryProviderCachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: providerEntries }, null, 2)}\n`),
    ]);
  };

  for (const batch of batches) {
    if (options.requestDelayMs) await delay(options.requestDelayMs);
    const isbns = [...new Set(batch.flatMap((book) => book.isbn13.map(normalizeIsbn).filter((value) => /^\d{13}$/.test(value))))];
    const cacheKey = `openlibrary:isbn-batch:${isbns.join(",")}`;
    try {
      let json = providerEntries[cacheKey]?.json;
      if (!json) {
        const params = new URLSearchParams({
          q: `isbn:(${isbns.join(" OR ")})`,
          fields: "key,title,author_name,isbn,cover_i",
          limit: String(Math.max(25, isbns.length * 3)),
        });
        const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
          headers: { "user-agent": "Book Prize Index cover discovery" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Open Library HTTP ${response.status}`);
        json = await response.json() as { docs?: OpenLibrarySearchDoc[] };
        providerEntries[cacheKey] = { fetchedAt: new Date().toISOString(), json };
      }
      const docsByIsbn = new Map<string, OpenLibrarySearchDoc>();
      for (const doc of json.docs ?? []) {
        for (const isbn of doc.isbn?.map(normalizeIsbn) ?? []) if (isbns.includes(isbn)) docsByIsbn.set(isbn, doc);
      }
      for (const book of batch) {
        const doc = book.isbn13.map(normalizeIsbn).map((isbn) => docsByIsbn.get(isbn)).find(Boolean);
        if (doc?.cover_i && doc.cover_i > 0) {
          const sourceId = `source-cover-open-library-${book.slug}`;
          candidates[book.id] = {
            bookId: book.id,
            title: book.title,
            provider: "openlibrary",
            method: "openlibrary_isbn_search",
            sourceUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
            source: {
              id: sourceId,
              label: `Open Library cover for ${book.title}`,
              url: doc.key ? `https://openlibrary.org${doc.key}` : `https://openlibrary.org/search?q=${encodeURIComponent(book.title)}`,
              accessedAt: generatedAt,
              confidence: "catalog",
              field: "book",
              note: `Cover ID ${doc.cover_i} resolved through an exact ISBN batch search.`,
            },
          };
          attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "found" };
          summary.found += 1;
        } else if (doc) {
          attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "no_cover", note: "Exact Open Library ISBN result had no cover ID." };
          summary.noCover += 1;
        } else {
          attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "not_found", note: "Open Library returned no exact ISBN result." };
          summary.notFound += 1;
        }
        summary.completed += 1;
      }
    } catch (error) {
      for (const book of batch) {
        attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "error", note: error instanceof Error ? error.message : String(error) };
        summary.completed += 1;
        summary.errors += 1;
      }
    }
    if (options.checkpointEvery && (summary.completed % options.checkpointEvery === 0 || summary.completed === summary.selected)) {
      await checkpoint();
      console.log(`Checkpointed ${summary.completed}/${summary.selected} Open Library ISBN cover lookups.`);
    }
  }
  await checkpoint();
  return summary;
}

async function discoverOpenLibraryTitleCovers(
  candidates: Record<string, CoverDiscoveryCandidate>,
  generatedAt: string,
  options: CliOptions,
) {
  const attemptFile = await readJson<AttemptFile>(openLibraryTitleAttemptPath, {});
  const attempts = { ...(attemptFile.attempts ?? {}) };
  const providerCacheFile = await readJson<{ entries?: Record<string, { fetchedAt: string; json: { docs?: OpenLibrarySearchDoc[] } }> }>(openLibraryTitleProviderCachePath, {});
  const providerEntries = { ...(providerCacheFile.entries ?? {}) };
  const selected = data.books
    .filter((book) => !book.thumbnailUrl && candidates[book.id]?.provider !== "openlibrary")
    .filter((book) => options.retryFailures || !attempts[book.id])
    .slice(0, options.limit);
  const summary = { ...emptyOnlineSummary(), selected: selected.length };

  const checkpoint = async () => {
    await Promise.all([
      writeCandidateFile(candidates, generatedAt),
      fs.writeFile(openLibraryTitleAttemptPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), attempts }, null, 2)}\n`),
      fs.writeFile(openLibraryTitleProviderCachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: providerEntries }, null, 2)}\n`),
    ]);
  };

  for (const book of selected) {
    if (options.requestDelayMs) await delay(options.requestDelayMs);
    const author = book.authors[0]?.name ?? "";
    const cacheKey = `openlibrary:title:${normalizeText(book.title)}|${normalizeText(author)}`;
    try {
      let json = providerEntries[cacheKey]?.json;
      if (!json) {
        const params = new URLSearchParams({
          title: book.title,
          author,
          fields: "key,title,author_name,isbn,cover_i",
          limit: "10",
        });
        const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
          headers: { "user-agent": "BookPrizeIndex/1.0 (https://resobscura.substack.com)" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Open Library HTTP ${response.status}`);
        json = await response.json() as { docs?: OpenLibrarySearchDoc[] };
        providerEntries[cacheKey] = { fetchedAt: new Date().toISOString(), json };
      }
      const exactMatches = (json.docs ?? []).filter((doc) => {
        const sameTitle = titleKeys(doc.title ?? "").some((title) => titleKeys(book.title).includes(title));
        return sameTitle && authorsOverlap(book, doc.author_name ?? []);
      });
      const doc = exactMatches.find((match) => Boolean(match.cover_i && match.cover_i > 0));
      if (doc?.cover_i) {
        const sourceId = `source-cover-open-library-${book.slug}`;
        candidates[book.id] = {
          bookId: book.id,
          title: book.title,
          provider: "openlibrary",
          method: "openlibrary_title_search",
          sourceUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false`,
          source: {
            id: sourceId,
            label: `Open Library cover for ${book.title}`,
            url: doc.key ? `https://openlibrary.org${doc.key}` : `https://openlibrary.org/search?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(author)}`,
            accessedAt: generatedAt,
            confidence: "catalog",
            field: "book",
            note: "Cover matched through an exact normalized title and author search; the image is validated before use.",
          },
        };
        attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "found" };
        summary.found += 1;
      } else if (exactMatches.length) {
        attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "no_cover", note: "Exact Open Library title/author results had no cover ID." };
        summary.noCover += 1;
      } else {
        attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "not_found", note: "Open Library returned no exact title/author result." };
        summary.notFound += 1;
      }
    } catch (error) {
      attempts[book.id] = { attemptedAt: new Date().toISOString(), status: "error", note: error instanceof Error ? error.message : String(error) };
      summary.errors += 1;
    }
    summary.completed += 1;
    if (options.checkpointEvery && (summary.completed % options.checkpointEvery === 0 || summary.completed === summary.selected)) {
      await checkpoint();
      console.log(`Checkpointed ${summary.completed}/${summary.selected} Open Library title/author cover lookups.`);
    }
  }
  await checkpoint();
  return summary;
}

type OpenLibrarySearchDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
};

function addCachedGoogleCandidates(
  candidates: Record<string, CoverDiscoveryCandidate>,
  entries: NonNullable<ProviderCache["entries"]>,
  generatedAt: string,
) {
  const missingBooks = data.books.filter((book) => !book.thumbnailUrl);
  const booksByIsbn = new Map<string, Book[]>();
  const booksByTitle = new Map<string, Book[]>();
  for (const book of missingBooks) {
    for (const isbn of book.isbn13.map(normalizeIsbn).filter(Boolean)) appendMap(booksByIsbn, isbn, book);
    for (const title of titleKeys(book.title)) appendMap(booksByTitle, title, book);
  }

  for (const [cacheUrl, cached] of Object.entries(entries)) {
    if (!cacheUrl.startsWith("google:")) {
      let url: URL;
      try {
        url = new URL(cacheUrl);
      } catch {
        continue;
      }
      if (url.hostname !== "www.googleapis.com") continue;
    }
    const json = cached.json as { items?: GoogleVolume[] } | undefined;
    for (const item of json?.items ?? []) {
      const book = cachedGoogleBookMatch(item, booksByIsbn, booksByTitle);
      if (!book || candidates[book.id]) continue;
      const sourcePageUrl = item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(item.id)}`;
      const sourceId = `source-cover-google-books-${book.slug}`;
      candidates[book.id] = {
        bookId: book.id,
        title: book.title,
        provider: "google",
        method: "google_cache_match",
        sourceUrl: `https://books.google.com/books/content?id=${encodeURIComponent(item.id)}&printsec=frontcover&img=1&zoom=1&source=gbs_api`,
        source: {
          id: sourceId,
          label: `Google Books cover for ${book.title}`,
          url: sourcePageUrl,
          accessedAt: generatedAt,
          confidence: "catalog",
          field: "book",
          note: "Cover candidate recovered from a previously cached Google Books title/author or ISBN result; the image is placeholder-checked before use.",
        },
      };
    }
  }
}

function cachedGoogleBookMatch(
  item: GoogleVolume,
  booksByIsbn: Map<string, Book[]>,
  booksByTitle: Map<string, Book[]>,
) {
  const isbnMatches = new Set(
    (item.volumeInfo?.industryIdentifiers ?? [])
      .flatMap((value) => booksByIsbn.get(normalizeIsbn(value.identifier ?? "")) ?? []),
  );
  if (isbnMatches.size === 1) return [...isbnMatches][0];
  const titleMatches = new Set(titleKeys(item.volumeInfo?.title ?? "").flatMap((title) => booksByTitle.get(title) ?? []));
  const authorMatches = [...titleMatches].filter((book) => authorsOverlap(book, item.volumeInfo?.authors ?? []));
  return authorMatches.length === 1 ? authorMatches[0] : undefined;
}

function authorsOverlap(book: Book, providerAuthors: string[]) {
  const providerNames = providerAuthors.map(normalizeText).filter(Boolean);
  if (!providerNames.length) return false;
  return book.authors.some((author) => {
    const normalized = normalizeText(author.name);
    const surname = normalized.split(" ").at(-1);
    return providerNames.some((provider) => provider === normalized || Boolean(surname && surname.length >= 3 && provider.split(" ").includes(surname)));
  });
}

function titleKeys(title: string) {
  const full = normalizeText(title);
  const short = normalizeText(title.split(/\s*[:—–]\s*/)[0]);
  return [...new Set([full, short].filter((value) => value.length >= 4))];
}

function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function appendMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
}

async function discoverGoogleIsbnCovers(
  candidates: Record<string, CoverDiscoveryCandidate>,
  generatedAt: string,
  options: CliOptions,
) {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_BOOKS_API_KEY is required for --google-isbn.");
  const attemptFile = await readJson<AttemptFile>(attemptPath, {});
  const attempts = { ...(attemptFile.attempts ?? {}) };
  const providerCacheFile = await readJson<GoogleProviderCache>(googleProviderCachePath, {});
  const providerEntries = { ...(providerCacheFile.entries ?? {}) };
  const selected = data.books
    .filter((book) => !book.thumbnailUrl && book.isbn13.length > 0 && candidates[book.id]?.provider !== "openlibrary")
    .filter((book) => options.retryFailures || !attempts[book.id])
    .slice(0, options.limit);
  const summary = { selected: selected.length, completed: 0, found: 0, notFound: 0, noCover: 0, errors: 0 };
  let checkpointChain = Promise.resolve();

  const checkpoint = async () => {
    await Promise.all([
      writeCandidateFile(candidates, generatedAt),
      fs.writeFile(attemptPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), attempts }, null, 2)}\n`),
      fs.writeFile(googleProviderCachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: providerEntries }, null, 2)}\n`),
    ]);
  };

  await mapConcurrent(selected, options.concurrency, async (book) => {
    if (options.requestDelayMs) await delay(options.requestDelayMs);
    const result = await googleIsbnCandidate(book, apiKey, generatedAt, providerEntries);
    checkpointChain = checkpointChain.then(async () => {
      attempts[book.id] = result.attempt;
      if (result.candidate) candidates[book.id] = result.candidate;
      summary.completed += 1;
      if (result.attempt.status === "found") summary.found += 1;
      else if (result.attempt.status === "not_found") summary.notFound += 1;
      else if (result.attempt.status === "no_cover") summary.noCover += 1;
      else summary.errors += 1;
      if (options.checkpointEvery && summary.completed % options.checkpointEvery === 0) {
        await checkpoint();
        console.log(`Checkpointed ${summary.completed}/${summary.selected} Google ISBN cover lookups.`);
      }
    });
    await checkpointChain;
  });
  await checkpointChain;
  await checkpoint();
  return summary;
}

async function discoverGoogleTitleCovers(
  candidates: Record<string, CoverDiscoveryCandidate>,
  generatedAt: string,
  options: CliOptions,
) {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_BOOKS_API_KEY is required for --google-title.");
  const attemptFile = await readJson<AttemptFile>(googleTitleAttemptPath, {});
  const attempts = { ...(attemptFile.attempts ?? {}) };
  const providerCacheFile = await readJson<GoogleProviderCache>(googleTitleProviderCachePath, {});
  const providerEntries = { ...(providerCacheFile.entries ?? {}) };
  const selected = data.books
    .filter((book) => !book.thumbnailUrl && candidates[book.id]?.provider !== "openlibrary")
    .filter((book) => options.retryFailures || !attempts[book.id])
    .slice(0, options.limit);
  const summary = { ...emptyOnlineSummary(), selected: selected.length };

  const checkpoint = async () => {
    await Promise.all([
      writeCandidateFile(candidates, generatedAt),
      fs.writeFile(googleTitleAttemptPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), attempts }, null, 2)}\n`),
      fs.writeFile(googleTitleProviderCachePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: providerEntries }, null, 2)}\n`),
    ]);
  };

  for (const book of selected) {
    if (options.requestDelayMs) await delay(options.requestDelayMs);
    const result = await googleTitleCandidate(book, apiKey, generatedAt, providerEntries);
    attempts[book.id] = result.attempt;
    if (result.candidate) candidates[book.id] = result.candidate;
    summary.completed += 1;
    if (result.attempt.status === "found") summary.found += 1;
    else if (result.attempt.status === "not_found") summary.notFound += 1;
    else if (result.attempt.status === "no_cover") summary.noCover += 1;
    else summary.errors += 1;
    if (options.checkpointEvery && (summary.completed % options.checkpointEvery === 0 || summary.completed === summary.selected)) {
      await checkpoint();
      console.log(`Checkpointed ${summary.completed}/${summary.selected} Google title/author cover lookups.`);
    }
  }
  await checkpoint();
  return summary;
}

async function googleTitleCandidate(
  book: Book,
  apiKey: string,
  generatedAt: string,
  providerEntries: NonNullable<GoogleProviderCache["entries"]>,
): Promise<GoogleIsbnResult> {
  const author = book.authors[0]?.name ?? "";
  const cacheKey = `google:title:${normalizeText(book.title)}|${normalizeText(author)}`;
  try {
    let json = providerEntries[cacheKey]?.json;
    if (!json) {
      const params = new URLSearchParams({
        q: `intitle:${book.title} inauthor:${author}`,
        maxResults: "10",
        printType: "books",
        fields: "items(id,volumeInfo(title,authors,industryIdentifiers,imageLinks,canonicalVolumeLink,infoLink))",
        key: apiKey,
      });
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
        headers: { "user-agent": "BookPrizeIndex/1.0 (https://resobscura.substack.com)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Google Books HTTP ${response.status}`);
      json = await response.json() as { items?: GoogleVolume[] };
      providerEntries[cacheKey] = { fetchedAt: new Date().toISOString(), json };
    }
    const exactItems = (json.items ?? []).filter((item) => {
      const sameTitle = titleKeys(item.volumeInfo?.title ?? "").some((title) => titleKeys(book.title).includes(title));
      return sameTitle && authorsOverlap(book, item.volumeInfo?.authors ?? []);
    });
    const item = exactItems.find((value) => googleCoverUrl(value));
    if (!exactItems.length) return attemptResult("not_found", "Google Books returned no exact title/author match.");
    if (!item) return attemptResult("no_cover", "Exact Google Books title/author matches had no imageLinks.");
    const sourcePageUrl = item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(item.id)}`;
    const sourceId = `source-cover-google-books-${book.slug}`;
    return {
      attempt: { attemptedAt: new Date().toISOString(), status: "found" },
      candidate: {
        bookId: book.id,
        title: book.title,
        provider: "google",
        method: "google_title_search",
        sourceUrl: googleCoverUrl(item)!,
        source: {
          id: sourceId,
          label: `Google Books cover for ${book.title}`,
          url: sourcePageUrl,
          accessedAt: generatedAt,
          confidence: "catalog",
          field: "book",
          note: "Cover matched through an exact normalized title and author search; the image is placeholder-checked before use.",
        },
      },
    };
  } catch (error) {
    return attemptResult("error", error instanceof Error ? error.message : String(error));
  }
}

async function googleIsbnCandidate(
  book: Book,
  apiKey: string,
  generatedAt: string,
  providerEntries: NonNullable<GoogleProviderCache["entries"]>,
): Promise<GoogleIsbnResult> {
  const isbn = book.isbn13.map(normalizeIsbn).find((value) => /^\d{13}$/.test(value));
  if (!isbn) return attemptResult("not_found", "Book has no usable ISBN13.");
  const cacheKey = `google:isbn:${isbn}`;
  try {
    let json = providerEntries[cacheKey]?.json;
    if (!json) {
      const params = new URLSearchParams({
        q: `isbn:${isbn}`,
        maxResults: "5",
        printType: "books",
        fields: "items(id,volumeInfo(title,authors,industryIdentifiers,imageLinks,canonicalVolumeLink,infoLink))",
        key: apiKey,
      });
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
        headers: { "user-agent": "Book Prize Index cover discovery" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Google Books HTTP ${response.status}`);
      json = await response.json() as { items?: GoogleVolume[] };
      providerEntries[cacheKey] = { fetchedAt: new Date().toISOString(), json };
    }
    const exactItems = (json.items ?? []).filter((item) => item.volumeInfo?.industryIdentifiers?.some((value) => normalizeIsbn(value.identifier ?? "") === isbn));
    const item = exactItems.find((value) => googleCoverUrl(value));
    if (!exactItems.length) return attemptResult("not_found", "Google Books returned no exact ISBN match.");
    if (!item) return attemptResult("no_cover", "Exact Google Books ISBN matches had no imageLinks.");
    const sourceUrl = googleCoverUrl(item)!;
    const sourcePageUrl = item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(item.id)}`;
    const sourceId = `source-cover-google-books-${book.slug}`;
    return {
      attempt: { attemptedAt: new Date().toISOString(), status: "found" as const },
      candidate: {
        bookId: book.id,
        title: book.title,
        provider: "google" as const,
        method: "google_isbn" as const,
        sourceUrl,
        source: {
          id: sourceId,
          label: `Google Books cover for ${book.title}`,
          url: sourcePageUrl,
          accessedAt: generatedAt,
          confidence: "catalog" as const,
          field: "book",
          note: `Cover matched through exact ISBN ${isbn}.`,
        },
      },
    };
  } catch (error) {
    return attemptResult("error", error instanceof Error ? error.message : String(error));
  }
}

function googleCoverUrl(item: GoogleVolume) {
  const links = item.volumeInfo?.imageLinks;
  return links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail ?? links?.large;
}

function attemptResult(status: CoverAttempt["status"], note: string): GoogleIsbnResult {
  return { attempt: { attemptedAt: new Date().toISOString(), status, note } };
}

async function writeCandidateFile(candidates: Record<string, CoverDiscoveryCandidate>, generatedAt: string) {
  const rows = Object.values(candidates).sort((a, b) => a.title.localeCompare(b.title));
  const output: CandidateFile = { generatedAt, candidates: Object.fromEntries(rows.map((row) => [row.bookId, row])) };
  await fs.writeFile(candidatePath, `${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: args.includes("--dry-run"),
    googleIsbn: args.includes("--google-isbn"),
    googleTitle: args.includes("--google-title"),
    openLibraryIsbn: args.includes("--openlibrary-isbn"),
    openLibraryTitle: args.includes("--openlibrary-title"),
    limit: 1000,
    concurrency: 1,
    requestDelayMs: 250,
    checkpointEvery: 50,
    retryFailures: args.includes("--retry-failures"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--limit" && value) options.limit = positiveInteger(value, "limit");
    if (args[index] === "--concurrency" && value) options.concurrency = positiveInteger(value, "concurrency");
    if (args[index] === "--request-delay-ms" && value) options.requestDelayMs = nonNegativeInteger(value, "request-delay-ms");
    if (args[index] === "--checkpoint-every" && value) options.checkpointEvery = positiveInteger(value, "checkpoint-every");
  }
  return options;
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`--${label} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${label} must be a non-negative integer.`);
  return parsed;
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9X]/gi, "").toUpperCase();
}

async function mapConcurrent<T>(items: T[], width: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });
  await Promise.all(workers);
}

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local environment file.
    }
  }
}

function openLibraryRecordForLink(
  rawUrl: string | undefined,
  entries: NonNullable<ProviderCache["entries"]>,
) {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "openlibrary.org" || !/^\/(?:works|books)\//.test(url.pathname)) return undefined;
    const pathname = url.pathname.replace(/\/$/, "");
    const record = cachedOpenLibraryRecord(entries, [
      `https://openlibrary.org${pathname}.json`,
      `https://openlibrary.org${pathname}/editions.json`,
    ]);
    return record ? { record, sourcePageUrl: `https://openlibrary.org${pathname}` } : undefined;
  } catch {
    return undefined;
  }
}

function openLibraryRecordForIsbns(
  isbns: string[],
  entries: NonNullable<ProviderCache["entries"]>,
) {
  for (const rawIsbn of isbns) {
    const isbn = rawIsbn.replace(/[^0-9X]/gi, "");
    if (!isbn) continue;
    const record = cachedOpenLibraryRecord(entries, [`https://openlibrary.org/isbn/${isbn}.json`]);
    if (record) return { record, sourcePageUrl: `https://openlibrary.org/isbn/${isbn}` };
  }
  return undefined;
}

function cachedOpenLibraryRecord(
  entries: NonNullable<ProviderCache["entries"]>,
  keys: string[],
) {
  for (const key of keys) {
    const json = entries[key]?.json;
    if (!json || typeof json !== "object") continue;
    const record = json as OpenLibraryRecord & { entries?: OpenLibraryRecord[] };
    if (firstCoverId(record)) return record;
    const edition = record.entries?.find((item) => firstCoverId(item));
    if (edition) return edition;
  }
  return undefined;
}

function firstCoverId(record: OpenLibraryRecord | undefined) {
  const coverId = record?.covers?.find((value) => Number.isInteger(value) && value > 0) ?? record?.cover_i;
  return coverId && coverId > 0 ? coverId : undefined;
}

function googleVolumeForLink(rawUrl: string | undefined) {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (!new Set(["books.google.com", "play.google.com"]).has(url.hostname)) return undefined;
    const id = url.searchParams.get("id")?.trim();
    return id ? { id, sourcePageUrl: rawUrl } : undefined;
  } catch {
    return undefined;
  }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}
