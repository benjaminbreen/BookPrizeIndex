import type { Metadata } from "next";
import Link from "next/link";
import { LibraryShelf } from "@/components/library-shelf";
import { SurpriseShelfButton } from "@/components/surprise-shelf-button";
import { getLibraryShelfWindow, libraryShelf } from "@/lib/library-shelf-data";

export const metadata: Metadata = {
  title: "The Library of Congress Shelf / The Book Prize Index",
  description: "Browse prize-recognized books in Library of Congress call-number order.",
  alternates: { canonical: "/fun/library-of-congress-shelf" },
};

type PageProps = {
  searchParams: Promise<{ book?: string; class?: string; index?: string; q?: string }>;
};

export default async function LibraryOfCongressShelfPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialData = getLibraryShelfWindow({
    book: params.book,
    classCode: params.class,
    index: parseIndex(params.index),
    query: params.q,
  });
  const coverage = (libraryShelf.stats.shelfBooks / Math.max(libraryShelf.stats.catalogBooks, 1)) * 100;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="library-shelf-page-header grid gap-8 border-b hairline pb-10 lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiment / Library shelf</p>
          <h1 className="mt-4 max-w-4xl font-[var(--font-serif)] text-5xl font-light leading-[0.98] tracking-[-0.03em] sm:text-6xl">
            The Library of Congress Shelf
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 muted">
            Begin with a book, then sample the prize-recognized books cataloged beside it. This is a simulated shelf
            ordered by edition-level Library of Congress call numbers; actual holdings and local shelving may differ.
          </p>
        </div>
        <SurpriseShelfButton
          currentIndex={initialData.selectedIndex}
          totalBooks={libraryShelf.stats.shelfBooks}
        />
        <dl className="library-shelf-metrics">
          <div><dt>On the shelf</dt><dd>{libraryShelf.stats.shelfBooks.toLocaleString()}</dd></div>
          <div><dt>Catalog coverage</dt><dd>{coverage.toFixed(1)}%</dd></div>
          <div><dt>Classes represented</dt><dd>{libraryShelf.classes.length}</dd></div>
        </dl>
      </header>

      <section className="py-8">
        <LibraryShelf initialData={initialData} key={initialData.selectedIndex} />
      </section>

      <footer className="grid gap-5 border-t hairline pt-6 text-sm leading-6 muted md:grid-cols-[1fr_auto]">
        <p className="max-w-3xl">
          Call numbers are edition-dependent catalog evidence, not project-generated classifications. Partial,
          conflicting, and low-confidence records are excluded. Library of Congress Classification is one historically
          situated way of arranging knowledge, not a neutral or exhaustive taxonomy.
        </p>
        <Link className="book-detail-text-link self-start" href="/methodology">Read the methodology</Link>
      </footer>
    </main>
  );
}

function parseIndex(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
