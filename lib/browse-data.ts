import rawBrowseData from "@/data/public/browse.json";
import type { BrowseBookRow, BrowseData } from "@/lib/browse-types";

export const browseData = rawBrowseData as unknown as BrowseData;
export const browseBooksById = new Map(browseData.books.map((book) => [book.id, book]));
export const browseBooksBySlug = new Map(browseData.books.map((book) => [book.slug, book]));
export const browseBooksByImprintId = groupBrowseBooks((book) => book.imprintId);
export const browseBooksByPublisherId = groupBrowseBooks((book) => book.publisherId);
export const browseBooksBySubject = (() => {
  const grouped = new Map<string, BrowseBookRow[]>();
  for (const book of browseData.books) {
    for (const subject of book.subjects) {
      const current = grouped.get(subject) ?? [];
      current.push(book);
      grouped.set(subject, current);
    }
  }
  return grouped;
})();
export const browseBooksByTopic = (() => {
  const grouped = new Map<string, BrowseBookRow[]>();
  for (const book of browseData.books) {
    for (const topic of book.topics) {
      const current = grouped.get(topic) ?? [];
      current.push(book);
      grouped.set(topic, current);
    }
  }
  return grouped;
})();

function groupBrowseBooks(keyForBook: (book: BrowseBookRow) => string | undefined) {
  const grouped = new Map<string, BrowseBookRow[]>();
  for (const book of browseData.books) {
    const key = keyForBook(book);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(book);
    grouped.set(key, current);
  }
  return grouped;
}
