"use client";

import Link from "next/link";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignJustify, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { filterBooksByQuery, sortBooks, type BookSortKey } from "@/lib/catalog";
import { data, getBookStats, imprintsById, subjectsByName } from "@/lib/data";
import type { Book } from "@/lib/types";

type MetadataFilter = "all" | "complete" | "missing" | "has_cover" | "missing_cover" | "missing_publisher";

const metadataFilterLabels: Record<MetadataFilter, string> = {
  all: "All metadata",
  complete: "Complete basics",
  missing: "Missing basics",
  has_cover: "Has cover",
  missing_cover: "Missing cover",
  missing_publisher: "Missing publisher",
};

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
  const [subjectFilter, setSubjectFilter] = useState("");
  const [awardFilter, setAwardFilter] = useState("");
  const [publisherFilter, setPublisherFilter] = useState("");
  const [metadataFilter, setMetadataFilter] = useState<MetadataFilter>("all");
  const [showOptions, setShowOptions] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [density, setDensity] = useState<"compact" | "normal" | "roomy">("normal");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const topicFilter = searchParams.get("topic");
  const pageSize = 100;
  const awardBookIds = useMemo(() => {
    if (!awardFilter) return null;
    return new Set(data.appearances.filter((appearance) => appearance.awardId === awardFilter).map((appearance) => appearance.bookId));
  }, [awardFilter]);
  const publisherOptions = useMemo(
    () =>
      data.publishers
        .filter((publisher) => books.some((book) => book.publisherId === publisher.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [books],
  );
  const hasActiveFilters = Boolean(query || topicFilter || subjectFilter || awardFilter || publisherFilter || metadataFilter !== "all");
  const filteredRows = useMemo(() => {
    const structuredFiltered = books.filter((book) => {
      if (topicFilter && !book.topics.includes(topicFilter)) return false;
      if (subjectFilter && !book.subjects.includes(subjectFilter)) return false;
      if (awardBookIds && !awardBookIds.has(book.id)) return false;
      if (publisherFilter && book.publisherId !== publisherFilter) return false;
      if (!matchesMetadataFilter(book, metadataFilter)) return false;
      return true;
    });
    const filtered = filterBooksByQuery(structuredFiltered, query);
    return sortBooks(filtered, sortKey);
  }, [awardBookIds, books, metadataFilter, publisherFilter, query, sortKey, subjectFilter, topicFilter]);

  const totalRows = limit ? Math.min(filteredRows.length, limit) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageNumbers = paginationRange(safePage, totalPages);
  const selectedBook = selectedBookId ? data.books.find((book) => book.id === selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? filteredRows.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => openBook(filteredRows[selectedIndex - 1]) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < totalRows - 1 ? () => openBook(filteredRows[selectedIndex + 1]) : undefined;
  const rowPadding = density === "compact" ? "py-2" : density === "roomy" ? "py-5" : "py-3.5";
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

  function resetFilters() {
    setQuery("");
    setSubjectFilter("");
    setAwardFilter("");
    setPublisherFilter("");
    setMetadataFilter("all");
    setPage(1);
    if (topicFilter) router.replace(pathname, { scroll: false });
  }

  function clearTopicFilter() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("topic");
    nextParams.delete("book");
    setPage(1);
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  const activeFilterChips = [
    query.trim()
      ? {
          id: "query",
          label: `Search: ${query.trim()}`,
          onRemove: () => {
            setQuery("");
            setPage(1);
          },
        }
      : null,
    topicFilter
      ? {
          id: "topic",
          label: `Topic: ${titleCaseLabel(topicFilter)}`,
          onRemove: clearTopicFilter,
        }
      : null,
    subjectFilter
      ? {
          id: "subject",
          label: `Subject: ${subjectFilter}`,
          onRemove: () => {
            setSubjectFilter("");
            setPage(1);
          },
        }
      : null,
    awardFilter
      ? {
          id: "award",
          label: `Award: ${data.awards.find((award) => award.id === awardFilter)?.shortName ?? data.awards.find((award) => award.id === awardFilter)?.name ?? awardFilter}`,
          onRemove: () => {
            setAwardFilter("");
            setPage(1);
          },
        }
      : null,
    publisherFilter
      ? {
          id: "publisher",
          label: `Publisher: ${data.publishers.find((publisher) => publisher.id === publisherFilter)?.name ?? publisherFilter}`,
          onRemove: () => {
            setPublisherFilter("");
            setPage(1);
          },
        }
      : null,
    metadataFilter !== "all"
      ? {
          id: "metadata",
          label: `Metadata: ${metadataFilterLabels[metadataFilter]}`,
          onRemove: () => {
            setMetadataFilter("all");
            setPage(1);
          },
        }
      : null,
  ].filter(Boolean) as Array<{ id: string; label: string; onRemove: () => void }>;

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 grid gap-5 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Catalog</p>
          <h1 className="mt-2 text-4xl leading-tight">{title}</h1>
          {deck ? <p className="mt-3 max-w-md text-lg leading-7 muted">{deck}</p> : null}
        </div>
        <div className="grid gap-3">
          <div className="subjects-search focus-within:border-[var(--ink)]">
            <Search size={18} className="muted" />
            <input
              className="min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-[var(--muted)]"
              placeholder="Search title, author, award, subject, imprint..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
            <div className="ml-auto hidden shrink-0 overflow-hidden rounded-md border hairline bg-[color-mix(in_srgb,var(--paper)_68%,var(--panel))] p-1 font-[var(--font-mono)] text-xs sm:flex">
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 font-[var(--font-mono)] text-xs">
            <span className="muted">
              <span className="plain-number text-[var(--ink)]">{totalRows.toLocaleString()}</span> books
              {hasActiveFilters ? <span className="ml-2 text-[var(--ink)]">filtered</span> : null}
            </span>
            <div className="flex items-center gap-2">
              {hasActiveFilters ? (
                <button className="focus-ring inline-flex items-center gap-2 px-2 py-1 text-[var(--ink)] transition hover:text-[var(--accent)]" onClick={resetFilters} type="button">
                  Clear
                  <X size={12} />
                </button>
              ) : null}
              <button
                aria-expanded={showOptions}
                className="focus-ring inline-flex items-center gap-2 rounded-md border hairline bg-[color-mix(in_srgb,var(--paper)_76%,var(--panel))] px-3 py-2 text-[var(--ink)] transition hover:bg-[var(--panel)]"
                onClick={() => setShowOptions((value) => !value)}
                type="button"
              >
                <SlidersHorizontal size={14} />
                {showOptions ? "Hide options" : "More options"}
                <ChevronDown className={`transition ${showOptions ? "rotate-180" : ""}`} size={13} />
              </button>
            </div>
          </div>
          {showOptions ? (
            <div className="panel rounded-lg border hairline p-4 shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_4%,transparent)]">
              <div className="flex flex-wrap items-center gap-2 border-b hairline pb-3 font-[var(--font-mono)] text-xs">
                <span className="mr-1 uppercase tracking-[0.16em] muted">Sort</span>
                {(["score", "wins", "lists", "year", "title", "author", "imprint", "publisher"] as BookSortKey[]).map((key) => (
                  <button
                    key={key}
                    className={`focus-ring inline-flex items-center gap-1 rounded-md border hairline px-3 py-2 capitalize transition ${
                      sortKey === key ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                    }`}
                    onClick={() => {
                      setSortKey(key);
                      setPage(1);
                    }}
                    type="button"
                  >
                    {key}
                    {sortKey === key ? <ChevronDown size={12} /> : null}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 font-[var(--font-mono)] text-xs sm:grid-cols-2 xl:grid-cols-4">
                <FilterSelect
                  label="Subject"
                  value={subjectFilter}
                  onChange={(value) => {
                    setSubjectFilter(value);
                    setPage(1);
                  }}
                  options={data.subjects.map((subject) => ({ value: subject.name, label: subject.name }))}
                />
                <FilterSelect
                  label="Award"
                  value={awardFilter}
                  onChange={(value) => {
                    setAwardFilter(value);
                    setPage(1);
                  }}
                  options={data.awards.map((award) => ({ value: award.id, label: award.shortName ?? award.name }))}
                />
                <FilterSelect
                  label="Publisher"
                  value={publisherFilter}
                  onChange={(value) => {
                    setPublisherFilter(value);
                    setPage(1);
                  }}
                  options={publisherOptions.map((publisher) => ({ value: publisher.id, label: publisher.name }))}
                />
                <FilterSelect
                  label="Metadata"
                  value={metadataFilter}
                  onChange={(value) => {
                    setMetadataFilter(value as MetadataFilter);
                    setPage(1);
                  }}
                  options={[
                    { value: "complete", label: "Complete basics" },
                    { value: "missing", label: "Missing basics" },
                    { value: "has_cover", label: "Has cover" },
                    { value: "missing_cover", label: "Missing cover" },
                    { value: "missing_publisher", label: "Missing publisher" },
                  ]}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto border hairline panel">
        <div className="flex min-w-[1180px] items-center justify-between border-b hairline px-4 py-3 font-[var(--font-mono)] text-xs">
          <div className="flex items-center gap-3 muted">
            <span>
              Showing <span className="plain-number text-[var(--ink)]">{pageSize}</span> per page
            </span>
            {topicFilter ? (
              <button
                className="focus-ring inline-flex items-center gap-2 border hairline px-3 py-2 text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
                onClick={clearTopicFilter}
                type="button"
              >
                {titleCaseLabel(topicFilter)}
                <X size={12} />
              </button>
            ) : null}
            {hasActiveFilters ? (
              <button className="focus-ring inline-flex items-center gap-2 border hairline px-3 py-2 text-[var(--ink)] transition hover:bg-[var(--accent-soft)]" onClick={resetFilters}>
                Clear filters
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-5 muted">
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
        {activeFilterChips.length ? (
          <div className="flex min-w-[1180px] flex-wrap items-center gap-2 border-b hairline px-4 py-3 font-[var(--font-mono)] text-xs">
            <span className="mr-1 uppercase tracking-[0.16em] muted">Filters</span>
            {activeFilterChips.map((chip) => (
              <button
                className="focus-ring inline-flex max-w-[24rem] items-center gap-2 rounded-full border hairline bg-[color-mix(in_srgb,var(--paper)_78%,var(--panel))] px-3 py-1.5 text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
                key={chip.id}
                onClick={chip.onRemove}
                title={chip.label}
                type="button"
              >
                <span className="truncate">{chip.label}</span>
                <X className="shrink-0" size={12} />
              </button>
            ))}
          </div>
        ) : null}
        <table className="w-full min-w-[1180px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[27%]" />
            <col className="w-[14%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[13%]" />
            <col className="w-[28%]" />
          </colgroup>
          <thead className="bg-[var(--panel)] font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.11em] muted">
            <tr className="border-b hairline">
              {([
                ["Year", "year"],
                ["Title", "title"],
                ["Author", "author"],
                ["Wins", "wins"],
                ["Lists", "lists"],
                ["Imprint", "imprint"],
                ["Subjects", "subject"],
              ] as [string, BookSortKey][]).map(([heading, key]) => (
                <th className="px-3 py-3 align-bottom font-normal" key={heading}>
                  <button
                    className={`focus-ring inline-flex items-center gap-1 transition hover:text-[var(--ink)] ${
                      sortKey === key ? "text-[var(--ink)]" : ""
                    }`}
                    onClick={() => {
                      setSortKey(key);
                      setPage(1);
                    }}
                    type="button"
                  >
                    {heading}
                    {sortKey === key ? <ChevronDown size={10} /> : <ChevronsUpDown size={10} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-16 text-center" colSpan={7}>
                  <p className="text-lg">No books match the current view.</p>
                  <p className="mt-2 text-sm muted">Try clearing a filter or broadening the search.</p>
                  {hasActiveFilters ? (
                    <button className="focus-ring mt-5 inline-flex items-center gap-2 border hairline px-4 py-3 text-sm transition hover:bg-[var(--accent-soft)]" onClick={resetFilters} type="button">
                      Clear filters
                      <X size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ) : rows.map((book, index) => {
              const stats = getBookStats(book.id);
              const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
              const firstRecognitionYear = Math.min(...data.appearances.filter((appearance) => appearance.bookId === book.id).map((appearance) => appearance.year));
              const displayYear = book.publicationYear ?? (Number.isFinite(firstRecognitionYear) ? firstRecognitionYear : undefined);
              return (
                <tr
                  key={book.id}
                  className={`book-table-row fade-up cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                    selectedBookId === book.id ? "book-table-row-active" : ""
                  }`}
                  style={{ animationDelay: `${Math.min(index * 10, 100)}ms` }}
                  onClick={() => openBook(book)}
                >
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{displayYear ?? "—"}</td>
                  <td className={`px-3 ${rowPadding}`}>
                    <button
                      className="book-catalog-title focus-ring block w-full text-left text-base transition hover:text-[var(--accent)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        openBook(book);
                      }}
                      type="button"
                    >
                      {book.title}
                    </button>
                  </td>
                  <td className={`px-3 ${rowPadding}`}>
                    <span className="line-clamp-2">{book.authors.map((author) => author.name).join(", ")}</span>
                  </td>
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.wins}</td>
                  <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.lists}</td>
                  <td className={`px-3 ${rowPadding}`}>
                    <span className="line-clamp-2">{imprint || "Unknown"}</span>
                  </td>
                  <td className={`px-3 ${rowPadding}`}>
                    <div className="grid max-w-full gap-2">
                      {book.primarySubject ? (
                        <div>
                          <CatalogSubjectPill
                            onClick={(event) => event.stopPropagation()}
                            subject={book.primarySubject}
                          />
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {book.topics.slice(0, 3).map((topic) => (
                          <CatalogTopicTag
                            isPrimary={topic === book.primaryTopic}
                            key={topic}
                            onClick={(event) => event.stopPropagation()}
                            topic={topic}
                          />
                        ))}
                        {book.topics.length > 3 ? (
                          <span className="plain-number text-[0.58rem] text-[var(--muted)]">+{book.topics.length - 3}</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex min-w-[1180px] items-center justify-between border-t hairline px-4 py-3 font-[var(--font-mono)] text-xs muted">
          <p>
            {totalRows > 0 ? (
              <>
                Showing <span className="plain-number">{(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalRows)}</span> of <span className="plain-number">{totalRows.toLocaleString()}</span> books
              </>
            ) : (
              "No matching books"
            )}
          </p>
          <p>{topicFilter ? `Filtered by ${titleCaseLabel(topicFilter)}` : `Sorted by ${sortKey === "score" ? "award activity" : sortKey}`}</p>
          <div className="flex items-center gap-2">
            <button
              className="focus-ring grid h-8 w-8 place-items-center border hairline transition hover:bg-[var(--panel)] disabled:opacity-40"
              disabled={safePage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            {totalRows > 0 ? pageNumbers.map((value, index) =>
              value === "ellipsis" ? (
                <span className="px-2" key={`ellipsis-${index}`}>...</span>
              ) : (
                <button
                  className={`focus-ring plain-number grid h-8 w-8 place-items-center border hairline transition ${
                    safePage === value ? "bg-[var(--ink)] text-[var(--paper)]" : "hover:bg-[var(--panel)]"
                  }`}
                  key={value}
                  onClick={() => setPage(value)}
                >
                  {value}
                </button>
              ),
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

function paginationRange(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current, current - 1, current + 1].filter((value) => value >= 1 && value <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const output: Array<number | "ellipsis"> = [];
  for (const value of sorted) {
    const previous = output[output.length - 1];
    if (typeof previous === "number" && value - previous > 1) output.push("ellipsis");
    output.push(value);
  }
  return output;
}

function CatalogSubjectPill({
  subject,
  onClick,
}: {
  subject: string;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const subjectSlug = subjectsByName.get(subject.toLowerCase())?.slug;
  return (
    <Link
      className={`subject-chip ${subjectChipClass(subject)} focus-ring rounded-full border hairline px-2.5 py-[0.22rem] text-[0.72rem]`}
      href={subjectSlug ? `/subjects/${subjectSlug}` : "/subjects"}
      onClick={onClick}
    >
      {subject}
    </Link>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="uppercase tracking-[0.16em] muted">{label}</span>
      <select
        className="focus-ring min-w-0 border hairline bg-[var(--paper)] px-3 py-2 font-sans text-sm normal-case tracking-normal text-[var(--ink)] transition hover:bg-[var(--panel)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function matchesMetadataFilter(book: Book, filter: MetadataFilter) {
  const hasCompleteBasics = Boolean(book.isbn13.length && book.pageCount && book.thumbnailUrl && book.publisherId);
  if (filter === "all") return true;
  if (filter === "complete") return hasCompleteBasics;
  if (filter === "missing") return !hasCompleteBasics;
  if (filter === "has_cover") return Boolean(book.thumbnailUrl);
  if (filter === "missing_cover") return !book.thumbnailUrl;
  if (filter === "missing_publisher") return !book.publisherId;
  return true;
}

function subjectChipClass(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("american history") || normalized === "history") return "subject-chip-brick";
  if (normalized.includes("world history") || normalized.includes("travel")) return "subject-chip-teal";
  if (normalized.includes("biography") || normalized.includes("memoir")) return "subject-chip-plum";
  if (normalized.includes("politics") || normalized.includes("journalism")) return "subject-chip-indigo";
  if (normalized.includes("society") || normalized.includes("race") || normalized.includes("gender") || normalized.includes("religion")) return "subject-chip-olive";
  if (normalized.includes("science") || normalized.includes("medicine") || normalized.includes("technology") || normalized.includes("nature")) return "subject-chip-slate";
  if (normalized.includes("business") || normalized.includes("arts") || normalized.includes("sports")) return "subject-chip-ochre";
  if (normalized.includes("war") || normalized.includes("crime") || normalized.includes("justice")) return "subject-chip-forest";
  return "subject-chip-teal";
}

function CatalogTopicTag({
  topic,
  isPrimary,
  onClick,
}: {
  topic: string;
  isPrimary?: boolean;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      className={`topic-tag topic-tag-compact focus-ring ${isPrimary ? "topic-tag-primary" : ""}`}
      href={`/books?topic=${encodeURIComponent(topic)}`}
      onClick={onClick}
    >
      {titleCaseLabel(topic)}
    </Link>
  );
}

function titleCaseLabel(value: string) {
  const smallWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "vs", "with"]);
  return value
    .toLowerCase()
    .split(/(\s+|[-/&])/)
    .map((part, index) => {
      if (!/[a-z0-9]/.test(part)) return part;
      if (index > 0 && smallWords.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
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
