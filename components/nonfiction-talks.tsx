"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { NonfictionTalksClaim, NonfictionTalksData } from "@/lib/nonfiction-talks-types";

type Hovered = {
  year: number;
  claim: NonfictionTalksClaim | null;
  index: number;
};

/** Palette slot per stance; "none" falls through to a neutral tone. */
const STANCE_COLOR: Record<string, string> = {
  "revisionism": "var(--chart-cat-2)",
  "moral-seriousness": "var(--chart-cat-1)",
  "wonder": "var(--chart-cat-3)",
  "conceptual-strangeness": "var(--chart-cat-5)",
  "counterintuition": "var(--chart-cat-4)",
  "elegy": "var(--chart-cat-6)",
  "polemic": "var(--chart-cat-8)",
  "none": "color-mix(in srgb, var(--muted) 40%, transparent)",
};

export function NonfictionTalks({ dataUrl }: { dataUrl: string }) {
  const [data, setData] = useState<NonfictionTalksData | null>(null);
  const [error, setError] = useState(false);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [stance, setStance] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(dataUrl, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload: NonfictionTalksData) => setData(payload))
      .catch((cause) => { if (!controller.signal.aborted) setError(true); void cause; });
    return () => controller.abort();
  }, [dataUrl]);

  const subjectIndex = useMemo(
    () => (subject && data ? data.subjects.indexOf(subject) : -1),
    [data, subject],
  );
  const stanceIndex = useMemo(
    () => (stance && data ? data.stances.indexOf(stance) : -1),
    [data, stance],
  );

  if (error) return <p className="talks-status">The claim data could not be loaded.</p>;
  if (!data) return <p className="talks-status">Loading {(4322).toLocaleString("en-US")} claims…</p>;

  const filtered = subjectIndex >= 0 || stanceIndex >= 0;
  const matches = (claim: NonfictionTalksClaim) =>
    (subjectIndex < 0 || claim.subject === subjectIndex) &&
    (stanceIndex < 0 || claim.stance === stanceIndex);
  const matchCount = data.years.reduce(
    (sum, row) => sum + row.claims.filter(matches).length, 0,
  );

  return (
    <div className="talks">
      <div className="talks-controls">
        <div className="talks-legend" role="group" aria-label="Highlight a stance">
          {data.stances.map((value) => (
            <button
              aria-pressed={stance === value}
              className={`talks-legend-item focus-ring${stance === value ? " is-active" : ""}`}
              key={value}
              onClick={() => setStance(stance === value ? null : value)}
              type="button"
            >
              <i style={{ background: STANCE_COLOR[value] ?? STANCE_COLOR.none }} />
              {value.replace(/-/g, " ")}
            </button>
          ))}
        </div>
        <div className="talks-subject">
          <label className="talks-subject-label" htmlFor="talks-subject-select">Subject</label>
          <select
            className="talks-subject-select focus-ring"
            id="talks-subject-select"
            onChange={(event) => setSubject(event.target.value || null)}
            value={subject ?? ""}
          >
            <option value="">All subjects</option>
            {data.subjects.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {filtered ? (
            <button
              className="talks-clear focus-ring"
              onClick={() => { setSubject(null); setStance(null); }}
              type="button"
            >
              Clear ({matchCount.toLocaleString("en-US")})
            </button>
          ) : null}
        </div>
      </div>

      <div className="talks-body">
        <div className="talks-chart" onMouseLeave={() => setHovered(null)}>
          {data.years.map((row) => (
            <YearRow
              dimmed={filtered}
              key={row.year}
              matches={matches}
              maxRow={data.maxRow}
              onHover={setHovered}
              row={row}
              stances={data.stances}
            />
          ))}
        </div>

        <aside className="talks-detail">
          <div className="talks-detail-inner">
            {hovered?.claim ? (
              <>
                <p className="talks-detail-year">{hovered.year}</p>
                <p className="talks-detail-claim">{hovered.claim.claim}</p>
                <Link className="talks-detail-title focus-ring" href={`/books/${hovered.claim.slug}`}>
                  {hovered.claim.title}
                </Link>
                <p className="talks-detail-meta">
                  <span
                    className="talks-detail-swatch"
                    style={{ background: STANCE_COLOR[data.stances[hovered.claim.stance]] ?? STANCE_COLOR.none }}
                  />
                  {data.stances[hovered.claim.stance].replace(/-/g, " ")}
                  <span className="talks-detail-sep">·</span>
                  {data.subjects[hovered.claim.subject]}
                </p>
              </>
            ) : hovered ? (
              <>
                <p className="talks-detail-year">{hovered.year}</p>
                <p className="talks-detail-empty">
                  No interpretive claim was extracted for this book. Roughly half the corpus has one.
                </p>
              </>
            ) : (
              <p className="talks-detail-empty">
                Hover any mark to read the claim that book makes. Each mark is one book, placed in its
                publication year and coloured by the stance it takes.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * One row per year, drawn as a single SVG rather than N elements: at 293 marks in the
 * widest year that is ~7,700 nodes across the page, and one pointer handler per row
 * beats one per mark. The index is recovered from pointer x, which also makes the hit
 * target exactly the mark's width.
 */
function YearRow({
  dimmed,
  matches,
  maxRow,
  onHover,
  row,
  stances,
}: {
  dimmed: boolean;
  matches: (claim: NonfictionTalksClaim) => boolean;
  maxRow: number;
  onHover: (value: Hovered | null) => void;
  row: NonfictionTalksData["years"][number];
  stances: string[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const total = row.claims.length + row.unclaimed;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const index = Math.floor(((event.clientX - bounds.left) / bounds.width) * maxRow);
    if (index < 0 || index >= total) { onHover(null); return; }
    onHover({ year: row.year, index, claim: row.claims[index] ?? null });
  };

  return (
    <div className="talks-row">
      <span className="talks-row-year">{row.year}</span>
      <span className="talks-row-count">{total}</span>
      <svg
        className="talks-row-marks"
        onMouseMove={handleMove}
        preserveAspectRatio="none"
        ref={svgRef}
        viewBox={`0 0 ${maxRow} 10`}
      >
        {row.claims.map((claim, index) => (
          <rect
            fill={STANCE_COLOR[stances[claim.stance]] ?? STANCE_COLOR.none}
            fillOpacity={!dimmed || matches(claim) ? 1 : 0.12}
            height={10}
            key={index}
            width={1}
            x={index}
            y={0}
          />
        ))}
        {row.unclaimed > 0 ? (
          <rect
            className="talks-unclaimed"
            height={10}
            width={row.unclaimed}
            x={row.claims.length}
            y={0}
          />
        ) : null}
      </svg>
    </div>
  );
}
