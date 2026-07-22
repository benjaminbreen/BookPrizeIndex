"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { SectionPermalink } from "@/components/ui/section-permalink";
import type { PrizeCensus } from "@/lib/prize-census";

type PrizeCensusExperimentProps = {
  census: PrizeCensus;
};

const WIDTH = 960;
const COUNT_PANEL = { top: 26, bottom: 250, left: 56, right: 936 };
const RECORD_PANEL = { top: 292, bottom: 366, left: 56, right: 936 };
const SVG_HEIGHT = 400;

export function PrizeCensusExperiment({ census }: PrizeCensusExperimentProps) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const [hoverPrizeId, setHoverPrizeId] = useState<string | null>(null);

  const { years, prizes, currentYear } = census;
  const minYear = years[0]?.year ?? 1917;
  const maxActive = Math.max(...years.map((item) => item.active));
  const peakYears = years.filter((item) => item.active === maxActive).map((item) => item.year);
  const peakYear = peakYears[0] ?? currentYear;
  const peakPeriod = peakYears.length > 1 ? `${peakYears[0]}-${peakYears.at(-1)}` : String(peakYear);
  const activeNow = years.at(-1)?.active ?? 0;
  const discontinued = prizes.filter((prize) => prize.finalYear !== undefined);
  const hovered = hoverYear === null ? null : years.find((item) => item.year === hoverYear) ?? null;

  const foundingsByDecade = useMemo(() => {
    const rows: Array<{ decade: number; count: number }> = [];
    for (let decade = Math.floor(minYear / 10) * 10; decade <= currentYear; decade += 10) {
      rows.push({ decade, count: prizes.filter((prize) => prize.foundedYear >= decade && prize.foundedYear < decade + 10).length });
    }
    return rows;
  }, [prizes, minYear, currentYear]);
  const maxFoundings = Math.max(...foundingsByDecade.map((row) => row.count));
  const completeYears = years.filter((item) => item.year < currentYear);
  const recordPeak = completeYears.reduce((peak, item) => item.records > peak.records ? item : peak, completeYears[0]);
  const recentPeriod = completeYears.slice(-5);
  const priorPeriod = completeYears.slice(-10, -5);
  const recentAverage = averageRecords(recentPeriod);
  const priorAverage = averageRecords(priorPeriod);
  const recordChange = priorAverage > 0 ? (recentAverage - priorAverage) / priorAverage : 0;

  function xForYear(year: number) {
    return COUNT_PANEL.left + ((year - minYear) / (currentYear - minYear)) * (COUNT_PANEL.right - COUNT_PANEL.left);
  }

  function updateHoverFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const year = Math.round(minYear + ((vx - COUNT_PANEL.left) / (COUNT_PANEL.right - COUNT_PANEL.left)) * (currentYear - minYear));
    setHoverYear(Math.min(currentYear, Math.max(minYear, year)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setHoverYear((current) => Math.min(currentYear, Math.max(minYear, (current ?? peakYear) + step)));
  }

  return (
    <section className="mt-12 scroll-mt-24 border-t hairline pt-8" id="prize-census">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="border-b hairline pb-6">
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Prize history</p>
            <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">
              A century of nonfiction prizes
              <SectionPermalink id="prize-census" label="A century of nonfiction prizes" />
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 muted">
              The number of nonfiction prize programs in this index that were active each year.
            </p>
          </div>

          <div
            className="mt-6 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))] focus-ring"
            onKeyDown={handleKeyDown}
            role="application"
            aria-label="Prizes active per year chart. Use left and right arrow keys to move between years."
            tabIndex={0}
          >
            <div className="relative min-w-[48rem]">
            <svg
              aria-hidden="true"
              className="experiment-chart"
              onPointerLeave={() => setHoverYear(null)}
              onPointerMove={updateHoverFromPointer}
              viewBox={`0 0 ${WIDTH} ${SVG_HEIGHT}`}
            >
              <rect className="experiment-chart-bg" height={SVG_HEIGHT} width={WIDTH} />
              <CensusAxes currentYear={currentYear} maxActive={maxActive} minYear={minYear} xForYear={xForYear} years={years} />
              <ActiveCountSeries maxActive={maxActive} xForYear={xForYear} years={years} />
              <RecordDensitySeries currentYear={currentYear} hoverYear={hoverYear} xForYear={xForYear} years={years} />
              {hoverYear !== null ? (
                <line
                  stroke="var(--ink)"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                  x1={xForYear(hoverYear)}
                  x2={xForYear(hoverYear)}
                  y1={COUNT_PANEL.top}
                  y2={RECORD_PANEL.bottom}
                />
              ) : null}
            </svg>
            {hovered ? <CensusTooltip currentYear={currentYear} hovered={hovered} left={xForYear(hovered.year) / WIDTH} /> : null}
            </div>
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="font-[var(--font-serif)] text-xl font-light">Program timelines</h3>
              <div className="flex flex-wrap items-center gap-4 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.14em] muted">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-[6px] w-5" style={{ background: "var(--chart-cat-1)" }} />
                  Records in this index
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-[3px] w-5" style={{ background: "var(--line)" }} />
                  Active per registry
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-[10px] w-[2px]" style={{ background: "var(--ink)" }} />
                  Final edition
                </span>
              </div>
            </div>
            <div className="mt-4 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))]">
              <PrizeTimeline
                currentYear={currentYear}
                hoverPrizeId={hoverPrizeId}
                minYear={minYear}
                onHoverPrizeId={setHoverPrizeId}
                prizes={prizes}
              />
            </div>
          </div>

          <details className="mt-6 border hairline p-4 text-sm leading-6">
            <summary className="cursor-pointer font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">
              View as data table
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b hairline font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.14em] muted">
                    <th className="py-2 pr-4 font-normal">Program</th>
                    <th className="py-2 pr-4 font-normal">Founded</th>
                    <th className="py-2 pr-4 font-normal">Final edition</th>
                    <th className="py-2 pr-4 font-normal">Coverage in index</th>
                    <th className="py-2 text-right font-normal">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {prizes.map((prize) => (
                    <tr className="border-b hairline align-top" key={prize.id}>
                      <td className="py-2 pr-4">{prize.name}</td>
                      <td className="plain-number py-2 pr-4">{prize.foundedYear}</td>
                      <td className="plain-number py-2 pr-4">{prize.finalYear ?? "Active"}</td>
                      <td className="plain-number py-2 pr-4">
                        {prize.firstRecordYear !== undefined ? `${prize.firstRecordYear}-${prize.lastRecordYear}` : "None"}
                      </td>
                      <td className="plain-number py-2 text-right">{prize.recordCount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <aside className="border-t hairline pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="grid grid-cols-3 gap-4 border-b hairline pb-5 lg:grid-cols-1">
            <Metric label="Programs tracked" value={String(prizes.length)} />
            <Metric label={`Active in ${currentYear}`} value={String(activeNow)} />
            <Metric label="Peak plateau" value={`${peakPeriod} (${maxActive})`} />
          </div>

          <div className="border-b hairline py-5">
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Foundings by decade</p>
            <div className="mt-4 grid gap-1.5">
              {foundingsByDecade.map((row) => (
                <div className="flex items-center gap-3" key={row.decade}>
                  <span className="plain-number w-12 text-xs muted">{row.decade}s</span>
                  <span aria-hidden="true" className="h-2 shrink-0" style={{ background: "var(--chart-cat-1)", opacity: 0.85, width: `${row.count === 0 ? 0 : Math.max(4, (row.count / maxFoundings) * 120)}px` }} />
                  <span className="plain-number text-xs">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-5 text-sm leading-6 muted">
            <p className="text-[var(--ink)]">Notes</p>
            <p className="mt-2">
              Founding and discontinuation dates come from the prize registry; the count falls only when a program is
              formally discontinued{discontinued.length ? ` (${discontinued.map((prize) => `${prize.name}, final edition ${prize.finalYear}`).join("; ")})` : ""}.
            </p>
            <p className="mt-3">
              Recognition density peaked in {recordPeak.year} at {recordPeak.records.toLocaleString()} events.
              The {recentPeriod[0]?.year}-{recentPeriod.at(-1)?.year} average is {recentAverage.toFixed(1)} per year versus {priorAverage.toFixed(1)} in {priorPeriod[0]?.year}-{priorPeriod.at(-1)?.year}
              ({formatSignedPercent(recordChange)}).
            </p>
            <p className="mt-3">The {currentYear} record bar is partial and excluded from the comparison.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function CensusAxes({
  currentYear,
  maxActive,
  minYear,
  xForYear,
  years,
}: {
  currentYear: number;
  maxActive: number;
  minYear: number;
  xForYear: (year: number) => number;
  years: PrizeCensus["years"];
}) {
  const yearTicks = decadeTicks(minYear, currentYear, 20);
  const activeTicks = niceCountTicks(maxActive);
  const maxRecords = Math.max(...years.map((item) => item.records));
  const recordTicks = niceCountTicks(maxRecords);

  return (
    <g>
      {yearTicks.map((year) => (
        <g key={year}>
          <line className="experiment-chart-grid" x1={xForYear(year)} x2={xForYear(year)} y1={COUNT_PANEL.top} y2={RECORD_PANEL.bottom} />
          <text className="experiment-chart-axis" textAnchor="middle" x={xForYear(year)} y={RECORD_PANEL.bottom + 22}>
            {year}
          </text>
        </g>
      ))}
      {activeTicks.map((tick) => (
        <g key={`active-${tick}`}>
          <line
            className="experiment-chart-grid"
            x1={COUNT_PANEL.left}
            x2={COUNT_PANEL.right}
            y1={yForActive(tick, maxActive)}
            y2={yForActive(tick, maxActive)}
          />
          <text className="experiment-chart-axis" textAnchor="end" x={COUNT_PANEL.left - 10} y={yForActive(tick, maxActive) + 3}>
            {tick}
          </text>
        </g>
      ))}
      <text className="experiment-chart-axis" x={COUNT_PANEL.left} y={COUNT_PANEL.top - 10}>
        Prize programs active
      </text>
      {recordTicks.map((tick) => (
        <text className="experiment-chart-axis" key={`record-${tick}`} textAnchor="end" x={RECORD_PANEL.left - 10} y={yForRecords(tick, maxRecords) + 3}>
          {tick}
        </text>
      ))}
      <text className="experiment-chart-axis" x={RECORD_PANEL.left} y={RECORD_PANEL.top - 8}>
        Recognition events per year in this index
      </text>
    </g>
  );
}

function ActiveCountSeries({
  maxActive,
  xForYear,
  years,
}: {
  maxActive: number;
  xForYear: (year: number) => number;
  years: PrizeCensus["years"];
}) {
  const linePath = years
    .map((item, index) => {
      const x = xForYear(item.year);
      const y = yForActive(item.active, maxActive);
      if (index === 0) return `M${x},${y}`;
      const previous = yForActive(years[index - 1].active, maxActive);
      return `L${x},${previous} L${x},${y}`;
    })
    .join(" ");
  const areaPath = `${linePath} L${xForYear(years.at(-1)?.year ?? 0)},${COUNT_PANEL.bottom} L${xForYear(years[0]?.year ?? 0)},${COUNT_PANEL.bottom} Z`;

  return (
    <g>
      <path d={areaPath} fill="var(--chart-cat-1)" opacity={0.1} />
      <path d={linePath} fill="none" stroke="var(--chart-cat-1)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      {years
        .filter((item) => item.founded.length > 0)
        .map((item) => (
          <path
            d={`M${xForYear(item.year) - 3.5},${COUNT_PANEL.bottom + 10} L${xForYear(item.year) + 3.5},${COUNT_PANEL.bottom + 10} L${xForYear(item.year)},${COUNT_PANEL.bottom + 4} Z`}
            fill="var(--chart-cat-1)"
            key={`founded-${item.year}`}
          />
        ))}
      {years
        .filter((item) => item.discontinued.length > 0)
        .map((item) => (
          <g key={`final-${item.year}`} stroke="var(--ink)" strokeWidth={1.4}>
            <line x1={xForYear(item.year) - 3} x2={xForYear(item.year) + 3} y1={COUNT_PANEL.bottom + 4} y2={COUNT_PANEL.bottom + 10} />
            <line x1={xForYear(item.year) - 3} x2={xForYear(item.year) + 3} y1={COUNT_PANEL.bottom + 10} y2={COUNT_PANEL.bottom + 4} />
          </g>
        ))}
    </g>
  );
}

function RecordDensitySeries({
  currentYear,
  hoverYear,
  xForYear,
  years,
}: {
  currentYear: number;
  hoverYear: number | null;
  xForYear: (year: number) => number;
  years: PrizeCensus["years"];
}) {
  const maxRecords = Math.max(...years.map((item) => item.records));
  const slot = (RECORD_PANEL.right - RECORD_PANEL.left) / Math.max(1, years.length);
  const barWidth = Math.max(1.5, slot - 2);

  return (
    <g>
      {years.map((item) => {
        if (item.records === 0) return null;
        const top = yForRecords(item.records, maxRecords);
        return (
          <rect
            fill={item.year === currentYear ? "var(--chart-cat-3)" : "var(--muted)"}
            height={RECORD_PANEL.bottom - top}
            key={item.year}
            opacity={hoverYear === item.year ? 0.9 : 0.45}
            width={barWidth}
            x={xForYear(item.year) - barWidth / 2}
            y={top}
          />
        );
      })}
    </g>
  );
}

function CensusTooltip({ currentYear, hovered, left }: { currentYear: number; hovered: PrizeCensus["years"][number]; left: number }) {
  const percent = Math.min(88, Math.max(10, left * 100));
  return (
    <div
      className="pointer-events-none absolute top-3 z-10 w-60 -translate-x-1/2 border hairline bg-[var(--panel)] p-3 text-xs leading-5 shadow-sm"
      style={{ left: `${percent}%` }}
    >
      <p className="flex items-baseline justify-between gap-3">
        <span className="plain-number text-base text-[var(--ink)]">{hovered.active}</span>
        <span className="muted">programs active, {hovered.year}</span>
      </p>
      <p className="mt-1 flex items-baseline justify-between gap-3">
        <span className="plain-number text-[var(--ink)]">{hovered.records.toLocaleString()}</span>
        <span className="muted">recognition events{hovered.year === currentYear ? " (partial year)" : ""}</span>
      </p>
      {hovered.founded.length > 0 ? (
        <p className="mt-2 border-t hairline pt-2">
          <span className="muted">Founded: </span>
          {hovered.founded.join("; ")}
        </p>
      ) : null}
      {hovered.discontinued.length > 0 ? (
        <p className="mt-2 border-t hairline pt-2">
          <span className="muted">Final edition: </span>
          {hovered.discontinued.join("; ")}
        </p>
      ) : null}
    </div>
  );
}

const ROW_HEIGHT = 17;
const TIMELINE_LABEL_WIDTH = 224;
const TIMELINE_TOP = 10;

function PrizeTimeline({
  currentYear,
  hoverPrizeId,
  minYear,
  onHoverPrizeId,
  prizes,
}: {
  currentYear: number;
  hoverPrizeId: string | null;
  minYear: number;
  onHoverPrizeId: (id: string | null) => void;
  prizes: PrizeCensus["prizes"];
}) {
  const height = TIMELINE_TOP + prizes.length * ROW_HEIGHT + 30;
  const trackLeft = TIMELINE_LABEL_WIDTH;
  const trackRight = WIDTH - 20;
  const hovered = hoverPrizeId ? prizes.find((prize) => prize.id === hoverPrizeId) : undefined;
  const hoveredIndex = hovered ? prizes.indexOf(hovered) : -1;

  function x(year: number) {
    return trackLeft + ((year - minYear) / (currentYear - minYear)) * (trackRight - trackLeft);
  }

  return (
    <div className="relative min-w-[48rem]">
      <svg aria-label="Timeline of prize programs by founding year" className="experiment-chart" role="img" viewBox={`0 0 ${WIDTH} ${height}`}>
        <rect className="experiment-chart-bg" height={height} width={WIDTH} />
        {decadeTicks(minYear, currentYear, 20).map((year) => (
          <g key={year}>
            <line className="experiment-chart-grid" x1={x(year)} x2={x(year)} y1={TIMELINE_TOP} y2={height - 26} />
            <text className="experiment-chart-axis" textAnchor="middle" x={x(year)} y={height - 10}>
              {year}
            </text>
          </g>
        ))}
        {prizes.map((prize, index) => {
          const rowY = TIMELINE_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const registrySegments = subtractRanges([prize.foundedYear, prize.finalYear ?? currentYear], prize.dormantYears);
          const coverageSegments =
            prize.firstRecordYear !== undefined
              ? subtractRanges([prize.firstRecordYear, prize.lastRecordYear ?? prize.firstRecordYear], prize.dormantYears)
              : [];
          const active = hoverPrizeId === prize.id;
          return (
            <g
              key={prize.id}
              onPointerEnter={() => onHoverPrizeId(prize.id)}
              onPointerLeave={() => onHoverPrizeId(null)}
              tabIndex={0}
              onFocus={() => onHoverPrizeId(prize.id)}
              onBlur={() => onHoverPrizeId(null)}
            >
              {active ? (
                <rect fill="var(--ink)" height={ROW_HEIGHT} opacity={0.05} width={WIDTH} x={0} y={rowY - ROW_HEIGHT / 2} />
              ) : null}
              <text
                className="experiment-chart-axis"
                textAnchor="end"
                x={TIMELINE_LABEL_WIDTH - 12}
                y={rowY + 3}
                opacity={prize.finalYear !== undefined ? 0.65 : 1}
              >
                {truncateLabel(prize.name, 26)}
              </text>
              {registrySegments.map(([start, end]) => (
                <rect
                  fill="var(--line)"
                  height={3}
                  key={`registry-${start}`}
                  width={Math.max(2, x(end) - x(start))}
                  x={x(start)}
                  y={rowY - 1.5}
                />
              ))}
              {coverageSegments.map(([start, end]) => (
                <rect
                  fill="var(--chart-cat-1)"
                  height={7}
                  key={`coverage-${start}`}
                  rx={2}
                  stroke="var(--paper)"
                  strokeWidth={1}
                  width={Math.max(3, x(end) - x(start))}
                  x={x(start)}
                  y={rowY - 3.5}
                />
              ))}
              {prize.finalYear !== undefined ? (
                <rect fill="var(--ink)" height={11} width={2} x={x(prize.finalYear)} y={rowY - 5.5} />
              ) : null}
              <rect fill="transparent" height={ROW_HEIGHT} width={WIDTH} x={0} y={rowY - ROW_HEIGHT / 2} />
            </g>
          );
        })}
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 w-72 border hairline bg-[var(--panel)] p-3 text-xs leading-5 shadow-sm"
          style={{
            left: `${Math.min(70, Math.max(4, (x(hovered.foundedYear) / WIDTH) * 100))}%`,
            top: `${((TIMELINE_TOP + hoveredIndex * ROW_HEIGHT) / height) * 100}%`,
          }}
        >
          <p className="text-[var(--ink)]">{hovered.name}</p>
          <p className="muted">
            {hovered.organization} / {hovered.geography}
          </p>
          <p className="mt-1">
            <span className="plain-number text-[var(--ink)]">
              {hovered.foundedYear}-{hovered.finalYear ?? "present"}
            </span>
            {hovered.dormantYears.length > 0 ? (
              <span className="muted"> (dormant {hovered.dormantYears.map(([a, b]) => `${a}-${b}`).join(", ")})</span>
            ) : null}
          </p>
          <p className="muted">
            {hovered.recordCount > 0
              ? `${hovered.recordCount.toLocaleString()} records in this index, ${hovered.firstRecordYear}-${hovered.lastRecordYear}`
              : "No records imported yet"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="plain-number text-2xl leading-none text-[var(--ink)]">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.15em] muted">{label}</p>
    </div>
  );
}

function averageRecords(years: PrizeCensus["years"]) {
  if (!years.length) return 0;
  return years.reduce((sum, item) => sum + item.records, 0) / years.length;
}

function formatSignedPercent(value: number) {
  const percent = Math.abs(value * 100).toFixed(1);
  if (value > 0) return `+${percent}%`;
  if (value < 0) return `-${percent}%`;
  return "0.0%";
}

function yForActive(value: number, maxActive: number) {
  return COUNT_PANEL.bottom - (value / Math.max(1, niceCountTicks(maxActive).at(-1) ?? maxActive)) * (COUNT_PANEL.bottom - COUNT_PANEL.top);
}

function yForRecords(value: number, maxRecords: number) {
  return RECORD_PANEL.bottom - (value / Math.max(1, niceCountTicks(maxRecords).at(-1) ?? maxRecords)) * (RECORD_PANEL.bottom - RECORD_PANEL.top);
}

function decadeTicks(minYear: number, maxYear: number, step: number) {
  const ticks: number[] = [];
  for (let year = Math.ceil(minYear / step) * step; year <= maxYear; year += step) ticks.push(year);
  return ticks;
}

function niceCountTicks(max: number) {
  const step = max <= 12 ? 4 : max <= 40 ? 10 : max <= 120 ? 40 : max <= 300 ? 100 : 200;
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) ticks.push(tick);
  return ticks;
}

function subtractRanges(range: [number, number], holes: Array<[number, number]>): Array<[number, number]> {
  let segments: Array<[number, number]> = [range];
  for (const [holeStart, holeEnd] of holes) {
    segments = segments.flatMap(([start, end]) => {
      if (holeEnd < start || holeStart > end) return [[start, end] as [number, number]];
      const result: Array<[number, number]> = [];
      if (holeStart > start) result.push([start, holeStart - 1]);
      if (holeEnd < end) result.push([holeEnd + 1, end]);
      return result;
    });
  }
  return segments.filter(([start, end]) => end >= start);
}

function truncateLabel(label: string, max: number) {
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}
