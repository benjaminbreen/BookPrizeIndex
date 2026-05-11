"use client";

import Link from "next/link";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Rows2, Rows3, Rows4, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { SearchModeSelect } from "@/components/ui/design-primitives";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import { filterBooksByQuery, getBookStatsForRegion, sortBooks, type BookSortKey } from "@/lib/catalog";
import { data, imprintsById, publishersById, subjectsByName } from "@/lib/data";
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

const bookSortLabels: Record<BookSortKey, string> = {
  score: "Recognition score",
  wins: "Most wins",
  lists: "Most lists",
  year: "Newest year",
  title: "Title A-Z",
  author: "Author A-Z",
  publisher: "Publisher A-Z",
  imprint: "Imprint A-Z",
  subject: "Subject A-Z",
};

export function BookCatalog({
  books,
  title = "Books",
  deck,
  secondaryDeck,
  limit,
  compactHeader = false,
  wideLayout = false,
  defaultRegion = "us",
}: {
  books: Book[];
  title?: string | null;
  deck?: React.ReactNode;
  secondaryDeck?: React.ReactNode;
  limit?: number;
  compactHeader?: boolean;
  wideLayout?: boolean;
  defaultRegion?: AwardRegionFilter;
}) {
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);
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
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
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
    return sortBooks(filtered, sortKey, region);
  }, [awardBookIds, books, metadataFilter, publisherFilter, query, region, sortKey, subjectFilter, topicFilter]);

  const totalRows = limit ? Math.min(filteredRows.length, limit) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageNumbers = paginationRange(safePage, totalPages);
  const selectedBook = selectedBookId ? data.books.find((book) => book.id === selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? filteredRows.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => openBook(filteredRows[selectedIndex - 1]) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < totalRows - 1 ? () => openBook(filteredRows[selectedIndex + 1]) : undefined;
  const rowPadding = density === "compact" ? "py-1.5" : density === "roomy" ? "py-4" : "py-2.5";
  const coverSize = density === "roomy" ? "large" : "standard";
  const showRowCovers = density !== "compact";
  const tableMinWidth = wideLayout ? "min-w-[1320px]" : "min-w-[1180px]";
  const showDenseCatalogControls = wideLayout && !compactHeader;
  useEffect(() => {
    setQuery(urlQuery);
    setPage(1);
  }, [urlQuery]);

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
    if (topicFilter || urlQuery) router.replace(pathname, { scroll: false });
  }

  function setRegion(nextRegion: AwardRegionFilter) {
    setRegionState(nextRegion);
    setPage(1);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextRegion}; path=/; max-age=31536000; samesite=lax`;
  }

  function clearQuery() {
    setQuery("");
    setPage(1);
    if (!urlQuery) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("q");
    nextParams.delete("book");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
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
          onRemove: clearQuery,
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
  const resultContext = `${regionLabel(region)} awards · ${topicFilter ? `Topic: ${titleCaseLabel(topicFilter)} · ` : ""}Sorted by ${bookSortLabels[sortKey].toLowerCase()} · ${totalRows.toLocaleString()} books${hasActiveFilters ? " · filtered" : ""}`;

  return (
    <section className={`mx-auto ${wideLayout ? "max-w-[90rem]" : "max-w-7xl"} px-4 sm:px-6 lg:px-8 ${compactHeader ? "pb-10" : wideLayout ? "py-4" : "py-10"}`}>
      <div className={`mx-auto mb-6 grid max-w-7xl gap-8 lg:items-center ${wideLayout ? "min-[1345px]:px-8" : ""} ${compactHeader ? "lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)]" : "lg:grid-cols-[0.86fr_1fr]"}`}>
        <div>
          {title === null ? null : (
            <>
              <h1 className="font-[var(--font-serif)] text-5xl font-light leading-tight">{title}</h1>
            </>
          )}
          {deck ? <p className={`${title === null ? "" : "mt-5"} max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted`}>{deck}</p> : null}
          {secondaryDeck ? <p className="mt-3 max-w-2xl text-sm leading-6 muted">{secondaryDeck}</p> : null}
        </div>
        <div className={`grid gap-3 ${compactHeader ? "lg:justify-self-end lg:w-full lg:max-w-3xl" : ""}`}>
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
                onClick={clearQuery}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
            <SearchModeSelect onChange={setMode} value={mode} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 font-[var(--font-mono)] text-xs">
            <span className="muted">
              {resultContext}
            </span>
            <div className={`items-center gap-2 ${showDenseCatalogControls ? "hidden" : "flex"}`}>
              {hasActiveFilters ? (
                <button className="filter-chip focus-ring inline-flex items-center gap-2 px-3 py-1.5 text-[var(--ink)]" onClick={resetFilters} type="button">
                  Clear
                  <X size={12} />
                </button>
              ) : null}
              <button
                aria-expanded={showOptions}
                className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2"
                onClick={() => setShowOptions((value) => !value)}
                type="button"
              >
                <SlidersHorizontal size={14} />
                {showOptions ? "Hide options" : "More options"}
                <ChevronDown className={`transition ${showOptions ? "rotate-180" : ""}`} size={13} />
              </button>
            </div>
          </div>
          {showOptions && !showDenseCatalogControls ? (
            <div className="panel rounded-[2px] border hairline p-4 shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_4%,transparent)]">
              <div className="filter-group border-b hairline pb-3 font-[var(--font-mono)] text-xs">
                <span className="filter-label mr-1">Awards</span>
                {(["us", "international", "all"] as const).map((item) => (
                  <button
                    key={item}
                    className={`filter-chip focus-ring inline-flex items-center gap-1 px-3 py-2 ${region === item ? "segment-button-active" : ""}`}
                    onClick={() => setRegion(item)}
                    type="button"
                  >
                    {regionLabel(item)}
                  </button>
                ))}
              </div>
              <div className="filter-group border-b hairline py-3 font-[var(--font-mono)] text-xs">
                <span className="filter-label mr-1">Sort</span>
                {(["score", "wins", "lists", "year", "title", "author", "imprint", "publisher"] as BookSortKey[]).map((key) => (
                  <button
                    key={key}
                    className={`filter-chip focus-ring inline-flex items-center gap-1 px-3 py-2 capitalize ${sortKey === key ? "segment-button-active" : ""}`}
                    onClick={() => {
                      setSortKey(key);
                      setPage(1);
                    }}
                    type="button"
                  >
                    {bookSortLabels[key]}
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

      {showDenseCatalogControls ? (
        <div className="filter-toolbar mx-auto mb-3 grid max-w-7xl gap-2 border-y hairline px-1 py-2 font-[var(--font-mono)] text-xs min-[1345px]:px-2 lg:grid-cols-[auto_minmax(13rem,1fr)_minmax(12rem,0.7fr)_auto] lg:items-center">
          <div className="filter-group">
            <span className="filter-label">Award geography</span>
            <div className="segmented-control">
              {(["us", "international", "all"] as const).map((item) => (
                <button
                  className={`segment-button focus-ring min-w-20 ${region === item ? "segment-button-active" : ""}`}
                  key={item}
                  onClick={() => setRegion(item)}
                  type="button"
                >
                  {regionLabel(item)}
                </button>
              ))}
            </div>
          </div>
          <InlineFilterSelect
            label="Subject"
            value={subjectFilter}
            onChange={(value) => {
              setSubjectFilter(value);
              setPage(1);
            }}
            options={data.subjects.map((subject) => ({ value: subject.name, label: subject.name }))}
          />
          <label className="filter-group flex-nowrap">
            <span className="filter-label">Sort</span>
            <select
              className="filter-select focus-ring font-sans normal-case tracking-normal"
              onChange={(event) => {
                setSortKey(event.target.value as BookSortKey);
                setPage(1);
              }}
              value={sortKey}
            >
              {Object.entries(bookSortLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-2 lg:justify-end">
            {hasActiveFilters ? (
              <button className="filter-chip focus-ring inline-flex items-center gap-2 px-3 py-1.5 text-[var(--ink)]" onClick={resetFilters} type="button">
                Clear
                <X size={12} />
              </button>
            ) : null}
            <button
              aria-expanded={showOptions}
              className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-1.5"
              onClick={() => setShowOptions((value) => !value)}
              type="button"
            >
              <SlidersHorizontal size={14} />
              {showOptions ? "Hide filters" : "More filters"}
              <ChevronDown className={`transition ${showOptions ? "rotate-180" : ""}`} size={13} />
            </button>
          </div>
        </div>
      ) : null}

      {showOptions && showDenseCatalogControls ? (
        <div className="panel mx-auto mb-4 max-w-7xl border hairline p-4 shadow-[0_14px_32px_color-mix(in_srgb,var(--ink)_4%,transparent)] min-[1345px]:px-5">
          <div className="grid gap-3 font-[var(--font-mono)] text-xs sm:grid-cols-2 xl:grid-cols-3">
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

      <div className="border hairline panel">
        <div className={`flex flex-col gap-2 border-b hairline px-3 py-1.5 font-[var(--font-mono)] text-xs md:flex-row md:items-center md:justify-between`}>
          <div className="flex items-center gap-2 muted">
            <span>
              <span className="plain-number text-[var(--ink)]">{pageSize}</span> per page
            </span>
            {topicFilter ? (
              <button
                className="filter-chip focus-ring inline-flex items-center gap-2 px-3 py-2"
                onClick={clearTopicFilter}
                type="button"
              >
                {titleCaseLabel(topicFilter)}
                <X size={12} />
              </button>
            ) : null}
            {hasActiveFilters ? (
              <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2" onClick={resetFilters}>
                Clear filters
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div className="hidden items-center gap-3 muted md:flex">
            <div className="flex items-center gap-2">
              <span>Density</span>
              <div className="density-control" role="group" aria-label="Row density">
                {([
                  { value: "compact", label: "High density" },
                  { value: "normal", label: "Standard density" },
                  { value: "roomy", label: "Roomy density" },
                ] as const).map(({ value, label }) => (
                  <button
                    aria-label={label}
                    className={`density-button focus-ring ${density === value ? "density-button-active" : ""}`}
                    key={value}
                    onClick={() => setDensity(value)}
                    title={label}
                    type="button"
                  >
                    <DensityIcon density={value} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {activeFilterChips.length ? (
          <div className={`flex flex-wrap items-center gap-2 border-b hairline px-4 py-3 font-[var(--font-mono)] text-xs`}>
            <span className="mr-1 uppercase tracking-[0.16em] muted">Filters</span>
            {activeFilterChips.map((chip) => (
              <button
                className="filter-chip focus-ring inline-flex max-w-[24rem] items-center gap-2 px-3 py-1.5"
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
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-lg">No books match the current view.</p>
            <p className="mt-2 text-sm muted">Try clearing a filter or broadening the search.</p>
            {hasActiveFilters ? (
              <button className="filter-action focus-ring mt-5 inline-flex items-center gap-2 px-4 py-3 text-sm" onClick={resetFilters} type="button">
                Clear filters
                <X size={14} />
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid md:hidden">
                  {rows.map((book, index) => (
                    <BookMobileCard
                      book={book}
                      isSelected={selectedBookId === book.id}
                      key={book.id}
                      onOpen={() => openBook(book)}
                      region={region}
                      style={{ animationDelay: `${Math.min(index * 10, 100)}ms` }}
                    />
                  ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className={`w-full ${tableMinWidth} table-fixed border-collapse text-left`}>
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[26%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="bg-[var(--panel)] font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.11em] muted">
                  <tr className="border-b hairline">
                    {([
                      ["Year", "year"],
                      ["Title", "title"],
                      ["Author", "author"],
                      ["Subject", "subject"],
                      ["Score", "score"],
                      ["Wins", "wins"],
                      ["Lists", "lists"],
                      ["Imprint", "imprint"],
                      ["Publisher", "publisher"],
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
                  {rows.map((book, index) => {
                    const stats = getBookStatsForRegion(book.id, region);
                    const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
                    const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
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
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openBook(book);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td className={`plain-number px-3 ${rowPadding} text-xs`}>{displayYear ?? "-"}</td>
                        <td className={`px-3 ${rowPadding}`}>
                          <button
                            className={`focus-ring w-full items-center text-left transition hover:text-[var(--accent)] ${
                              showRowCovers ? (density === "roomy" ? "grid grid-cols-[3rem_1fr] gap-3.5" : "grid grid-cols-[2.35rem_1fr] gap-3") : "block"
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openBook(book);
                            }}
                            type="button"
                          >
                            {showRowCovers ? <BookRowCover book={book} size={coverSize} /> : null}
                            <span className="book-catalog-title text-base">{book.title}</span>
                          </button>
                        </td>
                        <td className={`px-3 ${rowPadding}`}>
                          <span className="line-clamp-2">{book.authors.map((author) => author.name).join(", ")}</span>
                        </td>
                        <td className={`px-3 ${rowPadding}`}>
                          <BookPrimarySubject book={book} />
                        </td>
                        <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.score}</td>
                        <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.wins}</td>
                        <td className={`plain-number px-3 ${rowPadding} text-xs`}>{stats.lists}</td>
                        <td className={`px-3 ${rowPadding}`}>
                          <span className={`line-clamp-2 ${imprint ? "" : "book-missing-value"}`}>{imprint || "Unknown"}</span>
                        </td>
                        <td className={`px-3 ${rowPadding}`}>
                          <span className={`line-clamp-2 ${publisher ? "" : "book-missing-value"}`}>{publisher || "Not yet sourced"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className={`flex flex-col gap-3 border-t hairline px-4 py-3 font-[var(--font-mono)] text-xs muted md:flex-row md:items-center md:justify-between`}>
          <p>
            {totalRows > 0 ? (
              <>
                Showing <span className="plain-number">{(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, totalRows)}</span> of <span className="plain-number">{totalRows.toLocaleString()}</span> books
              </>
            ) : (
              "No matching books"
            )}
          </p>
          <p className="hidden md:block">{resultContext}</p>
          <div className="flex flex-wrap items-center gap-2">
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

function BookRowCover({ book, size = "standard" }: { book: Book; size?: "standard" | "large" }) {
  const className = `book-row-cover ${size === "large" ? "book-row-cover-large" : ""}`;
  if (book.thumbnailUrl) {
    return (
      <span className={className} aria-hidden="true">
        <img src={book.thumbnailUrl} alt="" />
      </span>
    );
  }
  return (
    <span className={`${className} book-row-cover-placeholder`} aria-hidden="true">
      {book.title.charAt(0)}
    </span>
  );
}

function BookPrimarySubject({ book }: { book: Book }) {
  if (!book.primarySubject) {
    return <span className="book-missing-value">Unknown</span>;
  }
  return (
    <CatalogSubjectPill
      onClick={(event) => event.stopPropagation()}
      subject={book.primarySubject}
    />
  );
}

function BookMobileCard({
  book,
  isSelected,
  onOpen,
  region,
  style,
}: {
  book: Book;
  isSelected: boolean;
  onOpen: () => void;
  region: AwardRegionFilter;
  style?: React.CSSProperties;
}) {
  const stats = getBookStatsForRegion(book.id, region);
  const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
  const firstRecognitionYear = Math.min(...data.appearances.filter((appearance) => appearance.bookId === book.id).map((appearance) => appearance.year));
  const displayYear = book.publicationYear ?? (Number.isFinite(firstRecognitionYear) ? firstRecognitionYear : undefined);

  return (
    <div
      className={`book-mobile-card fade-up border-b hairline p-4 text-left transition last:border-b-0 hover:bg-[var(--accent-soft)] ${
        isSelected ? "book-table-row-active" : ""
      }`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      style={style}
      tabIndex={0}
    >
      <span className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
        <BookRowCover book={book} />
        <span className="min-w-0">
          <span className="book-catalog-title text-lg leading-snug">{book.title}</span>
          <span className="mt-1 block text-sm leading-5 muted">{book.authors.map((author) => author.name).join(", ")}</span>
        </span>
      </span>
      <span className="mt-4 grid grid-cols-3 border-y hairline py-3 font-[var(--font-mono)] text-xs">
        <span>
          <span className="block uppercase tracking-[0.14em] muted">Year</span>
          <span className="plain-number mt-1 block text-[var(--ink)]">{displayYear ?? "-"}</span>
        </span>
        <span>
          <span className="block uppercase tracking-[0.14em] muted">Wins</span>
          <span className="plain-number mt-1 block text-[var(--ink)]">{stats.wins}</span>
        </span>
        <span>
          <span className="block uppercase tracking-[0.14em] muted">Lists</span>
          <span className="plain-number mt-1 block text-[var(--ink)]">{stats.lists}</span>
        </span>
      </span>
      <span className="mt-3 block text-sm">
        <span className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Imprint</span>
        <span className={`mt-1 block ${imprint ? "" : "book-missing-value"}`}>{imprint || "Unknown"}</span>
      </span>
      <span className="mt-3 block">
        <BookSubjectTags book={book} interactive={false} />
      </span>
    </div>
  );
}

function BookSubjectTags({ book, interactive = true }: { book: Book; interactive?: boolean }) {
  return (
    <span className="grid max-w-full gap-2">
      {book.primarySubject ? (
        <span>
          {interactive ? (
            <CatalogSubjectPill
              onClick={(event) => event.stopPropagation()}
              subject={book.primarySubject}
            />
          ) : (
            <span className={`subject-chip ${subjectChipClass(book.primarySubject)} rounded-full border hairline px-2.5 py-[0.22rem] text-[0.72rem]`}>
              {book.primarySubject}
            </span>
          )}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {book.topics.slice(0, 3).map((topic) =>
          interactive ? (
            <CatalogTopicTag
              isPrimary={topic === book.primaryTopic}
              key={topic}
              onClick={(event) => event.stopPropagation()}
              topic={topic}
            />
          ) : (
            <span className={`topic-tag topic-tag-compact ${topic === book.primaryTopic ? "topic-tag-primary" : ""}`} key={topic}>
              {titleCaseLabel(topic)}
            </span>
          ),
        )}
        {book.topics.length > 3 ? (
          <span className="plain-number text-[0.58rem] text-[var(--muted)]">+{book.topics.length - 3}</span>
        ) : null}
      </span>
    </span>
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
        className="filter-select focus-ring font-sans normal-case tracking-normal"
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

function InlineFilterSelect({
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
    <label className="filter-group flex-nowrap">
      <span className="filter-label">{label}</span>
      <select
        className="filter-select focus-ring min-w-0 flex-1 font-sans normal-case tracking-normal"
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
  if (density === "compact") return <Rows2 size={16} strokeWidth={1.8} />;
  if (density === "roomy") return <Rows4 size={16} strokeWidth={1.8} />;
  return <Rows3 size={16} strokeWidth={1.8} />;
}
