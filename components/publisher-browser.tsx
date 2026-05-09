"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { imprintSlug, imprintsForPublisher, imprintStats, publisherSlug, publisherStats } from "@/lib/catalog";
import { data } from "@/lib/data";

type SortKey = "activity" | "name" | "imprints";

export function PublisherBrowser() {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [letter, setLetter] = useState<string | null>(null);

  const allRows = useMemo(
    () =>
      data.publishers
        .map((publisher) => ({
          publisher,
          stats: publisherStats(publisher.id),
          imprints: imprintsForPublisher(publisher.id),
        }))
        .filter((row) => row.stats.books > 0),
    [],
  );

  const publisherRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows
      .filter((row) => {
        const haystack = `${row.publisher.name} ${row.imprints.map((imprint) => imprint.name).join(" ")}`.toLowerCase();
        const matchesQuery = !q || haystack.includes(q);
        const first = row.publisher.name[0]?.toUpperCase() ?? "#";
        const matchesLetter = !letter || (letter === "#" ? !/[A-Z]/.test(first) : first === letter);
        return matchesQuery && matchesLetter;
      })
      .sort((a, b) => {
        if (sortKey === "name") return a.publisher.name.localeCompare(b.publisher.name);
        if (sortKey === "imprints") return b.stats.imprints - a.stats.imprints || a.publisher.name.localeCompare(b.publisher.name);
        return b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name);
      });
  }, [allRows, letter, query, sortKey]);

  const totalAppearances = data.appearances.length;
  const years = data.appearances.map((appearance) => appearance.year);
  const topPublishers = [...allRows].sort((a, b) => b.stats.score - a.stats.score || a.publisher.name.localeCompare(b.publisher.name)).slice(0, 5);
  const topImprints = [...data.imprints].sort((a, b) => imprintStats(b.id).score - imprintStats(a.id).score || a.name.localeCompare(b.name)).slice(0, 5);

  return (
    <main>
      <section className="border-b hairline">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:px-8">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publishers and imprints</p>
            <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Browse imprints by publisher.</h1>
            <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
              Publishers are parent organizations. Imprints are publishing labels grouped beneath each publisher and ordered by award activity.
            </p>
          </div>
          <div className="grid grid-cols-4 border-l hairline">
            <HeroMetric value={allRows.length} label="Publishers" />
            <HeroMetric value={data.imprints.length} label="Imprints" />
            <HeroMetric value={totalAppearances.toLocaleString()} label="Appearances" />
            <HeroMetric value={`${Math.min(...years)}-${Math.max(...years)}`} label="Year range" />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_22rem] lg:px-8">
        <div>
          <div className="panel mb-4 grid gap-3 border hairline p-3 lg:grid-cols-[1fr_auto_auto]">
            <label className="flex items-center gap-3 border hairline px-4 py-3">
              <Search size={17} className="muted" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
                placeholder="Search publishers or imprints..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select className="border hairline bg-transparent px-4 py-3 text-sm" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="activity">Most-awarded first</option>
              <option value="name">Publisher A-Z</option>
              <option value="imprints">Most imprints</option>
            </select>
            <Link className="inline-flex items-center justify-center gap-2 border hairline px-4 py-3 text-sm transition hover:bg-[var(--accent-soft)]" href="/imprints">
              All imprints
              <ChevronRight size={15} />
            </Link>
          </div>

          <div className="overflow-hidden border hairline">
            {publisherRows.map(({ publisher, stats, imprints }, index) => (
              <div className="grid gap-4 border-b hairline p-4 last:border-b-0 lg:grid-cols-[18rem_1fr]" key={publisher.id}>
                <Link className="group" href={`/publishers/${publisherSlug(publisher)}`}>
                  <p className="font-[var(--font-mono)] text-xs plain-number muted">{String(index + 1).padStart(2, "0")}</p>
                  <h2 className="mt-2 font-[var(--font-serif)] text-2xl font-light group-hover:text-[var(--accent)]">{publisher.name}</h2>
                  <p className="mt-2 font-[var(--font-mono)] text-xs muted">
                    {stats.imprints} imprints / {stats.appearances} appearances
                  </p>
                </Link>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {imprints.slice(0, 6).map((imprint) => {
                    const itemStats = imprintStats(imprint.id);
                    return (
                      <Link className="group grid grid-cols-[1fr_auto] items-center gap-3 border hairline px-4 py-3 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
                        <span>
                          <span className="block text-sm font-medium">{imprint.shortName ?? imprint.name}</span>
                          <span className="mt-1 block font-[var(--font-mono)] text-xs muted">{itemStats.appearances} appearances</span>
                        </span>
                        <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <RankingPanel title="Top publishers by award activity" href="/publishers" rows={topPublishers.map((row) => ({
            label: row.publisher.name,
            value: row.stats.score,
            href: `/publishers/${publisherSlug(row.publisher)}`,
          }))} />
          <RankingPanel title="Top imprints overall" href="/imprints" rows={topImprints.map((imprint) => ({
            label: imprint.name,
            value: imprintStats(imprint.id).score,
            href: `/imprints/${imprintSlug(imprint)}`,
          }))} />
          <div className="border hairline p-5">
            <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Browse by letter</h2>
            <div className="mt-4 grid grid-cols-9 gap-2 font-[var(--font-mono)] text-xs">
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((item) => (
                <button
                  className={`focus-ring grid h-8 place-items-center border hairline transition hover:bg-[var(--accent-soft)] ${
                    letter === item ? "bg-[var(--ink)] text-[var(--paper)]" : ""
                  }`}
                  key={item}
                  onClick={() => setLetter((current) => (current === item ? null : item))}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function HeroMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-r hairline px-4 py-6 text-center last:border-r-0">
      <p className="plain-number text-2xl">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">{label}</p>
    </div>
  );
}

function RankingPanel({ title, rows, href }: { title: string; href: string; rows: { label: string; value: number; href: string }[] }) {
  return (
    <div className="border hairline p-5">
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
