"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpDown, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAwardRegion } from "@/components/use-award-region";
import { type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import type { BrowseData } from "@/lib/browse-types";

type AwardSort = "name" | "records" | "subject" | "deadline";
type BookTypeFilter = "all" | "fiction" | "nonfiction";

export function AwardsBrowser({ data, defaultRegion }: { data: BrowseData; defaultRegion: AwardRegionFilter }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AwardSort>("name");
  const [geography, setGeography] = useAwardRegion(defaultRegion);
  const [bookType, setBookType] = useState<BookTypeFilter>("all");
  const router = useRouter();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.awards
      .filter((row) => row.records > 0)
      .filter((row) => matchesRegion(row.geography, geography))
      .filter((row) => matchesBookType(row.subjects, bookType))
      .filter((row) => row.searchText.includes(q))
      .sort((a, b) => {
        if (sort === "records") return b.records - a.records || a.name.localeCompare(b.name);
        if (sort === "subject") return a.subjects.join(", ").localeCompare(b.subjects.join(", "));
        if (sort === "deadline") return (a.deadline ?? "zzz").localeCompare(b.deadline ?? "zzz");
        return a.name.localeCompare(b.name);
      });
  }, [bookType, data.awards, geography, query, sort]);

  const contextLine = `${regionLabel(geography)} · ${bookType === "all" ? "All books" : titleCase(bookType)} · Sorted by ${awardSortLabels[sort].toLowerCase()} · ${rows.length.toLocaleString()} awards`;

  return (
    <main className="subjects-page py-4">
      <section className="subjects-hero mx-auto grid max-w-7xl gap-5 px-4 sm:gap-8 sm:px-6 lg:grid-cols-[0.86fr_1fr] lg:items-center lg:px-8">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Awards</p>
          <h1 className="mt-3 font-[var(--font-serif)] text-[2.25rem] font-light leading-tight sm:text-5xl">Browse awards.</h1>
          <p className="mt-3 max-w-2xl font-[var(--font-serif)] text-[1.05rem] font-light leading-7 muted sm:mt-5 sm:text-xl sm:leading-8">
            Explore nonfiction prizes by subject, eligibility, deadline, and source.
            <br />
            Click an award to view related books and records.
          </p>
        </div>

        <div className="subjects-search focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={24} strokeWidth={1.8} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            placeholder="Search awards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </section>

      <section className="subjects-table-panel mx-auto mt-6 max-w-[96rem] border hairline">
        <div className="filter-toolbar mx-auto flex max-w-7xl flex-col gap-5 border-b hairline px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <FilterGroup label="Award Geography">
              {(["us", "international", "all"] as const).map((item) => (
                <SegmentButton active={geography === item} key={item} onClick={() => setGeography(item)}>{regionLabel(item)}</SegmentButton>
              ))}
            </FilterGroup>

            <FilterGroup label="Book Type">
              <SegmentButton active={bookType === "all"} onClick={() => setBookType("all")}>All</SegmentButton>
              <SegmentButton active={bookType === "fiction"} onClick={() => setBookType("fiction")}>Fiction</SegmentButton>
              <SegmentButton active={bookType === "nonfiction"} onClick={() => setBookType("nonfiction")}>Nonfiction</SegmentButton>
            </FilterGroup>
          </div>

          <FilterGroup label="Sort" wrap>
            {(["name", "records", "subject", "deadline"] as AwardSort[]).map((item) => (
              <SegmentButton key={item} active={sort === item} onClick={() => setSort(item)}>
                <span className="inline-flex items-center gap-2 capitalize">
                  <ArrowUpDown size={12} />
                  {awardSortLabels[item]}
                </span>
              </SegmentButton>
            ))}
          </FilterGroup>
        </div>
        <div className="mx-auto max-w-7xl border-b hairline px-6 py-3 font-[var(--font-mono)] text-xs muted">
          {contextLine}
          {query.trim() ? <span className="ml-2 text-[var(--ink)]">Search: {query.trim()}</span> : null}
        </div>

        <div className="grid md:hidden">
          {rows.length ? rows.map((row, index) => (
            <Link
              className="subjects-row mobile-browse-row block border-b hairline px-3 py-3 transition last:border-b-0 hover:bg-[var(--accent-soft)]"
              href={`/awards/${row.slug}`}
              key={row.id}
              style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}
            >
              <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <span className="min-w-0">
                  <span className="block text-lg font-medium leading-tight">{row.name}</span>
                  <span className="mt-1 block line-clamp-2 text-sm leading-5 muted">{row.description}</span>
                </span>
                <span className="grid justify-items-end gap-1">
                  <span className="plain-number text-base">{row.records.toLocaleString()}</span>
                  <ArrowRight size={15} className="muted" />
                </span>
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t hairline pt-2 text-sm">
                <span>{row.typeLabel}</span>
                <span className="muted">{formatGeography(row.geography)}</span>
                <span className="plain-number muted">{row.yearRange}</span>
              </span>
              <span className="mt-1 block truncate text-sm muted">
                {row.subjects.slice(0, 3).join(", ")}{row.subjects.length > 3 ? ` +${row.subjects.length - 3}` : ""}
              </span>
            </Link>
          )) : (
            <AwardEmptyState onReset={() => {
              setQuery("");
              setGeography("all");
              setBookType("all");
            }} />
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="subjects-table w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="border-b hairline">
                <th className="w-[34rem] px-6 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Prize</th>
                <th className="w-36 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Type</th>
                <th className="w-28 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Region</th>
                <th className="w-72 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Subject</th>
                <th className="w-36 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Years</th>
                <th className="w-52 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Deadline</th>
                <th className="w-28 px-4 py-4 text-right font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Records</th>
                <th className="w-16 px-6 py-4" />
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, index) => (
                <tr
                  className="subjects-row cursor-pointer border-b hairline"
                  key={row.id}
                  onClick={() => router.push(`/awards/${row.slug}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/awards/${row.slug}`);
                    }
                  }}
                  role="link"
                  style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}
                  tabIndex={0}
                >
                  <td className="px-6 py-4">
                    <Link className="subjects-title-link block" href={`/awards/${row.slug}`} onClick={(event) => event.stopPropagation()}>
                      <span className="block text-xl font-medium leading-tight">{row.name}</span>
                      <span className="mt-1 block text-sm leading-5 muted">{row.description}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex border hairline px-3 py-1.5 text-xs">{row.typeLabel}</span>
                  </td>
                  <td className="px-4 py-4 text-sm">{formatGeography(row.geography)}</td>
                  <td className="px-4 py-4 text-sm leading-6">{row.subjects.slice(0, 3).join(", ")}{row.subjects.length > 3 ? ` +${row.subjects.length - 3}` : ""}</td>
                  <td className="plain-number px-4 py-4 text-sm muted">{row.yearRange}</td>
                  <td className="px-4 py-4 text-sm leading-6 muted">{row.deadline ?? row.typeLabel}</td>
                  <td className="plain-number px-4 py-4 text-right text-lg">{row.records.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">
                    <Link aria-label={`View ${row.name}`} className="subjects-row-icon focus-ring ml-auto" href={`/awards/${row.slug}`} onClick={(event) => event.stopPropagation()}>
                      <ArrowRight size={22} strokeWidth={1.7} />
                    </Link>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>
                    <AwardEmptyState onReset={() => {
                      setQuery("");
                      setGeography("all");
                      setBookType("all");
                    }} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function AwardEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="px-4 py-14 text-center sm:px-6">
      <p className="text-lg">No awards match the current filters.</p>
      <p className="mt-2 text-sm muted">Try a broader search, include all regions, or reset book type.</p>
      <button className="filter-action focus-ring mt-5 inline-flex items-center gap-2 px-4 py-3 text-sm" onClick={onReset} type="button">
        Show all awards
      </button>
    </div>
  );
}

