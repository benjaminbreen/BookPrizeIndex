import MiniSearch from "minisearch";
import {
  data,
  appearancesByBookId,
  booksByImprintId,
  booksByPublisherId,
  booksBySubject,
  subjectsBySlug,
  awardProgramsById,
  awardsById,
  getBookStats,
  imprintsById,
  publishersById,
} from "@/lib/data";
import { matchesAwardRegion, awardRequiredPublicationRegion, type AwardRegionFilter } from "@/lib/award-region";
import type { AwardStatus, Book, BookStats, Imprint, Publisher } from "@/lib/types";

export type BookSortKey = "score" | "year" | "title" | "author" | "wins" | "lists" | "imprint" | "publisher" | "subject";
const regionStatsCache = new Map<AwardRegionFilter, Map<string, BookStats>>();
const publisherStatsCache = new Map<string, PublisherStats>();
const imprintStatsCache = new Map<string, ImprintStats>();

export type BookSearchDocument = {
  id: string;
  title: string;
  author: string;
  publisher: string;
  imprint: string;
  subjects: string;
  awards: string;
  figures: string;
  places: string;
  argument: string;
  summary: string;
};

export function makeBookSearch() {
  const search = new MiniSearch<BookSearchDocument>({
    fields: ["title", "author", "publisher", "imprint", "subjects", "awards", "figures", "places", "argument", "summary"],
    storeFields: ["id"],
    searchOptions: {
      boost: { title: 4, author: 3, awards: 2, subjects: 2, imprint: 1.5 },
      fuzzy: 0.12,
      prefix: true,
    },
  });
  search.addAll(data.books.map(bookToSearchDocument));
  return search;
}

export function bookToSearchDocument(book: Book): BookSearchDocument {
  const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name ?? "" : "";
  const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name ?? "" : "";
  const awards = (appearancesByBookId.get(book.id) ?? [])
    .map((appearance) => awardsById.get(appearance.awardId)?.name)
    .filter(Boolean)
    .join(" ");
  return {
    id: book.id,
    title: book.title,
    author: book.authors.map((author) => author.name).join(" "),
    publisher,
    imprint,
    subjects: book.subjects.join(" "),
    awards,
    figures: book.centralFigures.join(" "),
    places: book.experimentalSemanticProfile?.centralPlaces.map((place) => place.name).join(" ") ?? "",
    argument: book.experimentalSemanticProfile?.argument.present ? book.experimentalSemanticProfile.argument.statement : "",
    summary: book.summary ?? "",
  };
}

export function sortBooks(books: Book[], sortKey: BookSortKey, region: AwardRegionFilter = "all") {
  return [...books].sort((a, b) => {
    const aStats = getBookStatsForRegion(a.id, region);
    const bStats = getBookStatsForRegion(b.id, region);
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
    if (sortKey === "year") return (b.publicationYear ?? 0) - (a.publicationYear ?? 0) || a.title.localeCompare(b.title);
    if (sortKey === "author") {
      const aAuthor = a.authors.map((author) => author.name).join(", ");
      const bAuthor = b.authors.map((author) => author.name).join(", ");
      return aAuthor.localeCompare(bAuthor) || a.title.localeCompare(b.title);
    }
    if (sortKey === "imprint") {
      const aImprint = a.imprintId ? imprintsById.get(a.imprintId)?.name ?? "" : "";
      const bImprint = b.imprintId ? imprintsById.get(b.imprintId)?.name ?? "" : "";
      return aImprint.localeCompare(bImprint) || a.title.localeCompare(b.title);
    }
    if (sortKey === "publisher") {
      const aPublisher = a.publisherId ? publishersById.get(a.publisherId)?.name ?? "" : "";
      const bPublisher = b.publisherId ? publishersById.get(b.publisherId)?.name ?? "" : "";
      return aPublisher.localeCompare(bPublisher) || a.title.localeCompare(b.title);
    }
    if (sortKey === "subject") {
      return (a.primarySubject ?? "").localeCompare(b.primarySubject ?? "") || a.title.localeCompare(b.title);
    }
    return a.title.localeCompare(b.title);
  });
}

