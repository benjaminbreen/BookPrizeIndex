import { Suspense } from "react";
import { cookies } from "next/headers";
import { BookCatalog } from "@/components/book-catalog";
import { data } from "@/lib/data";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";

export const metadata = {
  title: "Books / The Book Prize Index",
};

export default async function BooksPage() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);

  return (
    <Suspense>
      <BookCatalog
        books={data.books}
        title="Books"
        deck="Search, rank, and filter winners, finalists, shortlists, and longlists across the imported prize corpus."
        defaultRegion={defaultRegion}
        wideLayout
      />
    </Suspense>
  );
}
