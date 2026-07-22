import { BestsellerConvergenceExperiment } from "@/components/bestseller-convergence-experiment";
import { ConsensusExperiment } from "@/components/consensus-experiment";
import { ImprintRankExperiment, type ImprintRankEvent } from "@/components/imprint-rank-experiment";
import { PrizeCensusExperiment } from "@/components/prize-census-experiment";
import { SubjectDriftExperiment, type SubjectDriftData } from "@/components/subject-drift-experiment";
import { awardProgramsById, awardsById, booksById, data, publishersById } from "@/lib/data";
import { buildConsensusData } from "@/lib/consensus";
import { buildBestsellerConvergenceData } from "@/lib/bestseller-convergence";
import { buildPrizeCensus } from "@/lib/prize-census";
import { rollupSubjectName } from "@/lib/subject-rollup";
import type { AwardStatus } from "@/lib/types";

export const metadata = {
  title: "Trends / The Book Prize Index",
  description: "Interactive charts showing how nonfiction prizes, subjects, and publishing imprints have changed over time.",
  alternates: { canonical: "/experiments" },
};

const CHART_LINKS = [
  { href: "#imprint-leaderboard", label: "Imprint leaderboard" },
  { href: "#prize-census", label: "Prize census" },
  { href: "#subject-drift", label: "Subject drift" },
  { href: "#consensus", label: "Consensus" },
  { href: "#bestseller-convergence", label: "Prizes and bestsellers" },
];

export default function ExperimentsPage() {
  const events = buildImprintRankEvents();
  const years = events.map((event) => event.year);
  const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];
  const census = buildPrizeCensus();
  const subjectDrift = buildSubjectDriftData();
  const consensus = buildConsensusData();
  const bestsellerConvergence = buildBestsellerConvergenceData();

  return (
    <main className="text-page mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <section className="grid gap-8 border-b hairline pb-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Trends</p>
          <h1 className="mt-3 max-w-3xl font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">
            How nonfiction prizes have changed.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 muted">
            Explore the publishers, subjects, and prize programs represented in the index over time.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <HeroMetric label="Events" value={events.length.toLocaleString()} />
          <HeroMetric label="Imprints" value={new Set(events.map((event) => event.imprintId)).size.toLocaleString()} />
          <HeroMetric label="Years" value={`${yearRange[0]}-${yearRange[1]}`} />
        </div>
      </section>

      <nav aria-label="Charts on this page" className="border-b hairline py-4">
        <p className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.16em] muted">On this page</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {CHART_LINKS.map((item) => (
            <a className="focus-ring rounded-sm transition hover:text-[var(--accent)]" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <ImprintRankExperiment events={events} yearRange={yearRange} />

      <PrizeCensusExperiment census={census} />

      <SubjectDriftExperiment data={subjectDrift} />

      <ConsensusExperiment data={consensus} />

      <BestsellerConvergenceExperiment data={bestsellerConvergence} />
    </main>
  );
}

function buildSubjectDriftData(): SubjectDriftData {
  const counts = new Map<string, number>();
  const subjectTotals = new Map<string, number>();

  for (const appearance of data.appearances) {
    const book = booksById.get(appearance.bookId);
    const storedSubject = book?.primarySubject;
    if (!storedSubject) continue;
    const subject = rollupSubjectName(storedSubject);
    const award = awardsById.get(appearance.awardId);
    if (!award) continue;
    const program = award.programId ? awardProgramsById.get(award.programId) : undefined;
    const regionIndex = subjectDriftRegionIndex(award.geography ?? program?.geography);
    const isWin = appearance.status === "winner" || appearance.status === "co_winner" ? 1 : 0;
    const scopeIndex = award.scope === "general" ? 0 : 1;
    subjectTotals.set(subject, (subjectTotals.get(subject) ?? 0) + 1);
    const key = `${appearance.year}|${subject}|${regionIndex}|${isWin}|${scopeIndex}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const subjects = [...subjectTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject]) => subject);
  const subjectIndex = new Map(subjects.map((subject, index) => [subject, index]));

  const rows = [...counts.entries()]
    .map(([key, count]) => {
      const [year, subject, regionIndex, isWin, scopeIndex] = key.split("|");
      return [Number(year), subjectIndex.get(subject) as number, Number(regionIndex), Number(isWin), Number(scopeIndex), count] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const rowYears = rows.map((row) => row[0]);
  return {
    subjects,
    rows,
    yearRange: [Math.min(...rowYears), Math.max(...rowYears)],
  };
}

function subjectDriftRegionIndex(geography: string | undefined) {
  const normalized = geography?.toLowerCase() ?? "";
  if (normalized.includes("united states") || normalized.includes("u.s.")) return 0;
  if (normalized.includes("united kingdom")) return 1;
  if (normalized.includes("canada")) return 2;
  return 3;
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
      imprintName: imprint.name,
      ...(imprint.shortName ? { imprintShortName: imprint.shortName } : {}),
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
