import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AwardBookList } from "@/components/award-book-list";
import { appearancesByAwardId, awardProgramsBySlug, awardsBySlug, booksById, data, getBookStats, imprintsById, publishersById } from "@/lib/data";

export function generateStaticParams() {
  return [...data.awards.map((award) => ({ slug: award.slug })), ...(data.awardPrograms ?? []).map((program) => ({ slug: program.slug }))];
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const award = awardsBySlug.get(slug);
  const program = awardProgramsBySlug.get(slug);
  return { title: program && shouldRenderProgram(program) ? `${program.name} / The Book Prize Index` : award ? `${award.name} / The Book Prize Index` : "Award / The Book Prize Index" };
}

export default async function AwardPage({ params }: PageProps) {
  const { slug } = await params;
  const award = awardsBySlug.get(slug);
  const program = awardProgramsBySlug.get(slug);
  if (program && shouldRenderProgram(program)) return <AwardProgramPage program={program} />;
  if (!award) notFound();

  const appearances = [...(appearancesByAwardId.get(award.id) ?? [])].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank);
  const bookIds = new Set(appearances.map((appearance) => appearance.bookId));
  const books = [...bookIds].map((id) => booksById.get(id)).filter(Boolean);
  const years = appearances.map((appearance) => appearance.year);
  const yearRange = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown";
  const winners = appearances.filter((appearance) => appearance.status === "winner" || appearance.status === "co_winner").length;
  const finalists = appearances.filter((appearance) => appearance.status === "finalist").length;
  const shortlisted = appearances.filter((appearance) => appearance.status === "shortlist").length;
  const longlisted = appearances.filter((appearance) => appearance.status === "longlist").length;
  const sourcedRecords = appearances.filter((appearance) => appearance.sourceUrl || appearance.sourceIds.length).length;
  const sourceCoverage = appearances.length ? `${Math.round((sourcedRecords / appearances.length) * 100)}%` : "Unknown";
  const topImprints = topCounts(
    books.map((book) => {
      const imprint = book?.imprintId ? imprintsById.get(book.imprintId) : undefined;
      return imprint?.shortName ?? imprint?.name ?? "";
    }),
  );
  const topPublishers = topCounts(
    books.map((book) => (book?.publisherId ? publishersById.get(book.publisherId)?.name ?? "" : "")),
  );

  return (
    <main>
      <section className="paper-surface border-b hairline">
        <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-6 px-4 py-7 sm:px-6 lg:grid-cols-[24rem_1fr] lg:px-8">
          <aside className="paper-surface border-r-0 hairline lg:border-r lg:pr-9">
            <AwardMark
              name={award.shortName ?? award.name}
              logoAlt={award.logoAlt}
              logoUrl={award.logoUrl}
            />
            <dl className="mt-4 grid text-[0.78rem]">
              <RailMeta label="Organization" value={award.organization ?? "Not yet sourced"} />
              <RailMeta label="Region" value={formatAwardGeography(award.geography)} />
              <RailMeta label="Type" value={award.awardType === "award" ? "Award" : "Major award"} />
              <RailMeta label="Subject" value={award.subjectAreas.join(", ")} />
              <RailMeta label="Records" value={String(appearances.length)} />
              <RailMeta label="Year range" value={yearRange} />
            </dl>
          </aside>

          <section className="paper-surface">
            <div className="grid gap-x-10 gap-y-7 lg:grid-cols-[1fr_18rem] xl:grid-cols-[1fr_20rem]">
              <h1 className="font-[var(--font-serif)] text-4xl font-light leading-[1.06] sm:text-[4rem] lg:col-span-2 xl:max-w-5xl">
                {award.name}
              </h1>
              <div>
                <p className="mt-3 max-w-3xl text-lg leading-8 muted">
                  {award.description ??
                    `A sourced archive of ${award.name} records currently imported into The Book Prize Index, including winners and all available finalist, shortlist, and longlist entries.`}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {award.subjectAreas.map((subject) => (
                    <span className="border hairline px-4 py-2 text-sm" key={subject}>{subject}</span>
                  ))}
                  <span className="border hairline px-4 py-2 text-sm">
                    {award.awardType === "award" ? "Award" : "Major award"}
                  </span>
                </div>
              </div>

              <dl className="paper-surface self-start text-sm">
                <StatLine label="Winners" value={String(winners)} />
                <StatLine label="Finalists" value={String(finalists)} />
                <StatLine label="Shortlisted" value={String(shortlisted)} />
                <StatLine label="Longlisted" value={String(longlisted)} />
                <StatLine label="First year" value={String(years.length ? Math.min(...years) : "Unknown")} />
                <StatLine label="Latest year" value={String(years.length ? Math.max(...years) : "Unknown")} />
                <StatLine label="Books" value={String(bookIds.size)} />
              </dl>
            </div>
          </section>

          <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)] lg:col-span-2 lg:grid-cols-[1fr_1fr_2fr]">
            <AdminMeta label="Deadline" numberValue value={award.deadline ?? "Not yet sourced"} />
            <AdminMeta label="Prize amount" numberValue value={award.prizeAmount ?? "Not yet sourced"} />
            <AdminMeta label="Criteria" value={award.criteria ?? "Not yet sourced"} />
          </div>
          <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)] lg:col-span-2 md:grid-cols-4">
            <AdminMeta label="Source coverage" numberValue value={sourceCoverage} />
            <AdminMeta label="Sourced records" numberValue value={`${sourcedRecords} of ${appearances.length}`} />
            <AdminMeta label="Official site" value={award.links.official ?? "Not yet sourced"} />
            <AdminMeta label="Submission info" value={award.links.submission ?? award.links.criteria ?? "Not yet sourced"} />
          </div>
        </div>
      </section>

      <section>
        <div className="paper-surface mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1fr_20rem] xl:grid-cols-[1fr_22rem] lg:px-8">
          <div className="paper-surface py-8 lg:pr-10">
            <h2 className="font-[var(--font-serif)] text-2xl font-light">Prize history</h2>
            <Suspense>
              <AwardBookList appearances={appearances} />
            </Suspense>
          </div>

          <aside className="paper-surface border-t hairline py-8 lg:border-l lg:border-t-0 lg:pl-8">
            <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)]">
              <MiniPanel title="Top imprints" rows={topImprints} href="/imprints" footer="View all imprints" />
              <MiniPanel title="Top publishers" rows={topPublishers} href="/publishers" footer="View all publishers" />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function shouldRenderProgram(program?: NonNullable<typeof data.awardPrograms>[number]) {
  if (!program) return false;
  return data.awards.filter((award) => award.programId === program.id).length > 1;
}

