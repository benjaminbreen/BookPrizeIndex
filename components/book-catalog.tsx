"use client";

import Link from "next/link";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignJustify, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Filter, MoreHorizontal, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { filterBooksByQuery, sortBooks, type BookSortKey } from "@/lib/catalog";
import { data, getBookStats, imprintsById, publishersById, subjectsByName } from "@/lib/data";
import type { Book } from "@/lib/types";

export function BookCatalog({
  books,
  title = "Books",
  deck,
  limit,
}: {
  books: Book[];
  title?: string;
  deck?: string;
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [page, setPage] = useState(1);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [density, setDensity] = useState<"compact" | "normal" | "roomy">("normal");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageSize = 25;

  const filteredRows = useMemo(() => {
    const filtered = filterBooksByQuery(books, query);
    return sortBooks(filtered, sortKey);
  }, [books, limit, query, sortKey]);

  const totalRows = limit ? Math.min(filteredRows.length, limit) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedBook = selectedBookId ? data.books.find((book) => book.id === selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? filteredRows.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => openBook(filteredRows[selectedIndex - 1]) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < totalRows - 1 ? () => openBook(filteredRows[selectedIndex + 1]) : undefined;
  const rowPadding = density === "compact" ? "py-2" : density === "roomy" ? "py-5" : "py-3.5";
  const topicChipPadding = density === "compact" ? "py-[0.08rem]" : "py-[0.14rem]";

  useEffect(() => {
    const slug = searchParams.get("book");
    if (!slug) {
      setSelectedBookId(null);
      return;
    }

    const bookFromUrl = books.find((book) => book.slug === slug) ?? data.books.find((book) => book.slug === slug);
    setSelectedBookId(bookFromUrl?.id ?? null);
  }, [books, searchParams]);

  function setBookParam(bookSlug: string | null) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (bookSlug) {
      nextParams.set("book", bookSlug);
    } else {
      nextParams.delete("book");
    }
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function openBook(book: Book) {
    setSelectedBookId(book.id);
    setBookParam(book.slug);
  }

  function closeBook() {
    setSelectedBookId(null);
    setBookParam(null);
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 grid gap-5 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Catalog</p>
          <h1 className="mt-2 text-4xl leading-tight">{title}</h1>
          {deck ? <p className="mt-3 max-w-md text-lg leading-7 muted">{deck}</p> : null}
        </div>
        <div className="panel border hairline p-4">
          <div className="flex items-center gap-3 border-b hairline pb-3">
            <Search size={18} className="muted" />
            <input
              className="w-full bg-transparent text-base outline-none placeholder:text-[var(--muted)]"
              placeholder="Search title, author, award, subject, imprint..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <div className="ml-auto flex shrink-0 border hairline p-1 font-[var(--font-mono)] text-xs">
              {(["keyword", "semantic"] as const).map((item) => (
                <button
                  key={item}
                  className={`focus-ring px-4 py-2 capitalize transition ${
                    mode === item ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:text-[var(--ink)]"
                  }`}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-[var(--font-mono)] text-xs">
            {(["score", "wins", "lists", "year", "title", "imprint", "publisher"] as BookSortKey[]).map((key) => (
              <button
                key={key}
                className={`focus-ring inline-flex items-center gap-1 border hairline px-3 py-2 capitalize transition ${
                  sortKey === key ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                }`}
                onClick={() => {
                  setSortKey(key);
                  setPage(1);
                }}
              >
                {key}
                {sortKey === key && key === "score" ? <ChevronDown size={12} /> : null}
              </button>
            ))}
            <span className="ml-auto self-center text-sm muted">{totalRows.toLocaleString()} books</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border hairline panel">
        <div className="flex min-w-[1180px] items-center justify-between border-b hairline px-4 py-3 font-[var(--font-mono)] text-xs">
          <button className="focus-ring inline-flex items-center gap-2 border hairline px-3 py-2 transition hover:bg-[var(--accent-soft)]">
            <Filter size={14} />
            All filters
            <ChevronDown size={12} />
          </button>
          <div className="flex items-center gap-5 muted">
            <button className="transition hover:text-[var(--ink)]">Clear</button>
            <div className="flex items-center gap-2">
              <span>Density</span>
              {(["compact", "normal", "roomy"] as const).map((value) => (
                <button
                  aria-label={`${value} row density`}
                  className={`focus-ring grid h-8 w-8 place-items-center border hairline transition ${
                    density === value ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink)] hover:bg-[var(--panel)]"
                  }`}
                  key={value}
                  onClick={() => setDensity(value)}
                  title={`${value[0].toUpperCase()}${value.slice(1)} density`}
                >
                  <DensityIcon density={value} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <table className="w-full min-w-[1180px] border-collapse text-left">
          <thead className="bg-[var(--panel)] font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.11em] muted">
            <tr className="border-b hairline">
              {["Year", "Title", "Author", "Score", "Wins", "Lists", "Publisher", "Imprint", "Subjects", ""].map((heading) => (
                <th className="px-3 py-3 align-bottom font-normal" key={heading}>
                  <span className="inline-flex items-center gap-1">
                    {heading}
                    {heading ? <ChevronsUpDown size={10} /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((book, index) => {
              const stats = getBookStats(book.id);
              const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
              const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
              return (
                <tr
                  key={book.id}
                  className={`book-table-row fade-up cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                    selectedBookId === book.id ? "book-table-row-active" : ""
                  }`}
                  style={{ animationDelay: `${Math.min(index * 10, 100)}ms` }}
                  onClick={() => openBook(book)}
                >
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{book.publicationYear}</td>
                  <td className={`px-3 ${rowPadding}`}>
                    <Link
                      className="text-base transition hover:text-[var(--accent)]"
                      href={`/books/${book.slug}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {book.title}
                    </Link>
                  </td>
                  <td className={`px-3 ${rowPadding}`}>{book.authors.map((author) => author.name).join(", ")}</td>
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.score}</td>
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.wins}</td>
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.lists}</td>
                  <td className={`px-3 ${rowPadding}`}>{publisher || "Not yet sourced"}</td>
                  <td className={`px-3 ${rowPadding}`}>{imprint || "Unknown"}</td>
                  <td className={`px-3 ${rowPadding}`}>
                    <div className="flex max-w-72 flex-wrap items-center gap-1.5">
                      {book.subjects.slice(0, 2).map((subject, subjectIndex) => (
                        <CatalogSubjectPill
                          index={subjectIndex}
                          key={subject}
                          onClick={(event) => event.stopPropagation()}
                          subject={subject}
                        />
                      ))}
                      {book.subjects.length > 2 ? (
                        <span className="plain-number rounded-full border hairline px-2 py-[0.18rem] text-[0.58rem] text-[var(--muted)]">+{book.subjects.length - 2}</span>
                      ) : null}
                      {book.topics.slice(0, 3).map((topic) => (
                        <span className={`topic-chip rounded-full border hairline px-1.5 ${topicChipPadding} font-[var(--font-mono)] text-[0.48rem] uppercase tracking-[0.08em]`} key={topic}>
                          {topic}
                        </span>
                      ))}
                      {book.topics.length > 3 ? (
                        <span className="plain-number topic-chip rounded-full border hairline px-1.5 py-[0.08rem] text-[0.48rem]">+{book.topics.length - 3}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className={`px-3 ${rowPadding}`}>
                    <button className="focus-ring grid h-7 w-7 place-items-center" aria-label={`Actions for ${book.title}`}>
                      <MoreHorizontal size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex min-w-[1180px] items-center justify-between border-t hairline px-4 py-3 font-[var(--font-mono)] text-xs muted">
          <p>
            Showing <span className="plain-number">{(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalRows)}</span> of <span className="plain-number">{totalRows.toLocaleString()}</span> books
          </p>
          <p>Sorted by {sortKey === "score" ? "award score" : sortKey}</p>
          <div className="flex items-center gap-2">
            <button
              className="focus-ring grid h-8 w-8 place-items-center border hairline transition hover:bg-[var(--panel)] disabled:opacity-40"
              disabled={safePage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            {[1, 2, 3, 4, 5].filter((value) => value <= totalPages).map((value) => (
              <button
                className={`focus-ring plain-number grid h-8 w-8 place-items-center border hairline transition ${
                  safePage === value ? "bg-[var(--ink)] text-[var(--paper)]" : "hover:bg-[var(--panel)]"
                }`}
                key={value}
                onClick={() => setPage(value)}
              >
                {value}
              </button>
            ))}
            {totalPages > 5 ? <span className="px-2">...</span> : null}
            {totalPages > 5 ? (
              <button className="focus-ring plain-number border hairline px-3 py-2 transition hover:bg-[var(--panel)]" onClick={() => setPage(totalPages)}>
                {totalPages}
              </button>
            ) : null}
            <button
              className="focus-ring grid h-8 w-8 place-items-center border hairline transition hover:bg-[var(--panel)] disabled:opacity-40"
              disabled={safePage === totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
      <BookDrawer
        book={selectedBook}
        appearances={selectedBook ? data.appearances.filter((appearance) => appearance.bookId === selectedBook.id) : []}
        currentLabel={selectedIndex >= 0 ? `${selectedIndex + 1} of ${totalRows}` : undefined}
        onClose={closeBook}
        onNext={goNext}
        onPrevious={goPrevious}
      />
    </section>
  );
}

function CatalogSubjectPill({
  subject,
  index,
  onClick,
}: {
  subject: string;
  index: number;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const subjectSlug = subjectsByName.get(subject.toLowerCase())?.slug;
  return (
    <Link
      className={`subject-chip subject-chip-${index % 6} subject-chip-compact focus-ring rounded-full border hairline px-2.5 py-[0.22rem] text-[0.62rem]`}
      href={subjectSlug ? `/subjects/${subjectSlug}` : "/subjects"}
      onClick={onClick}
    >
      {subject}
    </Link>
  );
}

function DensityIcon({ density }: { density: "compact" | "normal" | "roomy" }) {
  if (density === "compact") {
    return <AlignJustify size={15} strokeWidth={2.5} />;
  }
  if (density === "roomy") {
    return (
      <span className="grid gap-1">
        <span className="block h-px w-4 bg-current" />
        <span className="block h-px w-4 bg-current" />
        <span className="block h-px w-4 bg-current" />
      </span>
    );
  }
  return (
    <span className="grid gap-0.5">
      <span className="block h-px w-4 bg-current" />
      <span className="block h-px w-4 bg-current" />
      <span className="block h-px w-4 bg-current" />
    </span>
  );
}
