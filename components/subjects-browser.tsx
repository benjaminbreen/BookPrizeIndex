"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, matchesAwardRegion } from "@/lib/award-region";
import type { Book, PublicData, SubjectSummary } from "@/lib/types";

type BookTypeFilter = "all" | "fiction" | "nonfiction";
type SortKey = "books-desc" | "books-asc" | "subject-asc" | "subject-desc";
type SubjectRowData = SubjectSummary & { bookCount: number; topBookId?: string };

export function SubjectsBrowser({ data, defaultRegion }: { data: PublicData; defaultRegion: AwardRegionFilter }) {
  const [query, setQuery] = useState("");
  const [geography, setGeographyState] = useState<AwardRegionFilter>(defaultRegion);
  const [bookType, setBookType] = useState<BookTypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("books-desc");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const booksById = new Map(data.books.map((book) => [book.id, book]));
    const filteredBookIds = filteredBookIdsFor(data, geography, bookType);
    const filteredBooks = data.books.filter((book) => filteredBookIds.has(book.id));
    const scoreByBook = filteredScoresByBook(data, geography, bookType);
    const rows = data.subjects
      .map((subject) => {
        const subjectBooks = filteredBooks.filter((book) => book.subjects.includes(subject.name));
        const topBook = [...subjectBooks].sort((a, b) => (scoreByBook.get(b.id) ?? 0) - (scoreByBook.get(a.id) ?? 0) || a.title.localeCompare(b.title))[0];
        return {
          ...subject,
          bookCount: subjectBooks.length,
          topBookId: topBook?.id,
        };
      })
      .filter((subject) => subject.bookCount > 0)
      .filter((subject) => {
        if (!q) return true;
        const topBook = subject.topBookId ? booksById.get(subject.topBookId) : undefined;
        return [subject.name, subject.description, subjectDeck(subject.name), topBook?.title, topBook?.authors.map((author) => author.name).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
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
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">Browse subjects.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 muted">
            Explore books organized by subject.
            <br />
            Click a subject to view related books and awards.
          </p>
        </div>

        <div className="subjects-search focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={24} strokeWidth={1.8} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            placeholder="Search subjects (e.g., American history, science, memoir)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Search mode"
            className="subjects-select focus-ring"
            defaultValue="semantic"
          >
            <option value="semantic">Semantic</option>
            <option value="keyword">Keyword</option>
          </select>
        </div>
      </section>

      <section className="subjects-table-panel mt-6 border hairline">
        <div className="subjects-filterbar flex flex-col gap-4 border-b hairline px-6 py-4 md:flex-row md:items-center md:justify-between">
          <FilterGroup label="Award Geography">
            <SegmentButton active={geography === "us"} onClick={() => setGeography("us")}>US</SegmentButton>
            <SegmentButton active={geography === "world"} onClick={() => setGeography("world")}>World</SegmentButton>
          </FilterGroup>

          <FilterGroup label="Book Type">
            <SegmentButton active={bookType === "all"} onClick={() => setBookType("all")}>All</SegmentButton>
            <SegmentButton active={bookType === "fiction"} onClick={() => setBookType("fiction")}>Fiction</SegmentButton>
            <SegmentButton active={bookType === "nonfiction"} onClick={() => setBookType("nonfiction")}>Nonfiction</SegmentButton>
          </FilterGroup>
        </div>

        <div className="overflow-x-auto">
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
              {rows.length ? rows.map((subject, index) => {
                const topBook = subject.topBookId ? data.books.find((book) => book.id === subject.topBookId) : undefined;
                return <SubjectRow index={index} key={subject.id} subject={subject} topBook={topBook} />;
              }) : (
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
    <div className="flex flex-wrap items-center gap-4">
      <span className="text-sm leading-none muted">{label}</span>
      <div className="subjects-segments inline-flex overflow-hidden border hairline">{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`focus-ring min-w-20 border-r hairline px-6 py-2 text-sm leading-none transition last:border-r-0 ${
        active ? "bg-[var(--ink)] text-[var(--paper)] shadow-sm" : "hover:bg-[var(--panel)]"
      }`}
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

function SubjectRow({ index, subject, topBook }: { index: number; subject: SubjectRowData; topBook?: Book }) {
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
              <span className="mt-1 block text-sm muted">
                {topBook.authors.map((author) => author.name).join(", ")} <span className="px-1">·</span> {topBook.publicationYear ?? "Unknown"}
              </span>
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

function sortSubjectRows(rows: SubjectRowData[], sortKey: SortKey) {
  return [...rows].sort((a, b) => {
    if (sortKey === "subject-asc") return a.name.localeCompare(b.name);
    if (sortKey === "subject-desc") return b.name.localeCompare(a.name);
    if (sortKey === "books-asc") return a.bookCount - b.bookCount || a.name.localeCompare(b.name);
    return b.bookCount - a.bookCount || a.name.localeCompare(b.name);
  });
}

function filteredBookIdsFor(data: PublicData, geography: AwardRegionFilter, bookType: BookTypeFilter) {
  const awardById = new Map(data.awards.map((award) => [award.id, award]));
  const programsById = new Map((data.awardPrograms ?? []).map((program) => [program.id, program]));
  const ids = new Set<string>();
  for (const appearance of data.appearances) {
    const award = awardById.get(appearance.awardId);
    if (!award) continue;
    if (!matchesAwardRegion(award, geography, programsById)) continue;
    if (!matchesBookType(award.subjectAreas, bookType)) continue;
    ids.add(appearance.bookId);
  }
  return ids;
}

function filteredScoresByBook(data: PublicData, geography: AwardRegionFilter, bookType: BookTypeFilter) {
  const awardById = new Map(data.awards.map((award) => [award.id, award]));
  const programsById = new Map((data.awardPrograms ?? []).map((program) => [program.id, program]));
  const scores = new Map<string, number>();
  for (const appearance of data.appearances) {
    const award = awardById.get(appearance.awardId);
    if (!award) continue;
    if (!matchesAwardRegion(award, geography, programsById)) continue;
    if (!matchesBookType(award.subjectAreas, bookType)) continue;
    scores.set(appearance.bookId, (scores.get(appearance.bookId) ?? 0) + appearanceScore(appearance.statusRank));
  }
  return scores;
}

function matchesBookType(subjectAreas: string[], bookType: BookTypeFilter) {
  const hasFiction = subjectAreas.some((area) => area.toLowerCase().includes("fiction") && !area.toLowerCase().includes("nonfiction"));
  if (bookType === "fiction") return hasFiction;
  if (bookType === "nonfiction") return !hasFiction;
  return true;
}

function appearanceScore(statusRank: number) {
  if (statusRank <= 1) return 10;
  if (statusRank <= 3) return 5;
  return 2;
}

function subjectDeck(name: string) {
  const decks: Record<string, string> = {
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
