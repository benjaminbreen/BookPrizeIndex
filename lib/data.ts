import rawBooks from "@/data/public/catalog-books.json";
import rawEntities from "@/data/public/catalog-entities.json";
import type { AwardStatus, Book, BookStats, PublicData } from "./types";

export const data = {
  ...rawBooks,
  ...rawEntities,
  sources: [],
} as PublicData;

export const statusLabels: Record<AwardStatus, string> = {
  winner: "Winner",
  co_winner: "Co-winner",
  finalist: "Finalist",
  shortlist: "Shortlist",
  longlist: "Longlist",
  honorable_mention: "Honorable mention",
  commended: "Commended",
  notable: "Notable",
  unknown: "Listed",
};

export function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

export const booksById = byId(data.books);
export const booksBySlug = new Map(data.books.map((book) => [book.slug, book]));
export const awardProgramsById = byId(data.awardPrograms ?? []);
export const awardProgramsBySlug = new Map((data.awardPrograms ?? []).map((program) => [program.slug, program]));
export const awardsById = byId(data.awards);
export const awardsBySlug = new Map(data.awards.map((award) => [award.slug, award]));
export const editionsById = byId(data.editions);
export const publishersById = byId(data.publishers);
export const publishersBySlug = new Map(data.publishers.map((publisher) => [publisher.id.replace(/^publisher-/, ""), publisher]));
export const imprintsById = byId(data.imprints);
export const imprintsBySlug = new Map(data.imprints.map((imprint) => [imprint.id.replace(/^imprint-/, ""), imprint]));
export const subjectsByName = new Map(data.subjects.map((item) => [item.name.toLowerCase(), item]));
export const subjectsBySlug = new Map(data.subjects.map((item) => [item.slug, item]));
export const statsByBookId = new Map(data.stats.map((item) => [item.bookId, item]));
export const appearancesByBookId = groupBy(data.appearances, (appearance) => appearance.bookId);
export const appearancesByAwardId = groupBy(data.appearances, (appearance) => appearance.awardId);
export const booksByImprintId = groupBy(data.books, (book) => book.imprintId);
export const booksByPublisherId = groupBy(data.books, (book) => book.publisherId);
export const booksByTopic = new Map<string, Book[]>();
export const booksBySubject = new Map<string, Book[]>();
export const booksByAuthorName = new Map<string, Book[]>();

for (const book of data.books) {
  for (const subject of book.subjects) {
    const current = booksBySubject.get(subject) ?? [];
    current.push(book);
    booksBySubject.set(subject, current);
  }
  for (const topic of book.topics) {
    const current = booksByTopic.get(topic) ?? [];
    current.push(book);
    booksByTopic.set(topic, current);
  }
  for (const author of book.authors) {
    const current = booksByAuthorName.get(author.name) ?? [];
    current.push(book);
    booksByAuthorName.set(author.name, current);
  }
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string | undefined) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }
  return grouped;
}

export function getBookStats(bookId: string): BookStats {
  return statsByBookId.get(bookId) ?? {
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

export function getBookLabel(book: Book) {
  return `${book.title}${book.publicationYear ? ` (${book.publicationYear})` : ""}`;
}

export function bookSearchText(book: Book) {
  const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
  const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
  const appearances = (appearancesByBookId.get(book.id) ?? [])
    .map((appearance) => awardsById.get(appearance.awardId)?.name)
    .filter(Boolean)
    .join(" ");

  return [
    book.title,
    book.subtitle,
    book.authors.map((author) => author.name).join(" "),
    publisher,
    imprint,
    book.subjects.join(" "),
    book.centralFigures.join(" "),
    book.experimentalSemanticProfile?.centralPlaces.map((place) => place.name).join(" "),
    book.experimentalSemanticProfile?.argument.present ? book.experimentalSemanticProfile.argument.statement : "",
    appearances,
    book.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