export function getBookStatsForRegion(bookId: string, region: AwardRegionFilter = "all"): BookStats {
  if (region === "all") return getBookStats(bookId);
  const statsByBookId = getRegionStats(region);
  return statsByBookId.get(bookId) ?? emptyBookStats(bookId);
}

function getRegionStats(region: AwardRegionFilter) {
  const cached = regionStatsCache.get(region);
  if (cached) return cached;

  const statsByBookId = new Map<string, BookStats>();
  for (const appearance of data.appearances) {
    const award = awardsById.get(appearance.awardId);
    if (!award || !matchesAwardRegion(award, region, awardProgramsById)) continue;

    const stats = statsByBookId.get(appearance.bookId) ?? emptyBookStats(appearance.bookId);
    statsByBookId.set(appearance.bookId, stats);

    const isMajorAward = award.awardType === "major_award";
    stats.lists += 1;
    stats.score += awardRecognitionWeight(appearance.status, isMajorAward);
    stats.statuses[appearance.status] = (stats.statuses[appearance.status] ?? 0) + 1;

    if (appearance.status === "winner" || appearance.status === "co_winner") {
      stats.wins += 1;
      if (isMajorAward) stats.majorWins += 1;
      else stats.normalWins += 1;
    } else if (appearance.status === "finalist" || appearance.status === "shortlist") {
      if (isMajorAward) stats.majorShortlists += 1;
      else stats.normalShortlists += 1;
    } else if (appearance.status === "longlist") {
      if (isMajorAward) stats.majorLonglists += 1;
      else stats.normalLonglists += 1;
    }
  }

  regionStatsCache.set(region, statsByBookId);
  return statsByBookId;
}

function emptyBookStats(bookId: string): BookStats {
  return {
    bookId,
    wins: 0,
    lists: 0,
    score: 0,
    majorWins: 0,
    normalWins: 0,
    majorShortlists: 0,
    normalShortlists: 0,
    majorLonglists: 0,
    normalLonglists: 0,
    statuses: {
      winner: 0,
      co_winner: 0,
      finalist: 0,
      shortlist: 0,
      longlist: 0,
      honorable_mention: 0,
      commended: 0,
      notable: 0,
      unknown: 0,
    },
  };
}

function awardRecognitionWeight(status: AwardStatus, isMajorAward: boolean) {
  if (status === "winner" || status === "co_winner") return isMajorAward ? 10 : 4;
  if (status === "finalist" || status === "shortlist") return isMajorAward ? 4 : 2;
  if (status === "longlist") return isMajorAward ? 2 : 1;
  return 0;
}

export function filterBooksByQuery(books: Book[], query: string) {
  const q = query.trim();
  if (!q) return books;
  const search = makeBookSearch();
  const ids = new Set(search.search(q).map((result) => result.id));
  return books.filter((book) => ids.has(book.id));
}

export function booksForImprint(imprintId: string) {
  return booksByImprintId.get(imprintId) ?? [];
}

export function imprintsForPublisher(publisherId: string) {
  return data.imprints
    .filter((imprint) => imprint.publisherId === publisherId)
    .sort((a, b) => imprintStats(b.id).majorScore - imprintStats(a.id).majorScore || imprintStats(b.id).score - imprintStats(a.id).score || a.name.localeCompare(b.name));
}

export function booksForPublisher(publisherId: string) {
  return booksByPublisherId.get(publisherId) ?? [];
}

function isGlobalMajorAward(awardId: string, region: AwardRegionFilter = "all") {
  const award = awardsById.get(awardId);
  return Boolean(award?.awardType === "major_award" && award.programId !== "prose-awards" && !award.id.startsWith("award-prose-award-") && matchesAwardRegion(award, region));
}

function majorAppearanceWeight(status: string): number {
  if (status === "winner" || status === "co_winner") return 10;
  if (status === "finalist" || status === "shortlist") return 4;
  if (status === "longlist") return 2;
  return 0;
}

