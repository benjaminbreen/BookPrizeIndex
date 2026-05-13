"use client";

import Link from "next/link";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CornerDownLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Info, Rows2, Rows3, Rows4, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { SearchModeSelect } from "@/components/ui/design-primitives";
import { useSemanticBookSearch, type SemanticSearchDiagnostics } from "@/components/use-semantic-book-search";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import { appearancesByBookId, booksById } from "@/lib/data";
import type { BrowseBookRow } from "@/lib/browse-types";
import type { SemanticQueryInterpretation } from "@/lib/semantic-search";

type BookSortKey = "score" | "year" | "title" | "author" | "wins" | "lists" | "imprint" | "publisher" | "subject";
type AwardOption = { id: string; name: string; shortName?: string };

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
  awardOptions,
  books,
  title = "Books",
  deck,
  secondaryDeck,
  limit,
  compactHeader = false,
  wideLayout = false,
  defaultRegion = "us",
}: {
  awardOptions: AwardOption[];
  books: BrowseBookRow[];
  title?: string | null;
  deck?: React.ReactNode;
  secondaryDeck?: React.ReactNode;
  limit?: number;
  compactHeader?: boolean;
  wideLayout?: boolean;
  defaultRegion?: AwardRegionFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeMode = searchParamsMode(searchParams.get("mode"));
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);
  const [mode, setModeState] = useState<"keyword" | "semantic">(() => routeMode);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [awardFilter, setAwardFilter] = useState("");
  const [publisherFilter, setPublisherFilter] = useState("");
  const [metadataFilter, setMetadataFilter] = useState<MetadataFilter>("all");
  const [showOptions, setShowOptions] = useState(false);
  const [page, setPage] = useState(1);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [density, setDensity] = useState<"compact" | "normal" | "roomy">("normal");
  const [showSemanticDetails, setShowSemanticDetails] = useState(false);
  const topicFilter = searchParams.get("topic");
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [semanticQuery, setSemanticQuery] = useState(urlQuery);
  const activeQuery = mode === "semantic" ? semanticQuery : query;
  const pageSize = 100;
  const awardBookIds = useMemo(() => {
    if (!awardFilter) return null;
    return new Set(books.filter((book) => book.awardIds.includes(awardFilter)).map((book) => book.id));
  }, [awardFilter]);
  const publisherOptions = useMemo(
    () =>
      [...new Map(books.filter((book) => book.publisherId && book.publisher).map((book) => [book.publisherId!, { id: book.publisherId!, name: book.publisher! }])).values()]
        .sort((a, b) => a.name.localeCompare(b.name)),
    [books],
  );
  const hasActiveFilters = Boolean(query || topicFilter || subjectFilter || awardFilter || publisherFilter || metadataFilter !== "all");
  const structuredRows = useMemo(() => {
    return books.filter((book) => {
      if (topicFilter && !book.topics.includes(topicFilter)) return false;
      if (subjectFilter && !book.subjects.includes(subjectFilter)) return false;
      if (awardBookIds && !awardBookIds.has(book.id)) return false;
      if (publisherFilter && book.publisherId !== publisherFilter) return false;
      if (!matchesMetadataFilter(book, metadataFilter)) return false;
      return true;
    });
  }, [awardBookIds, books, metadataFilter, publisherFilter, subjectFilter, topicFilter]);
  const semanticCandidateBookIds = useMemo(() => structuredRows.map((book) => book.id), [structuredRows]);
  const semanticSearch = useSemanticBookSearch({
    candidateBookIds: semanticCandidateBookIds,
    enabled: mode === "semantic",
    limit: 500,
    query: semanticQuery,
  });
  const semanticResultByBookId = useMemo(() => new Map(semanticSearch.results.map((result, index) => [result.bookId, { ...result, index }])), [semanticSearch.results]);
  const filteredRows = useMemo(() => {
    const trimmedQuery = activeQuery.trim();
    if (mode === "semantic" && trimmedQuery.length >= 3 && semanticSearch.results.length) {
      return structuredRows
        .filter((book) => semanticResultByBookId.has(book.id))
        .sort((a, b) => (semanticResultByBookId.get(a.id)?.index ?? 0) - (semanticResultByBookId.get(b.id)?.index ?? 0));
    }
    if (mode === "semantic" && trimmedQuery.length >= 3 && !semanticSearch.loading && !semanticSearch.error) {
      return [];
    }
    const filtered = filterBookRowsByQuery(structuredRows, activeQuery);
    return sortBookRows(filtered, sortKey);
  }, [activeQuery, mode, region, semanticResultByBookId, semanticSearch.error, semanticSearch.loading, semanticSearch.results.length, sortKey, structuredRows]);

  const totalRows = limit ? Math.min(filteredRows.length, limit) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageNumbers = paginationRange(safePage, totalPages);
  const rowPadding = density === "compact" ? "py-1.5" : density === "roomy" ? "py-4" : "py-2.5";
  const coverSize = density === "roomy" ? "large" : "standard";
  const showRowCovers = density !== "compact";
  const tableMinWidth = wideLayout ? "min-w-[1320px]" : "min-w-[1180px]";
  const showDenseCatalogControls = wideLayout && !compactHeader;
  const activeBook = activeBookId ? booksById.get(activeBookId) ?? null : null;
  const activeBookAppearances = activeBookId ? appearancesByBookId.get(activeBookId) ?? [] : [];
  const activeBookIndex = activeBookId ? rows.findIndex((book) => book.id === activeBookId) : -1;
  useEffect(() => {
    setQuery(urlQuery);
    setSemanticQuery(routeMode === "semantic" ? urlQuery : "");
    setPage(1);
  }, [routeMode, urlQuery]);

  useEffect(() => {
    setModeState(routeMode);
  }, [routeMode]);

  useEffect(() => {
    setActiveBookId(null);
  }, [searchParams]);

  function openBook(book: BrowseBookRow) {
    setActiveBookId(book.id);
  }

  function resetFilters() {
    setQuery("");
    setSemanticQuery("");
    setSubjectFilter("");
    setAwardFilter("");
    setPublisherFilter("");
    setMetadataFilter("all");
    setPage(1);
    if (topicFilter || urlQuery) router.replace(pathname, { scroll: false });
  }

  function setMode(nextMode: "keyword" | "semantic") {
    setModeState(nextMode);
    if (nextMode === "semantic") setSemanticQuery("");
    setPage(1);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextMode === "semantic") nextParams.set("mode", "semantic");
    else nextParams.delete("mode");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function setRegion(nextRegion: AwardRegionFilter) {
    setRegionState(nextRegion);
    setPage(1);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextRegion}; path=/; max-age=31536000; samesite=lax`;
  }

  function clearQuery() {
    setQuery("");
    setSemanticQuery("");
    setPage(1);
    if (!urlQuery) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("q");
    nextParams.delete("book");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function submitSemanticQuery() {
    if (mode !== "semantic") return;
    setSemanticQuery(query.trim());
    setPage(1);
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
    activeQuery.trim()
      ? {
          id: "query",
          label: `Search: ${activeQuery.trim()}`,
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
          label: `Award: ${awardOptions.find((award) => award.id === awardFilter)?.shortName ?? awardOptions.find((award) => award.id === awardFilter)?.name ?? awardFilter}`,
          onRemove: () => {
            setAwardFilter("");
            setPage(1);
          },
        }
      : null,
    publisherFilter
      ? {
          id: "publisher",
          label: `Publisher: ${publisherOptions.find((publisher) => publisher.id === publisherFilter)?.name ?? publisherFilter}`,
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
  const semanticActive = mode === "semantic" && semanticQuery.trim().length >= 3;
  const hasPendingSemanticQuery = mode === "semantic" && query.trim() !== semanticQuery.trim();
  const semanticSearchPending = semanticActive && (semanticSearch.loading || semanticSearch.query !== semanticQuery.trim() || (!semanticSearch.diagnostics && !semanticSearch.error));
  const resultContext = semanticSearchPending
    ? `${regionLabel(region)} awards · Searching ${structuredRows.length.toLocaleString()} candidate books by meaning`
    : `${regionLabel(region)} awards · ${topicFilter ? `Topic: ${titleCaseLabel(topicFilter)} · ` : ""}${semanticActive ? "Sorted by meaning match" : `Sorted by ${bookSortLabels[sortKey].toLowerCase()}`} · ${totalRows.toLocaleString()} books${hasActiveFilters ? " · filtered" : ""}`;
  const semanticConceptLine = semanticActive && semanticSearch.interpretation
    ? [
        semanticSearch.interpretation.concepts.slice(0, 4).join(", "),
        semanticSearch.interpretation.eras.slice(0, 2).join(", "),
        semanticSearch.interpretation.subjects.slice(0, 3).join(", "),
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <>
    <section className={`mx-auto ${wideLayout ? "max-w-[90rem]" : "max-w-7xl"} px-4 sm:px-6 lg:px-8 ${compactHeader ? "pb-10" : wideLayout ? "py-4" : "py-10"}`}>
      <div className={`mx-auto mb-6 grid max-w-7xl gap-8 lg:items-center ${wideLayout ? "min-[1345px]:px-8" : ""} ${compactHeader ? "lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)]" : "lg:grid-cols-[0.86fr_1fr]"}`}>
        <div>
          {title === null ? null : (
            <>
              <h1 className="font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">{title}</h1>
            </>
          )}
          {deck ? <p className={`${title === null ? "" : "mt-4 sm:mt-5"} max-w-2xl font-[var(--font-serif)] text-lg font-light leading-7 muted sm:text-xl sm:leading-8`}>{deck}</p> : null}
          {secondaryDeck ? <p className="mt-3 max-w-2xl text-sm leading-6 muted">{secondaryDeck}</p> : null}
        </div>
        <div className={`grid gap-3 ${compactHeader ? "lg:justify-self-end lg:w-full lg:max-w-3xl" : ""}`}>
          <div className="subjects-search focus-within:border-[var(--ink)]">
            <Search size={18} className="muted" />
            <input
              className="min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-[var(--muted)]"
              maxLength={600}
              placeholder={mode === "semantic" ? "Describe a theme, project, era, or mood..." : "Search title, author, award, subject, imprint..."}
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (mode === "semantic" && !nextQuery.trim()) setSemanticQuery("");
                setPage(1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && mode === "semantic") {
                  event.preventDefault();
                  submitSemanticQuery();
                }
              }}
            />
            {query || semanticQuery ? (
              <button
                aria-label="Clear search"
                className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                onClick={clearQuery}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
            {mode === "semantic" ? (
              <button
                aria-label="Run meaning search"
                className={`semantic-submit focus-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs ${hasPendingSemanticQuery ? "semantic-submit-ready" : ""}`}
                disabled={!query.trim() || !hasPendingSemanticQuery}
                onClick={submitSemanticQuery}
                type="button"
              >
                Enter
                <CornerDownLeft size={13} />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 font-[var(--font-mono)] text-xs">
            <span className="grid gap-1 muted">
              <span>{resultContext}</span>
              {hasPendingSemanticQuery && query.trim() ? <span>Press Enter to search this phrase.</span> : null}
              {semanticSearchPending ? <span>Reading for meaning...</span> : null}
              {semanticConceptLine ? <span className="text-[var(--ink)]">Interpreted as {semanticConceptLine}</span> : null}
              {semanticActive && semanticSearch.error ? <span className="text-[var(--accent)]">{semanticSearch.error} Showing keyword fallback.</span> : null}
              {semanticActive && semanticSearch.warning ? <span>{semanticSearch.warning}</span> : null}
            </span>
            <div className={`items-center gap-2 ${showDenseCatalogControls ? "hidden" : "flex"}`}>
              {semanticActive && !semanticSearchPending && semanticSearch.diagnostics ? (
                <button className="semantic-detail-button focus-ring inline-flex items-center gap-2" onClick={() => setShowSemanticDetails(true)} type="button">
                  <Info size={13} />
                  How this worked
                </button>
              ) : null}
              <SearchModeSelect className="semantic-mode-select" onChange={setMode} value={mode} />
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
                  options={subjectOptions(books)}
                />
                <FilterSelect
                  label="Award"
                  value={awardFilter}
                  onChange={(value) => {
                    setAwardFilter(value);
                    setPage(1);
                  }}
                  options={awardOptions.map((award) => ({ value: award.id, label: award.shortName ?? award.name }))}
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
            options={subjectOptions(books)}
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
            {semanticActive && !semanticSearchPending && semanticSearch.diagnostics ? (
              <button className="semantic-detail-button focus-ring inline-flex items-center gap-2" onClick={() => setShowSemanticDetails(true)} type="button">
                <Info size={13} />
                Details
              </button>
            ) : null}
            <SearchModeSelect className="semantic-mode-select" onChange={setMode} value={mode} />
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

      {showSemanticDetails && semanticSearch.diagnostics ? (
        <SemanticDetailsModal
          diagnostics={semanticSearch.diagnostics}
          interpretation={semanticSearch.interpretation}
          onClose={() => setShowSemanticDetails(false)}
          query={semanticQuery}
        />
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
              options={awardOptions.map((award) => ({ value: award.id, label: award.shortName ?? award.name }))}
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
        {semanticSearchPending ? (
          <SemanticLoadingState candidateCount={structuredRows.length} query={semanticQuery} />
        ) : rows.length === 0 ? (
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
                      isSelected={activeBookId === book.id}
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
                    const stats = book;
                    const imprint = book.imprint ?? "";
                    const publisher = book.publisher ?? "";
                    const displayYear = book.publicationYear ?? book.firstRecognitionYear;
                    return (
                      <tr
                        key={book.id}
                        className={`book-table-row fade-up cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                          activeBookId === book.id ? "book-table-row-active" : ""
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
                          <span className="line-clamp-2">{book.author}</span>
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
    </section>
    <BookDrawer
      appearances={activeBookAppearances}
      book={activeBook}
      currentLabel={activeBook && activeBookIndex >= 0 ? `${activeBookIndex + 1} of ${rows.length}` : undefined}
      onClose={() => setActiveBookId(null)}
      onNext={activeBookIndex >= 0 && activeBookIndex < rows.length - 1 ? () => setActiveBookId(rows[activeBookIndex + 1].id) : undefined}
      onPrevious={activeBookIndex > 0 ? () => setActiveBookId(rows[activeBookIndex - 1].id) : undefined}
    />
    </>
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

