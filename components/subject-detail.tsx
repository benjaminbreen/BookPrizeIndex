"use client";

import Link from "next/link";
import { CornerDownLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type React from "react";
import { BookDrawer } from "@/components/book-drawer";
import { EntityMetricGrid, SearchModeSelect } from "@/components/ui/design-primitives";
import { useSemanticBookSearch } from "@/components/use-semantic-book-search";
import type { BrowseBookRow } from "@/lib/browse-types";
import { appearancesByBookId, booksById } from "@/lib/data";
import type { SubjectSummary } from "@/lib/types";

type BookSortKey = "score" | "year" | "title" | "author" | "wins" | "lists" | "imprint" | "publisher" | "subject";
type AwardOption = { id: string; name: string; shortName?: string };
type RelatedSubjectOption = { id: string; slug: string; name: string };

export function SubjectDetail({
  awardOptions,
  books,
  relatedSubjects,
  subject,
}: {
  awardOptions: AwardOption[];
  books: BrowseBookRow[];
  relatedSubjects: RelatedSubjectOption[];
  subject: SubjectSummary;
}) {
  const [query, setQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [sortKey, setSortKey] = useState<BookSortKey>("score");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const activeQuery = mode === "semantic" ? semanticQuery : query;
  const semanticCandidateBookIds = useMemo(() => books.map((book) => book.id), [books]);
  const awardsById = useMemo(() => new Map(awardOptions.map((award) => [award.id, award])), [awardOptions]);

  const semanticSearch = useSemanticBookSearch({
    candidateBookIds: semanticCandidateBookIds,
    enabled: mode === "semantic",
    limit: 80,
    query: semanticQuery,
  });
  const semanticResultByBookId = useMemo(() => new Map(semanticSearch.results.map((result, index) => [result.bookId, index])), [semanticSearch.results]);
  const rows = useMemo(() => {
    const trimmedQuery = activeQuery.trim();
    if (mode === "semantic" && trimmedQuery.length >= 3 && semanticSearch.results.length) {
      return books
        .filter((book) => semanticResultByBookId.has(book.id))
        .sort((a, b) => (semanticResultByBookId.get(a.id) ?? 0) - (semanticResultByBookId.get(b.id) ?? 0))
        .slice(0, 50);
    }
    if (mode === "semantic" && trimmedQuery.length >= 3 && !semanticSearch.loading && !semanticSearch.error) return [];
    return sortBookRows(filterBookRowsByQuery(books, activeQuery), sortKey).slice(0, 50);
  }, [activeQuery, books, mode, semanticResultByBookId, semanticSearch.error, semanticSearch.loading, semanticSearch.results.length, sortKey]);
  const years = books.map((book) => book.firstRecognitionYear).filter((year): year is number => Boolean(year));
  const yearRange = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown";
  const uniqueImprints = new Set(books.map((book) => book.imprintId).filter(Boolean));
  const topicMix = topTopicCounts(books, subject.name);
  const topAwards = topCounts(books.flatMap((book) => book.awardIds.map((awardId) => awardsById.get(awardId)?.shortName ?? awardsById.get(awardId)?.name ?? "")));
  const topImprints = topCounts(books.map((book) => book.imprint ?? ""));
  const semanticActive = mode === "semantic" && semanticQuery.trim().length >= 3;
  const hasPendingSemanticQuery = mode === "semantic" && query.trim() !== semanticQuery.trim();
  const contextLine = `${subject.name} · ${semanticActive ? "Sorted by meaning match" : `Sorted by ${subjectSortLabel(sortKey).toLowerCase()}`} · Showing ${rows.length.toLocaleString()} of ${books.length.toLocaleString()} books${activeQuery.trim() ? ` · Search: ${activeQuery.trim()}` : ""}`;
  const activeBook = activeBookId ? booksById.get(activeBookId) ?? null : null;
  const activeBookAppearances = activeBookId ? appearancesByBookId.get(activeBookId) ?? [] : [];
  const activeBookIndex = activeBookId ? rows.findIndex((book) => book.id === activeBookId) : -1;
  const semanticConceptLine = semanticActive && semanticSearch.interpretation
    ? [
        semanticSearch.interpretation.concepts.slice(0, 4).join(", "),
        semanticSearch.interpretation.eras.slice(0, 2).join(", "),
        semanticSearch.interpretation.subjects.slice(0, 3).join(", "),
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1fr_0.5fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subject</p>
          <h1 className="mt-3 text-4xl font-light leading-tight sm:text-5xl">{subject.name}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 muted sm:text-lg sm:leading-8">{subjectDeck(subject.name)}</p>
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
              maxLength={600}
              placeholder={`Search within ${subject.name}...`}
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (mode === "semantic" && !nextQuery.trim()) setSemanticQuery("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && mode === "semantic") {
                  event.preventDefault();
                  setSemanticQuery(query.trim());
                }
              }}
            />
            {mode === "semantic" ? (
              <button
                aria-label="Run meaning search"
                className={`semantic-submit focus-ring inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-xs ${hasPendingSemanticQuery ? "semantic-submit-ready" : ""}`}
                disabled={!query.trim() || !hasPendingSemanticQuery}
                onClick={() => setSemanticQuery(query.trim())}
                type="button"
              >
                Enter
                <CornerDownLeft size={13} />
              </button>
            ) : null}
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
          <SearchModeSelect
            className="semantic-mode-select justify-self-start lg:justify-self-end"
            onChange={(nextMode) => {
              if (nextMode === "semantic") setSemanticQuery("");
              setMode(nextMode);
            }}
            value={mode}
          />
        </div>
        {semanticActive || (hasPendingSemanticQuery && query.trim()) ? (
          <p className="mt-2 grid gap-1 px-1 font-[var(--font-mono)] text-xs muted">
            {hasPendingSemanticQuery && query.trim() ? <span>Press Enter to search this phrase.</span> : null}
            {semanticSearch.loading ? <span>Reading for meaning...</span> : null}
            {semanticConceptLine ? <span className="text-[var(--ink)]">Interpreted as {semanticConceptLine}</span> : null}
            {semanticSearch.error ? <span className="text-[var(--accent)]">{semanticSearch.error} Showing keyword fallback.</span> : null}
            {semanticSearch.warning ? <span>{semanticSearch.warning}</span> : null}
          </p>
        ) : null}
      </section>

      <section className="mt-5 grid gap-6 lg:grid-cols-[1fr_0.5fr] lg:items-start">
        <div className="overflow-hidden rounded-[2px] border hairline panel">
          <div className="grid md:hidden">
            {rows.map((book) => {
              const imprint = book.imprint ?? "";
              const publisher = book.publisher ?? "";
              return (
                <button
                  className="book-mobile-card book-mobile-card-compact block w-full border-b hairline px-3 py-3 text-left text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)]"
                  key={book.id}
                  onClick={() => setActiveBookId(book.id)}
                  type="button"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0 overflow-hidden">
                      <p className="book-mobile-title-one-line text-base font-medium leading-snug">{book.title}</p>
                      <p className="mt-0.5 truncate text-sm leading-5 muted">{book.author}</p>
                    </div>
                    <span className="plain-number shrink-0 font-[var(--font-mono)] text-xs">{book.publicationYear ?? "-"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-[var(--font-mono)] text-xs muted">
                    <span><span className="plain-number text-[var(--ink)]">{book.wins}</span> wins</span>
                    <span><span className="plain-number text-[var(--ink)]">{book.lists}</span> lists</span>
                    <span className={`min-w-0 max-w-full truncate font-sans text-sm normal-case tracking-normal ${imprint || publisher ? "text-[var(--ink)]" : "book-missing-value"}`}>
                      {imprint || publisher || "Not yet sourced"}
                    </span>
                  </div>
                </button>
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
                const imprint = book.imprint ?? "";
                const publisher = book.publisher ?? "";
                return (
                  <tr
                    className="book-table-row cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)]"
                    key={book.id}
                    onClick={() => setActiveBookId(book.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveBookId(book.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="plain-number px-4 py-3 text-xs">{book.publicationYear}</td>
                    <td className="px-4 py-3">
                      <button
                        className="focus-ring grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 text-left text-base transition hover:text-[var(--accent)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveBookId(book.id);
                        }}
                        type="button"
                      >
                        <SubjectBookCover book={book} />
                        <span className="line-clamp-2">{book.title}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3">{book.author}</td>
                    <td className="plain-number px-4 py-3 text-xs">{book.wins}</td>
                    <td className="plain-number px-4 py-3 text-xs">{book.lists}</td>
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
    </main>
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
      href={`/topics/${slugify(label)}`}
      style={{ "--topic-mix-pct": `${pct}%`, "--topic-mix-delay": `${Math.min(colorIndex * 42, 260)}ms` } as React.CSSProperties}
    >
      <span className="topic-mix-label">{label}</span>
      <span className="topic-mix-track"><span className="topic-mix-fill" /></span>
      <span className="plain-number topic-mix-value">{value} ({pct}%)</span>
    </Link>
  );
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

function topCounts(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function SubjectBookCover({ book }: { book: BrowseBookRow }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (book.thumbnailUrl && !imageFailed) {
    return (
      <span className="subject-book-cover" aria-hidden="true">
        <img src={book.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
      </span>
    );
  }
  return (
    <span className="subject-book-cover subject-book-cover-placeholder" aria-hidden="true">
      {book.title.charAt(0)}
    </span>
  );
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

function topTopicCounts(books: BrowseBookRow[], subjectName: string) {
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
  const topicForBook = (book: BrowseBookRow) => {
    const topics = book.topics ?? [];
    return topics.find((topic) => preferred?.has(topic)) ?? topics.find((topic) => !genericTopics.has(topic)) ?? book.primaryTopic ?? "";
  };
  return topCounts(books.map(topicForBook), 10);
}

function filterBookRowsByQuery(books: BrowseBookRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return books;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return books.filter((book) => terms.every((term) => book.searchText.includes(term)));
}

function sortBookRows(books: BrowseBookRow[], sortKey: BookSortKey) {
  return [...books].sort((a, b) => {
    if (sortKey === "score") return b.score - a.score || b.wins - a.wins || b.lists - a.lists || a.title.localeCompare(b.title);
    if (sortKey === "wins") return b.wins - a.wins || a.title.localeCompare(b.title);
    if (sortKey === "lists") return b.lists - a.lists || a.title.localeCompare(b.title);
    if (sortKey === "year") return (b.publicationYear ?? b.firstRecognitionYear ?? 0) - (a.publicationYear ?? a.firstRecognitionYear ?? 0) || a.title.localeCompare(b.title);
    if (sortKey === "title") return a.title.localeCompare(b.title);
    if (sortKey === "author") return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
    if (sortKey === "publisher") return (a.publisher ?? "").localeCompare(b.publisher ?? "") || a.title.localeCompare(b.title);
    if (sortKey === "imprint") return (a.imprint ?? "").localeCompare(b.imprint ?? "") || a.title.localeCompare(b.title);
    return (a.primarySubject ?? "").localeCompare(b.primarySubject ?? "") || a.title.localeCompare(b.title);
  });
}

function subjectDeck(name: string) {
  if (name.toLowerCase() === "american history") {
    return "Award-recognized works that explore the history of the United States, its people, institutions, politics, and social movements from the colonial era to the present.";
  }
  return `Award-recognized works classified under ${name.toLowerCase()}, with sortable prize results, imprints, and related subjects.`;
}
