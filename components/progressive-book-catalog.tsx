"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { BookCatalog } from "@/components/book-catalog";
import type { BrowseBookRow } from "@/lib/browse-types";

type AwardOption = { id: string; awardIds: string[]; name: string; shortName?: string };

type EntityType = "imprint" | "publisher";

export function ProgressiveBookCatalog({
  awardOptions,
  books,
  compactHeader = false,
  deck,
  entityId,
  entityType,
  secondaryDeck,
  title,
  totalBooks,
}: {
  awardOptions: AwardOption[];
  books: BrowseBookRow[];
  compactHeader?: boolean;
  deck?: React.ReactNode;
  entityId: string;
  entityType: EntityType;
  secondaryDeck?: React.ReactNode;
  title?: string | null;
  totalBooks: number;
}) {
  const [visibleBooks, setVisibleBooks] = useState(books);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadedAll = visibleBooks.length >= totalBooks;
  const catalogDeck = useMemo(() => {
    const loadedLine = loadedAll
      ? null
      : (
        <span className="mt-3 block font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
          Showing {visibleBooks.length.toLocaleString()} of {totalBooks.toLocaleString()} books.
        </span>
      );
    return (
      <>
        {deck}
        {loadedLine}
      </>
    );
  }, [deck, loadedAll, totalBooks, visibleBooks.length]);

  async function loadAllBooks() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/books/entity?type=${entityType}&id=${encodeURIComponent(entityId)}`);
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const payload = await response.json() as { books?: BrowseBookRow[] };
      if (!Array.isArray(payload.books)) throw new Error("Response did not include books.");
      setVisibleBooks(payload.books);
    } catch {
      setError("Could not load the full book list. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <BookCatalog
        awardOptions={awardOptions}
        books={visibleBooks}
        compactHeader={compactHeader}
        deck={catalogDeck}
        secondaryDeck={secondaryDeck}
        title={title}
      />
      {!loadedAll ? (
        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t hairline pt-5 font-[var(--font-mono)] text-xs">
            <span className="muted">
              {totalBooks.toLocaleString()} total books in this {entityType} view.
            </span>
            <button
              className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2"
              disabled={loading}
              onClick={loadAllBooks}
              type="button"
            >
              {loading ? "Loading..." : `Load all ${totalBooks.toLocaleString()} books`}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-[var(--accent)]">{error}</p> : null}
        </section>
      ) : null}
    </>
  );
}
