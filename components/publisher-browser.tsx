import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ImprintLogoMark } from "@/components/imprint-logo-mark";
import type { AwardRegionFilter } from "@/lib/award-region";
import { regionLabel } from "@/lib/award-region";
import { imprintSlug, imprintsForPublisher, imprintStats, publisherSlug, publisherStats } from "@/lib/catalog";
import { data } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";

type SortKey = "major_activity" | "all_activity" | "name" | "imprints";
type AnalysisView = "publishers" | "imprints";
type TimeWindow = "recent" | "all";

const RECENT_YEARS = 30;

export function PublisherBrowser({
  analysisView = "imprints",
  letter = null,
  region,
  sortKey = "major_activity",
  timeWindow = "recent",
}: {
  analysisView?: AnalysisView;
  letter?: string | null;
  region: AwardRegionFilter;
  sortKey?: SortKey;
  timeWindow?: TimeWindow;
}) {
  const sinceYear = timeWindow === "recent" ? new Date().getFullYear() - RECENT_YEARS : undefined;
  const queryState = { analysisView, letter, region, sortKey, timeWindow };
  const allRows = data.publishers
    .map((publisher) => ({
      publisher,
      stats: publisherStats(publisher.id, sinceYear, region),
      imprints: imprintsForPublisher(publisher.id),
    }))
    .filter((row) => row.stats.books > 0);
  const publishersById = new Map(data.publishers.map((publisher) => [publisher.id, publisher]));
  const publisherRows = allRows
    .filter((row) => matchesLetter(row.publisher.name, letter))
    .sort((a, b) => comparePublisherRows(a, b, sortKey));
  const imprintRows = data.imprints
    .map((imprint) => ({
      imprint,
      publisher: imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined,
      stats: imprintStats(imprint.id, sinceYear, region),
    }))
    .filter((row) => row.stats.books > 0)
    .filter((row) => matchesLetter(row.imprint.shortName ?? row.imprint.name, letter))
    .sort((a, b) => compareImprintRows(a, b, sortKey));

  const totalAppearances = data.appearances.length;
  const years = data.appearances.map((appearance) => appearance.year);
  const topPublishers = [...allRows].sort((a, b) => b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name)).slice(0, 5);
  const topImprints = [...data.imprints].sort((a, b) => imprintStats(b.id, sinceYear, region).majorAppearances - imprintStats(a.id, sinceYear, region).majorAppearances || imprintStats(b.id, sinceYear, region).majorScore - imprintStats(a.id, sinceYear, region).majorScore || imprintStats(b.id, sinceYear, region).score - imprintStats(a.id, sinceYear, region).score || a.name.localeCompare(b.name)).slice(0, 5);
  const topPublisherRows = topPublishers
    .map((row) => ({
      label: row.publisher.name,
      value: row.stats.majorAppearances,
      href: `/publishers/${publisherSlug(row.publisher)}`,
    }))
    .filter((row) => row.value > 0);
  const topImprintRows = topImprints
    .map((imprint) => ({
      label: imprint.name,
      value: imprintStats(imprint.id, sinceYear, region).majorAppearances,
      href: `/imprints/${imprintSlug(imprint)}`,
    }))
    .filter((row) => row.value > 0);

  return (
    <main>
      <section className="border-b hairline bg-[var(--paper)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:px-8">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publishers and imprints</p>
            <h1 className="mt-3 font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">Browse imprints by publisher.</h1>
            <p className="mt-4 max-w-2xl font-[var(--font-serif)] text-lg font-light leading-7 muted sm:mt-5 sm:text-xl sm:leading-8">
              Publishers are parent organizations. Imprints are publishing labels grouped beneath each publisher and ordered by award activity.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 muted">
              Historical labels and short-lived sub-imprints are consolidated under their clearest parent publisher where the source data supports it.
            </p>
          </div>
          <div className="grid grid-cols-2 border-l hairline sm:grid-cols-4">
            <HeroMetric value={allRows.length} label="Publishers" />
            <HeroMetric value={data.imprints.length} label="Imprints" />
            <HeroMetric value={totalAppearances.toLocaleString()} label="Appearances" />
            <HeroMetric value={`${Math.min(...years)}-${Math.max(...years)}`} label="Year range" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="filter-toolbar mb-4 grid gap-3 border-y hairline px-1 py-2 xl:grid-cols-[auto_auto_auto_minmax(18rem,1fr)_auto] xl:items-end">
          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Analyze by</span>
            <div className="segmented-control">
              {(["publishers", "imprints"] as const).map((view) => (
                <Link
                  className={`segment-button focus-ring min-w-28 capitalize ${analysisView === view ? "segment-button-active" : ""}`}
                  href={publisherBrowserHref(queryState, {
                    analysisView: view,
                    sortKey: view === "imprints" && sortKey === "imprints" ? "major_activity" : sortKey,
                  })}
                  key={view}
                >
                  {view}
                </Link>
              ))}
            </div>
          </div>

          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Awards</span>
            <div className="segmented-control">
              {(["us", "international", "all"] as const).map((item) => (
                <Link
                  className={`segment-button focus-ring min-w-24 ${region === item ? "segment-button-active" : ""}`}
                  href={publisherBrowserHref(queryState, { region: item })}
                  key={item}
                >
                  {regionLabel(item)}
                </Link>
              ))}
            </div>
          </div>

          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Period</span>
            <div className="segmented-control">
              <Link
                className={`segment-button focus-ring ${timeWindow === "recent" ? "segment-button-active" : ""}`}
                href={publisherBrowserHref(queryState, { timeWindow: "recent" })}
              >
                Last {RECENT_YEARS} yrs
              </Link>
              <Link
                className={`segment-button focus-ring ${timeWindow === "all" ? "segment-button-active" : ""}`}
                href={publisherBrowserHref(queryState, { timeWindow: "all" })}
              >
                All time
              </Link>
            </div>
          </div>

          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Sort</span>
            <div className="flex flex-wrap gap-1.5">
              {sortOptions(analysisView).map((option) => (
                <Link
                  className={`filter-chip focus-ring px-3 py-1.5 ${sortKey === option.value ? "segment-button-active" : ""}`}
                  href={publisherBrowserHref(queryState, { sortKey: option.value })}
                  key={option.value}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>

          <Link className="filter-action focus-ring inline-flex items-center justify-center gap-2 px-4 text-sm" href="/imprints">
            All imprints
            <ChevronRight size={15} />
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div>
          <div className="paper-surface overflow-hidden border hairline">
            {analysisView === "publishers" ? (
              publisherRows.length ? publisherRows.map(({ publisher, stats, imprints }, index) => (
                <div className="paper-surface grid gap-4 border-b hairline p-4 last:border-b-0 lg:grid-cols-[18rem_1fr]" key={publisher.id}>
                  <Link className="group" href={`/publishers/${publisherSlug(publisher)}`}>
                    <p className="font-[var(--font-mono)] text-xs plain-number muted">{String(index + 1).padStart(2, "0")}</p>
                    <h2 className="mt-2 font-[var(--font-serif)] text-2xl font-light group-hover:text-[var(--accent)]">{publisher.name}</h2>
                    <p className="mt-2 font-[var(--font-mono)] text-xs muted">
                      {stats.imprints} imprints / {stats.majorAppearances} major / {stats.appearances} total
                    </p>
                  </Link>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {imprints.slice(0, 6).map((imprint) => {
                      const itemStats = imprintStats(imprint.id, sinceYear, region);
                      return (
                        <Link className="group grid grid-cols-[1fr_auto] items-center gap-3 border hairline px-4 py-3 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
                          <span>
                            <span className="block text-sm font-medium">{imprint.shortName ?? imprint.name}</span>
                            <span className="mt-1 block font-[var(--font-mono)] text-xs muted">{itemStats.majorAppearances} major / {itemStats.appearances} total</span>
                          </span>
                          <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )) : (
                <PublisherEmptyState view="publishers" />
              )
            ) : (
              imprintRows.length ? imprintRows.map(({ imprint, publisher, stats }, index) => (
                <Link
                  className="group paper-surface grid gap-4 border-b hairline p-4 transition last:border-b-0 hover:bg-[var(--accent-soft)] sm:grid-cols-[4rem_1.25fr_12rem_9rem]"
                  href={`/imprints/${imprintSlug(imprint)}`}
                  key={imprint.id}
                >
                  <p className="font-[var(--font-mono)] text-xs plain-number muted">{String(index + 1).padStart(2, "0")}</p>
                  <span className="flex min-w-0 items-center gap-4">
                    <ImprintLogoMark logoPath={getImprintLogo(imprint.id)?.logoPath} name={imprint.name} />
                    <span className="min-w-0">
                      <span className="block font-[var(--font-serif)] text-2xl font-light group-hover:text-[var(--accent)]">{imprint.shortName ?? imprint.name}</span>
                      <span className="mt-2 block text-sm muted">
                        {imprint.shortName ? `${imprint.name} / ${publisher?.name ?? "Parent not yet sourced"}` : publisher?.name ?? "Parent not yet sourced"}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm">
                    <span className="block font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Parent</span>
                    <span className="mt-1 block">{publisher?.name ?? "Not yet sourced"}</span>
                  </span>
                  <span className="grid content-start gap-1 font-[var(--font-mono)] text-xs muted">
                    <span><span className="plain-number text-[var(--ink)]">{stats.books}</span> books</span>
                    <span><span className="plain-number text-[var(--ink)]">{stats.majorAppearances}</span> major appearances</span>
                    <span><span className="plain-number text-[var(--ink)]">{stats.appearances}</span> appearances</span>
                  </span>
                </Link>
              )) : (
                <PublisherEmptyState view="imprints" />
              )
            )}
          </div>
          </div>

          <aside className="grid content-start gap-4">
          <RankingPanel title="Top publishers by major awards" href="/publishers" rows={topPublisherRows} />
          <RankingPanel title="Top imprints by major awards" href="/imprints" rows={topImprintRows} />
          <div className="paper-surface border hairline p-5">
            <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Browse by letter</h2>
            <div className="mt-4 grid grid-cols-9 gap-2 font-[var(--font-mono)] text-xs">
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((item) => (
                <Link
                  className={`filter-chip focus-ring grid h-8 place-items-center ${letter === item ? "segment-button-active" : ""}`}
                  href={publisherBrowserHref(queryState, { letter: letter === item ? null : item })}
                  key={item}
                >
                  {item}
                </Link>
              ))}
            </div>
          </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function PublisherEmptyState({ view }: { view: AnalysisView }) {
  return (
    <div className="px-4 py-14 text-center sm:px-6">
      <p className="text-lg">No {view} match the current filters.</p>
      <p className="mt-2 text-sm muted">Try another letter, award region, or period.</p>
      <Link className="filter-action focus-ring mt-5 inline-flex items-center gap-2 px-4 py-3 text-sm" href="/publishers">
        Reset publisher view
      </Link>
    </div>
  );
}

function HeroMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-r border-b hairline px-3 py-5 text-center even:border-r-0 sm:border-b-0 sm:px-4 sm:py-6 sm:even:border-r sm:last:border-r-0">
      <p className="plain-number text-xl sm:text-2xl">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">{label}</p>
    </div>
  );
}

function RankingPanel({ title, rows, href }: { title: string; href: string; rows: { label: string; value: number; href: string }[] }) {
  return (
    <div className="paper-surface border hairline p-5">
      <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">{title}</h2>
      {rows.length ? (
        <div className="mt-4 grid gap-2">
          {rows.map((row, index) => (
            <Link className="grid grid-cols-[auto_1fr_auto] gap-3 text-sm transition hover:text-[var(--accent)]" href={row.href} key={row.href}>
              <span className="plain-number muted">{index + 1}</span>
              <span>{row.label}</span>
              <span className="plain-number">{row.value}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm muted">No major-award activity for this view.</p>
      )}
      <Link className="mt-4 inline-flex items-center gap-2 text-sm transition hover:text-[var(--accent)]" href={href}>
        View full list
        <ChevronRight size={15} />
      </Link>
    </div>
  );
}

function publisherBrowserHref(
  current: { analysisView: AnalysisView; letter: string | null; region: AwardRegionFilter; sortKey: SortKey; timeWindow: TimeWindow },
  updates: Partial<{ analysisView: AnalysisView; letter: string | null; region: AwardRegionFilter; sortKey: SortKey; timeWindow: TimeWindow }>,
) {
  const next = { ...current, ...updates };
  const params = new URLSearchParams();
  if (next.analysisView !== "imprints") params.set("view", next.analysisView);
  if (next.region !== "all") params.set("awards", next.region);
  if (next.timeWindow !== "recent") params.set("period", next.timeWindow);
  if (next.sortKey !== "major_activity") params.set("sort", next.sortKey);
  if (next.letter) params.set("letter", next.letter);
  const query = params.toString();
  return query ? `/publishers?${query}` : "/publishers";
}

function sortOptions(analysisView: AnalysisView): Array<{ value: SortKey; label: string }> {
  return [
    { value: "major_activity", label: "Major awards" },
    { value: "all_activity", label: "All awards" },
    { value: "name", label: analysisView === "publishers" ? "Publisher A-Z" : "Imprint A-Z" },
    ...(analysisView === "publishers" ? [{ value: "imprints" as const, label: "Most imprints" }] : []),
  ];
}

function matchesLetter(name: string, letter: string | null) {
  if (!letter) return true;
  const first = name[0]?.toUpperCase() ?? "#";
  return letter === "#" ? !/[A-Z]/.test(first) : first === letter;
}

function comparePublisherRows(
  a: { publisher: { name: string }; stats: ReturnType<typeof publisherStats> },
  b: { publisher: { name: string }; stats: ReturnType<typeof publisherStats> },
  sortKey: SortKey,
) {
  if (sortKey === "name") return a.publisher.name.localeCompare(b.publisher.name);
  if (sortKey === "imprints") return b.stats.imprints - a.stats.imprints || a.publisher.name.localeCompare(b.publisher.name);
  if (sortKey === "all_activity") return b.stats.score - a.stats.score || b.stats.majorScore - a.stats.majorScore || a.publisher.name.localeCompare(b.publisher.name);
  return b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name);
}

function compareImprintRows(
  a: { imprint: { name: string; shortName?: string }; stats: ReturnType<typeof imprintStats> },
  b: { imprint: { name: string; shortName?: string }; stats: ReturnType<typeof imprintStats> },
  sortKey: SortKey,
) {
  const aName = a.imprint.shortName ?? a.imprint.name;
  const bName = b.imprint.shortName ?? b.imprint.name;
  if (sortKey === "name") return aName.localeCompare(bName);
  if (sortKey === "all_activity") return b.stats.score - a.stats.score || b.stats.majorScore - a.stats.majorScore || aName.localeCompare(bName);
  return b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || aName.localeCompare(bName);
}
