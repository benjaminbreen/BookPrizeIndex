"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryShelfRow, LibraryShelfWindow } from "@/lib/library-shelf-types";

export function LibraryShelf({ initialData }: { initialData: LibraryShelfWindow }) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState(initialData.query ?? "");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const shelfRef = useRef<HTMLDivElement>(null);
  const selected = rowAt(data, data.selectedIndex);
  const selectedClass = data.classes.find((item) => item.code === selected?.mainClass);
  const visibleRows = useMemo(() => {
    const start = Math.max(data.windowStart, data.selectedIndex - 3);
    const end = Math.min(data.windowEnd, data.selectedIndex + 3);
    return data.rows
      .map((row, localIndex) => ({ row, globalIndex: data.windowStart + localIndex }))
      .filter(({ globalIndex }) => globalIndex >= start && globalIndex <= end);
  }, [data]);

  useEffect(() => {
    if (!selected) return;
    if (!(data.query && data.matchCount === 0)) {
      const url = new URL(window.location.href);
      url.searchParams.set("book", selected.slug);
      url.searchParams.delete("class");
      url.searchParams.delete("index");
      url.searchParams.delete("q");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    shelfRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [data.matchCount, data.query, selected]);

  async function load(params: URLSearchParams) {
    setLoading(true);
    setLoadError(undefined);
    try {
      const response = await fetch(`/api/library-shelf?${params.toString()}`);
      if (!response.ok) throw new Error("The shelf could not be loaded.");
      setData(await response.json() as LibraryShelfWindow);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function selectIndex(index: number) {
    if (index < 0 || index >= data.stats.shelfBooks) return;
    if (index < data.windowStart + 2 || index > data.windowEnd - 2) {
      void load(new URLSearchParams({ index: String(index), radius: "15" }));
      return;
    }
    setData((current) => ({
      ...current,
      selectedIndex: index,
      query: undefined,
      matchCount: undefined,
    }));
  }

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    void load(new URLSearchParams({ q: query.trim(), radius: "15" }));
  }

  return (
    <div className="library-shelf-shell">
      <div className="filter-toolbar library-shelf-toolbar">
        <form className="library-shelf-search" onSubmit={onSearch}>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="Search the shelf by title, author, or call number"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a book on the shelf"
            value={query}
          />
          <button className="filter-action focus-ring" disabled={!query.trim() || loading} type="submit">
            Find
          </button>
        </form>
        <label className="filter-group library-shelf-class-select">
          <span className="filter-label">Class</span>
          <select
            className="filter-select focus-ring"
            onChange={(event) => void load(new URLSearchParams({ class: event.target.value, radius: "15" }))}
            value={selected?.mainClass ?? ""}
          >
            {data.classes.map((item) => (
              <option key={item.code} value={item.code}>{item.code} · {item.label} ({item.count})</option>
            ))}
          </select>
        </label>
      </div>

      <div className="library-shelf-class-track" aria-label="Library of Congress classes">
        {data.classes.map((item) => (
          <button
            aria-label={`Go to class ${item.code}, ${item.label}, ${item.count} books`}
            className={item.code === selected?.mainClass ? "is-active" : ""}
            key={item.code}
            onClick={() => void load(new URLSearchParams({ class: item.code, radius: "15" }))}
            style={{ flexGrow: Math.max(item.count, 4) }}
            type="button"
          >
            <span className="library-shelf-class-code">{item.code}</span>
            <span className="library-shelf-class-tooltip" role="tooltip">
              <strong>{item.code} · {item.label}</strong>
              <small>{item.count.toLocaleString()} shelf books</small>
            </span>
          </button>
        ))}
      </div>

      <section
        aria-label="Books in call-number order"
        className={`library-shelf-viewport ${loading ? "is-loading" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectIndex(data.selectedIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            selectIndex(data.selectedIndex + 1);
          }
        }}
        ref={shelfRef}
        tabIndex={0}
      >
        <div className="library-shelf-controls">
          <button
            aria-label="Previous book"
            className="focus-ring"
            disabled={data.selectedIndex === 0 || loading}
            onClick={() => selectIndex(data.selectedIndex - 1)}
            type="button"
          >
            <ArrowLeft size={18} />
          </button>
          <p>
            <span>{selectedClass ? `${selectedClass.code} · ${selectedClass.label}` : "Library shelf"}</span>
            <strong className="plain-number">{data.selectedIndex + 1} / {data.stats.shelfBooks.toLocaleString()}</strong>
          </p>
          <button
            aria-label="Next book"
            className="focus-ring"
            disabled={data.selectedIndex >= data.stats.shelfBooks - 1 || loading}
            onClick={() => selectIndex(data.selectedIndex + 1)}
            type="button"
          >
            <ArrowRight size={18} />
          </button>
        </div>

        <ol className="library-shelf-books">
          {visibleRows.map(({ row, globalIndex }) => (
            <li className={globalIndex === data.selectedIndex ? "is-selected" : ""} key={row.id}>
              <button
                aria-current={globalIndex === data.selectedIndex ? "true" : undefined}
                className="focus-ring library-shelf-book"
                onClick={() => selectIndex(globalIndex)}
                type="button"
              >
                <ShelfCover row={row} />
                <span className="library-shelf-call">{row.callNumber}</span>
                <span className="library-shelf-book-title">{row.title}</span>
                <span className="library-shelf-book-author">{row.author}</span>
              </button>
            </li>
          ))}
        </ol>
        <div aria-live="polite" className="sr-only">
          {selected ? `${selected.title} by ${selected.author}, call number ${selected.callNumber}, book ${data.selectedIndex + 1} of ${data.stats.shelfBooks}` : ""}
        </div>
      </section>

      {loadError ? <p className="library-shelf-notice" role="alert">{loadError}</p> : null}
      {data.query ? (
        <p className="library-shelf-notice">
          {data.matchCount
            ? `${data.matchCount.toLocaleString()} shelf ${data.matchCount === 1 ? "match" : "matches"} for “${data.query}”; showing the first.`
            : `No shelf match for “${data.query}”.`}
        </p>
      ) : null}

      {selected ? (
        <article className="library-shelf-selection">
          <div>
            <p className="library-shelf-eyebrow">{selected.subclass} · Library of Congress call number</p>
            <h2>{selected.title}</h2>
            <p className="library-shelf-selected-author">{selected.author}{selected.publicationYear ? ` · ${selected.publicationYear}` : ""}</p>
          </div>
          <dl>
            <div>
              <dt>Call number</dt>
              <dd>{selected.callNumber}</dd>
            </div>
            <div>
              <dt>Project subject</dt>
              <dd>{selected.primarySubject ?? "Not yet classified"}</dd>
            </div>
            <div>
              <dt>Placement</dt>
              <dd>{selected.confidence === "high" ? "Exact-edition evidence" : "Catalog consensus"}</dd>
            </div>
          </dl>
          <Link className="filter-action focus-ring library-shelf-record-link" href={`/books/${selected.slug}`}>
            Open book record
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </article>
      ) : null}
    </div>
  );
}

function rowAt(data: LibraryShelfWindow, index: number) {
  return data.rows[index - data.windowStart];
}

function ShelfCover({ row }: { row: LibraryShelfRow }) {
  if (row.thumbnailUrl) {
    return <span className="library-shelf-cover" aria-hidden="true"><img alt="" src={row.thumbnailUrl} /></span>;
  }
  return <span className="library-shelf-cover library-shelf-cover-placeholder" aria-hidden="true">{row.title.charAt(0)}</span>;
}
