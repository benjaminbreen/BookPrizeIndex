import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import rawCoverSpectrum from "@/data/public/cover-spectrum.json";
import rawFunPreviews from "@/public/fun/previews.json";
import type { CoverSpectrumData } from "@/lib/cover-spectrum-types";

export const metadata = {
  title: "For Fun / The Book Prize Index",
  description: "Visual experiments and playful ways to explore the Book Prize Index.",
  alternates: { canonical: "/fun" },
};

const ideas: FunIdea[] = [
  {
    title: "The Chromatic Index",
    description: "Every locally cached cover arranged into a screen-sized spectrum by hue and brightness.",
    href: "/fun/chromatic-index",
    status: "Live",
    preview: "spectrum",
  },
  {
    title: "The Nonfiction Galaxy",
    description: "A semantic map where nearby books share subjects, topics, people, and ideas.",
    href: "/fun/nonfiction-galaxy",
    status: "Live",
    preview: "galaxy",
  },
  {
    title: "The LLM's Choice",
    description: "Which books a language model is drawn to, and where that pulls away from public recognition.",
    href: "/fun/llm-choice",
    status: "Live",
    preview: "llmChoice",
  },
  {
    title: "What Nonfiction Talks About",
    description: "Every argument the corpus makes, one mark per book, placed in the year it was published.",
    href: "/fun/what-nonfiction-talks-about",
    status: "Live",
    preview: "talks",
  },
  {
    title: "The Library of Congress Shelf",
    description: "Reshelve prize-recognized books by Library of Congress class and call number, from A to Z.",
    href: "/fun/library-of-congress-shelf",
    status: "Live",
    preview: "libraryShelf",
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
  const previews = rawFunPreviews as FunPreviews;
  // Derived so the sentence cannot drift out of date as experiments ship.
  const liveCount = ideas.filter((idea) => idea.status === "Live").length;
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
          {" "}{liveCount} are live; the rest are sketches for future experiments.
        </p>
      </header>

      <section className="grid gap-4 py-8 md:grid-cols-2 xl:grid-cols-3" aria-label="Visualization ideas">
        {ideas.map((idea, index) => {
          const content = (
            <>
              {idea.preview === "spectrum" ? (
                <div className="grid h-44 grid-cols-12 grid-rows-3 overflow-hidden border-b hairline" aria-hidden="true">
                  {previewBooks.map((book, previewIndex) => (
                    <img className="h-full w-full object-cover" key={`${book.slug}-${previewIndex}`} loading="lazy" src={book.thumbnailUrl} alt="" />
                  ))}
                </div>
              ) : idea.preview === "galaxy" ? (
                <div className="fun-preview fun-preview-galaxy" aria-hidden="true">
                  <GalaxyPreview />
                </div>
              ) : idea.preview === "talks" ? (
                <div className="fun-preview fun-preview-talks" aria-hidden="true">
                  <TalksPreview />
                </div>
              ) : idea.preview ? (
                <div className="fun-preview" aria-hidden="true">
                  {previews[idea.preview as CoverPreviewKey].covers.map((cover: string, coverIndex: number) => (
                    <img className="h-full w-full object-cover" key={`${cover}-${coverIndex}`} loading="lazy" src={cover} alt="" />
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
            <Link className={`fun-idea-card focus-ring ${idea.preview === "spectrum" ? "md:col-span-2 xl:col-span-2" : ""}`} href={idea.href} key={idea.title}>
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

type CoverPreviewKey = "llmChoice" | "libraryShelf";

type FunIdea = {
  title: string;
  description: string;
  href?: string;
  status: string;
  preview?: "spectrum" | "galaxy" | "talks" | CoverPreviewKey;
};

type FunPreviews = {
  galaxy: { dots: number[][] };
  talks: { rows: number[][]; maxRow: number };
  llmChoice: { covers: string[] };
  libraryShelf: { covers: string[] };
};

/**
 * A sampled dot field standing in for the full projection. Colour cycles the
 * categorical palette by subject index so clusters read as clusters, matching what
 * the experiment itself shows.
 */
function GalaxyPreview() {
  const previews = rawFunPreviews as FunPreviews;
  return (
    // Window centred on the projection's y median (~0.40) rather than on 0.5. A
    // square viewBox cropped to this short band would sit above the dense middle and
    // leave the lower half empty.
    <svg className="h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 15 100 50">
      {previews.galaxy.dots.map(([x, y, subjectIndex], index) => (
        <circle
          cx={x * 100}
          cy={y * 100}
          fill={`var(--chart-cat-${(subjectIndex % 10) + 1})`}
          fillOpacity={0.72}
          key={index}
          r={0.85}
        />
      ))}
    </svg>
  );
}

/**
 * The claim wedge in miniature: one bar per year, length proportional to that year's
 * book count, segmented by stance. Same shape the experiment opens with.
 */
function TalksPreview() {
  const { rows, maxRow } = (rawFunPreviews as FunPreviews).talks;
  return (
    <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${maxRow} ${rows.length}`}>
      {rows.map((segments, rowIndex) => {
        let offset = 0;
        return segments.map((width, stanceIndex) => {
          const x = offset;
          offset += width;
          return width ? (
            <rect
              fill={`var(--chart-cat-${(stanceIndex % 10) + 1})`}
              fillOpacity={stanceIndex === segments.length - 1 ? 0.18 : 0.85}
              height={0.85}
              key={`${rowIndex}-${stanceIndex}`}
              width={width}
              x={x}
              y={rowIndex}
            />
          ) : null;
        });
      })}
    </svg>
  );
}
