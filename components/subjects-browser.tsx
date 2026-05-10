"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Book, PublicData, SubjectSummary } from "@/lib/types";

type GeographyFilter = "us" | "world";
type BookTypeFilter = "all" | "fiction" | "nonfiction";

export function SubjectsBrowser({ data }: { data: PublicData }) {
  const [query, setQuery] = useState("");
  const [geography, setGeography] = useState<GeographyFilter>("us");
  const [bookType, setBookType] = useState<BookTypeFilter>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.subjects
      .filter((subject) => matchesGeography(subject, geography))
      .filter((subject) => matchesBookType(subject, bookType))
      .filter((subject) => {
        if (!q) return true;
        const topBook = subject.topBookId ? data.books.find((book) => book.id === subject.topBookId) : undefined;
        return [subject.name, subject.description, subjectDeck(subject.name), topBook?.title, topBook?.authors.map((author) => author.name).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [bookType, data.books, data.subjects, geography, query]);

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
        <div className="subjects-filterbar flex flex-col gap-5 border-b hairline px-6 py-6 md:flex-row md:items-center md:justify-between">
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
                <th className="px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Subject</th>
                <th className="w-36 px-4 py-4 text-right font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Books</th>
                <th className="w-[28rem] px-10 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Top-recognized book</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((subject, index) => {
                const topBook = subject.topBookId ? data.books.find((book) => book.id === subject.topBookId) : undefined;
                return <SubjectRow index={index} key={subject.id} subject={subject} topBook={topBook} />;
              })}
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
      <span className="text-sm muted">{label}</span>
      <div className="subjects-segments inline-flex overflow-hidden border hairline">{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`focus-ring min-w-20 border-r hairline px-7 py-2.5 text-sm transition last:border-r-0 ${
        active ? "bg-[var(--ink)] text-[var(--paper)] shadow-sm" : "hover:bg-[var(--panel)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SubjectRow({ index, subject, topBook }: { index: number; subject: SubjectSummary; topBook?: Book }) {
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

function matchesGeography(subject: SubjectSummary, geography: GeographyFilter) {
  if (geography === "world") return subject.name !== "American History";
  return true;
}

function matchesBookType(_subject: SubjectSummary, bookType: BookTypeFilter) {
  return bookType !== "fiction";
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
