"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronUp, ChevronsUpDown, CornerDownLeft, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SearchMode } from "@/components/ui/design-primitives";
import { AWARD_REGION_COOKIE, type AwardRegionFilter, regionLabel } from "@/lib/award-region";
import type { BrowseData, BrowseLinkRow } from "@/lib/browse-types";
import type { SemanticQueryExpansionModel } from "@/lib/semantic-search";

type SortKey = "score" | "year" | "title" | "author" | "wins" | "lists" | "imprint" | "publisher";
type SortDirection = "asc" | "desc";
type TypeFilter = "fiction" | "nonfiction" | "all";
type RankedSubjectFilter = "all" | "biography" | "history" | "science" | "politics";

export type HomeBookRow = Pick<
  BrowseData["books"][number],
  | "id"
  | "slug"
  | "title"
  | "author"
  | "publicationYear"
  | "firstRecognitionYear"
  | "publisher"
  | "imprint"
  | "thumbnailUrl"
  | "subjects"
  | "wins"
  | "lists"
  | "score"
  | "majorWins"
  | "majorShortlists"
  | "normalShortlists"
  | "majorLonglists"
  | "normalLonglists"
  | "searchText"
>;

export type HomeBrowseData = Pick<BrowseData, "generatedAt" | "stats"> & {
  books: HomeBookRow[];
  home: Record<string, { subjects: BrowseLinkRow[]; awards: BrowseLinkRow[] }>;
};

const rankedSubjectFilters: Array<{ key: RankedSubjectFilter; label: string; subjects: string[] }> = [
  { key: "all", label: "All", subjects: [] },
  { key: "biography", label: "Biography", subjects: ["Biography"] },
  { key: "history", label: "History", subjects: ["History", "American History", "World History"] },
  { key: "science", label: "Science", subjects: ["Science"] },
  { key: "politics", label: "Politics", subjects: ["Politics & Government"] },
];

