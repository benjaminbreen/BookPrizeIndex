import { Suspense } from "react";
import { cookies } from "next/headers";
import { BookCatalog } from "@/components/book-catalog";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { browseData } from "@/lib/browse-data";
import { bookCatalogPublisherOptions, bookCatalogSubjectOptions, queryBookCatalog } from "@/lib/book-catalog-query";

export const metadata = {
  title: "Books / The Book Prize Index",
};

type BooksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BooksPage({ searchParams }: BooksPageProps) {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);
  const params = (await searchParams) ?? {};
  const initialQuery = typeof params.q === "string" && params.mode !== "semantic" ? params.q : "";
  const topic = typeof params.topic === "string" ? params.topic : undefined;
  const initial = queryBookCatalog(browseData.books, {
    page: 1,
    pageSize: 100,
    query: initialQuery,
    region: defaultRegion,
    topic,
  });

  return (
    <Suspense>
      <BookCatalog
        awardOptions={browseData.awards}
        books={initial.rows}
        title="Books"
        deck="Search, rank, and filter winners, finalists, shortlists, and longlists across the imported prize corpus."
        defaultRegion={defaultRegion}
        remote={{
          initialTotal: initial.total,
          publisherOptions: bookCatalogPublisherOptions(browseData.books),
          subjectOptions: bookCatalogSubjectOptions(browseData.books),
        }}
        wideLayout
      />
    </Suspense>
  );
}