function AwardProgramPage({ program }: { program: NonNullable<typeof data.awardPrograms>[number] }) {
  const categoryRows = data.awards
    .filter((award) => award.programId === program.id)
    .map((award) => {
      const awardAppearances = appearancesByAwardId.get(award.id) ?? [];
      const years = awardAppearances.map((appearance) => appearance.year);
      return {
        award,
        records: awardAppearances.length,
        books: new Set(awardAppearances.map((appearance) => appearance.bookId)).size,
        years,
        yearRange: award.categoryYears ?? (years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown"),
      };
    })
    .sort((a, b) => b.records - a.records || a.award.name.localeCompare(b.award.name));
  const awardIds = new Set(categoryRows.map((row) => row.award.id));
  const appearances = [...awardIds].flatMap((awardId) => appearancesByAwardId.get(awardId) ?? []);
  const years = appearances.map((appearance) => appearance.year);
  const bookIds = new Set(appearances.map((appearance) => appearance.bookId));
  const sourcedRecords = appearances.filter((appearance) => appearance.sourceUrl || appearance.sourceIds.length).length;
  const sourceCoverage = appearances.length ? `${Math.round((sourcedRecords / appearances.length) * 100)}%` : "Unknown";
  const subjects = [...new Set(categoryRows.flatMap((row) => row.award.subjectAreas))].sort((a, b) => a.localeCompare(b));
  const activeCategories = categoryRows.filter((row) => /present/i.test(row.yearRange)).length;
  const historicalCategories = Math.max(categoryRows.length - activeCategories, 0);
  const topImprints = topCounts(
    [...bookIds].map((bookId) => {
      const book = booksById.get(bookId);
      const imprint = book?.imprintId ? imprintsById.get(book.imprintId) : undefined;
      return imprint?.shortName ?? imprint?.name ?? "";
    }),
  );
  const topPublishers = topCounts(
    [...bookIds].map((bookId) => {
      const book = booksById.get(bookId);
      return book?.publisherId ? publishersById.get(book.publisherId)?.name ?? "" : "";
    }),
  );

  return (
    <main>
      <section className="paper-surface border-b hairline">
        <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-6 px-4 py-7 sm:px-6 lg:grid-cols-[24rem_1fr] lg:px-8">
          <aside className="paper-surface border-r-0 hairline lg:border-r lg:pr-9">
            <AwardMark name={program.name} />
            <dl className="mt-4 grid text-[0.78rem]">
              <RailMeta label="Organization" value={program.organization ?? "Not yet sourced"} />
              <RailMeta label="Region" value={formatAwardGeography(program.geography)} />
              <RailMeta label="Categories" value={String(categoryRows.length)} />
              <RailMeta label="Records" value={String(appearances.length)} />
              <RailMeta label="Year range" value={years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown"} />
            </dl>
          </aside>

          <section className="paper-surface">
            <div className="grid gap-x-10 gap-y-7 lg:grid-cols-[1fr_18rem] xl:grid-cols-[1fr_20rem]">
              <h1 className="font-[var(--font-serif)] text-4xl font-light leading-[1.06] sm:text-[4rem] lg:col-span-2 xl:max-w-5xl">
                {program.name}
              </h1>
              <div>
                <p className="mt-3 max-w-3xl text-lg leading-8 muted">
                  {program.description ?? `A program-level overview of ${program.name} categories currently represented in The Book Prize Index.`}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {subjects.map((subject) => (
                    <span className="border hairline px-4 py-2 text-sm" key={subject}>{subject}</span>
                  ))}
                  <span className="border hairline px-4 py-2 text-sm">Award program</span>
                </div>
              </div>

              <dl className="paper-surface self-start text-sm">
                <StatLine label="Categories" value={String(categoryRows.length)} />
                <StatLine label="Active" value={String(activeCategories)} />
                <StatLine label="Historical" value={String(historicalCategories)} />
                <StatLine label="Records" value={String(appearances.length)} />
                <StatLine label="Books" value={String(bookIds.size)} />
                <StatLine label="First year" value={String(years.length ? Math.min(...years) : "Unknown")} />
                <StatLine label="Latest year" value={String(years.length ? Math.max(...years) : "Unknown")} />
              </dl>
            </div>
          </section>

          <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)] lg:col-span-2 lg:grid-cols-[1fr_1fr_2fr]">
            <AdminMeta label="Official site" value={program.officialUrl ?? "Not yet sourced"} />
            <AdminMeta label="Coverage" numberValue value={`${categoryRows.length} categories represented`} />
            <AdminMeta label="Notes" value={program.notes ?? "Category coverage is based on imported source-backed award records."} />
          </div>
          <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)] lg:col-span-2 md:grid-cols-3">
            <AdminMeta label="Source coverage" numberValue value={sourceCoverage} />
            <AdminMeta label="Sourced records" numberValue value={`${sourcedRecords} of ${appearances.length}`} />
            <AdminMeta label="Active categories" numberValue value={`${activeCategories} active / ${historicalCategories} historical`} />
          </div>
        </div>
      </section>

      <section>
        <div className="paper-surface mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1fr_20rem] xl:grid-cols-[1fr_22rem] lg:px-8">
          <div className="paper-surface py-8 lg:pr-10">
            <h2 className="font-[var(--font-serif)] text-2xl font-light">Categories</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.12em] muted">
                  <tr className="border-b hairline">
                    <th className="py-2 pr-4 font-normal">Category</th>
                    <th className="px-4 py-2 font-normal">Years</th>
                    <th className="px-4 py-2 font-normal">Subject</th>
                    <th className="px-4 py-2 text-right font-normal">Records</th>
                    <th className="w-12 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map(({ award, records, yearRange }) => (
                    <tr className="book-table-row border-b hairline text-sm transition hover:bg-[var(--accent-soft)]" key={award.id}>
                      <td className="py-3 pr-4">
                        <Link className="transition hover:text-[var(--accent)]" href={`/awards/${award.slug}`}>
                          {award.categoryName ?? award.name}
                        </Link>
                      </td>
                      <td className="plain-number px-4 py-3 text-xs muted">{yearRange}</td>
                      <td className="px-4 py-3 muted">{award.subjectAreas.join(", ")}</td>
                      <td className="plain-number px-4 py-3 text-right">{records}</td>
                      <td className="px-4 py-3 text-right">
                        <Link aria-label={`View ${award.name}`} className="subjects-row-icon focus-ring ml-auto" href={`/awards/${award.slug}`}>
                          ›
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="paper-surface border-t hairline py-8 lg:border-l lg:border-t-0 lg:pl-8">
            <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)]">
              <MiniPanel title="Top imprints" rows={topImprints} href="/imprints" footer="View all imprints" />
              <MiniPanel title="Top publishers" rows={topPublishers} href="/publishers" footer="View all publishers" />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function AwardMark({ logoAlt, logoUrl, name }: { logoAlt?: string; logoUrl?: string; name: string }) {
  const words = name.split(/\s+/).slice(0, 5);
  return (
    <div className="mx-auto grid aspect-square w-full max-w-[12.5rem] place-items-center">
      <div className="grid h-full place-items-center text-center">
        {logoUrl ? (
          <div className="grid h-30 w-full place-items-center">
            <img
              alt={logoAlt ?? `${name} logo`}
              className="max-h-30 max-w-full object-contain"
              src={logoUrl}
            />
          </div>
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-full border hairline font-[var(--font-serif)] text-3xl font-light">
            {words[0]?.[0] ?? "P"}
          </div>
        )}
      </div>
    </div>
  );
}