function formatGeography(geography?: string) {
  if (!geography) return "Unknown";
  const normalized = geography.toLowerCase();
  if (normalized === "world") return "World";
  if (normalized === "us" || normalized === "usa" || normalized === "united states") return "US";
  if (normalized === "uk" || normalized === "united kingdom") return "UK";
  return geography;
}

function matchesRegion(geography: string | undefined, filter: AwardRegionFilter) {
  if (filter === "all") return true;
  const isUs = isUsGeography(geography);
  return filter === "us" ? isUs : !isUs;
}

const awardSortLabels: Record<AwardSort, string> = {
  name: "Name A-Z",
  records: "Most records",
  subject: "Subject A-Z",
  deadline: "Deadline",
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function FilterGroup({ children, label, wrap = false }: { children: React.ReactNode; label: string; wrap?: boolean }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className={`segmented-control ${wrap ? "flex-wrap xl:flex-nowrap" : ""}`}>{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`segment-button focus-ring min-w-16 sm:min-w-20 ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function matchesBookType(subjects: string[], filter: BookTypeFilter) {
  if (filter === "all") return true;
  const normalized = subjects.map((subject) => subject.toLowerCase());
  if (filter === "fiction") return normalized.some((subject) => subject === "fiction" || subject.includes(" fiction"));
  return normalized.some((subject) => subject === "nonfiction" || subject.includes("nonfiction"));
}

function isUsGeography(geography?: string) {
  return Boolean(geography && /united states|u\.s\.|us publication|united states publication/i.test(geography));
}
