import { Suspense } from "react";
import { BookCatalog } from "@/components/book-catalog";
import { data } from "@/lib/data";

export const metadata = {
  title: "Books / The Book Prize Index",
};

export default function BooksPage() {
  return (
    <Suspense>
      <BookCatalog
        books={data.books}
        title="Books"
        deck="Search and sort the full imported catalog by award performance, year, title, author, publisher, and imprint."
      />
    </Suspense>
  );
}
