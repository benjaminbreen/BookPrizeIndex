"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import type { BrowseData, BrowseSubjectRow } from "@/lib/browse-types";

type BookTypeFilter = "all" | "fiction" | "nonfiction";
type SortKey = "books-desc" | "books-asc" | "subject-asc" | "subject-desc";

export function SubjectsBrowser({ data, defaultRegion }: { data: BrowseData; defaultRegion: AwardRegionFilter }) {
  const [query, setQuery] = useState("");
  const [geography, setGeographyState] = useState<AwardRegionFilter>(defaultRegion);
  const [bookType, setBookType] = useState<BookTypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("books-desc");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data.subjects[`${geography}:${bookType}`].filter((subject) => !q || subject.searchText.includes(q));
    return sortSubjectRows(rows, sortKey);
  }, [bookType, data, geography, query, sortKey]);

  function setGeography(nextGeography: AwardRegionFilter) {
    setGeographyState(nextGeography);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextGeography}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <main className="subjects-page mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <section className="subjects-hero grid gap-8 lg:grid-cols-[0.86fr_1fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subjects</p>
          <h1 className="mt-3 font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">Browse subjects.</h1>
          <p className="mt-4 max-w-2xl font-[var(--font-serif)] text-lg font-light leading-7 muted sm:mt-5 sm:text-xl sm:leading-8">
            Explore books by editorial browse category.
            <br />
            Each title has one primary category for comparison; overlapping ideas live under Topics.
          </p>
          <Link className="mt-4 inline-block font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.14em] muted transition hover:text-[var(--ink)]" href="/methodology#subjects">
            How categories work →
          </Link>
        </div>

        <div className="subjects-search focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={24} strokeWidth={1.8} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            placeholder="Search subjects (e.g., history, science, memoir)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </section>

      <section className="subjects-table-panel mt-6 border hairline">
        <div className="filter-toolbar flex flex-col gap-3 border-b hairline px-5 py-3 md:flex-row md:items-center md:justify-between">
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

        <div className="grid md:hidden">
          {rows.length ? rows.map((subject, index) => <SubjectMobileCard index={index} key={subject.id} subject={subject} />) : (
            <div className="px-4 py-10 text-sm muted">
              No subjects match the current filters.
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="subjects-table w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b hairline">
                <th className="w-16 px-8 py-4" />
                <th className="px-4 py-4">
                  <SortHeader active={sortKey.startsWith("subject")} direction={sortKey === "subject-desc" ? "desc" : "asc"} onClick={() => setSortKey(sortKey === "subject-asc" ? "subject-desc" : "subject-asc")}>
                    Subject
                  </SortHeader>
                </th>
                <th className="w-36 px-4 py-4 text-right">
                  <SortHeader active={sortKey.startsWith("books")} align="right" direction={sortKey === "books-asc" ? "asc" : "desc"} onClick={() => setSortKey(sortKey === "books-desc" ? "books-asc" : "books-desc")}>
                    Books
                  </SortHeader>
                </th>
                <th className="w-[28rem] px-10 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Top-recognized book</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((subject, index) => <SubjectRow index={index} key={subject.id} subject={subject} />) : (
                <tr>
                  <td className="px-8 py-10 text-sm muted" colSpan={4}>
                    No subjects match the current filters.
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

function FilterGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className="segmented-control">{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`segment-button focus-ring ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SortHeader({
  active,
  align = "left",
  children,
  direction,
  onClick,
}: {
  active: boolean;
  align?: "left" | "right";
  children: React.ReactNode;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      className={`subjects-sort-header focus-ring ${align === "right" ? "ml-auto" : ""} ${active ? "subjects-sort-header-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

function SubjectRow({ index, subject }: { index: number; subject: BrowseSubjectRow }) {
  const topBook = subject.topBook;
  return (
    <tr className="subjects-row border-b hairline" style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}>
      <td className="px-8 py-4 align-middle">
        <Link aria-label={`View ${subject.name}`} className="subjects-row-icon focus-ring" href={`/subjects/${subject.slug}`}>
          <ChevronRight size={22} strokeWidth={1.7} />
        </Link>
      </td>
      <td className="px-4 py-4">
        <Link className="subjects-title-link block" href={`/subjects/${subject.slug}`}>
          <span className="block text-xl font-medium leading-tight">{subject.name}</span>
          <span className="mt-1 block text-sm leading-5 muted">{subjectDeck(subject.name)}</span>
        </Link>
      </td>
      <td className="plain-number px-4 py-4 text-right text-lg">{subject.bookCount.toLocaleString()}</td>
      <td className="px-10 py-4">
        {topBook ? (
          <Link className="subjects-book-link grid grid-cols-[1fr_auto] items-center gap-6" href={`/books/${topBook.slug}`}>
            <span>
              <span className="block text-base font-medium leading-tight">{topBook.title}</span>
              <span className="mt-1 block text-sm muted">{topBook.author} <span className="px-1">·</span> {topBook.publicationYear ?? "Unknown"}</span>
            </span>
            <span className="subjects-arrow">→</span>
          </Link>
        ) : (
          <span className="text-sm muted">Not yet ranked</span>
        )}
      </td>
    </tr>
  );
}

function SubjectMobileCard({ index, subject }: { index: number; subject: BrowseSubjectRow }) {
  const topBook = subject.topBook;
  return (
    <Link
      className="subjects-row mobile-browse-row block border-b hairline px-3 py-3 transition last:border-b-0 hover:bg-[var(--accent-soft)]"
      href={`/subjects/${subject.slug}`}
      style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}
    >
      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <span className="min-w-0">
          <span className="block text-lg font-medium leading-tight">{subject.name}</span>
          <span className="mt-0.5 block line-clamp-2 text-sm leading-5 muted">{subjectDeck(subject.name)}</span>
        </span>
        <span className="grid justify-items-end gap-1">
          <span className="plain-number shrink-0 text-base">{subject.bookCount.toLocaleString()}</span>
          <ChevronRight size={15} className="muted" />
        </span>
      </span>
      <span className="mt-2 block min-w-0 border-t hairline pt-2 text-sm">
        {topBook ? (
          <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <span className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Top</span>
            <span className="min-w-0 truncate">
              <span className="font-medium">{topBook.title}</span>
              <span className="muted"> / {topBook.author} / {topBook.publicationYear ?? "Unknown"}</span>
            </span>
          </span>
        ) : (
          <span className="muted">Not yet ranked</span>
        )}
      </span>
    </Link>
  );
}

function sortSubjectRows(rows: BrowseSubjectRow[], sortKey: SortKey) {
  return [...rows].sort((a, b) => {
    if (sortKey === "subject-asc") return a.name.localeCompare(b.name);
    if (sortKey === "subject-desc") return b.name.localeCompare(a.name);
    if (sortKey === "books-asc") return a.bookCount - b.bookCount || a.name.localeCompare(b.name);
    return b.bookCount - a.bookCount || a.name.localeCompare(b.name);
  });
}

function subjectDeck(name: string) {
  const decks: Record<string, string> = {
    History: "United States, world, and general history in one browse category.",
    "American History": "United States history, from pre-colonial period to present day.",
    "World History": "Global and international history.",
    Biography: "Life stories of individuals.",
    "Memoir & Autobiography": "Personal narratives and life experiences.",
    "Politics & Government": "Political systems, theory, and public policy.",
    "Society & Culture": "Social issues, customs, and cultural studies.",
    "Journalism & Reportage": "Journalistic works and on-the-ground reporting.",
    Science: "Scientific discoveries and explanations.",
  };
  return decks[name] ?? nameToSentence(name);
}

function nameToSentence(name: string) {
  return `${name} books and related award records.`;
}
