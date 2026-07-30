"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpDown, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAwardRegion } from "@/components/use-award-region";
import { type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import { type AwardSubmissionDisplay, describeAwardSubmission, todayIso } from "@/lib/award-submission";
import type { BrowseAwardRow, BrowseData } from "@/lib/browse-types";

type AwardSort = "name" | "records" | "subject" | "deadline";
type BookTypeFilter = "all" | "fiction" | "nonfiction";

export function AwardsBrowser({ data, defaultRegion }: { data: BrowseData; defaultRegion: AwardRegionFilter }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AwardSort>("name");
  const [geography, setGeography] = useAwardRegion(defaultRegion);
  const [bookType, setBookType] = useState<BookTypeFilter>("all");
  const router = useRouter();
  const today = useToday(data.generatedAt);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.awards
      .filter((row) => row.records > 0)
      .filter((row) => matchesRegion(row.geography, geography))
      .filter((row) => matchesBookType(row.subjects, bookType))
      .filter((row) => row.searchText.includes(q))
      .map((row) => ({ row, submission: describeAwardSubmission(row.submission, today) }))
      .sort((a, b) => {
        if (sort === "records") return b.row.records - a.row.records || a.row.name.localeCompare(b.row.name);
        if (sort === "subject") return a.row.subjects.join(", ").localeCompare(b.row.subjects.join(", "));
        if (sort === "deadline") return a.submission.sortKey.localeCompare(b.submission.sortKey) || a.row.name.localeCompare(b.row.name);
        return a.row.name.localeCompare(b.row.name);
      });
  }, [bookType, data.awards, geography, query, sort, today]);

  const openCount = rows.filter((item) => item.submission.tone === "open" || item.submission.tone === "closing").length;
  const contextLine = `${regionLabel(geography)} · ${bookType === "all" ? "All books" : titleCase(bookType)} · Sorted by ${awardSortLabels[sort].toLowerCase()} · ${rows.length.toLocaleString()} awards · ${openCount} with a dated entry window`;
  const reset = () => {
    setQuery("");
    setGeography("all");
    setBookType("all");
  };

  return (
    <main className="subjects-page py-3">
      <section className="subjects-hero mx-auto grid max-w-7xl gap-3 px-4 sm:gap-6 sm:px-6 lg:grid-cols-[0.9fr_1fr] lg:items-center lg:px-8">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Awards</p>
          <h1 className="mt-1.5 font-[var(--font-serif)] text-[2rem] font-light leading-tight sm:text-[2.6rem]">Browse awards.</h1>
          <p className="mt-2 max-w-2xl font-[var(--font-serif)] text-[1rem] font-light leading-6 muted sm:text-lg sm:leading-7">
            Nonfiction prizes by subject, eligibility, and entry deadline. Click an award for its records.
          </p>
        </div>

        <div className="subjects-search subjects-search-compact focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={20} strokeWidth={1.8} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            placeholder="Search awards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </section>

      <section className="subjects-table-panel mx-auto mt-3 max-w-[96rem] border hairline">
        <div className="filter-toolbar mx-auto flex max-w-7xl flex-col gap-3 border-b hairline px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
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
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <ArrowUpDown size={12} />
                  {awardSortLabels[item]}
                </span>
              </SegmentButton>
            ))}
          </FilterGroup>
        </div>
        <div className="mx-auto max-w-7xl border-b hairline px-4 py-2 font-[var(--font-mono)] text-xs muted sm:px-6">
          {contextLine}
          {query.trim() ? <span className="ml-2 text-[var(--ink)]">Search: {query.trim()}</span> : null}
        </div>

        <div className="grid md:hidden">
          {rows.length ? rows.map(({ row, submission }, index) => (
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
                <SubmissionChip submission={submission} />
                <span className="muted">{formatGeography(row.geography)}</span>
                <span className="plain-number muted">{row.yearRange}</span>
              </span>
            </Link>
          )) : (
            <AwardEmptyState onReset={reset} />
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="subjects-table w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="border-b hairline">
                <th className="w-[32rem] px-5 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Prize</th>
                <th className="w-32 px-3 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Type</th>
                <th className="w-24 px-3 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Region</th>
                <th className="w-64 px-3 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Subject</th>
                <th className="w-28 px-3 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Years</th>
                <th className="w-56 px-3 py-2.5 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Entry window</th>
                <th className="w-24 px-3 py-2.5 text-right font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Records</th>
                <th className="w-12 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map(({ row, submission }, index) => (
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
                  <td className="px-5 py-3">
                    <Link className="subjects-title-link block" href={`/awards/${row.slug}`} onClick={(event) => event.stopPropagation()}>
                      <span className="block text-[1.05rem] font-medium leading-snug">{row.name}</span>
                      <span className="mt-0.5 block line-clamp-2 text-[0.8rem] leading-5 muted">{row.description}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex border hairline px-2 py-1 text-xs">{row.typeLabel}</span>
                  </td>
                  <td className="px-3 py-3 text-sm">{formatGeography(row.geography)}</td>
                  <td className="px-3 py-3 text-[0.82rem] leading-5">{row.subjects.slice(0, 3).join(", ")}{row.subjects.length > 3 ? ` +${row.subjects.length - 3}` : ""}</td>
                  <td className="plain-number px-3 py-3 text-sm muted">{row.yearRange}</td>
                  <td className="px-3 py-3">
                    <SubmissionChip submission={submission} />
                  </td>
                  <td className="plain-number px-3 py-3 text-right text-base">{row.records.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <Link aria-label={`View ${row.name}`} className="subjects-row-icon focus-ring ml-auto" href={`/awards/${row.slug}`} onClick={(event) => event.stopPropagation()}>
                      <ArrowRight size={20} strokeWidth={1.7} />
                    </Link>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>
                    <AwardEmptyState onReset={reset} />
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

function SubmissionChip({ submission }: { submission: AwardSubmissionDisplay }) {
  return (
    <span className="inline-grid gap-0.5">
      <span className={`submission-chip submission-chip-${submission.tone}`}>{submission.label}</span>
      {submission.detail ? <span className="text-[0.72rem] leading-4 muted">{submission.detail}</span> : null}
    </span>
  );
}

/**
 * Renders the build date first so hydration matches the static HTML, then
 * switches to the viewer's real date.
 */
function useToday(generatedAt: string) {
  const [today, setToday] = useState(() => generatedAt.slice(0, 10));
  useEffect(() => setToday(todayIso()), []);
  return today;
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
  deadline: "Next deadline",
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
      className={`segment-button segment-button-compact focus-ring min-w-16 sm:min-w-20 ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function matchesBookType(subjects: BrowseAwardRow["subjects"], filter: BookTypeFilter) {
  if (filter === "all") return true;
  const normalized = subjects.map((subject) => subject.toLowerCase());
  if (filter === "fiction") return normalized.some((subject) => subject === "fiction" || subject.includes(" fiction"));
  return normalized.some((subject) => subject === "nonfiction" || subject.includes("nonfiction"));
}

function isUsGeography(geography?: string) {
  return Boolean(geography && /united states|u\.s\.|us publication|united states publication/i.test(geography));
}
