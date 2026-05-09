"use client";

import Link from "next/link";
import { ChevronDown, MoreHorizontal, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { filterBooksByQuery, sortBooks, type BookSortKey } from "@/lib/catalog";
import { awardsById, data, getBookStats, imprintsById, publishersById, statusLabels } from "@/lib/data";
import type { Book, SubjectSummary } from "@/lib/types";

export function SubjectDetail({ subject, books }: { subject: SubjectSummary; books: Book[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const rows = useMemo(() => sortBooks(filterBooksByQuery(books, query), sortKey).slice(0, 10), [books, query, sortKey]);
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
  const statusDistribution = getStatusDistribution(appearances);
  const topAwards = topCounts(appearances.map((appearance) => awardsById.get(appearance.awardId)?.shortName ?? awardsById.get(appearance.awardId)?.name ?? ""));
  const topImprints = topCounts(books.map((book) => (book.imprintId ? imprintsById.get(book.imprintId)?.name ?? "" : "")));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-8 lg:grid-cols-[1fr_0.55fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subject</p>
          <h1 className="mt-3 text-5xl font-light leading-tight">{subject.name}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 muted">{subjectDeck(subject.name)}</p>
        </div>
        <div className="grid grid-cols-2 border-l hairline sm:grid-cols-4 lg:grid-cols-4">
          <HeroMetric value={books.length} label="Books" />
          <HeroMetric value={appearances.length} label="Award appearances" />
          <HeroMetric value={uniqueImprints.size} label="Imprints" />
          <HeroMetric value={yearRange} label="Year range" />
        </div>
      </section>

      <section className="panel mt-9 border hairline p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <div className="flex items-center gap-3 border hairline px-4 py-3">
            <Search size={18} className="muted" />
            <input
              className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]"
              placeholder={`Search within ${subject.name}...`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 font-[var(--font-mono)] text-xs">
            {(["score", "wins", "lists", "year", "title", "publisher"] as BookSortKey[]).map((key) => (
              <button
                className={`focus-ring border hairline px-4 py-3 capitalize transition ${
                  sortKey === key ? "bg-[var(--ink)] text-[var(--paper)]" : "hover:bg-[var(--panel)]"
                }`}
                key={key}
                onClick={() => setSortKey(key)}
              >
                {key === "score" ? "Relevance" : key}
                {sortKey === key && key === "score" ? <ChevronDown className="ml-2 inline" size={12} /> : null}
              </button>
            ))}
          </div>
          <div className="ml-auto flex border hairline p-1 font-[var(--font-mono)] text-xs">
            {(["keyword", "semantic"] as const).map((item) => (
              <button
                className={`focus-ring px-4 py-2 capitalize transition ${
                  mode === item ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:text-[var(--ink)]"
                }`}
                key={item}
                onClick={() => setMode(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-6 lg:grid-cols-[1fr_0.5fr]">
        <div className="overflow-x-auto border hairline panel">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.12em] muted">
              <tr className="border-b hairline">
                <th className="px-4 py-3 font-normal">Year</th>
                <th className="px-4 py-3 font-normal">Title</th>
                <th className="px-4 py-3 font-normal">Author</th>
                <th className="px-4 py-3 font-normal">Wins</th>
                <th className="px-4 py-3 font-normal">Lists</th>
                <th className="px-4 py-3 font-normal">Publisher / Imprint</th>
                <th className="px-4 py-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {rows.map((book) => {
                const stats = getBookStats(book.id);
                const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
                const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
                return (
                  <tr
                    className={`book-table-row cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                      selectedBookId === book.id ? "book-table-row-active" : ""
                    }`}
                    key={book.id}
                    onClick={() => setSelectedBookId(book.id)}
                  >
                    <td className="plain-number px-4 py-3 text-xs">{book.publicationYear}</td>
                    <td className="px-4 py-3">
                      <Link className="text-base transition hover:text-[var(--accent)]" href={`/books/${book.slug}`} onClick={(event) => event.stopPropagation()}>
                        {book.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{book.authors.map((author) => author.name).join(", ")}</td>
                    <td className="plain-number px-4 py-3 text-xs">{stats.wins}</td>
                    <td className="plain-number px-4 py-3 text-xs">{stats.lists}</td>
                    <td className="px-4 py-3">{publisher || imprint || "Not yet sourced"}</td>
                    <td className="px-4 py-3"><MoreHorizontal size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t hairline px-4 py-4 text-sm">
            <p>Showing <span className="plain-number">1-{Math.min(rows.length, 10)}</span> of <span className="plain-number">{books.length}</span> books</p>
            <p className="muted">Sorted by {sortKey === "score" ? "award score" : sortKey}</p>
          </div>
        </div>

        <aside className="grid gap-4">
          <Panel title="Related subjects">
            <div className="flex flex-wrap gap-2">
              {relatedSubjects.map((item) => (
                <Link className="border hairline px-3 py-2 text-sm transition hover:bg-[var(--accent-soft)]" href={`/subjects/${item.slug}`} key={item.id}>
                  {item.name}
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Award results distribution">
            <div className="grid gap-2">
              {statusDistribution.map((row) => (
                <DistributionRow key={row.label} {...row} />
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

function HeroMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-r hairline px-5 py-7 text-center last:border-r-0">
      <p className="plain-number text-3xl">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">{label}</p>
    </div>
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

function DistributionRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="h-1.5 bg-[var(--line)]"><span className="block h-full bg-[var(--ink)]" style={{ width: `${pct}%` }} /></span>
      <span className="plain-number text-right text-xs">{value} ({pct}%)</span>
    </div>
  );
}

function getStatusDistribution(appearances: typeof data.appearances) {
  const labels = ["winner", "shortlist", "longlist", "finalist"] as const;
  return labels.map((status) => ({
    label: statusLabels[status],
    value: appearances.filter((appearance) => appearance.status === status).length,
    total: appearances.length,
  })).filter((row) => row.value > 0);
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function subjectDeck(name: string) {
  if (name.toLowerCase() === "american history") {
    return "Award-recognized works that explore the history of the United States, its people, institutions, politics, and social movements from the colonial era to the present.";
  }
  return `Award-recognized works classified under ${name.toLowerCase()}, with sortable prize results, imprints, and related subjects.`;
}
