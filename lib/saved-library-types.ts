import type { Book } from "@/lib/types";

export type SavedBookInput = {
  bookId: string;
  slug: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  thumbnailUrl?: string;
  primarySubject?: string;
};

export type SavedBook = SavedBookInput & {
  savedAt: string;
};

export type PersonalBookList = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  books: SavedBook[];
};

export type SavedLibraryCounts = {
  books: number;
  personalLists: number;
  searchLists: number;
  total: number;
};

export function savedBookInputFromBook(
  book: Pick<Book, "authors" | "id" | "primarySubject" | "publicationYear" | "slug" | "thumbnailUrl" | "title">,
): SavedBookInput {
  return {
    authors: book.authors.map((author) => author.name),
    bookId: book.id,
    primarySubject: book.primarySubject,
    publicationYear: book.publicationYear,
    slug: book.slug,
    thumbnailUrl: book.thumbnailUrl,
    title: book.title,
  };
}
