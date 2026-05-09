import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCatalog } from "@/components/book-catalog";
import { booksForImprint } from "@/lib/catalog";
import { data } from "@/lib/data";

export function generateStaticParams() {
  return data.imprints.map((imprint) => ({ slug: imprint.id.replace(/^imprint-/, "") }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const imprint = data.imprints.find((item) => item.id === `imprint-${slug}`);
  return { title: imprint ? `${imprint.name} / The Book Prize Index` : "Publisher / The Book Prize Index" };
}

export default async function PublisherPage({ params }: PageProps) {
  const { slug } = await params;
  const imprint = data.imprints.find((item) => item.id === `imprint-${slug}`);
  if (!imprint) notFound();
  return (
    <Suspense>
      <BookCatalog
        books={booksForImprint(imprint.id)}
        title={imprint.name}
        deck="Imported as an imprint. Publisher ownership is reserved for curated source-backed enrichment."
      />
    </Suspense>
  );
}