function RailMeta({ label, value }: { label: string; value: string }) {
  const isMissing = value === "Not yet sourced" || value === "Unknown";
  return (
    <div className="grid grid-cols-[7.4rem_1fr] gap-4 border-b hairline py-2">
      <dt className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em] muted">{label}</dt>
      <dd className={`plain-number text-right leading-relaxed ${isMissing ? "book-missing-value" : ""}`}>{value}</dd>
    </div>
  );
}

function AdminMeta({ label, numberValue = false, value }: { label: string; numberValue?: boolean; value: string }) {
  const isMissing = value === "Not yet sourced" || value === "Unknown";
  const isUrl = /^https?:\/\//.test(value);
  return (
    <div className="paper-surface grid gap-2 p-3 sm:grid-cols-[8rem_1fr] lg:block lg:p-4">
      <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.16em] muted">{label}</p>
      {isUrl ? (
        <a className="book-detail-text-link mt-0 text-sm leading-5 lg:mt-2 lg:inline-block" href={value} rel="noreferrer" target="_blank">
          Open source
        </a>
      ) : (
        <p className={`${numberValue ? "plain-number " : ""}text-sm leading-5 lg:mt-2 ${isMissing ? "book-missing-value" : ""}`}>{value}</p>
      )}
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-5 border-b hairline py-2.5">
      <dt className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">{label}</dt>
      <dd className="plain-number text-right">{value}</dd>
    </div>
  );
}

function formatAwardGeography(geography?: string) {
  if (!geography) return "Unknown";
  const normalized = geography.toLowerCase();
  if (normalized === "us" || normalized === "usa" || normalized === "united states") return "US";
  if (normalized === "uk" || normalized === "united kingdom") return "UK";
  return geography;
}

function MiniPanel({ title, rows, footer, href }: { title: string; rows: { label: string; value: number }[]; footer: string; href: string }) {
  return (
    <div className="bg-[var(--paper)] p-5">
      <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">{title}</h3>
      <div className="mt-4 grid gap-2 text-sm">
        {rows.slice(0, 5).map((row) => (
          <div className="grid grid-cols-[1fr_auto] gap-4" key={row.label}>
            <span>{row.label}</span>
            <span className="plain-number text-xs">{row.value}</span>
          </div>
        ))}
      </div>
      <Link className="mt-5 block text-sm transition hover:text-[var(--accent)]" href={href}>{footer} ›</Link>
    </div>
  );
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 5);
}