export function ExplorerHome({ data, defaultRegion }: { data: HomeBrowseData; defaultRegion: AwardRegionFilter }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [queryExpansionModel, setQueryExpansionModel] = useState<SemanticQueryExpansionModel>("gemini-3.5-flash");
  const [tooltipMode, setTooltipMode] = useState<SearchMode | null>(null);
  const [type, setType] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [rankedSubject, setRankedSubject] = useState<RankedSubjectFilter>("all");

  const rankedBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const subjectFilter = rankedSubjectFilters.find((filter) => filter.key === rankedSubject);
    const subjectSet = new Set(subjectFilter?.subjects ?? []);
    const filtered = data.books.filter((book) => {
      if (q && !book.searchText.includes(q)) return false;
      if (subjectSet.size && !book.subjects.some((subject) => subjectSet.has(subject))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const primary = compareHomeBooks(a, b, sortKey);
      if (primary) return sortDirection === "asc" ? primary : -primary;
      return compareHomeRecognitionTieBreak(a, b);
    });
  }, [data.books, query, rankedSubject, sortDirection, sortKey]);

  const topBooks = rankedBooks.slice(0, 12);
  const browseData = useMemo(() => getBrowseData(data, region, type), [data, region, type]);
  const showingLabel = `${regionLabel(region)} · ${type === "all" ? "All" : titleCase(type)}`;

  function setRegion(nextRegion: AwardRegionFilter) {
    setRegionState(nextRegion);
    document.cookie = `${AWARD_REGION_COOKIE}=${nextRegion}; path=/; max-age=31536000; samesite=lax`;
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    const mode = searchMode === "semantic" ? `&mode=semantic&queryModel=${encodeURIComponent(queryExpansionModel)}` : "";
    router.push(`/books?q=${encodeURIComponent(q)}${mode}`);
  }

  function selectSemanticMode() {
    if (searchMode === "semantic") {
      setQueryExpansionModel((model) => (model === "gpt-5.4-mini" ? "gemini-3.5-flash" : "gpt-5.4-mini"));
      return;
    }
    setSearchMode("semantic");
  }

  function sortByColumn(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(defaultSortDirection(nextSortKey));
  }

  return (
    <>
    <main>
      <section className="home-hero-section bg-[var(--paper)]">
        <div className="home-hero-inner mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:px-8 lg:pb-12 lg:pt-20">
          <div className="home-hero-copy">
            <h1 className="max-w-2xl font-[var(--font-serif)] text-4xl font-light leading-[1.02] sm:text-5xl lg:text-5xl">
              A searchable index of award-winning books.
            </h1>
            <p className="mt-6 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
              Browse award-winning, shortlisted, and longlisted books by subject, prize, imprint, publisher,
              figure, period, and source.
            </p>
          </div>

          <div className="home-search-panel self-end">
            <form
              className="subjects-search home-search-capsule"
              onSubmit={submitSearch}
            >
              <Search size={20} className="muted transition group-focus-within:text-[var(--ink)]" />
              <input
                aria-label="Search the book catalog"
                className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-[color-mix(in_srgb,var(--muted)_78%,transparent)]"
                maxLength={600}
                placeholder={searchMode === "semantic" ? "Describe a theme, project, era, or mood..." : "Search books, authors, subjects..."}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.trim() ? (
                <button
                  className="semantic-submit semantic-submit-ready focus-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs"
                  type="submit"
                >
                  Enter
                  <CornerDownLeft size={13} />
                </button>
              ) : null}
              <div className="home-search-mode-toggle" aria-label="Search mode" onMouseLeave={() => setTooltipMode(null)}>
                <button
                  aria-describedby="home-search-mode-help"
                  aria-label="Keyword search"
                  className={`home-search-mode-button focus-ring ${searchMode === "keyword" ? "home-search-mode-button-active" : ""}`}
                  onBlur={() => setTooltipMode(null)}
                  onClick={() => setSearchMode("keyword")}
                  onFocus={() => setTooltipMode("keyword")}
                  onMouseEnter={() => setTooltipMode("keyword")}
                  type="button"
                >
                  Keyword
                </button>
                <button
                  aria-describedby="home-search-mode-help"
                  aria-label="Semantic search"
                  className={`home-search-mode-button focus-ring ${searchMode === "semantic" ? "home-search-mode-button-active" : ""}`}
                  onBlur={() => setTooltipMode(null)}
                  onClick={selectSemanticMode}
                  onFocus={() => setTooltipMode("semantic")}
                  onMouseEnter={() => setTooltipMode("semantic")}
                  type="button"
                >
                  Semantic
                </button>
                <span
                  className={`home-mode-tooltip home-mode-tooltip-${tooltipMode ?? searchMode} ${tooltipMode ? "home-mode-tooltip-visible" : ""}`}
                  id="home-search-mode-help"
                  role="tooltip"
                >
                  {tooltipMode === "semantic" ? (
                    <>
                      <span className="home-mode-tooltip-label">Semantic</span>
                      <span>Uses machine learning to find books, awards, and subjects related to what you describe, even when the exact words do not appear.</span>
                      <span className="home-mode-tooltip-note">{`Query expander: ${queryExpansionModelLabel(queryExpansionModel)}. Click Semantic again to switch.`}</span>
                    </>
                  ) : (
                    <>
                      <span className="home-mode-tooltip-label">Keyword</span>
                      <span>Looks for the exact words you type in titles, authors, awards, subjects, publishers, and catalog text.</span>
                    </>
                  )}
                </span>
              </div>
            </form>
            <div className="home-search-controls">
              <div className="grid gap-4 lg:grid-cols-[auto_auto_auto] lg:items-end">
                <FilterGroup label="Region">
                  {(["us", "international", "all"] as const).map((item) => (
                    <FilterButton key={item} active={region === item} onClick={() => setRegion(item)}>
                      {regionLabel(item)}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <div className="hidden h-10 w-px bg-[var(--line)] lg:block" />
                <FilterGroup label="Type">
                  {(["fiction", "nonfiction", "all"] as const).map((item) => (
                    <FilterButton key={item} active={type === item} onClick={() => setType(item)}>
                      {titleCase(item)}
                    </FilterButton>
                  ))}
                </FilterGroup>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-browse-section border-y hairline" id="subjects">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="home-browse-status flex items-center gap-3 border-b hairline py-4 text-sm muted">
            <Filter size={16} />
            <span>
              Showing: <strong className="font-medium text-[var(--ink)]">{showingLabel}</strong>
            </span>
          </div>
        </div>
        <div className="home-browse-grid mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <BrowseList
            title="Browse by subject"
            seeAllHref="/subjects"
            items={browseData.subjects.slice(0, 8).map((subject) => ({
              id: subject.id,
              label: subject.name,
              meta: `${subject.count} books`,
              href: `/subjects/${subject.slug}`,
            }))}
          />
          <BrowseList
            title="Browse by prize"
            id="awards"
            seeAllHref="/awards"
            items={browseData.awards.slice(0, 8).map((award) => ({
              id: award.id,
              label: award.name,
              meta: `${award.count} records`,
              href: `/awards/${award.slug}`,
            }))}
          />
        </div>
      </section>

      <section className="home-ranked-section mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" id="books">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Ranked catalog</p>
            <h2 className="mt-2 font-[var(--font-serif)] text-3xl font-light">Most awarded books</h2>
          </div>
          <div className="grid justify-items-start gap-2 font-[var(--font-mono)] text-xs sm:justify-items-end">
            <div className="flex flex-wrap gap-2">
              {rankedSubjectFilters.map((filter) => (
                <button
                  key={filter.key}
                  className={`home-subject-pill home-subject-pill-${filter.key} focus-ring ${rankedSubject === filter.key ? "home-subject-pill-active" : ""}`}
                  onClick={() => setRankedSubject(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border hairline panel">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-xs uppercase tracking-[0.08em] muted">
              <tr className="border-b hairline">
                <HomeSortHeader active={sortKey === "year"} direction={sortDirection} label="Year" onClick={() => sortByColumn("year")} />
                <HomeSortHeader active={sortKey === "title"} direction={sortDirection} label="Title" onClick={() => sortByColumn("title")} />
                <HomeSortHeader active={sortKey === "author"} direction={sortDirection} label="Author" onClick={() => sortByColumn("author")} />
                <HomeSortHeader active={sortKey === "wins"} direction={sortDirection} label="Wins" onClick={() => sortByColumn("wins")} />
                <HomeSortHeader active={sortKey === "lists"} direction={sortDirection} label="Lists" onClick={() => sortByColumn("lists")} />
                <HomeSortHeader active={sortKey === "imprint"} direction={sortDirection} label="Imprint" onClick={() => sortByColumn("imprint")} />
                <HomeSortHeader active={sortKey === "publisher"} direction={sortDirection} label="Publisher" onClick={() => sortByColumn("publisher")} />
              </tr>
            </thead>
            <tbody>
              {topBooks.map((book, index) => {
                return (
                  <tr
                    key={book.id}
                    className="book-table-row fade-up border-b hairline transition hover:bg-[var(--accent-soft)]"
                    style={{ animationDelay: `${Math.min(index * 18, 140)}ms` }}
                  >
                    <td className="plain-number px-4 py-4 text-sm muted">{book.publicationYear}</td>
                    <td className="px-4 py-4">
                      <Link
                        className="focus-ring grid w-full grid-cols-[2.15rem_minmax(0,1fr)] items-center gap-3 text-left font-[var(--font-serif)] text-xl font-light transition hover:text-[var(--accent)]"
                        href={`/books/${book.slug}`}
                      >
                        <HomeBookCover book={book} />
                        <span className="line-clamp-2">{book.title}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm">{book.author}</td>
                    <td className="plain-number px-4 py-4 text-sm">{book.wins}</td>
                    <td className="plain-number px-4 py-4 text-sm">{book.lists}</td>
                    <td className={`px-4 py-4 text-sm ${book.imprint ? "" : "book-missing-value"}`}>{book.imprint || "Unknown"}</td>
                    <td className={`px-4 py-4 text-sm ${book.publisher ? "muted" : "book-missing-value"}`}>{book.publisher || "Not yet sourced"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="home-stats-section mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" id="publishers">
        <div className="grid gap-4 border-t hairline pt-8 font-[var(--font-mono)] text-xs muted sm:grid-cols-4">
          <Stat label="Books" value={data.stats.books} />
          <Stat label="Award appearances" value={data.stats.appearances} />
          <Stat label="Prizes" value={data.stats.prizes} />
          <Stat label="Imprints" value={data.stats.imprints} />
        </div>
      </section>
    </main>
    </>
  );
}

function BrowseList({
  title,
  items,
  id,
  seeAllHref,
}: {
  title: string;
  id?: string;
  items: { id: string; label: string; meta: string; href: string }[];
  seeAllHref: string;
}) {
  return (
    <div className="home-browse-list py-8 lg:px-8 lg:[&:first-child]:border-r lg:[&:first-child]:pl-0 lg:[&:last-child]:pr-0 hairline" id={id}>
      <h2 className="mb-5 font-[var(--font-mono)] text-xs uppercase tracking-[0.22em] muted">{title}</h2>
      <div className="border-t hairline">
        {items.map((item) => (
          <Link
            href={item.href}
            key={item.id}
            className="group flex min-h-10 items-center justify-between gap-4 border-b hairline py-2.5 transition hover:bg-[color-mix(in_srgb,var(--panel)_74%,transparent)]"
          >
            <span className="text-base font-medium leading-snug">{item.label}</span>
            <span className="flex shrink-0 items-center gap-3 text-sm muted">
              {item.meta}
              <ArrowRight size={15} className="transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
      <Link
        className="focus-ring group mx-auto mt-5 flex min-w-40 items-center justify-center gap-2 rounded-md border hairline px-5 py-3 text-sm transition hover:border-[color-mix(in_srgb,var(--ink)_36%,var(--line))] hover:bg-[var(--panel)] hover:text-[var(--ink)] hover:shadow-[0_10px_24px_color-mix(in_srgb,var(--ink)_5%,transparent)]"
        href={seeAllHref}
      >
        See all
        <ArrowRight size={14} className="transition group-hover:translate-x-1" />
      </Link>
    </div>
  );
}

function HomeSortHeader({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: SortDirection;
  label: string;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3 font-normal">
      <button
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
        className={`home-sort-header focus-ring inline-flex items-center gap-1.5 ${active ? "home-sort-header-active" : ""}`}
        onClick={onClick}
        type="button"
      >
        {label}
        {active ? (direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} />}
      </button>
    </th>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="home-filter-group">
      <p className="filter-label mb-2">{label}</p>
      <div className="segmented-control">
        {children}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`segment-button focus-ring min-w-20 ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function HomeBookCover({ book }: { book: HomeBookRow }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (book.thumbnailUrl && !imageFailed) {
    return (
      <span className="home-book-cover" aria-hidden="true">
        <img src={book.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
      </span>
    );
  }
  return (
    <span className="home-book-cover home-book-cover-placeholder" aria-hidden="true">
      {book.title.charAt(0)}
    </span>
  );
}

function compareHomeBooks(a: HomeBookRow, b: HomeBookRow, sortKey: SortKey) {
  if (sortKey === "score") return a.score - b.score;
  if (sortKey === "wins") return a.wins - b.wins;
  if (sortKey === "lists") return a.lists - b.lists;
  if (sortKey === "year") return (a.publicationYear ?? 0) - (b.publicationYear ?? 0);
  if (sortKey === "author") return a.author.localeCompare(b.author);
  if (sortKey === "imprint") return (a.imprint ?? "").localeCompare(b.imprint ?? "");
  if (sortKey === "publisher") return (a.publisher ?? "").localeCompare(b.publisher ?? "");
  return a.title.localeCompare(b.title);
}

function compareHomeRecognitionTieBreak(a: HomeBookRow, b: HomeBookRow) {
  return (
    b.score - a.score ||
    b.majorWins - a.majorWins ||
    b.majorShortlists - a.majorShortlists ||
    b.wins - a.wins ||
    b.lists - a.lists ||
    b.normalShortlists - a.normalShortlists ||
    b.majorLonglists - a.majorLonglists ||
    b.normalLonglists - a.normalLonglists ||
    (b.publicationYear ?? b.firstRecognitionYear ?? 0) - (a.publicationYear ?? a.firstRecognitionYear ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

function defaultSortDirection(sortKey: SortKey): SortDirection {
  return sortKey === "year" || sortKey === "wins" || sortKey === "lists" || sortKey === "score" ? "desc" : "asc";
}

function getBrowseData(data: HomeBrowseData, region: AwardRegionFilter, type: TypeFilter) {
  return data.home[`${region}:${type}`];
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function queryExpansionModelLabel(model: SemanticQueryExpansionModel) {
  return model === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "GPT-5.4 Mini";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p>{label}</p>
      <p className="mt-1 text-2xl text-[var(--ink)]">{value.toLocaleString()}</p>
    </div>
  );
}
