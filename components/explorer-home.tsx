"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import {
  bookSearchText,
  booksById,
  getBookStats,
  imprintsById,
  publishersById,
} from "@/lib/data";
import type { PublicData } from "@/lib/types";

type SortKey = "score" | "year" | "title" | "wins" | "lists" | "imprint";

export function ExplorerHome({ data }: { data: PublicData }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [subjectsExpanded, setSubjectsExpanded] = useState(false);
  const [prizesExpanded, setPrizesExpanded] = useState(false);

  const rankedBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.books.filter((book) => !q || bookSearchText(book).includes(q));
    return filtered.sort((a, b) => {
      const aStats = getBookStats(a.id);
      const bStats = getBookStats(b.id);
      if (sortKey === "score") return bStats.score - aStats.score || a.title.localeCompare(b.title);
      if (sortKey === "wins") return bStats.wins - aStats.wins || a.title.localeCompare(b.title);
      if (sortKey === "lists") return bStats.lists - aStats.lists || a.title.localeCompare(b.title);
      if (sortKey === "year") return (b.publicationYear ?? 0) - (a.publicationYear ?? 0) || a.title.localeCompare(b.title);
      if (sortKey === "imprint") {
        const aImprint = a.imprintId ? imprintsById.get(a.imprintId)?.name ?? "" : "";
        const bImprint = b.imprintId ? imprintsById.get(b.imprintId)?.name ?? "" : "";
        return aImprint.localeCompare(bImprint) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [data.books, query, sortKey]);

  const topBooks = rankedBooks.slice(0, 12);
  const selectedBook = selectedBookId ? booksById.get(selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? topBooks.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => setSelectedBookId(topBooks[selectedIndex - 1].id) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < topBooks.length - 1 ? () => setSelectedBookId(topBooks[selectedIndex + 1].id) : undefined;

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-14 lg:pt-20">
        <div>
          <h1 className="max-w-2xl font-[var(--font-serif)] text-4xl font-light leading-[1.02] sm:text-5xl lg:text-5xl">
            A searchable index of award-winning books
          </h1>
          <p className="mt-6 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
            Browse award-winning, shortlisted, and longlisted books by subject, prize, imprint, publisher,
            figure, period, and source.
          </p>
        </div>

        <div className="panel self-end border hairline p-4 sm:p-5">
          <div className="flex items-center gap-3 border-b hairline pb-4">
            <Search size={20} className="muted" />
            <input
              className="w-full bg-transparent text-lg outline-none placeholder:text-[var(--muted)]"
              placeholder="Search books, awards, authors, subjects..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex border hairline p-1 font-[var(--font-mono)] text-xs">
              {(["keyword", "semantic"] as const).map((item) => (
                <button
                  key={item}
                  className={`focus-ring px-3 py-2 capitalize transition ${
                    mode === item ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:text-[var(--ink)]"
                  }`}
                  onClick={() => setMode(item)}
                  title={item === "semantic" ? "Semantic search will use the embeddings pipeline in the next pass." : ""}
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="font-[var(--font-mono)] text-xs muted">
              {data.appearances.length} records / {rankedBooks.length} books
            </p>
          </div>
          {mode === "semantic" ? (
            <p className="mt-4 border-l-2 border-[var(--accent)] pl-3 text-sm muted">
              Semantic mode is wired into the interface; the embedding build step comes after the core data model and
              provenance surfaces are stable.
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-y hairline" id="subjects">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:px-8">
          <BrowseList
            title="Subjects"
            expanded={subjectsExpanded}
            onToggle={() => setSubjectsExpanded(!subjectsExpanded)}
            items={data.subjects.slice(0, subjectsExpanded ? 18 : 9).map((subject) => ({
              id: subject.id,
              label: subject.name,
              meta: `${subject.bookCount} books`,
              href: `/subjects/${subject.slug}`,
            }))}
          />
          <BrowseList
            title="Prizes"
            id="awards"
            expanded={prizesExpanded}
            onToggle={() => setPrizesExpanded(!prizesExpanded)}
            items={data.awards.slice(0, prizesExpanded ? data.awards.length : 9).map((award) => ({
              id: award.id,
              label: award.name,
              meta: `${data.appearances.filter((appearance) => appearance.awardId === award.id).length} records`,
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
                className={`focus-ring border hairline px-3 py-2 capitalize transition ${
                  sortKey === key ? "bg-[var(--ink)] text-[var(--paper)]" : "panel muted hover:text-[var(--ink)]"
                }`}
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
                const stats = getBookStats(book.id);
                const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
                const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
                return (
                  <tr
                    key={book.id}
                    className={`book-table-row fade-up cursor-pointer border-b hairline transition hover:bg-[var(--accent-soft)] ${
                      selectedBookId === book.id ? "book-table-row-active" : ""
                    }`}
                    style={{ animationDelay: `${Math.min(index * 18, 140)}ms` }}
                    onClick={() => setSelectedBookId(book.id)}
                  >
                    <td className="plain-number px-4 py-4 text-sm muted">{book.publicationYear}</td>
                    <td className="px-4 py-4">
                      <span className="font-[var(--font-serif)] text-xl font-light">{book.title}</span>
                    </td>
                    <td className="px-4 py-4 text-sm">{book.authors.map((author) => author.name).join(", ")}</td>
                    <td className="plain-number px-4 py-4 text-sm">{stats.wins}</td>
                    <td className="plain-number px-4 py-4 text-sm">{stats.lists}</td>
                    <td className="px-4 py-4 text-sm">{imprint || "Unknown"}</td>
                    <td className="px-4 py-4 text-sm muted">{publisher || "Not yet sourced"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" id="publishers">
        <div className="grid gap-4 border-t hairline pt-8 font-[var(--font-mono)] text-xs muted sm:grid-cols-4">
          <Stat label="Books" value={data.books.length} />
          <Stat label="Award appearances" value={data.appearances.length} />
          <Stat label="Prizes" value={data.awards.length} />
          <Stat label="Imprints" value={data.imprints.length} />
        </div>
      </section>

      <BookDrawer
        book={selectedBook}
        appearances={selectedBook ? data.appearances.filter((appearance) => appearance.bookId === selectedBook.id) : []}
        currentLabel={selectedIndex >= 0 ? `${selectedIndex + 1} of ${topBooks.length}` : undefined}
        onClose={() => setSelectedBookId(null)}
        onNext={goNext}
        onPrevious={goPrevious}
      />
    </main>
  );
}

function BrowseList({
  title,
  items,
  id,
  expanded,
  onToggle,
}: {
  title: string;
  id?: string;
  items: { id: string; label: string; meta: string; href: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div id={id}>
      <h2 className="mb-4 font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">{title}</h2>
      <div className="border-t hairline">
        {items.map((item) => (
          <Link
            href={item.href}
            key={item.id}
            className="group flex items-center justify-between gap-4 border-b hairline py-2.5 transition hover:bg-[var(--panel)]"
          >
            <span className="font-[var(--font-serif)] text-lg font-light sm:text-xl">{item.label}</span>
            <span className="flex items-center gap-2 font-[var(--font-mono)] text-xs muted">
              {item.meta}
              <ArrowUpRight size={13} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Link>
        ))}
      </div>
      <button
        className="focus-ring mx-auto mt-4 flex items-center gap-2 border hairline px-4 py-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] muted transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
        onClick={onToggle}
      >
        {expanded ? "Show less" : "See more"}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p>{label}</p>
      <p className="mt-1 text-2xl text-[var(--ink)]">{value.toLocaleString()}</p>
    </div>
  );
}
