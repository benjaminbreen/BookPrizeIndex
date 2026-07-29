export const SUPPORT_PROMPT_BOOK_THRESHOLD = 10;

export function recordDistinctBookView(viewedBooks: Set<string>, bookId: string) {
  const bookKey = bookId.trim().replace(/^book-/, "");
  if (!bookKey || viewedBooks.has(bookKey)) {
    return { added: false, count: viewedBooks.size };
  }

  viewedBooks.add(bookKey);
  return { added: true, count: viewedBooks.size };
}
