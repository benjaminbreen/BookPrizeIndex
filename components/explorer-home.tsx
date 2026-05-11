"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Filter, Info, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import type { BrowseData } from "@/lib/browse-types";

type SortKey = "score" | "year" | "title" | "wins" | "lists" | "imprint";
type TypeFilter = "fiction" | "nonfiction" | "all";

export function ExplorerHome({ data, defaultRegion }: { data: BrowseData; defaultRegion: AwardRegionFilter }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);
  const [type, setType] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");

  const rankedBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.books.filter((book) => !q || book.searchText.includes(q));
    return [...filtered].sort((a, b) => {
      if (sortKey === "score") {
        return (
          b.score - a.score ||
          b.majorWins - a.majorWins ||
          b.wins - a.wins ||
          b.majorShortlists - a.majorShortlists ||
          b.normalShortlists - a.normalShortlists ||
          b.majorLonglists - a.majorLonglists ||
          b.normalLonglists - a.normalLonglists ||
          (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
          a.title.localeCompare(b.title)
        );
      }
      if (sortKey === "wins") return b.wins - a.wins || a.title.localeCompare(b.title);
      if (sortKey === "lists") return b.lists - a.lists || a.title.localeCompare(b.title);
      if (sortKey === "year") return (b.publicationYear ?? 0) - (a.publicationYear ?? 0) || a.title.localeCompare(b.title);
      if (sortKey === "imprint") return (a.imprint ?? "").localeCompare(b.imprint ?? "") || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
  }, [data.books, query, sortKey]);

  const topBooks = rankedBooks.slice(0, 12);
  const browseData = useMemo(() => getBrowseData(data, region, type), [data, region, type]);
  const showingLabel = `${regionLabel(region)} · ${type === "all" ? "All" : titleCase(type)}`;

  function setRegion(nextRegion: AwardRegionFilter) {
    setRegionState(nextRegion);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextRegion}; path=/; max-age=31536000; samesite=lax`;
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/books?q=${encodeURIComponent(q)}`);
  }

  return (
    <main>
      <section className="bg-[var(--paper)]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:px-8 lg:pb-12 lg:pt-20">
          <div>
            <h1 className="max-w-2xl font-[var(--font-serif)] text-4xl font-light leading-[1.02] sm:text-5xl lg:text-5xl">
              A searchable index of award-winning books.
            </h1>
            <p className="mt-6 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
              Browse award-winning, shortlisted, and longlisted books by subject, prize, imprint, publisher,
              figure, period, and source.
            </p>
          </div>

          <div className="panel self-end rounded-lg border hairline p-4 shadow-[0_18px_40px_color-mix(in_srgb,var(--ink)_5%,transparent)] sm:p-5">
            <form
              className="group flex min-h-14 items-center gap-3 rounded-md border border-[color-mix(in_srgb,var(--line)_82%,var(--paper))] bg-[color-mix(in_srgb,var(--paper)_88%,white)] px-4 transition hover:border-[color-mix(in_srgb,var(--ink)_24%,var(--line))] hover:bg-[color-mix(in_srgb,var(--paper)_78%,white)] focus-within:border-[var(--focus)] focus-within:bg-[var(--panel)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_16%,transparent)]"
              onSubmit={submitSearch}
            >
              <Search size={22} className="muted transition group-focus-within:text-[var(--ink)]" />
              <input
                aria-label="Search the book catalog"
                className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-[color-mix(in_srgb,var(--muted)_78%,transparent)]"
                placeholder="Search books, awards, authors, subjects..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.trim() ? (
                <button
                  className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition hover:bg-[var(--accent)]"
                  type="submit"
                >
                  Enter
                  <ArrowRight size={14} />
                </button>
              ) : null}
            </form>
            <div className="mt-5 border-t hairline pt-5">
              <div className="grid gap-4 lg:grid-cols-[auto_auto_auto_auto_minmax(9rem,1fr)] lg:items-end">
                <FilterGroup label="Region">
                  {(["us", "international", "all"] as const).map((item) => (
                    <FilterButton key={item} active={region === item} onClick={() => setRegion(item)}>
                      {regionLabel(item)}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <div className="hidden h-10 w-px bg-[var(--line)] lg:block" />
                <FilterGroup label="Type">
                  {(["fiction", "nonfiction", "all"] as const).map((item) => (
                    <FilterButton key={item} active={type === item} onClick={() => setType(item)}>
                      {titleCase(item)}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <div className="hidden h-10 w-px bg-[var(--line)] lg:block" />
                <p className="flex items-start gap-2 text-xs leading-5 muted">
                  <Info size={15} className="mt-0.5 shrink-0" />
                  Lists update based on your selections.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y hairline" id="subjects">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 border-b hairline py-4 text-sm muted">
            <Filter size={16} />
            <span>
              Showing: <strong className="font-medium text-[var(--ink)]">{showingLabel}</strong>
            </span>
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <BrowseList
            title="Browse by subject"
            seeAllHref="/subjects"
            items={browseData.subjects.slice(0, 8).map((subject) => ({
              id: subject.id,
              label: subject.name,
              meta: `${subject.count} books`,
              href: `/subjects/${subject.slug}`,
            }))}
          />
          <BrowseList
            title="Browse by prize"
            id="awards"
            seeAllHref="/awards"
            items={browseData.awards.slice(0, 8).map((award) => ({
              id: award.id,
              label: award.name,
              meta: `${award.count} records`,
              href: `/awards/${award.slug}`,
            }))}
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" id="books">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Ranked catalog</p>
            <h2 className="mt-2 font-[var(--font-serif)] text-3xl font-light">Most awarded books</h2>
          </div>
          <div className="flex flex-wrap gap-2 font-[var(--font-mono)] text-xs">
            {(["score", "wins", "lists", "year", "title", "imprint"] as SortKey[]).map((key) => (
              <button
                key={key}
                className={`filter-chip focus-ring px-3 py-2 capitalize ${sortKey === key ? "segment-button-active" : ""}`}
                onClick={() => setSortKey(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto border hairline panel">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-xs uppercase tracking-[0.08em] muted">
              <tr className="border-b hairline">
                <th className="px-4 py-3 font-normal">Year</th>
                <th className="px-4 py-3 font-normal">Title</th>
                <th className="px-4 py-3 font-normal">Author</th>
                <th className="px-4 py-3 font-normal">Wins</th>
                <th className="px-4 py-3 font-normal">Lists</th>
                <th className="px-4 py-3 font-normal">Imprint</th>
                <th className="px-4 py-3 font-normal">Publisher</th>
              </tr>
            </thead>
            <tbody>
              {topBooks.map((book, index) => {
                return (
                  <tr
                    key={book.id}
                    className="book-table-row fade-up border-b hairline transition hover:bg-[var(--accent-soft)]"
                    style={{ animationDelay: `${Math.min(index * 18, 140)}ms` }}
                  >
                    <td className="plain-number px-4 py-4 text-sm muted">{book.publicationYear}</td>
                    <td className="px-4 py-4">
                      <Link
                        className="focus-ring block w-full text-left font-[var(--font-serif)] text-xl font-light transition hover:text-[var(--accent)]"
                        href={`/books/${book.slug}`}
                      >
                        {book.title}
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm">{book.author}</td>
                    <td className="plain-number px-4 py-4 text-sm">{book.wins}</td>
                    <td className="plain-number px-4 py-4 text-sm">{book.lists}</td>
                    <td className={`px-4 py-4 text-sm ${book.imprint ? "" : "book-missing-value"}`}>{book.imprint || "Unknown"}</td>
                    <td className={`px-4 py-4 text-sm ${book.publisher ? "muted" : "book-missing-value"}`}>{book.publisher || "Not yet sourced"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" id="publishers">
        <div className="grid gap-4 border-t hairline pt-8 font-[var(--font-mono)] text-xs muted sm:grid-cols-4">
          <Stat label="Books" value={data.stats.books} />
          <Stat label="Award appearances" value={data.stats.appearances} />
          <Stat label="Prizes" value={data.stats.prizes} />
          <Stat label="Imprints" value={data.stats.imprints} />
        </div>
      </section>
    </main>
  );
}

function BrowseList({
  title,
  items,
  id,
  seeAllHref,
}: {
  title: string;
  id?: string;
  items: { id: string; label: string; meta: string; href: string }[];
  seeAllHref: string;
}) {
  return (
    <div className="py-8 lg:px-8 lg:[&:first-child]:border-r lg:[&:first-child]:pl-0 lg:[&:last-child]:pr-0 hairline" id={id}>
      <h2 className="mb-5 font-[var(--font-mono)] text-xs uppercase tracking-[0.22em] muted">{title}</h2>
      <div className="border-t hairline">
        {items.map((item) => (
          <Link
            href={item.href}
            key={item.id}
            className="group flex min-h-10 items-center justify-between gap-4 border-b hairline py-2.5 transition hover:bg-[color-mix(in_srgb,var(--panel)_74%,transparent)]"
          >
            <span className="text-base font-medium leading-snug">{item.label}</span>
            <span className="flex shrink-0 items-center gap-3 text-sm muted">
              {item.meta}
              <ArrowRight size={15} className="transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
      <Link
        className="focus-ring group mx-auto mt-5 flex min-w-40 items-center justify-center gap-2 rounded-md border hairline px-5 py-3 text-sm transition hover:border-[color-mix(in_srgb,var(--ink)_36%,var(--line))] hover:bg-[var(--panel)] hover:text-[var(--ink)] hover:shadow-[0_10px_24px_color-mix(in_srgb,var(--ink)_5%,transparent)]"
        href={seeAllHref}
      >
        See all
        <ArrowRight size={14} className="transition group-hover:translate-x-1" />
      </Link>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="filter-label mb-2">{label}</p>
      <div className="segmented-control">
        {children}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`segment-button focus-ring min-w-20 ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function getBrowseData(data: BrowseData, region: AwardRegionFilter, type: TypeFilter) {
  return data.home[`${region}:${type}`];
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p>{label}</p>
      <p className="mt-1 text-2xl text-[var(--ink)]">{value.toLocaleString()}</p>
    </div>
  );
}
