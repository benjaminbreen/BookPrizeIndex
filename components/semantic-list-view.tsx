"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";
import { BrowseTrailWriter } from "@/components/browse-trail-writer";
import { SemanticListActions } from "@/components/semantic-list-actions";
import type {
  SemanticListDraft,
  SemanticListSnapshot,
} from "@/lib/semantic-list";

const PAGE_INCREMENT = 50;

export function SemanticListView({
  local = false,
  snapshot,
}: {
  local?: boolean;
  snapshot: SemanticListSnapshot;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_INCREMENT);
  const concepts = [
    ...(snapshot.interpretation?.coreConcepts ?? snapshot.interpretation?.concepts ?? []),
    ...(snapshot.interpretation?.adventurousConcepts ?? []),
    ...(snapshot.interpretation?.namedFigures ?? []),
    ...(snapshot.interpretation?.namedPlaces ?? []),
  ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 12);
  const visible = snapshot.results.slice(0, visibleCount);
  const remaining = snapshot.results.length - visible.length;
  const personaSearch = /\b(?:would|might)\s+(?:like|enjoy)\b|\bfor fans? of\b|\bbooks?\s+for\b/i.test(snapshot.query);
  const rerun = `/books?q=${encodeURIComponent(snapshot.query)}${snapshot.diagnostics?.queryExpansionModel ? `&queryModel=${encodeURIComponent(snapshot.diagnostics.queryExpansionModel)}` : ""}${snapshot.diagnostics?.retrievalMode ? `&semanticMode=${snapshot.diagnostics.retrievalMode}` : ""}`;
  const filterLabels = [
    snapshot.filters.region === "us" ? "U.S. awards" : snapshot.filters.region === "international" ? "International awards" : "All award regions",
    snapshot.filters.subject,
    snapshot.filters.awardLabel,
    snapshot.filters.publisherLabel,
    snapshot.filters.topic ? `Topic: ${snapshot.filters.topic}` : undefined,
    snapshot.filters.metadata && snapshot.filters.metadata !== "all"
      ? `Metadata: ${snapshot.filters.metadata.replaceAll("_", " ")}`
      : undefined,
  ].filter(Boolean);

  return (
    <main className="semantic-list-page mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <BrowseTrailWriter label="this list" slugs={snapshot.results.map((book) => book.slug)} />
      <header className="semantic-list-header border-b hairline pb-8">
        <div className="min-w-0">
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">
            {local ? "Saved on this device" : "Shared semantic list"}
          </p>
          <h1 className="mt-4 max-w-4xl font-[var(--font-serif)] text-4xl font-light leading-[1.04] tracking-[-0.025em] sm:text-5xl">
            {snapshot.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 muted">
            Frozen from the Meaning search <span className="text-[var(--ink)]">“{snapshot.query}”</span> on{" "}
            {formatDate(snapshot.createdAt)}. The interpretation and order below will not change when the live semantic
            index changes.
          </p>
        </div>
        <div className="semantic-list-header-actions">
          <SemanticListActions
            draft={draftFromSnapshot(snapshot)}
            initialSnapshot={snapshot}
            variant="page"
          />
          <Link className="semantic-list-rerun focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" href={rerun}>
            <Search size={14} />
            Run again
          </Link>
        </div>
      </header>

      <section className="semantic-list-intent border-b hairline py-6">
        <div>
          <p className="filter-label">Interpreted as</p>
          {concepts.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {concepts.map((concept) => <span className="semantic-list-concept" key={concept}>{concept}</span>)}
            </div>
          ) : (
            <p className="mt-2 text-sm muted">No expanded concepts were retained for this search.</p>
          )}
          <p className="mt-4 font-[var(--font-mono)] text-[0.68rem] leading-5 muted">
            Filter context · {filterLabels.join(" · ")}
          </p>
        </div>
        <dl>
          <div>
            <dt>Books</dt>
            <dd>{snapshot.results.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Catalog candidates</dt>
            <dd>{snapshot.diagnostics?.candidateBookCount?.toLocaleString() ?? "—"}</dd>
          </div>
          <div>
            <dt>Index date</dt>
            <dd>{snapshot.diagnostics?.indexGeneratedAt ? formatDate(snapshot.diagnostics.indexGeneratedAt) : "—"}</dd>
          </div>
        </dl>
      </section>

      {personaSearch ? (
        <p className="semantic-list-disclaimer">
          This is an AI-assisted interpretation of a reader’s query, not a statement of the named person’s actual
          preferences, participation, or endorsement.
        </p>
      ) : null}

      <section aria-labelledby="semantic-list-books" className="semantic-list-results">
        <div className="semantic-list-results-heading">
          <div>
            <p className="filter-label">Frozen ranking</p>
            <h2 className="mt-2 font-[var(--font-serif)] text-3xl font-light" id="semantic-list-books">Books in meaning-match order</h2>
          </div>
          <p className="font-[var(--font-mono)] text-xs muted">
            Showing {visible.length.toLocaleString()} of {snapshot.results.length.toLocaleString()}
          </p>
        </div>
        <ol className="semantic-list-books">
          {visible.map((book, index) => (
            <li key={book.bookId}>
              <span className="semantic-list-rank">{String(index + 1).padStart(2, "0")}</span>
              <Link className="semantic-list-cover focus-ring" href={`/books/${book.slug}`} aria-label={`Open ${book.title}`}>
                {book.thumbnailUrl ? <img loading="lazy" decoding="async" alt="" src={book.thumbnailUrl} /> : <span>{book.title.charAt(0)}</span>}
              </Link>
              <div className="min-w-0">
                <Link className="semantic-list-book-title focus-ring" href={`/books/${book.slug}`}>{book.title}</Link>
                <p className="mt-1 text-sm muted">{book.author}{book.publicationYear ? ` · ${book.publicationYear}` : ""}</p>
              </div>
              <div className="semantic-list-book-meta">
                {book.primarySubject ? <span>{book.primarySubject}</span> : null}
                <small>{book.imprint ?? book.publisher ?? "Publisher not yet sourced"}</small>
              </div>
              <Link aria-label={`Open ${book.title}`} className="semantic-list-book-arrow focus-ring" href={`/books/${book.slug}`}>
                <ArrowRight size={15} />
              </Link>
            </li>
          ))}
        </ol>
        {remaining > 0 ? (
          <div className="border-t hairline pt-5 text-center">
            <button
              className="filter-action focus-ring inline-flex px-4 py-2.5 text-sm"
              onClick={() => setVisibleCount((count) => Math.min(count + PAGE_INCREMENT, snapshot.results.length))}
              type="button"
            >
              Show {Math.min(PAGE_INCREMENT, remaining).toLocaleString()} more
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function draftFromSnapshot(snapshot: SemanticListSnapshot): SemanticListDraft {
  return {
    diagnostics: snapshot.diagnostics,
    filters: snapshot.filters,
    interpretation: snapshot.interpretation,
    query: snapshot.query,
    results: snapshot.results.map((result) => ({ bookId: result.bookId, score: result.semanticScore })),
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
