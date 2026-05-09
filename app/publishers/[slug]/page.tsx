import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { BookCatalog } from "@/components/book-catalog";
import { booksForPublisher, imprintSlug, imprintsForPublisher, imprintStats, publisherSlug, publisherStats } from "@/lib/catalog";
import { data } from "@/lib/data";

export function generateStaticParams() {
  return data.publishers.filter((publisher) => publisherStats(publisher.id).books > 0).map((publisher) => ({ slug: publisherSlug(publisher) }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const publisher = data.publishers.find((item) => publisherSlug(item) === slug);
  return { title: publisher ? `${publisher.name} / The Book Prize Index` : "Publisher / The Book Prize Index" };
}

export default async function PublisherPage({ params }: PageProps) {
  const { slug } = await params;
  const publisher = data.publishers.find((item) => publisherSlug(item) === slug);
  if (!publisher) notFound();
  const imprints = imprintsForPublisher(publisher.id);
  const stats = publisherStats(publisher.id);
  if (!stats.books) notFound();

  return (
    <main>
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publisher</p>
        <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end">
          <div>
            <h1 className="font-[var(--font-serif)] text-5xl font-light leading-tight">{publisher.name}</h1>
            <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
              Parent publisher view across child imprints represented in the award corpus.
            </p>
          </div>
          <div className="grid grid-cols-3 border-l hairline">
            <HeroMetric value={stats.imprints} label="Imprints" />
            <HeroMetric value={stats.books} label="Books" />
            <HeroMetric value={stats.appearances} label="Appearances" />
          </div>
        </div>

        <div className="mt-9 border-t hairline pt-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Top imprints</h2>
            <Link className="inline-flex items-center gap-2 text-sm transition hover:text-[var(--accent)]" href="/imprints">
              View all imprints
              <ChevronRight size={15} />
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {imprints.map((imprint) => {
              const itemStats = imprintStats(imprint.id);
              return (
                <Link className="border hairline p-4 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
                  <p className="font-medium">{imprint.name}</p>
                  <p className="mt-2 font-[var(--font-mono)] text-xs muted">
                    {itemStats.books} books / {itemStats.appearances} appearances
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <Suspense>
        <BookCatalog books={booksForPublisher(publisher.id)} title={`${publisher.name} books`} deck="Books grouped under this parent publisher across all current child imprints." />
      </Suspense>
    </main>
  );
}

function HeroMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-r hairline px-5 py-6 text-center last:border-r-0">
      <p className="plain-number text-3xl">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em] muted">{label}</p>
    </div>
  );
}
