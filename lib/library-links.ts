import type { Book } from "@/lib/types";

export function libraryLookupUrl(book: Book) {
  const isbn = book.isbn13.find((value) => /^\d{13}$/.test(value.replace(/[^0-9]/g, "")))?.replace(/[^0-9]/g, "");
  if (isbn) return `https://search.worldcat.org/search?q=${encodeURIComponent(isbn)}`;
  if (book.links.worldcat) return book.links.worldcat;
  const query = [book.title, book.authors[0]?.name].filter(Boolean).join(" ");
  return `https://search.worldcat.org/search?q=${encodeURIComponent(query)}`;
}
