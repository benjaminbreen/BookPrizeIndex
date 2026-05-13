import { ImprintRankExperiment, type ImprintRankEvent } from "@/components/imprint-rank-experiment";
import { awardsById, booksById, data, publishersById } from "@/lib/data";
import type { AwardStatus } from "@/lib/types";

export const metadata = {
  title: "Experiments / The Book Prize Index",
  description: "Experimental visualizations and interactive views of book prize data.",
};

export default function ExperimentsPage() {
  const events = buildImprintRankEvents();
  const years = events.map((event) => event.year);
  const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <section className="grid gap-8 border-b hairline pb-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiments</p>
          <h1 className="mt-3 max-w-3xl font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">
            Visual ways to test the prize corpus.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 muted">
            Small interactive studies for patterns that do not fit a normal browse table: imprint momentum, prize
            geography, subject drift, publisher concentration, and other views that may or may not graduate into the
            main product.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <HeroMetric label="Events" value={events.length.toLocaleString()} />
          <HeroMetric label="Imprints" value={new Set(events.map((event) => event.imprintId)).size.toLocaleString()} />
          <HeroMetric label="Years" value={`${yearRange[0]}-${yearRange[1]}`} />
        </div>
      </section>

      <ImprintRankExperiment events={events} yearRange={yearRange} />

      <section className="mt-12 grid gap-5 border-t hairline pt-8 md:grid-cols-3">
        <ExperimentStub
          title="Prize geography"
          body="Compare U.S., U.K., Canadian, and international award programs by subject mix and recognition weight."
        />
        <ExperimentStub
          title="Subject drift"
          body="Track how biography, history, science, memoir, criticism, and politics rise or fade across prize years."
        />
        <ExperimentStub
          title="Publisher concentration"
          body="Estimate how much recognition is concentrated among the largest parent publishers versus independent presses."
        />
      </section>
    </main>
  );
}

function buildImprintRankEvents(): ImprintRankEvent[] {
  const events: ImprintRankEvent[] = [];

  for (const appearance of data.appearances) {
    const book = booksById.get(appearance.bookId);
    if (!book?.imprintId) continue;
    const imprint = data.imprints.find((item) => item.id === book.imprintId);
    const award = awardsById.get(appearance.awardId);
    if (!imprint || !award) continue;
    const isMajor = award.awardType === "major_award" && award.programId !== "prose-awards" && !award.id.startsWith("award-prose-award-");
    const publisher = imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined;
    events.push({
      year: appearance.year,
      imprintId: imprint.id,
      imprintName: imprint.shortName ?? imprint.name,
      ...(publisher?.name ? { publisherName: publisher.name } : {}),
      bookId: book.id,
      weight: recognitionWeight(appearance.status, award.awardType === "major_award"),
      majorWeight: isMajor ? majorRecognitionWeight(appearance.status) : 0,
      isMajor,
      isWin: appearance.status === "winner" || appearance.status === "co_winner",
    });
  }

  return events.sort((a, b) => a.year - b.year || a.imprintName.localeCompare(b.imprintName));
}

function recognitionWeight(status: AwardStatus, isMajorAward: boolean) {
  if (status === "winner" || status === "co_winner") return isMajorAward ? 10 : 4;
  if (status === "finalist" || status === "shortlist") return isMajorAward ? 4 : 2;
  if (status === "longlist") return isMajorAward ? 2 : 1;
  return 0;
}

function majorRecognitionWeight(status: AwardStatus) {
  if (status === "winner" || status === "co_winner") return 10;
  if (status === "finalist" || status === "shortlist") return 4;
  if (status === "longlist") return 2;
  return 0;
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t hairline pt-3">
      <p className="plain-number text-2xl leading-none text-[var(--ink)]">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.15em] muted">{label}</p>
    </div>
  );
}

function ExperimentStub({ body, title }: { body: string; title: string }) {
  return (
    <div className="border-t hairline pt-4">
      <h2 className="font-[var(--font-serif)] text-2xl font-light">{title}</h2>
      <p className="mt-3 text-sm leading-6 muted">{body}</p>
    </div>
  );
}
