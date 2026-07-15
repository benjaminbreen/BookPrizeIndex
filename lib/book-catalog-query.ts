import type { AwardRegionFilter } from "@/lib/award-region";
import type { BrowseBookRecognitionStats, BrowseBookRow } from "@/lib/browse-types";
import { rollupSubjectName } from "@/lib/subject-rollup";

export type BookCatalogSortKey = "score" | "year" | "title" | "author" | "wins" | "lists" | "imprint" | "publisher" | "subject";
export type BookCatalogMetadataFilter = "all" | "complete" | "missing" | "has_cover" | "missing_cover" | "missing_publisher";

export type BookCatalogQuery = {
  awardId?: string;
  metadata?: BookCatalogMetadataFilter;
  page?: number;
  pageSize?: number;
  publisherId?: string;
  query?: string;
  region?: AwardRegionFilter;
  semanticBookIds?: string[];
  sort?: BookCatalogSortKey;
  subject?: string;
  topic?: string;
};

export type BookCatalogQueryResult = {
  page: number;
  pageSize: number;
  rows: BrowseBookRow[];
  total: number;
};

export function queryBookCatalog(books: BrowseBookRow[], query: BookCatalogQuery): BookCatalogQueryResult {
  const region = query.region ?? "us";
  const semanticOrder = query.semanticBookIds?.length
    ? new Map(query.semanticBookIds.map((bookId, index) => [bookId, index]))
    : null;
  const normalizedQuery = query.query?.trim().toLowerCase() ?? "";
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  let rows = filterBookCatalogRows(books, query).filter((book) => {
    if (semanticOrder && !semanticOrder.has(book.id)) return false;
    return terms.every((term) => book.searchText.includes(term));
  });

  rows = semanticOrder
    ? rows.sort((a, b) => (semanticOrder.get(a.id) ?? 0) - (semanticOrder.get(b.id) ?? 0))
    : sortBookRows(rows, query.sort ?? "score", region);

  const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 100);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  return { page, pageSize, rows: rows.slice(start, start + pageSize), total };
}

export function filterBookCatalogRows(books: BrowseBookRow[], query: BookCatalogQuery) {
  const region = query.region ?? "us";
  const metadata = query.metadata ?? "all";
  return books.filter((book) => {
    const recognition = bookRecognition(book, region);
    if (recognition.lists === 0) return false;
    if (query.topic && !book.topics.includes(query.topic)) return false;
    if (query.subject && !book.subjects.some((subject) => rollupSubjectName(subject) === query.subject)) return false;
    if (query.awardId && !recognition.awardIds.includes(query.awardId)) return false;
    if (query.publisherId && book.publisherId !== query.publisherId) return false;
    return matchesMetadataFilter(book, metadata);
  });
}

export function bookRecognition(book: BrowseBookRow, region: AwardRegionFilter): BrowseBookRecognitionStats {
  return book.recognitionByRegion?.[region] ?? {
    awardIds: book.awardIds,
    firstRecognitionYear: book.firstRecognitionYear,
    lists: book.lists,
    majorLonglists: book.majorLonglists,
    majorShortlists: book.majorShortlists,
    majorWins: book.majorWins,
    normalLonglists: book.normalLonglists,
    normalShortlists: book.normalShortlists,
    score: book.score,
    wins: book.wins,
  };
}

export function bookCatalogSubjectOptions(books: BrowseBookRow[]) {
  return [...new Set(books.flatMap((book) => book.subjects.map(rollupSubjectName)))]
    .sort((a, b) => a.localeCompare(b))
    .map((subject) => ({ value: subject, label: subject }));
}

export function bookCatalogPublisherOptions(books: BrowseBookRow[]) {
  return [...new Map(books
    .filter((book) => book.publisherId && book.publisher)
    .map((book) => [book.publisherId!, { id: book.publisherId!, name: book.publisher! }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matchesMetadataFilter(book: BrowseBookRow, filter: BookCatalogMetadataFilter) {
  const hasCompleteBasics = Boolean(book.hasIsbn && book.hasPageCount && book.hasCover && book.hasPublisher);
  if (filter === "all") return true;
  if (filter === "complete") return hasCompleteBasics;
  if (filter === "missing") return !hasCompleteBasics;
  if (filter === "has_cover") return book.hasCover;
  if (filter === "missing_cover") return !book.hasCover;
  if (filter === "missing_publisher") return !book.hasPublisher;
  return true;
}

function sortBookRows(books: BrowseBookRow[], sortKey: BookCatalogSortKey, region: AwardRegionFilter) {
  return [...books].sort((a, b) => {
    const aStats = bookRecognition(a, region);
    const bStats = bookRecognition(b, region);
    if (sortKey === "score") {
      return (
        bStats.score - aStats.score ||
        bStats.majorWins - aStats.majorWins ||
        bStats.wins - aStats.wins ||
        bStats.majorShortlists - aStats.majorShortlists ||
        bStats.normalShortlists - aStats.normalShortlists ||
        bStats.majorLonglists - aStats.majorLonglists ||
        bStats.normalLonglists - aStats.normalLonglists ||
        (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortKey === "wins") return bStats.wins - aStats.wins || a.title.localeCompare(b.title);
    if (sortKey === "lists") return bStats.lists - aStats.lists || a.title.localeCompare(b.title);
    if (sortKey === "year") return (b.publicationYear ?? bStats.firstRecognitionYear ?? b.firstRecognitionYear ?? 0) - (a.publicationYear ?? aStats.firstRecognitionYear ?? a.firstRecognitionYear ?? 0) || a.title.localeCompare(b.title);
    if (sortKey === "author") return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
    if (sortKey === "imprint") return (a.imprint ?? "").localeCompare(b.imprint ?? "") || a.title.localeCompare(b.title);
    if (sortKey === "publisher") return (a.publisher ?? "").localeCompare(b.publisher ?? "") || a.title.localeCompare(b.title);
    if (sortKey === "subject") return rollupSubjectName(a.primarySubject ?? "").localeCompare(rollupSubjectName(b.primarySubject ?? "")) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}
