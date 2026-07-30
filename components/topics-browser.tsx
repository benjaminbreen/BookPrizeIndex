"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { TopicIcon } from "@/components/topic-icon";

export type TopicBrowseRow = {
  name: string;
  slug: string;
  description: string;
  bookCount: number;
  topBook?: {
    title: string;
  };
};

type SortKey = "books-desc" | "books-asc" | "topic-asc" | "topic-desc";

export function TopicsBrowser({ topics }: { topics: TopicBrowseRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("books-desc");

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = topics.filter((topic) => {
      if (!normalizedQuery) return true;
      return [
        topic.name,
        topic.description,
        topic.topBook?.title,
      ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
    });
    return sortTopicRows(filtered, sortKey);
  }, [query, sortKey, topics]);

  return (
    <main className="subjects-page mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <section className="subjects-hero grid gap-5 sm:gap-8 lg:grid-cols-[0.86fr_1fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Topics</p>
          <h1 className="mt-3 font-[var(--font-serif)] text-[2.25rem] font-light leading-tight sm:text-5xl">Browse topics.</h1>
          <p className="mt-3 max-w-2xl font-[var(--font-serif)] text-[1.05rem] font-light leading-7 muted sm:mt-5 sm:text-xl sm:leading-8">
            Explore specific themes that connect books across broad subjects.
          </p>
          <p className="mt-3 max-w-xl text-sm leading-6 muted sm:text-base sm:leading-7">
            A title can appear under several topics. Prefer one broad category?{" "}
            <Link className="editorial-inline-link focus-ring" href="/subjects">
              Browse Subjects
            </Link>
          </p>
          <Link className="mt-4 inline-block font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.14em] muted transition hover:text-[var(--ink)]" href="/methodology#subjects">
            How classification works →
          </Link>
        </div>

        <div className="subjects-search focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={24} strokeWidth={1.8} />
          <input
            aria-label="Search topics"
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter topics…"
            value={query}
          />
        </div>
      </section>

      <section className="subjects-table-panel mt-4 border hairline sm:mt-6">
        <div className="filter-toolbar flex flex-col gap-3 border-b hairline px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-[var(--font-mono)] text-xs muted">
            Showing <span className="text-[var(--ink)]">{rows.length.toLocaleString()}</span> of {topics.length.toLocaleString()} topics
          </p>
          <div className="filter-group">
            <span className="filter-label">Sort</span>
            <div className="segmented-control">
              <button
                aria-pressed={sortKey.startsWith("books")}
                className={`segment-button focus-ring ${sortKey.startsWith("books") ? "segment-button-active" : ""}`}
                onClick={() => setSortKey(sortKey === "books-desc" ? "books-asc" : "books-desc")}
                type="button"
              >
                Books {sortKey === "books-asc" ? "↑" : "↓"}
              </button>
              <button
                aria-pressed={sortKey.startsWith("topic")}
                className={`segment-button focus-ring ${sortKey.startsWith("topic") ? "segment-button-active" : ""}`}
                onClick={() => setSortKey(sortKey === "topic-asc" ? "topic-desc" : "topic-asc")}
                type="button"
              >
                A–Z {sortKey === "topic-desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>
        </div>

        <div className="topic-directory-grid grid gap-px bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
          {rows.length ? rows.map((topic, index) => (
            <CompactTopicCard index={index} key={topic.slug} topic={topic} />
          )) : (
            <div className="bg-[var(--paper)] px-4 py-12 text-sm muted sm:col-span-2 lg:col-span-3">
              No topics match “{query.trim()}”.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function CompactTopicCard({ index, topic }: { index: number; topic: TopicBrowseRow }) {
  const colorIndex = topicColorIndex(topic.slug);
  return (
    <Link
      className={`topic-directory-item topic-mix-color-${colorIndex} focus-ring`}
      href={`/topics/${topic.slug}`}
      style={{ animationDelay: `${Math.min(index * 20, 360)}ms` }}
    >
      <span className="topic-directory-icon">
        <TopicIcon slug={topic.slug} />
      </span>
      <span className="min-w-0">
        <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <span className="text-base font-medium leading-5">{topic.name}</span>
          <span className="topic-directory-count plain-number">{topic.bookCount.toLocaleString()}</span>
        </span>
        <span className="mt-1 block line-clamp-2 text-[0.8rem] leading-5 muted">{topic.description}</span>
        {topic.topBook ? (
          <span className="topic-directory-top">
            <span className="topic-directory-top-label">Top title</span>
            <span className="line-clamp-2 min-w-0 text-[0.8rem] font-medium leading-[1.15rem]">{topic.topBook.title}</span>
          </span>
        ) : (
          <span className="topic-directory-top text-[0.8rem] muted">Not yet ranked</span>
        )}
      </span>
      <ChevronRight className="topic-directory-arrow" size={15} strokeWidth={1.7} />
    </Link>
  );
}

function sortTopicRows(rows: TopicBrowseRow[], sortKey: SortKey) {
  return [...rows].sort((a, b) => {
    if (sortKey === "topic-asc") return a.name.localeCompare(b.name);
    if (sortKey === "topic-desc") return b.name.localeCompare(a.name);
    if (sortKey === "books-asc") return a.bookCount - b.bookCount || a.name.localeCompare(b.name);
    return b.bookCount - a.bookCount || a.name.localeCompare(b.name);
  });
}

function topicColorIndex(slug: string) {
  let hash = 0;
  for (const character of slug) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 8;
}