type PublisherStats = {
  books: number;
  imprints: number;
  appearances: number;
  majorAppearances: number;
  score: number;
  majorScore: number;
  wins: number;
  majorWins: number;
};

type ImprintStats = Omit<PublisherStats, "imprints">;

export function publisherStats(publisherId: string, sinceYear?: number, region: AwardRegionFilter = "all") {
  const cacheKey = `${publisherId}:${sinceYear ?? "all"}:${region}`;
  const cached = publisherStatsCache.get(cacheKey);
  if (cached) return cached;

  const publisherRegion = publishersById.get(publisherId)?.region;
  const books = booksForPublisher(publisherId);
  const allAppearances = books.flatMap((book) => appearancesByBookId.get(book.id) ?? []).filter((appearance) => {
    if (publisherRegion) {
      const required = awardRequiredPublicationRegion(awardsById.get(appearance.awardId)?.geography);
      if (required && required !== publisherRegion) return false;
    }
    return true;
  });
  const appearances = sinceYear ? allAppearances.filter((a) => a.year >= sinceYear) : allAppearances;
  const majorAppearances = appearances.filter((appearance) => isGlobalMajorAward(appearance.awardId, region));
  const stats = {
    books: books.length,
    imprints: imprintsForPublisher(publisherId).length,
    appearances: appearances.length,
    majorAppearances: majorAppearances.length,
    score: books.reduce((sum, book) => sum + getBookStats(book.id).score, 0),
    majorScore: majorAppearances.reduce((sum, a) => sum + majorAppearanceWeight(a.status), 0),
    wins: books.reduce((sum, book) => sum + getBookStats(book.id).wins, 0),
    majorWins: majorAppearances.filter((a) => a.status === "winner" || a.status === "co_winner").length,
  };
  publisherStatsCache.set(cacheKey, stats);
  return stats;
}

export function imprintStats(imprintId: string, sinceYear?: number, region: AwardRegionFilter = "all") {
  const cacheKey = `${imprintId}:${sinceYear ?? "all"}:${region}`;
  const cached = imprintStatsCache.get(cacheKey);
  if (cached) return cached;

  const imprint = imprintsById.get(imprintId);
  const publisherRegion = imprint?.publisherId ? publishersById.get(imprint.publisherId)?.region : undefined;
  const books = booksForImprint(imprintId);
  const allAppearances = books.flatMap((book) => appearancesByBookId.get(book.id) ?? []).filter((appearance) => {
    if (publisherRegion) {
      const required = awardRequiredPublicationRegion(awardsById.get(appearance.awardId)?.geography);
      if (required && required !== publisherRegion) return false;
    }
    return true;
  });
  const appearances = sinceYear ? allAppearances.filter((a) => a.year >= sinceYear) : allAppearances;
  const majorAppearances = appearances.filter((appearance) => isGlobalMajorAward(appearance.awardId, region));
  const stats = {
    books: books.length,
    appearances: appearances.length,
    majorAppearances: majorAppearances.length,
    score: books.reduce((sum, book) => sum + getBookStats(book.id).score, 0),
    majorScore: majorAppearances.reduce((sum, a) => sum + majorAppearanceWeight(a.status), 0),
    wins: books.reduce((sum, book) => sum + getBookStats(book.id).wins, 0),
    majorWins: majorAppearances.filter((a) => a.status === "winner" || a.status === "co_winner").length,
  };
  imprintStatsCache.set(cacheKey, stats);
  return stats;
}

export function publisherSlug(publisher: Publisher) {
  return publisher.id.replace(/^publisher-/, "");
}

export function imprintSlug(imprint: Imprint) {
  return imprint.id.replace(/^imprint-/, "");
}

export function booksForSubject(slug: string) {
  const subject = subjectsBySlug.get(slug);
  if (!subject) return [];
  return booksBySubject.get(subject.name) ?? [];
}
