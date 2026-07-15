import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import rawCoverSpectrum from "@/data/public/cover-spectrum.json";
import type { CoverSpectrumData } from "@/lib/cover-spectrum-types";

export const metadata = {
  title: "For Fun / The Book Prize Index",
  description: "Visual experiments and playful ways to explore the Book Prize Index.",
};

const ideas = [
  {
    title: "The Chromatic Index",
    description: "Every locally cached cover arranged into a screen-sized spectrum by hue and brightness.",
    href: "/fun/chromatic-index",
    status: "Live",
  },
  {
    title: "The Nonfiction Galaxy",
    description: "A semantic map where nearby books share subjects, topics, people, and ideas.",
    status: "Concept",
  },
  {
    title: "What Nonfiction Talks About",
    description: "The distinctive words and phrases of prize-recognized titles, moving across decades.",
    status: "Concept",
  },
  {
    title: "Cover Twins",
    description: "Find the visual doppelgängers of any book by palette, brightness, and composition.",
    status: "Concept",
  },
  {
    title: "The Infinite Bookshelf",
    description: "The corpus rendered as one chronological shelf, with color from covers and height from page count.",
    status: "Concept",
  },
  {
    title: "Award Archipelago",
    description: "Prizes become islands, while books recognized by more than one program form the bridges.",
    status: "Concept",
  },
  {
    title: "Blind Date with a Book",
    description: "Browse summaries, topics, and prize histories while titles and covers remain hidden until reveal.",
    status: "Concept",
  },
  {
    title: "Prize DNA",
    description: "A compact visual barcode for the recognition history, subjects, regions, and era of each book.",
    status: "Concept",
  },
];

export default function FunPage() {
  const spectrum = rawCoverSpectrum as CoverSpectrumData;
  const orderedBooks = spectrum.layouts.desktop.order.filter((bookIndex) => bookIndex >= 0);
  const previewBooks = Array.from({ length: 36 }, (_, index) => {
    const orderIndex = Math.floor((index * orderedBooks.length) / 36);
    return spectrum.books[orderedBooks[orderIndex]];
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="grid gap-8 border-b hairline pb-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiments / Easter eggs</p>
          <h1 className="mt-4 max-w-3xl font-[var(--font-serif)] text-5xl font-light leading-[0.98] tracking-[-0.03em] sm:text-6xl">
            For fun
          </h1>
        </div>
        <p className="max-w-xl text-base leading-7 muted">
          Playful visualizations made from the books, covers, prize histories, titles, and relationships in the index.
          One is live; the rest are sketches for future experiments.
        </p>
      </header>

      <section className="grid gap-4 py-8 md:grid-cols-2 xl:grid-cols-3" aria-label="Visualization ideas">
        {ideas.map((idea, index) => {
          const content = (
            <>
              {index === 0 ? (
                <div className="grid h-44 grid-cols-12 grid-rows-3 overflow-hidden border-b hairline" aria-hidden="true">
                  {previewBooks.map((book, previewIndex) => (
                    <img className="h-full w-full object-cover" key={`${book.slug}-${previewIndex}`} loading="lazy" src={book.thumbnailUrl} alt="" />
                  ))}
                </div>
              ) : (
                <div className="flex h-20 items-end border-b hairline px-5 pb-4" aria-hidden="true">
                  <span className="font-[var(--font-number)] text-4xl text-[color-mix(in_srgb,var(--muted)_28%,transparent)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
              )}
              <div className="flex min-h-48 flex-col p-5">
                <div className="flex items-center justify-between gap-4 font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.15em] muted">
                  <span>Experiment {String(index + 1).padStart(2, "0")}</span>
                  <span>{idea.status}</span>
                </div>
                <h2 className="mt-5 font-[var(--font-serif)] text-2xl font-light leading-tight">{idea.title}</h2>
                <p className="mt-3 text-sm leading-6 muted">{idea.description}</p>
                <span className="mt-auto flex items-center justify-between pt-6 font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em]">
                  {idea.href ? "Open experiment" : "In the notebook"}
                  {idea.href ? <ArrowUpRight size={14} /> : null}
                </span>
              </div>
            </>
          );

          return idea.href ? (
            <Link className="fun-idea-card focus-ring md:col-span-2 xl:col-span-2" href={idea.href} key={idea.title}>
              {content}
            </Link>
          ) : (
            <article className="fun-idea-card fun-idea-card-concept" key={idea.title}>
              {content}
            </article>
          );
        })}
      </section>
    </main>
  );
}
