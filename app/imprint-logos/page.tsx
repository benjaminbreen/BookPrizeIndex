import Link from "next/link";
import { ImprintLogoMark } from "@/components/imprint-logo-mark";
import { imprintSlug, imprintStats } from "@/lib/catalog";
import { imprintsById, publishersById } from "@/lib/data";
import { imprintLogoManifest } from "@/lib/imprint-logos";

export const metadata = {
  title: "Imprint logo QA / The Book Prize Index",
};

export default function ImprintLogoQaPage() {
  const downloaded = imprintLogoManifest.filter((entry) => entry.status === "downloaded" && entry.logoPath);
  const missing = imprintLogoManifest.filter((entry) => entry.status !== "downloaded" || !entry.logoPath);
  const downloadedRows = downloaded
    .map((entry) => {
      const imprint = imprintsById.get(entry.imprintId);
      return {
        entry,
        imprint,
        publisher: imprint?.publisherId ? publishersById.get(imprint.publisherId) : undefined,
        stats: imprint ? imprintStats(imprint.id) : { books: 0, appearances: 0, score: 0, wins: 0 },
      };
    })
    .sort((a, b) => b.stats.score - a.stats.score || a.entry.imprintName.localeCompare(b.entry.imprintName));
  const missingRows = missing
    .map((entry) => {
      const imprint = imprintsById.get(entry.imprintId);
      return {
        entry,
        imprint,
        publisher: imprint?.publisherId ? publishersById.get(imprint.publisherId) : undefined,
        stats: imprint ? imprintStats(imprint.id) : { books: 0, appearances: 0, score: 0, wins: 0 },
      };
    })
    .sort((a, b) => b.stats.score - a.stats.score || a.entry.imprintName.localeCompare(b.entry.imprintName));
  const failedCount = imprintLogoManifest.filter((entry) => entry.status === "failed").length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_30rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Imprint logos</p>
          <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Logo QA.</h1>
          <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
            Review downloaded imprint marks at their production scale and prioritize the remaining gaps by award activity.
          </p>
        </div>
        <div className="grid grid-cols-3 border hairline panel">
          <HeroMetric value={downloaded.length} label="Downloaded" />
          <HeroMetric value={missing.length} label="Missing" />
          <HeroMetric value={failedCount} label="Failed" />
        </div>
      </div>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4 border-b hairline pb-3">
          <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Downloaded marks</h2>
          <p className="font-[var(--font-mono)] text-xs muted">{downloaded.length} logos</p>
        </div>
        <div className="mt-4 grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
          {downloadedRows.map(({ entry, imprint, publisher, stats }) => {
            const href = imprint ? `/imprints/${imprintSlug(imprint)}` : undefined;
            const body = (
              <>
                <div className="grid h-28 place-items-center">
                  <ImprintLogoMark
                    className="h-24 w-32"
                    imageClassName="h-full w-full object-contain grayscale"
                    logoPath={entry.logoPath}
                    name={entry.imprintName}
                  />
                </div>
                <p className="mt-5 truncate font-medium">{entry.imprintName}</p>
                <p className="mt-2 truncate text-sm muted">{publisher?.name ?? "Parent not yet sourced"}</p>
                <p className="mt-4 font-[var(--font-mono)] text-xs muted">
                  {stats.books} books / {stats.appearances} appearances
                </p>
                {entry.sourceTitle ? <p className="mt-2 truncate font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em] muted">{entry.sourceTitle}</p> : null}
              </>
            );

            return href ? (
              <Link className="bg-[var(--paper)] p-4 transition hover:bg-[var(--accent-soft)]" href={href} key={entry.imprintId}>
                {body}
              </Link>
            ) : (
              <div className="bg-[var(--paper)] p-4" key={entry.imprintId}>
                {body}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-end justify-between gap-4 border-b hairline pb-3">
          <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Missing or failed</h2>
          <p className="font-[var(--font-mono)] text-xs muted">{missing.length} imprints</p>
        </div>
        <div className="mt-4 overflow-hidden border hairline">
          {missingRows.map(({ entry, imprint, publisher, stats }) => {
            return (
              <div className="grid gap-3 border-b hairline p-4 last:border-b-0 sm:grid-cols-[1fr_12rem_8rem_7rem]" key={entry.imprintId}>
                <div>
                  {imprint ? (
                    <Link className="font-medium transition hover:text-[var(--accent)]" href={`/imprints/${imprintSlug(imprint)}`}>
                      {entry.imprintName}
                    </Link>
                  ) : (
                    <p className="font-medium">{entry.imprintName}</p>
                  )}
                  <p className="mt-1 text-sm muted">{publisher?.name ?? "Parent not yet sourced"}</p>
                </div>
                <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] muted">{entry.status}</p>
                <p className="font-[var(--font-mono)] text-xs muted">{stats.books} books</p>
                <p className="font-[var(--font-mono)] text-xs muted">{stats.appearances} appearances</p>
                {entry.error ? <p className="text-sm muted sm:col-span-4">{entry.error}</p> : null}
              </div>
            );
          })}
        </div>
      </section>
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
