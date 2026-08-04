import type { Metadata } from "next";
import Link from "next/link";
import { LlmChoice } from "@/components/llm-choice";
import rawLlmChoice from "@/public/fun/llm-choice.json";
import { llmDisplayName } from "@/lib/llm-models";
import type { LlmChoiceData } from "@/lib/llm-choice-types";

export const metadata: Metadata = {
  title: "The LLM's Choice / The Book Prize Index",
  description: "Which prize-recognized books a language model is drawn to, and where that diverges from public recognition.",
  alternates: { canonical: "/fun/llm-choice" },
};

export default function LlmChoicePage() {
  const data = rawLlmChoice as LlmChoiceData;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="grid gap-8 border-b hairline pb-10">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiment / Model preferences</p>
          <h1 className="mt-4 max-w-4xl font-[var(--font-serif)] text-5xl font-light leading-[0.98] tracking-[-0.03em] sm:text-6xl">
            The LLM&rsquo;s Choice
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 muted">
            Every book in the index was shown to a language model as title, author, and year alone, then asked how
            strongly its own inclinations pulled toward the book. The LLM ({llmDisplayName(data.model)}) was also
            asked to assess the &lsquo;renown&rsquo; of a book among humans, which allows for some interesting
            comparisons.
          </p>
        </div>
        <dl className="library-shelf-metrics llm-choice-metrics">
          <div><dt>Books scored</dt><dd>{data.count.toLocaleString("en-US")}</dd></div>
          <div><dt>Mean affinity</dt><dd>{data.meanAffinity}</dd></div>
          <div><dt>Mean fame</dt><dd>{data.meanFame}</dd></div>
          <div><dt>Correlation</dt><dd>{data.affinityFameCorrelation.toFixed(2)}</dd></div>
        </dl>
      </header>

      <section className="py-8">
        <LlmChoice data={data} />
      </section>

      <footer className="grid gap-5 border-t hairline pt-6 text-sm leading-6 muted md:grid-cols-[1fr_auto]">
        <p className="max-w-3xl">
          These are a model&rsquo;s self-reports, not measurements of quality, sales, or critical consensus, and not an
          endorsement. Affinity is compressed toward the top of its range and correlates with fame at r=
          {data.affinityFameCorrelation.toFixed(2)}, so the raw number is only meaningful as a ranking; the overlooked
          view subtracts what fame predicts. Books the model did not recognize are excluded, since it has no
          preference to report about them. Scored with {llmDisplayName(data.model)}.
        </p>
        <Link className="book-detail-text-link self-start" href="/methodology">Read the methodology</Link>
      </footer>
    </main>
  );
}
