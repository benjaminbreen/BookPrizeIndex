"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type React from "react";
import { BookDrawer } from "@/components/book-drawer";
import { EntityMetricGrid, SearchModeSelect } from "@/components/ui/design-primitives";
import { filterBooksByQuery, sortBooks, type BookSortKey } from "@/lib/catalog";
import { awardsById, data, getBookStats, imprintsById, publishersById } from "@/lib/data";
import { topicSlug } from "@/lib/topics";
import type { Book, SubjectSummary } from "@/lib/types";

export function SubjectDetail({ subject, books }: { subject: SubjectSummary; books: Book[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const rows = useMemo(() => sortBooks(filterBooksByQuery(books, query), sortKey).slice(0, 50), [books, query, sortKey]);
  const selectedBook = selectedBookId ? data.books.find((book) => book.id === selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? rows.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => setSelectedBookId(rows[selectedIndex - 1].id) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < rows.length - 1 ? () => setSelectedBookId(rows[selectedIndex + 1].id) : undefined;
  const bookIds = new Set(books.map((book) => book.id));
  const appearances = data.appearances.filter((appearance) => bookIds.has(appearance.bookId));
  const years = appearances.map((appearance) => appearance.year);
  const yearRange = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown";
  const uniqueImprints = new Set(books.map((book) => book.imprintId).filter(Boolean));
  const relatedSubjects = data.subjects.filter((item) => item.id !== subject.id).slice(0, 6);
  const topicMix = topTopicCounts(books, subject.name);
  const topAwards = topCounts(appearances.map((appearance) => awardsById.get(appearance.awardId)?.shortName ?? awardsById.get(appearance.awardId)?.name ?? ""));
  const topImprints = topCounts(books.map((book) => (book.imprintId ? imprintsById.get(book.imprintId)?.name ?? "" : "")));
  const contextLine = `${subject.name} · Sorted by ${subjectSortLabel(sortKey).toLowerCase()} · Showing ${rows.length.toLocaleString()} of ${books.length.toLocaleString()} books${query.trim() ? ` · Search: ${query.trim()}` : ""}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1fr_0.5fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subject</p>
          <h1 className="mt-3 text-5xl font-light leading-tight">{subject.name}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 muted">{subjectDeck(subject.name)}</p>
          <p className="mt-7 font-[var(--font-mono)] text-xs muted">{contextLine}</p>
        </div>
        <EntityMetricGrid
          className="subject-hero-metrics lg:justify-self-end"
          items={[
            { value: books.length, label: "Books" },
            { value: uniqueImprints.size, label: "Imprints" },
            { value: yearRange, label: "Year range" },
          ]}
        />
      </section>

      <section className="filter-toolbar mt-5 border-y hairline px-1 py-2">
        <div className="grid gap-2 lg:grid-cols-[minmax(20rem,0.78fr)_auto_minmax(12rem,15rem)_auto] lg:items-center">
          <div className="subjects-search subject-detail-search focus-within:border-[var(--ink)]">
            <Search size={18} className="muted" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]"
              placeholder={`Search within ${subject.name}...`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="hidden flex-wrap gap-1.5 font-[var(--font-mono)] text-xs xl:flex">
            {(["score", "wins", "year"] as BookSortKey[]).map((key) => (
              <button
                className={`filter-chip focus-ring px-3 py-1.5 ${sortKey === key ? "segment-button-active" : ""}`}
                key={key}
                onClick={() => setSortKey(key)}
                type="button"
              >
                {key === "score" ? "Relevance" : key === "wins" ? "Wins" : "Newest"}
              </button>
            ))}
          </div>
          <label className="filter-group flex-nowrap font-[var(--font-mono)] text-xs">
            <span className="filter-label">Sort</span>
            <select
              className="filter-select focus-ring min-w-0 flex-1 font-sans normal-case tracking-normal"
              onChange={(event) => setSortKey(event.target.value as BookSortKey)}
              value={sortKey}
            >
              {(["score", "wins", "lists", "year", "title", "publisher"] as BookSortKey[]).map((key) => (
                <option key={key} value={key}>{key === "score" ? "Relevance" : subjectSortLabel(key)}</option>
              ))}
            </select>
          </label>
          <SearchModeSelect className="justify-self-start lg:justify-self-end" onChange={setMode} value={mode} />
        </div>
      </section>

      <section className="mt-5 grid gap-6 lg:grid-cols-[1fr_0.5fr] lg:items-start">
        <div className="overflow-hidden rounded-[2px] border hairline panel">
          <div className="grid md:hidden">
            {rows.map((book) => {
              const stats = getBookStats(book.id);
              const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
              const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
              return (
                <div
                  className={`book-mobile-card cursor-pointer border-b hairline p-4 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)] ${
                    selectedBookId === book.id ? "book-table-row-active" : ""
                  }`}
                  key={book.id}
                  onClick={() => setSelectedBookId(book.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedBookId(book.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-lg font-medium leading-tight">{book.title}</p>
                      <p className="mt-1 text-sm leading-5 muted">{book.authors.map((author) => author.name).join(", ")}</p>
                    </div>
                    <span className="plain-number shrink-0 font-[var(--font-mono)] text-xs muted">{book.publicationYear ?? "-"}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 border-y hairline py-3 font-[var(--font-mono)] text-xs">
                    <div>
                      <p className="uppercase tracking-[0.14em] muted">Wins</p>
                      <p className="plain-number mt-1 text-[var(--ink)]">{stats.wins}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-[0.14em] muted">Lists</p>
                      <p className="plain-number mt-1 text-[var(--ink)]">{stats.lists}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-[0.14em] muted">Year</p>
                      <p className="plain-number mt-1 text-[var(--ink)]">{book.publicationYear ?? "-"}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Imprint</p>
                    <p className={`mt-1 ${imprint || publisher ? "" : "book-missing-value"}`}>{imprint || publisher || "Not yet sourced"}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.12em] muted">
              <tr className="border-b hairline">
                <th className="px-4 py-3 font-normal">Year</th>
                <th className="px-4 py-3 font-normal">Title</th>
                <th className="px-4 py-3 font-normal">Author</th>
                <th className="px-4 py-3 font-normal">Wins</th>
                <th className="px-4 py-3 font-normal">Lists</th>
                <th className="px-4 py-3 font-normal">Imprint</th>
                <th className="px-4 py-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {rows.map((book) => {
                const stats = getBookStats(book.id);
                const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
                const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
                return (
                  <tr
                    className={`book-table-row cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                      selectedBookId === book.id ? "book-table-row-active" : ""
                    }`}
                    key={book.id}
                    onClick={() => setSelectedBookId(book.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedBookId(book.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="plain-number px-4 py-3 text-xs">{book.publicationYear}</td>
                    <td className="px-4 py-3">
                      <button
                        className="focus-ring block w-full text-left text-base transition hover:text-[var(--accent)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedBookId(book.id);
                        }}
                        type="button"
                      >
                        {book.title}
                      </button>
                    </td>
                    <td className="px-4 py-3">{book.authors.map((author) => author.name).join(", ")}</td>
                    <td className="plain-number px-4 py-3 text-xs">{stats.wins}</td>
                    <td className="plain-number px-4 py-3 text-xs">{stats.lists}</td>
                    <td className={`px-4 py-3 ${imprint || publisher ? "" : "book-missing-value"}`}>{imprint || publisher || "Not yet sourced"}</td>
                    <td className="px-4 py-3" aria-hidden="true" />
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t hairline px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p>Showing <span className="plain-number">1-{rows.length}</span> of <span className="plain-number">{books.length}</span> books</p>
            <p className="muted">
              Sorted by {subjectSortLabel(sortKey).toLowerCase()}
              {books.length > 50 ? (
                <>
                  <span className="px-2">·</span>
                  <Link className="transition hover:text-[var(--accent)]" href={`/books?q=${encodeURIComponent(subject.name)}`}>View all in Books</Link>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <Panel title="Related subjects">
            <div className="flex flex-wrap gap-2">
              {relatedSubjects.map((item) => (
                <Link className="border hairline px-3 py-2 text-sm transition hover:bg-[var(--accent-soft)]" href={`/subjects/${item.slug}`} key={item.id}>
                  {item.name}
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Topic mix">
            <div className="grid gap-3">
              {topicMix.map((row, index) => (
                <DistributionRow colorIndex={index} key={row.label} {...row} total={books.length} />
              ))}
            </div>
          </Panel>

          <div className="grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-2">
            <MiniPanel title="Top awards in this subject" rows={topAwards} footer="View all awards" href="/awards" />
            <MiniPanel title="Top imprints in this subject" rows={topImprints} footer="View all imprints" href="/imprints" />
          </div>
        </aside>
      </section>

      <BookDrawer
        book={selectedBook}
        appearances={selectedBook ? data.appearances.filter((appearance) => appearance.bookId === selectedBook.id) : []}
        currentLabel={selectedIndex >= 0 ? `${selectedIndex + 1} of ${rows.length}` : undefined}
        onClose={() => setSelectedBookId(null)}
        onNext={goNext}
        onPrevious={goPrevious}
      />
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border hairline panel p-5">
      <h2 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MiniPanel({ title, rows, footer, href }: { title: string; rows: { label: string; value: number }[]; footer: string; href: string }) {
  return (
    <div className="bg-[var(--paper)] p-5">
      <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">{title}</h3>
      <div className="mt-4 grid gap-2 text-sm">
        {rows.slice(0, 5).map((row) => (
          <div className="grid grid-cols-[1fr_auto] gap-4" key={row.label}>
            <span>{row.label}</span>
            <span className="plain-number text-xs">{row.value}</span>
          </div>
        ))}
      </div>
      <Link className="mt-5 block text-sm transition hover:text-[var(--accent)]" href={href}>{footer} ›</Link>
    </div>
  );
}

function DistributionRow({ colorIndex, label, value, total }: { colorIndex: number; label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <Link
      className={`topic-mix-row topic-mix-color-${colorIndex % 8} focus-ring`}
      href={`/topics/${topicSlug(label)}`}
      style={{ "--topic-mix-pct": `${pct}%`, "--topic-mix-delay": `${Math.min(colorIndex * 42, 260)}ms` } as React.CSSProperties}
    >
      <span className="topic-mix-label">{label}</span>
      <span className="topic-mix-track"><span className="topic-mix-fill" /></span>
      <span className="plain-number topic-mix-value">{value} ({pct}%)</span>
    </Link>
  );
}

function topCounts(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function subjectSortLabel(sortKey: BookSortKey) {
  if (sortKey === "score") return "Award activity";
  if (sortKey === "wins") return "Most wins";
  if (sortKey === "lists") return "Most lists";
  if (sortKey === "year") return "Newest year";
  if (sortKey === "title") return "Title A-Z";
  if (sortKey === "author") return "Author A-Z";
  if (sortKey === "publisher") return "Publisher A-Z";
  if (sortKey === "imprint") return "Imprint A-Z";
  return "Subject A-Z";
}

function topTopicCounts(books: Book[], subjectName: string) {
  const genericTopics = new Set(["Biography & Public Lives", "Regional & Local History", "Empire & Colonialism", "Essays & Cultural Criticism"]);
  const preferredBySubject: Record<string, Set<string>> = {
    Biography: new Set([
      "Political Biography",
      "Presidential Biography",
      "Military Biography",
      "Literary Biography",
      "Artistic Biography",
      "Scientific Biography",
      "Business Biography",
      "Religious Biography",
      "Sports Biography",
      "Activist Biography",
      "Family Biography",
      "Group Biography",
      "Intellectual Biography",
      "Black History & Culture",
      "Civil Rights & Racial Justice",
      "Slavery & Emancipation",
      "American Civil War",
      "World War II",
      "Vietnam War",
      "Cold War & Nuclear Politics",
    ]),
  };
  const preferred = preferredBySubject[subjectName];
  const topicForBook = (book: Book) => {
    const topics = book.topics ?? [];
    return topics.find((topic) => preferred?.has(topic)) ?? topics.find((topic) => !genericTopics.has(topic)) ?? book.primaryTopic ?? "";
  };
  return topCounts(books.map(topicForBook), 10);
}

function subjectDeck(name: string) {
  if (name.toLowerCase() === "american history") {
    return "Award-recognized works that explore the history of the United States, its people, institutions, politics, and social movements from the colonial era to the present.";
  }
  return `Award-recognized works classified under ${name.toLowerCase()}, with sortable prize results, imprints, and related subjects.`;
}
