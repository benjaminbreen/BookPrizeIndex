import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ImprintLogoMark } from "@/components/imprint-logo-mark";
import { ProgressiveBookCatalog } from "@/components/progressive-book-catalog";
import { imprintSlug, imprintsForPublisher, imprintStats, publisherSlug, publisherStats } from "@/lib/catalog";
import { browseBooksByPublisherId, browseData } from "@/lib/browse-data";
import { sortBrowseBooksByRecognition } from "@/lib/browse-ranking";
import { booksByPublisherId, data, publishersBySlug } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";
import { pageMetadata } from "@/lib/site-metadata";

const STATIC_PUBLISHER_PAGE_LIMIT = 80;
const INITIAL_PUBLISHER_BOOK_LIMIT = 100;

export const dynamicParams = true;

export function generateStaticParams() {
  return rankedPublishers()
    .slice(0, STATIC_PUBLISHER_PAGE_LIMIT)
    .map((publisher) => ({ slug: publisherSlug(publisher) }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const publisher = publishersBySlug.get(slug);
  if (!publisher) return { title: "Publisher / The Book Prize Index", robots: { index: false, follow: false } };
  const stats = publisherStats(publisher.id);
  return pageMetadata({
    title: `${publisher.name} / The Book Prize Index`,
    description: `Explore ${stats.books} prize-recognized nonfiction books and ${stats.imprints} imprints associated with ${publisher.name}.`,
    canonical: `/publishers/${slug}`,
  });
}

export default async function PublisherPage({ params }: PageProps) {
  const { slug } = await params;
  const publisher = publishersBySlug.get(slug);
  if (!publisher) notFound();
  const imprints = imprintsForPublisher(publisher.id);
  const stats = publisherStats(publisher.id);
  const books = sortBrowseBooksByRecognition(browseBooksByPublisherId.get(publisher.id) ?? []);
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
                <Link className="flex items-center gap-4 border hairline p-4 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
                  <ImprintLogoMark className="h-14 w-20" logoPath={getImprintLogo(imprint.id)?.logoPath} name={imprint.name} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{imprint.name}</span>
                    <span className="mt-2 block font-[var(--font-mono)] text-xs muted">
                      {itemStats.books} books / {itemStats.appearances} appearances
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <Suspense>
        <ProgressiveBookCatalog
          awardOptions={browseData.awards}
          books={books.slice(0, INITIAL_PUBLISHER_BOOK_LIMIT)}
          entityId={publisher.id}
          entityType="publisher"
          title={`${publisher.name} books`}
          deck="Books grouped under this parent publisher across all current child imprints."
          totalBooks={books.length}
        />
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

let rankedPublishersCache: typeof data.publishers | undefined;

function rankedPublishers() {
  rankedPublishersCache ??= data.publishers
    .filter((publisher) => (booksByPublisherId.get(publisher.id)?.length ?? 0) > 0)
    .sort((a, b) => publisherStats(b.id).score - publisherStats(a.id).score || a.name.localeCompare(b.name));
  return rankedPublishersCache;
}
