"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ImprintLogoMark } from "@/components/imprint-logo-mark";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import { imprintSlug, imprintsForPublisher, imprintStats, publisherSlug, publisherStats } from "@/lib/catalog";
import { data } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";

type SortKey = "major_activity" | "all_activity" | "name" | "imprints";
type AnalysisView = "publishers" | "imprints";
type TimeWindow = "recent" | "all";

const RECENT_YEARS = 30;

export function PublisherBrowser({ defaultRegion }: { defaultRegion: AwardRegionFilter }) {
  const [sortKey, setSortKey] = useState<SortKey>("major_activity");
  const [letter, setLetter] = useState<string | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("imprints");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("recent");
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);

  const sinceYear = timeWindow === "recent" ? new Date().getFullYear() - RECENT_YEARS : undefined;

  function setRegion(nextRegion: AwardRegionFilter) {
    setRegionState(nextRegion);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextRegion}; path=/; max-age=31536000; samesite=lax`;
  }

  const allRows = useMemo(
    () =>
      data.publishers
        .map((publisher) => ({
          publisher,
          stats: publisherStats(publisher.id, sinceYear, region),
          imprints: imprintsForPublisher(publisher.id),
        }))
        .filter((row) => row.stats.books > 0),
    [region, sinceYear],
  );
  const publishersById = useMemo(() => new Map(data.publishers.map((publisher) => [publisher.id, publisher])), []);

  const publisherRows = useMemo(() => {
    return allRows
      .filter((row) => {
        const first = row.publisher.name[0]?.toUpperCase() ?? "#";
        return !letter || (letter === "#" ? !/[A-Z]/.test(first) : first === letter);
      })
      .sort((a, b) => {
        if (sortKey === "name") return a.publisher.name.localeCompare(b.publisher.name);
        if (sortKey === "imprints") return b.stats.imprints - a.stats.imprints || a.publisher.name.localeCompare(b.publisher.name);
        if (sortKey === "all_activity") return b.stats.score - a.stats.score || b.stats.majorScore - a.stats.majorScore || a.publisher.name.localeCompare(b.publisher.name);
        return b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name);
      });
  }, [allRows, letter, sortKey]);

  const imprintRows = useMemo(() => {
    return data.imprints
      .map((imprint) => ({
        imprint,
        publisher: imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined,
        stats: imprintStats(imprint.id, sinceYear, region),
      }))
      .filter((row) => row.stats.books > 0)
      .filter((row) => {
        const first = (row.imprint.shortName ?? row.imprint.name)[0]?.toUpperCase() ?? "#";
        return !letter || (letter === "#" ? !/[A-Z]/.test(first) : first === letter);
      })
      .sort((a, b) => {
        if (sortKey === "name") return (a.imprint.shortName ?? a.imprint.name).localeCompare(b.imprint.shortName ?? b.imprint.name);
        if (sortKey === "all_activity") return b.stats.score - a.stats.score || b.stats.majorScore - a.stats.majorScore || (a.imprint.shortName ?? a.imprint.name).localeCompare(b.imprint.shortName ?? b.imprint.name);
        return b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || (a.imprint.shortName ?? a.imprint.name).localeCompare(b.imprint.shortName ?? b.imprint.name);
      });
  }, [letter, publishersById, region, sinceYear, sortKey]);

  const totalAppearances = data.appearances.length;
  const years = data.appearances.map((appearance) => appearance.year);
  const topPublishers = [...allRows].sort((a, b) => b.stats.majorAppearances - a.stats.majorAppearances || b.stats.majorScore - a.stats.majorScore || b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name)).slice(0, 5);
  const topImprints = [...data.imprints].sort((a, b) => imprintStats(b.id, sinceYear, region).majorAppearances - imprintStats(a.id, sinceYear, region).majorAppearances || imprintStats(b.id, sinceYear, region).majorScore - imprintStats(a.id, sinceYear, region).majorScore || imprintStats(b.id, sinceYear, region).score - imprintStats(a.id, sinceYear, region).score || a.name.localeCompare(b.name)).slice(0, 5);

  return (
    <main>
      <section className="border-b hairline bg-[var(--paper)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:px-8">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publishers and imprints</p>
            <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Browse imprints by publisher.</h1>
            <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
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
                <button
                  className={`segment-button focus-ring min-w-28 capitalize ${analysisView === view ? "segment-button-active" : ""}`}
                  key={view}
                  onClick={() => {
                    setAnalysisView(view);
                    if (view === "imprints" && sortKey === "imprints") setSortKey("major_activity");
                  }}
                  type="button"
                >
                  {view}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Awards</span>
            <div className="segmented-control">
              {(["us", "international", "all"] as const).map((item) => (
                <button
                  className={`segment-button focus-ring min-w-24 ${region === item ? "segment-button-active" : ""}`}
                  key={item}
                  onClick={() => setRegion(item)}
                  type="button"
                >
                  {regionLabel(item)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Period</span>
            <div className="segmented-control">
              <button
                className={`segment-button focus-ring ${timeWindow === "recent" ? "segment-button-active" : ""}`}
                onClick={() => setTimeWindow("recent")}
                type="button"
              >
                Last {RECENT_YEARS} yrs
              </button>
              <button
                className={`segment-button focus-ring ${timeWindow === "all" ? "segment-button-active" : ""}`}
                onClick={() => setTimeWindow("all")}
                type="button"
              >
                All time
              </button>
            </div>
          </div>

          <label className="filter-group flex-col items-start gap-2">
            <span className="filter-label">Sort</span>
            <select className="filter-select focus-ring min-w-0 flex-1 xl:min-w-[16rem]" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="major_activity">Most-awarded (major awards)</option>
              <option value="all_activity">Most-awarded (all awards)</option>
              <option value="name">{analysisView === "publishers" ? "Publisher A-Z" : "Imprint A-Z"}</option>
              {analysisView === "publishers" ? <option value="imprints">Most imprints</option> : null}
            </select>
          </label>

          <Link className="filter-action focus-ring inline-flex items-center justify-center gap-2 px-4 text-sm" href="/imprints">
            All imprints
            <ChevronRight size={15} />
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div>
          <div className="paper-surface overflow-hidden border hairline">
            {analysisView === "publishers" ? (
              publisherRows.map(({ publisher, stats, imprints }, index) => (
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
              ))
            ) : (
              imprintRows.map(({ imprint, publisher, stats }, index) => (
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
              ))
            )}
          </div>
          </div>

          <aside className="grid content-start gap-4">
          <RankingPanel title="Top publishers by major awards" href="/publishers" rows={topPublishers.map((row) => ({
            label: row.publisher.name,
            value: row.stats.majorAppearances,
            href: `/publishers/${publisherSlug(row.publisher)}`,
          }))} />
          <RankingPanel title="Top imprints by major awards" href="/imprints" rows={topImprints.map((imprint) => ({
            label: imprint.name,
            value: imprintStats(imprint.id, sinceYear, region).majorAppearances,
            href: `/imprints/${imprintSlug(imprint)}`,
          }))} />
          <div className="paper-surface border hairline p-5">
            <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Browse by letter</h2>
            <div className="mt-4 grid grid-cols-9 gap-2 font-[var(--font-mono)] text-xs">
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((item) => (
                <button
                  className={`filter-chip focus-ring grid h-8 place-items-center ${letter === item ? "segment-button-active" : ""}`}
                  key={item}
                  onClick={() => setLetter((current) => (current === item ? null : item))}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          </aside>
        </div>
      </section>
    </main>
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
      <div className="mt-4 grid gap-2">
        {rows.map((row, index) => (
          <Link className="grid grid-cols-[auto_1fr_auto] gap-3 text-sm transition hover:text-[var(--accent)]" href={row.href} key={row.href}>
            <span className="plain-number muted">{index + 1}</span>
            <span>{row.label}</span>
            <span className="plain-number">{row.value}</span>
          </Link>
        ))}
      </div>
      <Link className="mt-4 inline-flex items-center gap-2 text-sm transition hover:text-[var(--accent)]" href={href}>
        View full list
        <ChevronRight size={15} />
      </Link>
    </div>
  );
}
