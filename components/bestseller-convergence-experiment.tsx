"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { BestsellerConvergenceData, BestsellerConvergencePoint } from "@/lib/bestseller-convergence";

const WIDTH = 1060;
const LEFT = 112;
const RIGHT = 820;
const TOP = 64;
const ROW_STEP = 42;
const BAR_HEIGHT = 14;

export function BestsellerConvergenceExperiment({ data }: { data: BestsellerConvergenceData }) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const points = data.winners.points;
  const chartHeight = Math.max(410, TOP + Math.max(0, points.length - 1) * ROW_STEP + 74);
  const peak = points.reduce<BestsellerConvergencePoint | undefined>((best, point) => !best || point.share > best.share ? point : best, undefined);
  const least = points.reduce<BestsellerConvergencePoint | undefined>((best, point) => !best || point.share < best.share ? point : best, undefined);
  const hoveredPoint = hoverYear === null ? null : points.find((point) => point.year === hoverYear) ?? null;
  const maxShare = useMemo(() => Math.max(10, Math.ceil(Math.max(0, ...points.map((point) => point.share)) / 5) * 5), [points]);

  if (!points.length || !peak || !least) return null;

  function xForShare(value: number) {
    return LEFT + (value / maxShare) * (RIGHT - LEFT);
  }

  function yForIndex(index: number) {
    return TOP + index * ROW_STEP;
  }

  function updateHoverFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewY = ((event.clientY - rect.top) / rect.height) * chartHeight;
    const index = Math.round((viewY - TOP) / ROW_STEP);
    setHoverYear(points[Math.min(points.length - 1, Math.max(0, index))]?.year ?? null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const currentIndex = Math.max(0, points.findIndex((point) => point.year === (hoverYear ?? peak?.year ?? data.startYear)));
    const nextIndex = Math.min(points.length - 1, Math.max(0, currentIndex + (event.key === "ArrowUp" ? -1 : 1)));
    setHoverYear(points[nextIndex].year);
  }

  return (
    <section className="mt-12 border-t hairline pt-8">
      <div className="grid gap-6 border-b hairline pb-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Prizes and sales</p>
          <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">When prize winners were bestsellers</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 muted">Percentage of prize-winning books that appeared on the New York Times Hardcover Nonfiction list in the same or preceding year.</p>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <Metric label="Highest overlap" value={`${peak.year}`} detail={formatCount(peak)} />
          <Metric label="Lowest overlap" value={`${least.year}`} detail={formatCount(least)} />
          <Metric label="Coverage" value={`${data.startYear}–${data.endYear}`} detail={`${points.length} years`} />
        </div>
      </div>

      <div
        aria-label="Annual percentage of prize-winning books that appeared on the bestseller list. Use up and down arrow keys to inspect years."
        className="mt-6 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))] focus-ring"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          className="bestseller-convergence-chart"
          onPointerLeave={() => setHoverYear(null)}
          onPointerMove={updateHoverFromPointer}
          viewBox={`0 0 ${WIDTH} ${chartHeight}`}
        >
          <rect className="experiment-chart-bg" height={chartHeight} width={WIDTH} />
          <BarAxes maxShare={maxShare} rowCount={points.length} xForShare={xForShare} />
          {points.map((point, index) => {
            const y = yForIndex(index);
            const isPeak = point.year === peak.year;
            const isLeast = point.year === least.year;
            const isActive = point.year === hoverYear;
            return (
              <g key={point.year}>
                {isActive ? <rect className="bestseller-overlap-row-active" height={ROW_STEP - 4} width={WIDTH} x={0} y={y - ROW_STEP / 2 + 2} /> : null}
                <text className="bestseller-overlap-year" textAnchor="end" x={LEFT - 18} y={y + 4}>{point.year}</text>
                <rect className="bestseller-overlap-track" height={BAR_HEIGHT} width={RIGHT - LEFT} x={LEFT} y={y - BAR_HEIGHT / 2} />
                <rect
                  className={`bestseller-overlap-bar ${isPeak ? "bestseller-overlap-bar-peak" : ""} ${isLeast ? "bestseller-overlap-bar-low" : ""}`}
                  height={BAR_HEIGHT}
                  width={Math.max(2, xForShare(point.share) - LEFT)}
                  x={LEFT}
                  y={y - BAR_HEIGHT / 2}
                />
                <text className="bestseller-overlap-value" x={xForShare(point.share) + 12} y={y + 4}>{formatCount(point)} · {formatPercent(point.share)}</text>
                {isPeak || isLeast ? <text className="bestseller-overlap-extreme" textAnchor="end" x={WIDTH - 30} y={y + 4}>{isPeak ? "Highest" : "Lowest"}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="consensus-readout border-x border-b hairline px-4 py-3 text-sm leading-6">
        {hoveredPoint ? (
          <p>
            <span className="plain-number text-[var(--ink)]">{hoveredPoint.year} · {formatCount(hoveredPoint)} winners · {formatPercent(hoveredPoint.share)}</span>
            {hoveredPoint.crossoverBooks.length ? <span className="muted"> · {formatBookList(hoveredPoint.crossoverBooks.map((book) => book.title))}</span> : null}
          </p>
        ) : (
          <p className="muted">Each bar shows the share and count of that year’s prize winners that also appeared on the bestseller list.</p>
        )}
      </div>
    </section>
  );
}

function BarAxes({ maxShare, rowCount, xForShare }: { maxShare: number; rowCount: number; xForShare: (value: number) => number }) {
  const ticks = [0, maxShare / 2, maxShare];
  const bottom = TOP + ROW_STEP * Math.max(0, rowCount - 1) + 24;
  return (
    <g>
      <text className="experiment-chart-axis" x={LEFT} y={26}>Prize winners also on the list</text>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="experiment-chart-grid" x1={xForShare(tick)} x2={xForShare(tick)} y1={TOP - 25} y2={bottom} />
          <text className="experiment-chart-axis" textAnchor="middle" x={xForShare(tick)} y={bottom + 23}>{Math.round(tick)}%</text>
        </g>
      ))}
    </g>
  );
}

function formatCount(point: BestsellerConvergencePoint) {
  return `${point.bestsellerBooks} of ${point.recognizedBooks}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatBookList(titles: string[]) {
  const shown = titles.slice(0, 3);
  const remaining = titles.length - shown.length;
  return `${shown.join(" · ")}${remaining > 0 ? ` · +${remaining} more` : ""}`;
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="border-t hairline pt-3">
      <p className="plain-number text-xl leading-none text-[var(--ink)]">{value}</p>
      <p className="mt-1 text-xs muted">{detail}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.56rem] uppercase tracking-[0.14em] muted">{label}</p>
    </div>
  );
}
