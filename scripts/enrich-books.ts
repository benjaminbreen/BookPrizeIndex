import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "../lib/data";
import type { Book, SourceRef } from "../lib/types";

type EnrichmentPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  publishers: Record<string, { id: string; name: string; sourceIds: string[] }>;
  sources: Record<string, SourceRef>;
};

type ReportRow = {
  bookId: string;
  title: string;
  author: string;
  status: "enriched" | "no_missing_fields" | "no_new_fields" | "not_found" | "low_confidence" | "error";
  fields: string[];
  skippedFields?: string[];
  missingFields?: MissingBookField[];
  matches?: MatchReport[];
  notes?: string;
};

type MissingBookField = "isbn13" | "pageCount" | "summary" | "thumbnailUrl" | "publisherLink" | "wikipedia";

type MatchReport = {
  provider: "google_books" | "open_library";
  title?: string;
  author?: string;
  url?: string;
  score: number;
  accepted: boolean;
};

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  first_publish_year?: number;
  key?: string;
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
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const limit = Number(process.env.ENRICH_LIMIT ?? readArg("--limit") ?? "25");
const minimumScore = Number(process.env.ENRICH_MIN_SCORE ?? readArg("--min-score") ?? "0.58");

async function main() {
  const generatedAt = new Date().toISOString();
  const selected = [...data.books]
    .filter((book) => missingFieldsForBook(book).length > 0)
    .sort((a, b) => getBookStats(b.id).score - getBookStats(a.id).score || a.title.localeCompare(b.title))
    .slice(0, limit);

  const patch = await readExistingPatch(generatedAt);
  const report: ReportRow[] = [];

  for (const book of selected) {
    const author = book.authors.map((item) => item.name).join(" ");
    const missingFields = missingFieldsForBook(book);
    if (!missingFields.length) {
      report.push({ bookId: book.id, title: book.title, author, status: "no_missing_fields", fields: [] });
      continue;
    }
    try {
      const [openLibraryResult, googleResult] = await Promise.allSettled([fetchOpenLibrary(book, author), fetchGoogleBooks(book, author)]);
      const openLibrary = openLibraryResult.status === "fulfilled" ? openLibraryResult.value : undefined;
      const google = googleResult.status === "fulfilled" ? googleResult.value : undefined;
      const matches = [
        google ? matchReport("google_books", book, author, google.item.volumeInfo?.title, google.item.volumeInfo?.authors?.join(" "), google.item.volumeInfo?.canonicalVolumeLink ?? google.item.volumeInfo?.infoLink, google.score) : undefined,
        openLibrary ? matchReport("open_library", book, author, openLibrary.doc.title, openLibrary.doc.author_name?.join(" "), openLibrary.doc.key ? `https://openlibrary.org${openLibrary.doc.key}` : undefined, openLibrary.score) : undefined,
      ].filter(Boolean) as MatchReport[];
      const hasAcceptedMatch = matches.some((match) => match.accepted);

      if (!hasAcceptedMatch) {
        const notes = [openLibraryResult, googleResult]
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .join("; ");
        report.push({
          bookId: book.id,
          title: book.title,
          author,
          status: matches.length ? "low_confidence" : "not_found",
          fields: [],
          missingFields,
          matches,
          notes,
        });
        continue;
      }

      const enriched = mergeMetadata(book, openLibrary?.doc, google?.item, generatedAt);
      if (!Object.keys(enriched.bookPatch).length) {
        const notes = [openLibraryResult, googleResult]
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .join("; ");
        report.push({ bookId: book.id, title: book.title, author, status: "no_new_fields", fields: [], missingFields, matches, notes });
        continue;
      }
      patch.books[book.id] = mergePatch(patch.books[book.id] ?? {}, enriched.bookPatch);
      Object.assign(patch.publishers, enriched.publishers);
      Object.assign(patch.sources, enriched.sources);
      report.push({
        bookId: book.id,
        title: book.title,
        author,
        status: "enriched",
        fields: Object.keys(enriched.bookPatch),
        skippedFields: missingFields.filter((field) => !Object.keys(enriched.bookPatch).includes(fieldToPatchKey(field))),
        missingFields,
        matches,
      });
    } catch (error) {
      report.push({
        bookId: book.id,
        title: book.title,
        author,
        status: "error",
        fields: [],
        notes: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "books.generated.json"), `${JSON.stringify(patch, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "book-enrichment-report.json"), `${JSON.stringify({ generatedAt, limit, minimumScore, selectedCount: selected.length, report }, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "enrichment-report.json"), `${JSON.stringify({ generatedAt, limit, minimumScore, selectedCount: selected.length, report }, null, 2)}\n`);
  const enrichedCount = report.filter((row) => row.status === "enriched").length;
  console.log(`Enriched ${enrichedCount}/${selected.length} books. Report written to data/public/book-enrichment-report.json.`);
}

async function readExistingPatch(generatedAt: string): Promise<EnrichmentPatch> {
  try {
    const existing = JSON.parse(await fs.readFile(path.join(outputDir, "books.generated.json"), "utf8")) as Partial<EnrichmentPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Existing generated patches are merged, not replaced. Manual curation may override these fields.",
      books: existing.books ?? {},
      publishers: existing.publishers ?? {},
      sources: existing.sources ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Manual curation may override these fields.",
      books: {},
      publishers: {},
      sources: {},
    };
  }
}

async function fetchOpenLibrary(book: Book, author: string): Promise<{ doc: OpenLibraryDoc; score: number } | undefined> {
  const params = new URLSearchParams({ title: book.title, author, limit: "3" });
  const json = await fetchJson<{ docs?: OpenLibraryDoc[] }>(`https://openlibrary.org/search.json?${params}`);
  return bestOpenLibraryMatch(book, author, json.docs ?? []);
}

async function fetchGoogleBooks(book: Book, author: string): Promise<{ item: GoogleVolume; score: number } | undefined> {
  const query = `intitle:${quote(book.title)} inauthor:${quote(author)}`;
  const params = new URLSearchParams({ q: query, maxResults: "5", printType: "books" });
  const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
  return bestGoogleMatch(book, author, json.items ?? []);
}

async function fetchJson<T>(url: string, retries = 2): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "book-prize-index-enrichment/0.1" } });
  if (response.status === 429 && retries > 0) {
    await delay(1200 * (3 - retries));
    return fetchJson<T>(url, retries - 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bestOpenLibraryMatch(book: Book, author: string, docs: OpenLibraryDoc[]) {
  return docs
    .map((doc) => ({ doc, score: matchScore(book.title, author, doc.title, doc.author_name?.join(" ")) }))
    .filter((item) => item.score >= minimumScore)
    .sort((a, b) => b.score - a.score)[0];
}

function bestGoogleMatch(book: Book, author: string, items: GoogleVolume[]) {
  return items
    .map((item) => ({ item, score: matchScore(book.title, author, item.volumeInfo?.title, item.volumeInfo?.authors?.join(" ")) }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score)[0];
}

function mergeMetadata(book: Book, openLibrary: OpenLibraryDoc | undefined, google: GoogleVolume | undefined, generatedAt: string) {
  const sourceIds = new Set(book.sourceIds);
  const sources: Record<string, SourceRef> = {};
  const publishers: EnrichmentPatch["publishers"] = {};
  const links = { ...book.links };
  const isbn13 = firstIsbn13([...(google?.volumeInfo?.industryIdentifiers?.map((item) => item.identifier) ?? []), ...(openLibrary?.isbn ?? [])]);
  const publisherName = google?.volumeInfo?.publisher ?? openLibrary?.publisher?.[0];
  const googleUrl = google?.volumeInfo?.canonicalVolumeLink ?? google?.volumeInfo?.infoLink;
  const openLibraryUrl = openLibrary?.key ? `https://openlibrary.org${openLibrary.key}` : undefined;

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
  if (!book.isbn13.length && isbn13) bookPatch.isbn13 = [isbn13];
  if (!book.pageCount && (google?.volumeInfo?.pageCount || openLibrary?.number_of_pages_median)) {
    bookPatch.pageCount = google?.volumeInfo?.pageCount ?? openLibrary?.number_of_pages_median;
  }
  if (!book.summary && google?.volumeInfo?.description) bookPatch.summary = trimDescription(google.volumeInfo.description);
  const thumbnail = google?.volumeInfo?.imageLinks?.thumbnail ?? google?.volumeInfo?.imageLinks?.smallThumbnail;
  if (!book.thumbnailUrl && thumbnail) bookPatch.thumbnailUrl = thumbnail.replace(/^http:/, "https:");
  if (!book.links.publisher && links.publisher) bookPatch.links = links;
  if (sourceIds.size > book.sourceIds.length) bookPatch.sourceIds = [...sourceIds];
  if (!book.publisherId && publisherName) {
    const publisherId = `publisher-${slugify(publisherName)}`;
    const sourceId = `source-publisher-catalog-${slugify(publisherName)}`;
    bookPatch.publisherId = publisherId;
    publishers[publisherId] = {
      id: publisherId,
      name: publisherName,
      sourceIds: [sourceId],
    };
    sources[sourceId] = {
      id: sourceId,
      label: `Publisher name from catalog metadata: ${publisherName}`,
      url: googleUrl ?? openLibraryUrl ?? "",
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "publisher",
    };
  }

  const substantiveFields = Object.keys(bookPatch).filter((key) => key !== "sourceIds");
  if (!substantiveFields.length) return { bookPatch: {}, publishers: {}, sources: {} };

  return { bookPatch, publishers, sources };
}

function missingFieldsForBook(book: Book): MissingBookField[] {
  const fields: MissingBookField[] = [];
  if (!book.isbn13.length) fields.push("isbn13");
  if (!book.pageCount) fields.push("pageCount");
  if (!book.summary) fields.push("summary");
  if (!book.thumbnailUrl) fields.push("thumbnailUrl");
  if (!book.links.publisher) fields.push("publisherLink");
  if (!book.links.wikipedia) fields.push("wikipedia");
  return fields;
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

function fieldToPatchKey(field: MissingBookField) {
  return field === "publisherLink" ? "links" : field;
}

function matchReport(
  provider: MatchReport["provider"],
  _book: Book,
  _author: string,
  candidateTitle: string | undefined,
  candidateAuthor: string | undefined,
  url: string | undefined,
  score: number,
): MatchReport {
  return {
    provider,
    title: candidateTitle,
    author: candidateAuthor,
    url,
    score: Number(score.toFixed(3)),
    accepted: score >= minimumScore && Boolean(candidateTitle || candidateAuthor || url),
  };
}

function firstIsbn13(values: string[]) {
  return values.map((value) => value.replaceAll("-", "")).find((value) => /^\d{13}$/.test(value));
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

function quote(input: string) {
  return `"${input.replaceAll('"', "")}"`;
}

function slugify(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
