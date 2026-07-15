import fs from "node:fs/promises";
import path from "node:path";
import { data } from "../lib/data";
import type { Book, PublisherEvidence, SourceRef } from "../lib/types";
import { cacheDataDir, sourcesDir } from "./build/paths";

type CacheFile = {
  entries?: Record<string, { fetchedAt?: string; json?: unknown }>;
};

type OpenLibraryEdition = {
  publishers?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  key?: string;
};

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    publisher?: string;
    industryIdentifiers?: Array<{ identifier?: string }>;
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
};

type PublisherCandidate = {
  isbn: string;
  provider: "google-books" | "open-library";
  rawName: string;
  sourceUrl: string;
};

type OutputFile = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
  publisherEvidence: Record<string, PublisherEvidence[]>;
};

const cachePath = path.join(cacheDataDir, "summary-enrichment-provider-cache.json");
const outputPath = path.join(sourcesDir, "enrichment", "publisher-evidence.cached.generated.json");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const generatedAt = new Date().toISOString();
  const cache = JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile;
  const editionsByIsbn = new Map<string, { edition: OpenLibraryEdition; sourceUrl: string }>();
  const googleByIsbn = new Map<string, PublisherCandidate>();

  for (const [cacheUrl, cached] of Object.entries(cache.entries ?? {})) {
    const match = cacheUrl.match(/^https:\/\/openlibrary\.org\/isbn\/([^/?#]+)\.json$/i);
    if (match && cached.json) {
      const edition = cached.json as OpenLibraryEdition;
      editionsByIsbn.set(normalizeIsbn(match[1]), { edition, sourceUrl: `https://openlibrary.org/isbn/${encodeURIComponent(normalizeIsbn(match[1]))}` });
      indexOpenLibraryEdition(editionsByIsbn, edition);
    } else if (/^https:\/\/openlibrary\.org\/books\/[^/?#]+\.json$/i.test(cacheUrl) && cached.json) {
      indexOpenLibraryEdition(editionsByIsbn, cached.json as OpenLibraryEdition);
    }
    if (!cacheUrl.includes("www.googleapis.com/books/v1/volumes") || !cached.json) continue;
    for (const item of (cached.json as { items?: GoogleVolume[] }).items ?? []) {
      const rawName = usablePublisher(item.volumeInfo?.publisher);
      if (!rawName) continue;
      const sourceUrl = item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(item.id ?? "")}`;
      for (const identifier of item.volumeInfo?.industryIdentifiers ?? []) {
        const isbn = normalizeIsbn(identifier.identifier ?? "");
        if (!isbn || googleByIsbn.has(isbn)) continue;
        googleByIsbn.set(isbn, { isbn, provider: "google-books", rawName, sourceUrl });
      }
    }
  }

  const existing = await readExistingOutput();
  const output: OutputFile = {
    generatedAt,
    notes: "Generated from cached exact-ISBN Open Library and Google Books metadata. Raw publisher strings remain evidence until sources/imprint-normalization.json maps them to a public imprint and parent publisher.",
    books: { ...(existing?.books ?? {}) },
    sources: { ...(existing?.sources ?? {}) },
    publisherEvidence: { ...(existing?.publisherEvidence ?? {}) },
  };
  let added = 0;

  for (const book of data.books) {
    if (output.publisherEvidence[book.id]?.length) continue;
    if (book.publisherId && book.imprintId) continue;
    const openLibraryMatch = book.isbn13
      .map(normalizeIsbn)
      .map((isbn) => ({ isbn, match: editionsByIsbn.get(isbn) }))
      .find(({ match }) => firstUsablePublisher(match?.edition.publishers));
    const googleMatch = book.isbn13.map(normalizeIsbn).map((isbn) => googleByIsbn.get(isbn)).find(Boolean);
    const candidate: PublisherCandidate | undefined = openLibraryMatch && firstUsablePublisher(openLibraryMatch.match?.edition.publishers)
      ? {
          isbn: openLibraryMatch.isbn,
          provider: "open-library",
          rawName: firstUsablePublisher(openLibraryMatch.match?.edition.publishers)!,
          sourceUrl: openLibraryMatch.match!.sourceUrl,
        }
      : googleMatch;
    if (!candidate) continue;

    const providerLabel = candidate.provider === "open-library" ? "Open Library" : "Google Books";
    const sourceId = `source-publisher-${candidate.provider}-${book.slug}`;
    const evidenceId = `publisher-evidence-${candidate.provider}-${book.slug}`;
    output.sources[sourceId] = {
      id: sourceId,
      label: `${providerLabel} edition record for ${book.title}`,
      url: candidate.sourceUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "publisher",
      note: `Publisher metadata matched through exact ISBN ${candidate.isbn}.`,
    };
    output.publisherEvidence[book.id] = [{
      id: evidenceId,
      bookId: book.id,
      rawName: candidate.rawName,
      source: "catalog_metadata",
      confidence: "high",
      sourceUrl: candidate.sourceUrl,
      sourceId,
      note: `Publisher string from the cached ${providerLabel} edition record for exact ISBN ${candidate.isbn}. Normalize before assigning a public imprint.`,
    }];
    output.books[book.id] = {
      sourceIds: [...new Set([...book.sourceIds, sourceId])],
    };
    added += 1;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(sortOutput(output), null, 2)}\n`);
  console.log(`Wrote exact-ISBN publisher evidence for ${Object.keys(output.publisherEvidence).length} books (${added} newly added).`);
}

function indexOpenLibraryEdition(
  target: Map<string, { edition: OpenLibraryEdition; sourceUrl: string }>,
  edition: OpenLibraryEdition,
) {
  if (!firstUsablePublisher(edition.publishers)) return;
  const sourceUrl = edition.key ? `https://openlibrary.org${edition.key}` : "https://openlibrary.org";
  for (const isbn of [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn).filter(Boolean)) {
    if (!target.has(isbn)) target.set(isbn, { edition, sourceUrl });
  }
}

async function readExistingOutput(): Promise<OutputFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8")) as OutputFile;
  } catch {
    return undefined;
  }
}

function firstUsablePublisher(values: string[] | undefined) {
  return values?.map(usablePublisher).find(Boolean);
}

function usablePublisher(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.length < 2) return undefined;
  if (/\b(audio|audiobook|books on tape|blackstone|tantor|large print|self[-\s]?published|independently published|publisher not identified|unknown)\b/i.test(normalized)) return undefined;
  return normalized;
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9X]/gi, "").toUpperCase();
}

function sortOutput(output: OutputFile): OutputFile {
  const sort = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return {
    ...output,
    books: sort(output.books),
    sources: sort(output.sources),
    publisherEvidence: sort(output.publisherEvidence),
  };
}
