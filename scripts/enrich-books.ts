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
  slug: string;
  title: string;
  author: string;
  status: "enriched" | "no_missing_fields" | "no_new_fields" | "not_found" | "low_confidence" | "error";
  fields: string[];
  skippedFields?: string[];
  missingFields?: CatalogMissingBookField[];
  deferredFields?: DeferredMissingBookField[];
  matches?: MatchReport[];
  notes?: string;
};

type CatalogMissingBookField = "isbn13" | "publicationYear" | "publisherId" | "imprintId" | "pageCount" | "summary" | "thumbnailUrl" | "publisherLink";
type DeferredMissingBookField = "wikipedia";

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
  subject?: string[];
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  first_publish_year?: number;
  key?: string;
};

type OpenLibraryWork = {
  subjects?: string[];
};

type OpenLibraryEdition = {
  title?: string;
  authors?: { key?: string }[];
  isbn_13?: string[];
  isbn_10?: string[];
  publishers?: string[];
  number_of_pages?: number;
  covers?: number[];
  publish_date?: string;
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
    categories?: string[];
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const limit = Number(process.env.BOOK_COMPLETION_LIMIT ?? process.env.ENRICH_LIMIT ?? readArg("--limit") ?? "25");
const minimumScore = Number(process.env.BOOK_COMPLETION_MIN_SCORE ?? process.env.ENRICH_MIN_SCORE ?? readArg("--min-score") ?? "0.58");
const provider = process.env.BOOK_COMPLETION_PROVIDER ?? process.env.ENRICH_PROVIDER ?? "all";
const useOpenLibrary = provider !== "google_books" && provider !== "google";
const useGoogleBooks = provider !== "open_library" && provider !== "openlibrary" && process.env.BOOK_COMPLETION_GOOGLE !== "0" && process.env.ENRICH_GOOGLE !== "0" && !hasArg("--no-google");

async function main() {
  const generatedAt = new Date().toISOString();
  const requestedBookIds = new Set((process.env.BOOK_COMPLETION_BOOK_IDS ?? process.env.ENRICH_BOOK_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const selected = (requestedBookIds.size ? data.books.filter((book) => requestedBookIds.has(book.id) || requestedBookIds.has(book.slug)) : [...data.books])
    .filter((book) => catalogMissingFieldsForBook(book).length > 0)
    .sort(
      (a, b) =>
        catalogMissingFieldsForBook(b).length - catalogMissingFieldsForBook(a).length ||
        getBookStats(b.id).score - getBookStats(a.id).score ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);

  const patch = await readExistingPatch(generatedAt);
  const report: ReportRow[] = [];

  for (const book of selected) {
    const index = report.length + 1;
    const author = book.authors.map((item) => item.name).join(" ");
    const missingFields = catalogMissingFieldsForBook(book);
    const deferredFields = deferredMissingFieldsForBook(book);
    if (!missingFields.length) {
      report.push({ bookId: book.id, slug: book.slug, title: book.title, author, status: "no_missing_fields", fields: [] });
      continue;
    }
    try {
      console.log(`[${index}/${selected.length}] Completing ${book.title} — ${author}`);
      const [openLibraryResult, googleResult] = await Promise.allSettled([
        useOpenLibrary ? fetchOpenLibrary(book, author) : Promise.resolve(undefined),
        useGoogleBooks ? fetchGoogleBooks(book, author) : Promise.resolve(undefined),
      ]);
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
          slug: book.slug,
          title: book.title,
          author,
          status: matches.length ? "low_confidence" : "not_found",
          fields: [],
          missingFields,
          deferredFields,
          matches,
          notes,
        });
        continue;
      }

      const enriched = mergeMetadata(
        book,
        openLibrary && isAcceptedMatch(book, author, openLibrary.doc.title, openLibrary.doc.author_name?.join(" "), openLibrary.score) ? openLibrary.doc : undefined,
        google && isAcceptedMatch(book, author, google.item.volumeInfo?.title, google.item.volumeInfo?.authors?.join(" "), google.score) ? google.item : undefined,
        generatedAt,
      );
      if (!Object.keys(enriched.bookPatch).length) {
        const notes = [openLibraryResult, googleResult]
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .join("; ");
        report.push({ bookId: book.id, slug: book.slug, title: book.title, author, status: "no_new_fields", fields: [], missingFields, deferredFields, matches, notes });
        continue;
      }
      patch.books[book.id] = mergePatch(patch.books[book.id] ?? {}, enriched.bookPatch);
      Object.assign(patch.publishers, enriched.publishers);
      Object.assign(patch.sources, enriched.sources);
      report.push({
        bookId: book.id,
        slug: book.slug,
        title: book.title,
        author,
        status: "enriched",
        fields: Object.keys(enriched.bookPatch),
        skippedFields: missingFields.filter((field) => !Object.keys(enriched.bookPatch).includes(fieldToPatchKey(field))),
        missingFields,
        deferredFields,
        matches,
      });
    } catch (error) {
      report.push({
        bookId: book.id,
        slug: book.slug,
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
  const reportPayload = { generatedAt, limit, minimumScore, provider, selectedCount: selected.length, summary: completionSummary(data.books), report };
  await fs.writeFile(path.join(publicDataDir, "book-completion-report.json"), `${JSON.stringify(reportPayload, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "book-enrichment-report.json"), `${JSON.stringify(reportPayload, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "enrichment-report.json"), `${JSON.stringify(reportPayload, null, 2)}\n`);
  const enrichedCount = report.filter((row) => row.status === "enriched").length;
  console.log(`Completed ${enrichedCount}/${selected.length} books. Report written to data/public/book-completion-report.json.`);
}

async function readExistingPatch(generatedAt: string): Promise<EnrichmentPatch> {
  try {
    const existing = JSON.parse(await fs.readFile(path.join(outputDir, "books.generated.json"), "utf8")) as Partial<EnrichmentPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Existing generated patches are merged, not replaced. Manual curation may override these fields. This pass promotes catalog metadata, not inferred imprints.",
      books: existing.books ?? {},
      publishers: existing.publishers ?? {},
      sources: existing.sources ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-books.ts from Open Library and Google Books catalog APIs. Manual curation may override these fields. This pass promotes catalog metadata, not inferred imprints.",
      books: {},
      publishers: {},
      sources: {},
    };
  }
}

async function fetchOpenLibrary(book: Book, author: string): Promise<{ doc: OpenLibraryDoc; score: number } | undefined> {
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

  const editions = await fetchOpenLibraryEditions(match.doc.key);
  const work = await fetchOpenLibraryWork(match.doc.key);
  const bestEdition = bestOpenLibraryEdition(match.doc, editions);
  if (!bestEdition && !work.subjects?.length) return match;

  return {
    ...match,
    doc: {
      ...(bestEdition ? mergeOpenLibraryEdition(match.doc, bestEdition) : match.doc),
      subject: [...new Set([...(match.doc.subject ?? []), ...(work.subjects ?? [])])],
    },
  };
}

async function fetchGoogleBooks(book: Book, author: string): Promise<{ item: GoogleVolume; score: number } | undefined> {
  const items: GoogleVolume[] = [];
  for (const query of googleQueries(book, author)) {
    const params = new URLSearchParams({ q: query, maxResults: "5", printType: "books" });
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
    items.push(...(json.items ?? []));
    const earlyMatch = bestGoogleMatch(book, author, items);
    if (earlyMatch?.score >= 0.92) break;
    await delay(250);
  }
  return bestGoogleMatch(book, author, dedupeGoogleVolumes(items));
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
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

async function fetchOpenLibraryEditions(workKey: string): Promise<OpenLibraryEdition[]> {
  const params = new URLSearchParams({ limit: "12" });
  const json = await fetchJson<{ entries?: OpenLibraryEdition[] }>(`https://openlibrary.org${workKey}/editions.json?${params}`);
  return json.entries ?? [];
}

async function fetchOpenLibraryWork(workKey: string): Promise<OpenLibraryWork> {
  return fetchJson<OpenLibraryWork>(`https://openlibrary.org${workKey}.json`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return [
    new URLSearchParams({ title: book.title, author, limit: "5" }),
    new URLSearchParams({ q: `${book.title} ${author}`, limit: "5" }),
    ...(shortTitle !== book.title ? [new URLSearchParams({ title: shortTitle, author: mainAuthor, limit: "5" })] : []),
    new URLSearchParams({ q: `${shortTitle} ${mainAuthor}`, limit: "5" }),
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
  if (edition.publishers?.length) score += 2;
  if (edition.title && work.title) score += similarity(work.title, edition.title);
  return score;
}

function mergeOpenLibraryEdition(work: OpenLibraryDoc, edition: OpenLibraryEdition): OpenLibraryDoc {
  return {
    ...work,
    isbn: [...(work.isbn ?? []), ...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])],
    publisher: work.publisher?.length ? work.publisher : edition.publishers,
    number_of_pages_median: work.number_of_pages_median ?? edition.number_of_pages,
    cover_i: work.cover_i ?? edition.covers?.[0],
    first_publish_year: work.first_publish_year ?? firstYear([edition.publish_date]),
  };
}

function mergeMetadata(book: Book, openLibrary: OpenLibraryDoc | undefined, google: GoogleVolume | undefined, generatedAt: string) {
  const sourceIds = new Set(book.sourceIds);
  const sources: Record<string, SourceRef> = {};
  const publishers: EnrichmentPatch["publishers"] = {};
  const links = { ...book.links };
  const isbn13 = firstIsbn13([...(google?.volumeInfo?.industryIdentifiers?.map((item) => item.identifier) ?? []), ...(openLibrary?.isbn ?? [])]);
  const publisherName = google?.volumeInfo?.publisher ?? openLibrary?.publisher?.[0];
  const publicationYear = firstYear([google?.volumeInfo?.publishedDate, openLibrary?.first_publish_year]);
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
  if (subjectCategories.length) {
    bookPatch.subjectCategories = mergeSubjectCategories(book.subjectCategories ?? [], subjectCategories);
  }
  if (!book.isbn13.length && isbn13) bookPatch.isbn13 = [isbn13];
  if (!book.publicationYear && publicationYear) bookPatch.publicationYear = publicationYear;
  if (!book.pageCount && (google?.volumeInfo?.pageCount || openLibrary?.number_of_pages_median)) {
    bookPatch.pageCount = google?.volumeInfo?.pageCount ?? openLibrary?.number_of_pages_median;
  }
  if (!book.summary && google?.volumeInfo?.description) bookPatch.summary = trimDescription(google.volumeInfo.description);
  const thumbnail = google?.volumeInfo?.imageLinks?.thumbnail ?? google?.volumeInfo?.imageLinks?.smallThumbnail;
  if (!book.thumbnailUrl && thumbnail) bookPatch.thumbnailUrl = thumbnail.replace(/^http:/, "https:");
  if (!book.thumbnailUrl && openLibrary?.cover_i) {
    bookPatch.thumbnailUrl = `https://covers.openlibrary.org/b/id/${openLibrary.cover_i}-L.jpg`;
  }
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

function mergeSubjectCategories(existing: NonNullable<Book["subjectCategories"]>, incoming: NonNullable<Book["subjectCategories"]>) {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter((category) => {
    const key = `${category.source}\u0000${category.scheme ?? ""}\u0000${category.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function catalogMissingFieldsForBook(book: Book): CatalogMissingBookField[] {
  const fields: CatalogMissingBookField[] = [];
  if (!book.isbn13.length) fields.push("isbn13");
  if (!book.publicationYear) fields.push("publicationYear");
  if (!book.publisherId) fields.push("publisherId");
  if (!book.imprintId) fields.push("imprintId");
  if (!book.pageCount) fields.push("pageCount");
  if (!book.summary) fields.push("summary");
  if (!book.thumbnailUrl) fields.push("thumbnailUrl");
  if (!book.links.publisher) fields.push("publisherLink");
  return fields;
}

function deferredMissingFieldsForBook(book: Book): DeferredMissingBookField[] {
  return book.links.wikipedia ? [] : ["wikipedia"];
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
): MatchReport {
  return {
    provider,
    title: candidateTitle,
    author: candidateAuthor,
    url,
    score: Number(score.toFixed(3)),
    accepted: isAcceptedMatch(book, author, candidateTitle, candidateAuthor, score),
  };
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
