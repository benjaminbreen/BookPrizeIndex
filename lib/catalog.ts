import MiniSearch from "minisearch";
import { data, awardsById, getBookStats, imprintsById, publishersById } from "@/lib/data";
import type { Book, Imprint, Publisher } from "@/lib/types";

export type BookSortKey = "score" | "year" | "title" | "wins" | "lists" | "imprint" | "publisher";

export type BookSearchDocument = {
  id: string;
  title: string;
  author: string;
  publisher: string;
  imprint: string;
  subjects: string;
  awards: string;
  figures: string;
  summary: string;
};

export function makeBookSearch() {
  const search = new MiniSearch<BookSearchDocument>({
    fields: ["title", "author", "publisher", "imprint", "subjects", "awards", "figures", "summary"],
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
  const awards = data.appearances
    .filter((appearance) => appearance.bookId === book.id)
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
    summary: book.summary ?? "",
  };
}

export function sortBooks(books: Book[], sortKey: BookSortKey) {
  return [...books].sort((a, b) => {
    const aStats = getBookStats(a.id);
    const bStats = getBookStats(b.id);
    if (sortKey === "score") return bStats.score - aStats.score || a.title.localeCompare(b.title);
    if (sortKey === "wins") return bStats.wins - aStats.wins || a.title.localeCompare(b.title);
    if (sortKey === "lists") return bStats.lists - aStats.lists || a.title.localeCompare(b.title);
    if (sortKey === "year") return (b.publicationYear ?? 0) - (a.publicationYear ?? 0) || a.title.localeCompare(b.title);
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
    return a.title.localeCompare(b.title);
  });
}

export function filterBooksByQuery(books: Book[], query: string) {
  const q = query.trim();
  if (!q) return books;
  const search = makeBookSearch();
  const ids = new Set(search.search(q).map((result) => result.id));
  return books.filter((book) => ids.has(book.id));
}

export function booksForImprint(imprintId: string) {
  return data.books.filter((book) => book.imprintId === imprintId);
}

export function imprintsForPublisher(publisherId: string) {
  return data.imprints
    .filter((imprint) => imprint.publisherId === publisherId)
    .sort((a, b) => imprintStats(b.id).score - imprintStats(a.id).score || a.name.localeCompare(b.name));
}

export function booksForPublisher(publisherId: string) {
  return data.books.filter((book) => book.publisherId === publisherId);
}

export function publisherStats(publisherId: string) {
  const books = booksForPublisher(publisherId);
  const bookIds = new Set(books.map((book) => book.id));
  const appearances = data.appearances.filter((appearance) => bookIds.has(appearance.bookId));
  return {
    books: books.length,
    imprints: imprintsForPublisher(publisherId).length,
    appearances: appearances.length,
    score: books.reduce((sum, book) => sum + getBookStats(book.id).score, 0),
    wins: books.reduce((sum, book) => sum + getBookStats(book.id).wins, 0),
  };
}

export function imprintStats(imprintId: string) {
  const books = booksForImprint(imprintId);
  const bookIds = new Set(books.map((book) => book.id));
  const appearances = data.appearances.filter((appearance) => bookIds.has(appearance.bookId));
  return {
    books: books.length,
    appearances: appearances.length,
    score: books.reduce((sum, book) => sum + getBookStats(book.id).score, 0),
    wins: books.reduce((sum, book) => sum + getBookStats(book.id).wins, 0),
  };
}

export function publisherSlug(publisher: Publisher) {
  return publisher.id.replace(/^publisher-/, "");
}

export function imprintSlug(imprint: Imprint) {
  return imprint.id.replace(/^imprint-/, "");
}

export function booksForSubject(slug: string) {
  const subject = data.subjects.find((item) => item.slug === slug);
  if (!subject) return [];
  return data.books.filter((book) => book.subjects.includes(subject.name));
}
