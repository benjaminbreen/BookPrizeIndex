import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCatalog } from "@/components/book-catalog";
import { ImprintKeyboardNav } from "@/components/imprint-keyboard-nav";
import { booksForImprint, imprintSlug, imprintStats } from "@/lib/catalog";
import { data, publishersById } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";

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
  const books = booksForImprint(imprint.id);
  const stats = imprintStats(imprint.id);
  const logo = getImprintLogo(imprint.id);
  const imprintRoutes = [...data.imprints]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `/imprints/${imprintSlug(item)}`);
  const currentRoute = `/imprints/${imprintSlug(imprint)}`;
  const currentIndex = imprintRoutes.indexOf(currentRoute);
  const previousHref = currentIndex > 0 ? imprintRoutes[currentIndex - 1] : undefined;
  const nextHref = currentIndex >= 0 && currentIndex < imprintRoutes.length - 1 ? imprintRoutes[currentIndex + 1] : undefined;

  return (
    <main>
      <ImprintKeyboardNav previousHref={previousHref} nextHref={nextHref} />
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[10rem_minmax(0,1fr)_24rem] lg:items-center">
          <ImprintLogo logoPath={logo?.logoPath} name={imprint.name} sourceTitle={logo?.sourceTitle} />

          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Imprint</p>
            <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-tight tracking-normal">{imprint.name}</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 muted">
              {publisher ? `An imprint of ${publisher.name}.` : "An imprint in the current award corpus."}
            </p>
          </div>

          <div className="lg:justify-self-end">
            <div className="grid grid-cols-2 border hairline panel sm:min-w-72">
              <HeroMetric value={stats.books} label="Books" />
              <HeroMetric value={stats.appearances} label="Appearances" />
            </div>
          </div>
        </div>
      </section>

      <Suspense>
        <BookCatalog
          books={books}
          title={`${imprint.name} books`}
          deck="Award-recognized books associated with this imprint."
        />
      </Suspense>
    </main>
  );
}

function ImprintLogo({ logoPath, name, sourceTitle }: { logoPath?: string; name: string; sourceTitle?: string }) {
  if (!logoPath) {
    return (
      <div className="grid min-h-32 place-items-center px-2 py-4 text-center">
        <span className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Logo pending</span>
      </div>
    );
  }

  return (
    <figure className="grid h-44 place-items-center overflow-visible px-2 py-4" title={sourceTitle}>
      <img
        alt={`${name} logo`}
        className="max-h-44 max-w-full scale-[2.4] object-contain grayscale"
        src={logoPath}
      />
    </figure>
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
