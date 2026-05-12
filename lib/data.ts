import rawData from "@/data/public/catalog.json";
import type { AwardStatus, Book, BookStats, PublicData } from "./types";

export const data = rawData as PublicData;

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
export const awardProgramsById = byId(data.awardPrograms ?? []);
export const awardsById = byId(data.awards);
export const editionsById = byId(data.editions);
export const publishersById = byId(data.publishers);
export const imprintsById = byId(data.imprints);
export const sourcesById = byId(data.sources);
export const subjectsByName = new Map(data.subjects.map((item) => [item.name.toLowerCase(), item]));
export const statsByBookId = new Map(data.stats.map((item) => [item.bookId, item]));
export const wikipediaEvidenceByBook = new Map((data.wikipediaEvidence ?? []).map((item) => [item.bookId, item]));

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
  const appearances = data.appearances
    .filter((appearance) => appearance.bookId === book.id)
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
    appearances,
    book.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
