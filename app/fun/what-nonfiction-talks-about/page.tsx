import type { Metadata } from "next";
import Link from "next/link";
import { NonfictionTalks } from "@/components/nonfiction-talks";

export const metadata: Metadata = {
  title: "What Nonfiction Talks About / The Book Prize Index",
  description: "Every interpretive claim extracted from prize-recognized nonfiction, placed in its publication year.",
  alternates: { canonical: "/fun/what-nonfiction-talks-about" },
};

export default function WhatNonfictionTalksAboutPage() {
  return (
    <main className="mx-auto max-w-[96rem] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="grid gap-8 border-b hairline pb-10">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiment / Claims over time</p>
          <h1 className="mt-4 max-w-4xl font-[var(--font-serif)] text-5xl font-light leading-[0.98] tracking-[-0.03em] sm:text-6xl">
            What Nonfiction Talks About
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 muted">
            A language model read each book&rsquo;s description and wrote down the single claim it argues for. Every
            mark below is one book, placed in the year it was published and coloured by the stance its argument
            takes. Row length is simply how many books that year, so the widening shape is prize nonfiction growing.
          </p>
        </div>
      </header>

      <section className="py-8">
        <NonfictionTalks dataUrl="/fun/nonfiction-talks.json" />
      </section>

      <footer className="grid gap-5 border-t hairline pt-6 text-sm leading-6 muted md:grid-cols-[1fr_auto]">
        <p className="max-w-3xl">
          Claims are model interpretations of publisher and catalog descriptions, not quotations from the books, and
          about half the corpus has one &mdash; the pale tail on each row is the books that do not. Stance labels come
          from a separate pass and describe the posture of the argument, not its quality. Years before 1990 carry only
          a few dozen books each, so read the early rows as texture rather than trend.
        </p>
        <Link className="book-detail-text-link self-start" href="/methodology">Read the methodology</Link>
      </footer>
    </main>
  );
}
