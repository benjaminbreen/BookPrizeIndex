import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "./build/pipeline-data";
import type { Book, BookSubjectCategory, SourceRef } from "../lib/types";

type SubjectCategoryPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  sources: Record<string, SourceRef>;
};

type ReportRow = {
  bookId: string;
  title: string;
  author: string;
  status: "enriched" | "already_has_categories" | "not_found" | "low_confidence" | "no_categories" | "error";
  categories: BookSubjectCategory[];
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
};

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    categories?: string[];
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
};

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  key?: string;
  isbn?: string[];
};

type OpenLibraryWork = {
  subjects?: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "sources", "enrichment");
const publicDataDir = path.join(root, "data", "public");
const reportsDataDir = path.join(root, "data", "reports");
const generatedPath = path.join(outputDir, "subject-categories.generated.json");
const limit = Number(process.env.SUBJECT_ENRICH_LIMIT ?? readArg("--limit") ?? "50");
const minimumScore = Number(process.env.SUBJECT_ENRICH_MIN_SCORE ?? readArg("--min-score") ?? "0.58");
const providerMode = process.env.SUBJECT_ENRICH_PROVIDER ?? readArg("--provider") ?? "all";

async function main() {
  const generatedAt = new Date().toISOString();
  const requested = new Set((process.env.SUBJECT_ENRICH_BOOK_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const patch = await readExistingPatch(generatedAt);
  const selected = (requested.size ? data.books.filter((book) => requested.has(book.id) || requested.has(book.slug)) : data.books)
    .filter((book) => !book.subjectCategories?.length)
    .sort((a, b) => getBookStats(b.id).score - getBookStats(a.id).score || a.title.localeCompare(b.title))
    .slice(0, limit);
  const report: ReportRow[] = [];

  for (const book of selected) {
    const author = book.authors.map((item) => item.name).join(" ");
    try {
      const [googleResult, openLibraryResult] = await Promise.allSettled([
        providerMode === "open_library" ? Promise.resolve(undefined) : fetchGoogleBooks(book, author),
        providerMode === "google_books" ? Promise.resolve(undefined) : fetchOpenLibrary(book, author),
      ]);
      const google = googleResult.status === "fulfilled" ? googleResult.value : undefined;
      const openLibrary = openLibraryResult.status === "fulfilled" ? openLibraryResult.value : undefined;
      const notes = [googleResult, openLibraryResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
        .join("; ");
      const matches = [
        google ? matchReport("google_books", book, author, google.item.volumeInfo?.title, google.item.volumeInfo?.authors?.join(" "), google.url, google.score) : undefined,
        openLibrary ? matchReport("open_library", book, author, openLibrary.doc.title, openLibrary.doc.author_name?.join(" "), openLibrary.url, openLibrary.score) : undefined,
      ].filter(Boolean) as MatchReport[];
      const categories = buildCategories(book, generatedAt, google, openLibrary, patch.sources);

      if (!matches.some((match) => match.accepted)) {
        report.push({ bookId: book.id, title: book.title, author, status: matches.length ? "low_confidence" : "not_found", categories: [], matches, notes: notes || undefined });
        continue;
      }
      if (!categories.length) {
        report.push({ bookId: book.id, title: book.title, author, status: "no_categories", categories: [], matches, notes: notes || undefined });
        continue;
      }

      patch.books[book.id] = {
        ...(patch.books[book.id] ?? {}),
        subjectCategories: mergeSubjectCategories(book.subjectCategories ?? [], categories),
      };
      report.push({ bookId: book.id, title: book.title, author, status: "enriched", categories, matches, notes: notes || undefined });
    } catch (error) {
      report.push({
        bookId: book.id,
        title: book.title,
        author,
        status: "error",
        categories: [],
        notes: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([publicDataDir, reportsDataDir].map((dir) => fs.mkdir(dir, { recursive: true })));
  await fs.writeFile(generatedPath, `${JSON.stringify(patch, null, 2)}\n`);
  await fs.writeFile(
    path.join(reportsDataDir, "subject-category-enrichment-report.json"),
    `${JSON.stringify({ generatedAt, limit, minimumScore, selectedCount: selected.length, report }, null, 2)}\n`,
  );
  console.log(`Subject category enrichment: ${report.filter((row) => row.status === "enriched").length}/${selected.length} enriched.`);
}

async function fetchGoogleBooks(book: Book, author: string) {
  for (const query of googleQueries(book, author)) {
    const params = new URLSearchParams({ q: query, maxResults: "8", printType: "books" });
    const json = await fetchJson<{ items?: GoogleVolume[] }>(`https://www.googleapis.com/books/v1/volumes?${params}`);
    const match = bestGoogleMatch(book, author, json.items ?? []);
    if (match && match.score >= minimumScore) {
      const url = match.item.volumeInfo?.canonicalVolumeLink ?? match.item.volumeInfo?.infoLink;
      return { ...match, url };
    }
    await delay(250);
  }
  return undefined;
}

async function fetchOpenLibrary(book: Book, author: string) {
  for (const params of openLibraryQueries(book, author)) {
    const json = await fetchJson<{ docs?: OpenLibraryDoc[] }>(`https://openlibrary.org/search.json?${params}`);
    const match = bestOpenLibraryMatch(book, author, json.docs ?? []);
    if (match?.doc.key && match.score >= minimumScore) {
      const work = await fetchJson<OpenLibraryWork>(`https://openlibrary.org${match.doc.key}.json`);
      return { ...match, work, url: `https://openlibrary.org${match.doc.key}` };
    }
    await delay(250);
  }
  return undefined;
}

function bestGoogleMatch(book: Book, author: string, items: GoogleVolume[]) {
  return items
    .map((item) => ({ item, score: matchScore(book.title, author, item.volumeInfo?.title, item.volumeInfo?.authors?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function bestOpenLibraryMatch(book: Book, author: string, docs: OpenLibraryDoc[]) {
  return docs
    .map((doc) => ({ doc, score: matchScore(book.title, author, doc.title, doc.author_name?.join(" ")) }))
    .sort((a, b) => b.score - a.score)[0];
}

function googleQueries(book: Book, author: string) {
  return unique([
    ...book.isbn13.map((isbn) => `isbn:${isbn}`),
    `intitle:${quote(book.title)} inauthor:${quote(author)}`,
    `intitle:${quote(book.title)} inauthor:${quote(firstAuthorSurname(book, author))}`,
    quote(`${book.title} ${firstAuthorSurname(book, author)}`),
    quote(book.title),
  ]);
}

function openLibraryQueries(book: Book, author: string) {
  const queries: URLSearchParams[] = [];
  for (const isbn of book.isbn13) queries.push(new URLSearchParams({ isbn, limit: "8" }));
  queries.push(new URLSearchParams({ title: book.title, author, limit: "8" }));
  queries.push(new URLSearchParams({ title: book.title, author: firstAuthorSurname(book, author), limit: "8" }));
  queries.push(new URLSearchParams({ q: `${book.title} ${firstAuthorSurname(book, author)}`, limit: "8" }));
  queries.push(new URLSearchParams({ title: book.title, limit: "8" }));
  return queries;
}

function firstAuthorSurname(book: Book, author: string) {
  const first = book.authors[0]?.name ?? author;
  const parts = first.split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? first;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function buildCategories(
  book: Book,
  generatedAt: string,
  google: Awaited<ReturnType<typeof fetchGoogleBooks>>,
  openLibrary: Awaited<ReturnType<typeof fetchOpenLibrary>>,
  sources: Record<string, SourceRef>,
) {
  const categories: BookSubjectCategory[] = [];
  if (google?.url) {
    const sourceId = `source-google-books-subjects-${book.slug}`;
    sources[sourceId] = {
      id: sourceId,
      label: `Google Books subject categories for ${book.title}`,
      url: google.url,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "subject",
    };
    for (const label of google.item.volumeInfo?.categories ?? []) {
      categories.push({ source: "google_books", scheme: "google_books_category", label, sourceId });
    }
  }
  if (openLibrary?.url) {
    const sourceId = `source-open-library-subjects-${book.slug}`;
    sources[sourceId] = {
      id: sourceId,
      label: `Open Library subjects for ${book.title}`,
      url: openLibrary.url,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "subject",
    };
    for (const label of openLibrary.work.subjects?.slice(0, 32) ?? []) {
      categories.push({ source: "open_library", scheme: "open_library_subject", label, sourceId });
    }
  }
  return mergeSubjectCategories([], categories);
}

async function readExistingPatch(generatedAt: string): Promise<SubjectCategoryPatch> {
  try {
    const existing = JSON.parse(await fs.readFile(generatedPath, "utf8")) as Partial<SubjectCategoryPatch>;
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-subject-categories.ts. Preserves raw catalog/library category labels for primary subject evidence scoring.",
      books: existing.books ?? {},
      sources: existing.sources ?? {},
    };
  } catch {
    return {
      generatedAt,
      notes: "Generated by scripts/enrich-subject-categories.ts. Preserves raw catalog/library category labels for primary subject evidence scoring.",
      books: {},
      sources: {},
    };
  }
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

async function fetchJson<T>(url: string, retries = 2): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": "book-prize-index-subject-enrichment/0.1" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429 && retries > 0) {
    await delay(1500 * (3 - retries));
    return fetchJson<T>(url, retries - 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return (await response.json()) as T;
}

function matchReport(provider: MatchReport["provider"], book: Book, author: string, title?: string, candidateAuthor?: string, url?: string, score = 0): MatchReport {
  return { provider, title, author: candidateAuthor, url, score, accepted: score >= minimumScore };
}

function matchScore(expectedTitle: string, expectedAuthor: string, candidateTitle?: string, candidateAuthor?: string) {
  const titleScore = stringSimilarity(expectedTitle, candidateTitle ?? "");
  const authorScore = candidateAuthor ? stringSimilarity(expectedAuthor, candidateAuthor) : 0.5;
  return titleScore * 0.76 + authorScore * 0.24;
}

function stringSimilarity(a: string, b: string) {
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function tokenSet(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}

function quote(value: string) {
  return `"${value.replace(/"/g, "")}"`;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
