"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { ConsensusData, ConsensusPoint } from "@/lib/consensus";

type Mode = "all" | "winners";

const WIDTH = 1060;
const HEIGHT = 330;
const LEFT = 66;
const RIGHT = 1030;
const LINE_TOP = 36;
const LINE_BOTTOM = 270;

export function ConsensusExperiment({ data }: { data: ConsensusData }) {
  const [mode, setMode] = useState<Mode>("all");
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const series = data[mode];
  const peak = series.points.reduce((best, point) => point.overlap > best.overlap ? point : best, series.points[0]);
  const latest = series.points.at(-1);
  const hoveredPoint = hoverYear === null ? null : series.points.find((point) => point.year === hoverYear) ?? null;
  const maxOverlap = useMemo(() => {
    const max = Math.max(...data.all.points.map((point) => point.overlap), ...data.winners.points.map((point) => point.overlap));
    return Math.max(10, Math.ceil(max / 5) * 5);
  }, [data]);

  function xForYear(year: number) {
    return LEFT + ((year - data.startYear) / (data.endYear - data.startYear)) * (RIGHT - LEFT);
  }

  function yForOverlap(value: number) {
    return LINE_BOTTOM - (value / maxOverlap) * (LINE_BOTTOM - LINE_TOP);
  }

  function updateHoverFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const year = Math.round(data.startYear + ((viewX - LEFT) / (RIGHT - LEFT)) * (data.endYear - data.startYear));
    const firstPointYear = series.points[0]?.year ?? data.startYear;
    setHoverYear(Math.min(data.endYear, Math.max(firstPointYear, year)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const firstPointYear = series.points[0]?.year ?? data.startYear;
    setHoverYear((current) => Math.min(data.endYear, Math.max(firstPointYear, (current ?? peak.year) + step)));
  }

  return (
    <section className="mt-12 border-t hairline pt-8">
      <div className="grid gap-6 border-b hairline pb-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-end">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Cross-prize agreement</p>
          <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">Consensus and fracture</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 muted">How often four long-running prizes recognized the same books.</p>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <Metric label="Peak" value={`${peak.year}`} detail={formatPercent(peak.overlap)} />
          <Metric label="Latest" value={formatPercent(latest?.overlap ?? 0)} detail={String(latest?.year ?? data.endYear)} />
          <Metric label="Programs" value={String(data.programLabels.length)} detail="fixed panel" />
        </div>
      </div>

      <div className="filter-toolbar mt-6 flex flex-wrap items-center justify-between gap-4 border hairline p-3">
        <div className="filter-group">
          <span className="filter-label">Recognition</span>
          <div className="segmented-control">
            <ModeButton active={mode === "all"} onClick={() => setMode("all")}>All recognized</ModeButton>
            <ModeButton active={mode === "winners"} onClick={() => setMode("winners")}>Winners only</ModeButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.13em] muted">
          <span className="inline-flex items-center gap-2"><span className="h-px w-5 bg-[var(--chart-cat-1)]" />Five-year overlap</span>
        </div>
      </div>

      <div
        aria-label="Cross-prize consensus over time. Use left and right arrow keys to inspect years."
        className="mt-4 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))] focus-ring"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          className="consensus-chart"
          onPointerLeave={() => setHoverYear(null)}
          onPointerMove={updateHoverFromPointer}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <rect className="experiment-chart-bg" height={HEIGHT} width={WIDTH} />
          <ConsensusAxes data={data} maxOverlap={maxOverlap} xForYear={xForYear} yForOverlap={yForOverlap} />
          <ConsensusLine points={series.points} xForYear={xForYear} yForOverlap={yForOverlap} />
          {hoveredPoint ? (
            <g pointerEvents="none">
              <line className="consensus-hover-line" x1={xForYear(hoveredPoint.year)} x2={xForYear(hoveredPoint.year)} y1={LINE_TOP} y2={LINE_BOTTOM} />
              <circle className="consensus-line-point consensus-line-point-active" cx={xForYear(hoveredPoint.year)} cy={yForOverlap(hoveredPoint.overlap)} r={4} />
            </g>
          ) : null}
        </svg>
      </div>

      <div className="consensus-readout border-x border-b hairline px-4 py-3 text-sm leading-6">
        {hoveredPoint ? (
          <p>
            <span className="plain-number text-[var(--ink)]">{hoveredPoint.year} · {formatPercent(hoveredPoint.overlap)}</span>
            <span className="muted"> average overlap · {hoveredPoint.sharedBooks} books shared by two or more prizes</span>
          </p>
        ) : (
          <p className="muted">Pulitzer · National Book Awards · NBCC · Los Angeles Times · five-year windows</p>
        )}
      </div>
    </section>
  );
}

function ConsensusAxes({
  data,
  maxOverlap,
  xForYear,
  yForOverlap,
}: {
  data: ConsensusData;
  maxOverlap: number;
  xForYear: (year: number) => number;
  yForOverlap: (value: number) => number;
}) {
  const yearTicks: number[] = [];
  for (let year = Math.ceil(data.startYear / 10) * 10; year <= data.endYear; year += 10) yearTicks.push(year);
  if (!yearTicks.includes(data.endYear)) yearTicks.push(data.endYear);
  const overlapTicks = [0, maxOverlap / 2, maxOverlap];

  return (
    <g>
      {yearTicks.map((year) => (
        <g key={year}>
          <line className="experiment-chart-grid" x1={xForYear(year)} x2={xForYear(year)} y1={LINE_TOP} y2={LINE_BOTTOM} />
          <text className="experiment-chart-axis" textAnchor="middle" x={xForYear(year)} y={HEIGHT - 22}>{year}</text>
        </g>
      ))}
      {overlapTicks.map((tick) => (
        <g key={tick}>
          <line className="experiment-chart-grid" x1={LEFT} x2={RIGHT} y1={yForOverlap(tick)} y2={yForOverlap(tick)} />
          <text className="experiment-chart-axis" textAnchor="end" x={LEFT - 12} y={yForOverlap(tick) + 4}>{Math.round(tick)}%</text>
        </g>
      ))}
      <text className="experiment-chart-axis" x={LEFT} y={LINE_TOP - 12}>Average slate overlap</text>
    </g>
  );
}

function ConsensusLine({
  points,
  xForYear,
  yForOverlap,
}: {
  points: ConsensusPoint[];
  xForYear: (year: number) => number;
  yForOverlap: (value: number) => number;
}) {
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${xForYear(point.year)},${yForOverlap(point.overlap)}`).join(" ");
  const area = `${line} L${xForYear(points.at(-1)?.year ?? 0)},${LINE_BOTTOM} L${xForYear(points[0]?.year ?? 0)},${LINE_BOTTOM} Z`;

  return (
    <g>
      <path className="consensus-line-area" d={area} />
      <path className="consensus-line-path" d={line} />
    </g>
  );
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function ModeButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={`segment-button focus-ring ${active ? "segment-button-active" : ""}`} onClick={onClick} type="button">{children}</button>;
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