function searchParamsMode(value: string | null): "keyword" | "semantic" {
  return value === "semantic" ? "semantic" : "keyword";
}

function CatalogSubjectPill({
  subject,
  onClick,
}: {
  subject: string;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const subjectSlug = slugify(subject);
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

function BookRowCover({ book, size = "standard" }: { book: BrowseBookRow; size?: "standard" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const className = `book-row-cover ${size === "large" ? "book-row-cover-large" : ""}`;
  if (book.thumbnailUrl && !imageFailed) {
    return (
      <span className={className} aria-hidden="true">
        <img src={book.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
      </span>
    );
  }
  return (
    <span className={`${className} book-row-cover-placeholder`} aria-hidden="true">
      {book.title.charAt(0)}
    </span>
  );
}

function BookPrimarySubject({ book }: { book: BrowseBookRow }) {
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
  book: BrowseBookRow;
  isSelected: boolean;
  onOpen: () => void;
  region: AwardRegionFilter;
  style?: React.CSSProperties;
}) {
  const stats = book;
  const imprint = book.imprint ?? "";
  const displayYear = book.publicationYear ?? book.firstRecognitionYear;
  const firstTopic = book.topics.find((topic) => topic !== book.primaryTopic) ?? book.primaryTopic ?? book.topics[0];

  return (
    <div
      className={`book-mobile-card book-mobile-card-compact fade-up border-b hairline px-3 py-3 text-left transition last:border-b-0 hover:bg-[var(--accent-soft)] ${
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
      <span className="grid grid-cols-[2.55rem_minmax(0,1fr)_auto] items-start gap-3">
        <BookRowCover book={book} />
        <span className="min-w-0 overflow-hidden">
          <span className="book-mobile-title text-base font-medium leading-snug">{book.title}</span>
          <span className="mt-0.5 block truncate text-sm leading-5 muted">{book.author}</span>
        </span>
        <span className="grid justify-items-end gap-1 font-[var(--font-mono)] text-xs">
          <span className="plain-number text-[var(--ink)]">{displayYear ?? "-"}</span>
          <span className="plain-number muted">{stats.score} pts</span>
        </span>
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-[var(--font-mono)] text-xs muted">
        <span><span className="plain-number text-[var(--ink)]">{stats.wins}</span> wins</span>
        <span><span className="plain-number text-[var(--ink)]">{stats.lists}</span> lists</span>
        <span className={`min-w-0 max-w-full truncate font-sans text-sm normal-case tracking-normal ${imprint ? "text-[var(--ink)]" : "book-missing-value"}`}>{imprint || "Unknown imprint"}</span>
      </span>
      <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {book.primarySubject ? (
          <span className={`subject-chip ${subjectChipClass(book.primarySubject)} rounded-full border hairline px-2 py-[0.18rem] text-[0.68rem]`}>
            {book.primarySubject}
          </span>
        ) : null}
        {firstTopic ? (
          <span className={`topic-tag topic-tag-compact ${firstTopic === book.primaryTopic ? "topic-tag-primary" : ""}`}>
            {titleCaseLabel(firstTopic)}
          </span>
        ) : null}
        {book.topics.length > 1 ? (
          <span className="plain-number text-[0.58rem] text-[var(--muted)]">+{Math.max(book.topics.length - 1, 0)}</span>
        ) : null}
      </span>
    </div>
  );
}

function BookSubjectTags({ book, interactive = true }: { book: BrowseBookRow; interactive?: boolean }) {
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

function SemanticDetailsModal({
  diagnostics,
  interpretation,
  onClose,
  query,
}: {
  diagnostics: SemanticSearchDiagnostics;
  interpretation: SemanticQueryInterpretation | null;
  onClose: () => void;
  query: string;
}) {
  const rankingTerms = diagnostics.rankingTerms?.slice(0, 18) ?? [];
  const indexDate = diagnostics.indexGeneratedAt ? new Date(diagnostics.indexGeneratedAt).toLocaleDateString() : "unknown";
  return (
    <div className="semantic-details-overlay" role="presentation">
      <button aria-label="Close semantic search details" className="semantic-details-backdrop" onClick={onClose} type="button" />
      <section aria-modal="true" className="semantic-details-modal" role="dialog">
        <div className="flex items-start justify-between gap-4 border-b hairline pb-3">
          <div>
            <p className="filter-label">Semantic Search</p>
            <h2 className="mt-2 text-xl font-medium">How this search worked</h2>
          </div>
          <button aria-label="Close" className="focus-ring grid h-8 w-8 place-items-center border hairline transition hover:bg-[var(--panel)]" onClick={onClose} type="button">
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 grid gap-4 text-sm leading-6">
          <p className="muted">
            The query <span className="text-[var(--ink)]">"{query.trim()}"</span> was converted into an embedding query, compared against
            {` ${diagnostics.candidateBookCount?.toLocaleString() ?? "the filtered set of"} candidate books`} from a
            {` ${diagnostics.indexBookCount?.toLocaleString() ?? "local"}-book semantic index`}, then reranked with text, topic, period, and recognition signals.
          </p>
          <div className="semantic-details-grid">
            <DetailItem label="Embedding model" value={diagnostics.embeddingModel ?? "unknown"} />
            <DetailItem label="Query expansion" value={diagnostics.usedModelInterpretation ? diagnostics.interpretationModel ?? "model assisted" : "local terms"} />
            <DetailItem label="Index date" value={indexDate} />
            <DetailItem label="Returned" value={`${diagnostics.resultCount?.toLocaleString() ?? 0} matches`} />
          </div>
          {interpretation ? (
            <div className="grid gap-2">
              <p className="filter-label">Expanded Intent</p>
              <p className="semantic-details-box">{interpretation.expandedQuery}</p>
            </div>
          ) : null}
          {rankingTerms.length ? (
            <div className="grid gap-2">
              <p className="filter-label">Ranking Terms</p>
              <p className="semantic-details-box">{rankingTerms.join(", ")}</p>
            </div>
          ) : null}
          {diagnostics.embeddingInput ? (
            <details className="semantic-details-raw">
              <summary>Show exact embedding text</summary>
              <pre>{diagnostics.embeddingInput}</pre>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SemanticLoadingState({ candidateCount, query }: { candidateCount: number; query: string }) {
  return (
    <div className="semantic-loading-state" aria-live="polite" role="status">
      <div className="semantic-loading-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <p className="semantic-loading-kicker">Semantic search</p>
        <p className="semantic-loading-title">Reading for meaning</p>
        <p className="semantic-loading-copy">
          Comparing "{query.trim()}" against {candidateCount.toLocaleString()} candidate books.
        </p>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="filter-label">{label}</p>
      <p className="mt-1 text-[var(--ink)]">{value}</p>
    </div>
  );
}

function matchesMetadataFilter(book: BrowseBookRow, filter: MetadataFilter) {
  const hasCompleteBasics = Boolean(book.hasIsbn && book.hasPageCount && book.hasCover && book.hasPublisher);
  if (filter === "all") return true;
  if (filter === "complete") return hasCompleteBasics;
  if (filter === "missing") return !hasCompleteBasics;
  if (filter === "has_cover") return book.hasCover;
  if (filter === "missing_cover") return !book.hasCover;
  if (filter === "missing_publisher") return !book.hasPublisher;
  return true;
}

function filterBookRowsByQuery(books: BrowseBookRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return books;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return books.filter((book) => terms.every((term) => book.searchText.includes(term)));
}

function sortBookRows(books: BrowseBookRow[], sortKey: BookSortKey) {
  return [...books].sort((a, b) => {
    if (sortKey === "score") {
      return (
        b.score - a.score ||
        b.majorWins - a.majorWins ||
        b.wins - a.wins ||
        b.majorShortlists - a.majorShortlists ||
        b.normalShortlists - a.normalShortlists ||
        b.majorLonglists - a.majorLonglists ||
        b.normalLonglists - a.normalLonglists ||
        (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortKey === "wins") return b.wins - a.wins || a.title.localeCompare(b.title);
    if (sortKey === "lists") return b.lists - a.lists || a.title.localeCompare(b.title);
    if (sortKey === "year") return (b.publicationYear ?? b.firstRecognitionYear ?? 0) - (a.publicationYear ?? a.firstRecognitionYear ?? 0) || a.title.localeCompare(b.title);
    if (sortKey === "author") return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
    if (sortKey === "imprint") return (a.imprint ?? "").localeCompare(b.imprint ?? "") || a.title.localeCompare(b.title);
    if (sortKey === "publisher") return (a.publisher ?? "").localeCompare(b.publisher ?? "") || a.title.localeCompare(b.title);
    if (sortKey === "subject") return (a.primarySubject ?? "").localeCompare(b.primarySubject ?? "") || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}

function subjectOptions(books: BrowseBookRow[]) {
  return [...new Set(books.flatMap((book) => book.subjects))]
    .sort((a, b) => a.localeCompare(b))
    .map((subject) => ({ value: subject, label: subject }));
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
