"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LlmChoiceBook, LlmChoiceData, LlmChoiceTagDimension } from "@/lib/llm-choice-types";

type View = "overlooked" | "favorites";

const VIEWS: Array<{ id: View; label: string; blurb: string }> = [
  {
    id: "overlooked",
    label: "Overlooked",
    blurb: "Books the model is drawn to far more than their public recognition would predict. Ranked by affinity net of fame.",
  },
  {
    id: "favorites",
    label: "Favorites",
    blurb: "Straight affinity ranking, unadjusted. Mostly famous books — which is the point of comparison.",
  },
];

const TAG_DIMENSIONS: Array<{ id: LlmChoiceTagDimension; label: string }> = [
  { id: "craft", label: "Craft" },
  { id: "evidence", label: "Evidence" },
  { id: "stance", label: "Stance" },
];

export function LlmChoice({ data }: { data: LlmChoiceData }) {
  const [view, setView] = useState<View>("overlooked");
  const [activeTag, setActiveTag] = useState<{ dimension: LlmChoiceTagDimension; value: string } | null>(null);

  const source = view === "overlooked" ? data.overlooked : data.favorites;

  const books = useMemo(() => {
    if (!activeTag) return source;
    return source.filter((book) => book.tags?.[activeTag.dimension] === activeTag.value);
  }, [activeTag, source]);

  /**
   * Chip counts come from the books actually on screen, not from the corpus. Corpus
   * counts looked authoritative but described a different set -- "restraint 9" led to
   * an empty list, because only 120 books are ranked here. Tags matching nothing in
   * the current view are dropped rather than shown as dead ends.
   */
  const availableTags = useMemo(() => {
    const counts: Record<LlmChoiceTagDimension, Map<string, number>> = {
      craft: new Map(), evidence: new Map(), stance: new Map(),
    };
    for (const book of source) {
      for (const dimension of TAG_DIMENSIONS) {
        const value = book.tags?.[dimension.id];
        if (!value || value === "none") continue;
        counts[dimension.id].set(value, (counts[dimension.id].get(value) ?? 0) + 1);
      }
    }
    return Object.fromEntries(TAG_DIMENSIONS.map((dimension) => [
      dimension.id,
      [...counts[dimension.id].entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    ])) as Record<LlmChoiceTagDimension, Array<{ value: string; count: number }>>;
  }, [source]);

  const activeView = VIEWS.find((item) => item.id === view)!;
  const maxDensity = useMemo(() => Math.max(...data.density.map((cell) => cell.n), 1), [data.density]);
  const highlighted = useMemo(
    () => books.slice(0, 24).map((book) => ({ x: book.fame, y: book.affinity, title: book.title })),
    [books],
  );

  return (
    <div className="llm-choice">
      <div className="llm-choice-controls">
        <div className="llm-choice-toggle" role="tablist" aria-label="Ranking">
          {VIEWS.map((item) => (
            <button
              aria-selected={view === item.id}
              className="llm-choice-toggle-button focus-ring"
              key={item.id}
              onClick={() => { setView(item.id); setActiveTag(null); }}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="llm-choice-blurb">{activeView.blurb}</p>
      </div>

      <div className="llm-choice-filters">
        {TAG_DIMENSIONS.map((dimension) => (
          <div className="llm-choice-filter-row" key={dimension.id}>
            <span className="llm-choice-filter-label">{dimension.label}</span>
            <div className="llm-choice-chips">
              {availableTags[dimension.id].map((tag) => {
                const active = activeTag?.dimension === dimension.id && activeTag.value === tag.value;
                return (
                  <button
                    aria-pressed={active}
                    className={`llm-choice-chip focus-ring${active ? " is-active" : ""}`}
                    key={tag.value}
                    onClick={() => setActiveTag(active ? null : { dimension: dimension.id, value: tag.value })}
                    type="button"
                  >
                    {tag.value.replace(/-/g, " ")}
                    <span className="llm-choice-chip-count">{tag.count.toLocaleString("en-US")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {activeTag ? (
          <button className="llm-choice-clear focus-ring" onClick={() => setActiveTag(null)} type="button">
            Clear filter
          </button>
        ) : null}
      </div>

      <div className="llm-choice-body">
        <ol className="llm-choice-list">
          {books.length ? books.map((book, index) => (
            <li className="llm-choice-row" key={book.bookId}>
              <span className="llm-choice-rank">{String(index + 1).padStart(2, "0")}</span>
              {book.thumbnailUrl ? (
                <img alt="" className="llm-choice-cover" loading="lazy" src={book.thumbnailUrl} />
              ) : (
                <span aria-hidden="true" className="llm-choice-cover llm-choice-cover-empty" />
              )}
              <div className="llm-choice-meta">
                <Link className="llm-choice-title focus-ring" href={`/books/${book.slug}`}>
                  {book.title}
                </Link>
                <p className="llm-choice-author">
                  {book.author}
                  {book.publicationYear ? <span className="llm-choice-year"> · {book.publicationYear}</span> : null}
                </p>
                <ScoreBars affinity={book.affinity} fame={book.fame} />
                <TagList tags={book.tags} />
              </div>
              <div className="llm-choice-figure">
                <span className="llm-choice-figure-value">
                  {view === "overlooked" ? formatSigned(book.residual) : book.affinity}
                </span>
                <span className="llm-choice-figure-label">
                  {view === "overlooked" ? "vs expected" : "affinity"}
                </span>
              </div>
            </li>
          )) : (
            <li className="llm-choice-empty">
              No books in this ranking carry that tag. <button className="focus-ring" onClick={() => setActiveTag(null)} type="button">Clear the filter</button> to see the full list.
            </li>
          )}
        </ol>

        <aside className="llm-choice-aside">
          <figure className="llm-choice-chart-figure">
            <figcaption className="llm-choice-chart-caption">
              Affinity against public fame across all {data.count.toLocaleString("en-US")} recognized books.
              Books above the line are liked more than their recognition predicts.
            </figcaption>
            <DensityChart
              cells={data.density}
              grid={data.grid}
              highlighted={highlighted}
              maxDensity={maxDensity}
            />
            <div className="llm-choice-legend">
              <span><i className="llm-choice-swatch llm-choice-swatch-density" /> corpus density</span>
              <span><i className="llm-choice-swatch llm-choice-swatch-mark" /> shown above</span>
            </div>
          </figure>
        </aside>
      </div>
    </div>
  );
}

function ScoreBars({ affinity, fame }: { affinity: number; fame: number }) {
  return (
    <div className="llm-choice-bars" role="img" aria-label={`Model affinity ${affinity} of 100, public fame ${fame} of 100`}>
      <span className="llm-choice-bar-label">Affinity</span>
      <span className="llm-choice-bar-track">
        <span className="llm-choice-bar-fill llm-choice-bar-affinity" style={{ width: `${affinity}%` }} />
      </span>
      <span className="llm-choice-bar-value">{affinity}</span>
      <span className="llm-choice-bar-label">Fame</span>
      <span className="llm-choice-bar-track">
        <span className="llm-choice-bar-fill llm-choice-bar-fame" style={{ width: `${fame}%` }} />
      </span>
      <span className="llm-choice-bar-value">{fame}</span>
    </div>
  );
}

function TagList({ tags }: { tags: LlmChoiceBook["tags"] }) {
  const values = TAG_DIMENSIONS
    .map((dimension) => tags?.[dimension.id])
    .filter((value): value is string => Boolean(value) && value !== "none");
  if (!values.length) return null;
  return (
    <ul className="llm-choice-tags">
      {values.map((value) => <li key={value}>{value.replace(/-/g, " ")}</li>)}
    </ul>
  );
}

/**
 * Fame on x, affinity on y. The diagonal is a visual reference for "liked exactly as
 * much as it is known", so distance above it reads as the overlooked axis without
 * needing the residual explained in words.
 */
function DensityChart({
  cells,
  grid,
  highlighted,
  maxDensity,
}: {
  cells: LlmChoiceData["density"];
  grid: number;
  highlighted: Array<{ x: number; y: number; title: string }>;
  maxDensity: number;
}) {
  const size = 100;
  const cell = size / grid;
  return (
    <svg
      className="llm-choice-chart"
      role="img"
      aria-label="Density of model affinity against public fame, with the books listed alongside marked"
      viewBox={`-14 -8 ${size + 22} ${size + 22}`}
    >
      <line className="llm-choice-axis" x1={0} x2={size} y1={size} y2={size} />
      <line className="llm-choice-axis" x1={0} x2={0} y1={0} y2={size} />
      <line className="llm-choice-diagonal" x1={0} x2={size} y1={size} y2={0} />
      {cells.map((item) => (
        <rect
          fill="var(--ink)"
          fillOpacity={0.06 + (item.n / maxDensity) * 0.5}
          height={cell}
          key={`${item.x}:${item.y}`}
          width={cell}
          x={item.x * cell}
          y={size - (item.y + 1) * cell}
        />
      ))}
      {highlighted.map((point) => (
        <circle
          className="llm-choice-point"
          cx={point.x}
          cy={size - point.y}
          key={point.title}
          r={1.7}
        >
          <title>{point.title}</title>
        </circle>
      ))}
      <text className="llm-choice-axis-label" x={size / 2} y={size + 13} textAnchor="middle">Public fame</text>
      <text className="llm-choice-axis-label" transform={`rotate(-90 -9 ${size / 2})`} x={-9} y={size / 2} textAnchor="middle">Model affinity</text>
    </svg>
  );
}

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
