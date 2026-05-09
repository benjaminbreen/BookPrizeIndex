import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCatalog } from "@/components/book-catalog";
import { booksForImprint, imprintSlug } from "@/lib/catalog";
import { data, publishersById } from "@/lib/data";

export function generateStaticParams() {
  return data.imprints.map((imprint) => ({ slug: imprintSlug(imprint) }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const imprint = data.imprints.find((item) => imprintSlug(item) === slug);
  return { title: imprint ? `${imprint.name} / The Book Prize Index` : "Imprint / The Book Prize Index" };
}

export default async function ImprintPage({ params }: PageProps) {
  const { slug } = await params;
  const imprint = data.imprints.find((item) => imprintSlug(item) === slug);
  if (!imprint) notFound();
  const publisher = imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined;

  return (
    <Suspense>
      <BookCatalog
        books={booksForImprint(imprint.id)}
        title={imprint.name}
        deck={publisher ? `An imprint of ${publisher.name}.` : "An imprint in the current award corpus."}
      />
    </Suspense>
  );
}
