"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export type ImprintRankEvent = {
  year: number;
  imprintId: string;
  imprintName: string;
  publisherName?: string;
  bookId: string;
  weight: number;
  majorWeight: number;
  isMajor: boolean;
  isWin: boolean;
};

type WindowMode = "cumulative" | "annual" | "rolling3" | "rolling5";
type Metric = "score" | "books" | "wins";
type Scope = "all" | "major";

type ImprintRankExperimentProps = {
  events: ImprintRankEvent[];
  yearRange: [number, number];
};

type YearStat = {
  score: number;
  wins: number;
  books: Set<string>;
};

type RankedPoint = {
  year: number;
  rank: number;
  value: number;
  score: number;
  books: number;
  wins: number;
};

type Series = {
  imprintId: string;
  name: string;
  publisherName?: string;
  color: string;
  finalRank: number;
  finalValue: number;
  points: RankedPoint[];
};

const seriesColors = [
  "var(--data-red)",
  "var(--data-green)",
  "var(--data-blue)",
  "var(--data-gold)",
  "var(--data-violet)",
  "var(--data-cyan)",
  "var(--data-olive)",
  "var(--data-rose)",
  "var(--accent)",
  "var(--focus)",
];

export function ImprintRankExperiment({ events, yearRange }: ImprintRankExperimentProps) {
  const [windowMode, setWindowMode] = useState<WindowMode>("cumulative");
  const [metric, setMetric] = useState<Metric>("score");
  const [scope, setScope] = useState<Scope>("major");
  const [topCount, setTopCount] = useState(10);
  const [visibleRange, setVisibleRange] = useState<[number, number]>(yearRange);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());

  const activeIds = useMemo(() => {
    if (hoverId) return new Set([hoverId]);
    return pinnedIds;
  }, [hoverId, pinnedIds]);
  const race = useMemo(() => buildRace(events, windowMode, metric, scope, visibleRange, topCount), [events, metric, scope, topCount, visibleRange, windowMode]);
  const activeSeriesId = hoverId ?? [...pinnedIds][0];
  const activeSeries = activeSeriesId ? race.series.find((series) => series.imprintId === activeSeriesId) : race.series[0];
  const leader = race.series[0];

  function togglePinned(imprintId: string) {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(imprintId)) next.delete(imprintId);
      else next.add(imprintId);
      return next;
    });
  }

  return (
    <section className="mt-10 border-t hairline pt-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="flex flex-col gap-5 border-b hairline pb-6">
            <div>
              <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Experiment 01</p>
              <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">
                Imprint leaderboard over time
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 muted">
                A bump chart works best here: each year ranks imprints by weighted prize recognition, then draws the
                selected top imprints as lines. Running totals show durable reputation; rolling windows reveal momentum
                without the noise of single prize seasons.
              </p>
            </div>

            <div className="filter-toolbar flex flex-wrap items-center gap-4 border hairline p-3">
              <ControlGroup label="Window">
                <SegmentButton active={windowMode === "cumulative"} onClick={() => setWindowMode("cumulative")}>Running</SegmentButton>
                <SegmentButton active={windowMode === "rolling5"} onClick={() => setWindowMode("rolling5")}>5 yr</SegmentButton>
                <SegmentButton active={windowMode === "rolling3"} onClick={() => setWindowMode("rolling3")}>3 yr</SegmentButton>
                <SegmentButton active={windowMode === "annual"} onClick={() => setWindowMode("annual")}>Annual</SegmentButton>
              </ControlGroup>
              <ControlGroup label="Measure">
                <SegmentButton active={metric === "score"} onClick={() => setMetric("score")}>Score</SegmentButton>
                <SegmentButton active={metric === "books"} onClick={() => setMetric("books")}>Books</SegmentButton>
                <SegmentButton active={metric === "wins"} onClick={() => setMetric("wins")}>Wins</SegmentButton>
              </ControlGroup>
              <ControlGroup label="Awards">
                <SegmentButton active={scope === "major"} onClick={() => setScope("major")}>Major</SegmentButton>
                <SegmentButton active={scope === "all"} onClick={() => setScope("all")}>All</SegmentButton>
              </ControlGroup>
              <ControlGroup label="Lines">
                {[5, 10, 15].map((count) => (
                  <SegmentButton active={topCount === count} key={count} onClick={() => setTopCount(count)}>
                    Top {count}
                  </SegmentButton>
                ))}
              </ControlGroup>
            </div>
          </div>

          <div className="mt-6 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))]">
            <ImprintBumpChart
              activeIds={activeIds}
              onHoverIdChange={setHoverId}
              onTogglePinned={togglePinned}
              pinnedIds={pinnedIds}
              series={race.series}
              yearRange={visibleRange}
            />
          </div>
          <DateRangeBrush fullRange={yearRange} onChange={setVisibleRange} value={visibleRange} />
        </div>

        <aside className="border-t hairline pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="grid grid-cols-3 gap-4 border-b hairline pb-5 lg:grid-cols-1">
            <Metric label="Years" value={`${visibleRange[0]}-${visibleRange[1]}`} />
            <Metric label="Ranked imprints" value={String(race.rankedImprints)} />
            <Metric label="Rows scored" value={race.scoredEvents.toLocaleString()} />
          </div>

          {leader ? (
            <div className="border-b hairline py-5">
              <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Current leader</p>
              <p className="mt-3 font-[var(--font-serif)] text-2xl font-light leading-tight">{leader.name}</p>
              <p className="mt-2 text-sm leading-6 muted">
                {leader.publisherName ?? "Parent publisher not yet sourced"} / {formatMetric(metric, leader.finalValue)}
              </p>
            </div>
          ) : null}

          <div className="pt-5">
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Top {topCount}</p>
            <div className="mt-4 grid gap-2">
              {race.series.map((series, index) => (
                <button
                  className={`experiment-legend-row focus-ring ${activeIds.has(series.imprintId) ? "experiment-legend-row-active" : ""} ${pinnedIds.has(series.imprintId) ? "experiment-legend-row-pinned" : ""}`}
                  key={series.imprintId}
                  onClick={() => togglePinned(series.imprintId)}
                  onMouseEnter={() => setHoverId(series.imprintId)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{ "--series-color": series.color } as CSSProperties}
                  type="button"
                >
                  <span className="experiment-legend-swatch" />
                  <span className="min-w-0 truncate text-left">{series.name}</span>
                  <span className="plain-number text-right">{pinnedIds.has(series.imprintId) ? "PIN" : index + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {activeSeries ? (
            <div className="mt-6 border-t hairline pt-5 text-sm leading-6 muted">
              <p className="text-[var(--ink)]">{activeSeries.name}</p>
              <p>{activeSeries.publisherName ?? "Parent publisher not yet sourced"}</p>
              <p>
                Latest rank {activeSeries.finalRank}; {formatMetric(metric, activeSeries.finalValue)}.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function ImprintBumpChart({
  activeIds,
  onHoverIdChange,
  onTogglePinned,
  pinnedIds,
  series,
  yearRange,
}: {
  activeIds: Set<string>;
  onHoverIdChange: (id: string | null) => void;
  onTogglePinned: (id: string) => void;
  pinnedIds: Set<string>;
  series: Series[];
  yearRange: [number, number];
}) {
  const width = 960;
  const height = 520;
  const margin = { top: 34, right: 48, bottom: 54, left: 62 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minYear = yearRange[0];
  const maxYear = yearRange[1];
  const rankFloor = 16;
  const yearTicks = getYearTicks(minYear, maxYear);
  const rankTicks = [1, 5, 10, 15];

  function xForYear(year: number) {
    if (maxYear === minYear) return margin.left;
    return margin.left + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  }

  function yForRank(rank: number) {
    const clamped = Math.min(rank, rankFloor);
    return margin.top + ((clamped - 1) / (rankFloor - 1)) * chartHeight;
  }

  return (
    <svg aria-label="Imprint rank chart" className="experiment-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
      <rect className="experiment-chart-bg" height={height} width={width} />
      {yearTicks.map((year) => (
        <g key={year}>
          <line className="experiment-chart-grid" x1={xForYear(year)} x2={xForYear(year)} y1={margin.top} y2={height - margin.bottom} />
          <text className="experiment-chart-axis" textAnchor="middle" x={xForYear(year)} y={height - 20}>{year}</text>
        </g>
      ))}
      {rankTicks.map((rank) => (
        <g key={rank}>
          <line className="experiment-chart-grid" x1={margin.left} x2={width - margin.right} y1={yForRank(rank)} y2={yForRank(rank)} />
          <text className="experiment-chart-axis" textAnchor="end" x={margin.left - 12} y={yForRank(rank) + 4}>#{rank}</text>
        </g>
      ))}
      <text className="experiment-chart-axis" textAnchor="end" x={margin.left - 12} y={yForRank(rankFloor) + 4}>16+</text>
      {series.map((item) => {
        const hasActive = activeIds.size > 0;
        const active = activeIds.has(item.imprintId);
        const focused = active || (!hasActive && item.finalRank <= 3);
        const dimmed = hasActive && !active;
        const showLabel = active || pinnedIds.has(item.imprintId) || (!hasActive && item.finalRank <= 3);
        const path = pointsToPath(item.points, xForYear, yForRank);
        return (
          <g
            className={dimmed ? "experiment-series-dimmed" : ""}
            key={item.imprintId}
            onClick={() => onTogglePinned(item.imprintId)}
            onMouseEnter={() => onHoverIdChange(item.imprintId)}
            onMouseLeave={() => onHoverIdChange(null)}
          >
            <title>{`${item.name}: rank ${item.finalRank}, value ${item.finalValue}`}</title>
            <path
              aria-hidden="true"
              className="experiment-series-hit-area"
              d={path}
              fill="none"
              stroke="transparent"
            />
            <path
              className={`experiment-series-line ${focused ? "experiment-series-line-active" : ""}`}
              d={path}
              fill="none"
              stroke={item.color}
            />
            {item.points
              .filter((point) => point.rank <= 10 || point.year === maxYear)
              .map((point) => (
                <circle
                  className="experiment-series-dot"
                  cx={xForYear(point.year)}
                  cy={yForRank(point.rank)}
                  fill={item.color}
                  key={`${item.imprintId}-${point.year}`}
                  r={focused ? 4 : 3}
                />
              ))}
            {showLabel ? (
              <text
                className="experiment-series-label"
                fill={item.color}
                onMouseEnter={() => onHoverIdChange(item.imprintId)}
                x={width - margin.right + 10}
                y={yForRank(item.points.at(-1)?.rank ?? item.finalRank) + 4}
              >
                {item.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function buildRace(events: ImprintRankEvent[], windowMode: WindowMode, metric: Metric, scope: Scope, yearRange: [number, number], topCount: number) {
  const years = rangeOfYears(yearRange[0], yearRange[1]);
  const imprintNames = new Map<string, { name: string; publisherName?: string }>();
  const annual = new Map<number, Map<string, YearStat>>();
  let scoredEvents = 0;

  for (const event of events) {
    if (event.year < yearRange[0] || event.year > yearRange[1]) continue;
    if (scope === "major" && !event.isMajor) continue;
    const weight = scope === "major" ? event.majorWeight : event.weight;
    if (weight <= 0) continue;
    scoredEvents += 1;
    imprintNames.set(event.imprintId, { name: event.imprintName, publisherName: event.publisherName });
    const yearStats = annual.get(event.year) ?? new Map<string, YearStat>();
    annual.set(event.year, yearStats);
    const stat = yearStats.get(event.imprintId) ?? { score: 0, wins: 0, books: new Set<string>() };
    stat.score += weight;
    if (event.isWin) stat.wins += 1;
    stat.books.add(event.bookId);
    yearStats.set(event.imprintId, stat);
  }

  const pointsByImprint = new Map<string, RankedPoint[]>();
  const running = new Map<string, YearStat>();
  const totals = new Map<string, number>();

  for (const year of years) {
    const yearStats = annual.get(year) ?? new Map<string, YearStat>();
    const rankable =
      windowMode === "annual"
        ? cloneStatsMap(yearStats)
        : windowMode === "rolling3"
          ? rollingStats(annual, year, 3, yearRange[0])
          : windowMode === "rolling5"
            ? rollingStats(annual, year, 5, yearRange[0])
            : updateRunningStats(running, yearStats);
    const ranked = [...rankable.entries()]
      .map(([imprintId, stat]) => ({
        imprintId,
        stat,
        value: statValue(stat, metric),
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value || b.stat.score - a.stat.score || imprintName(imprintNames, a.imprintId).localeCompare(imprintName(imprintNames, b.imprintId)));

    ranked.forEach((row, index) => {
      const point = {
        year,
        rank: index + 1,
        value: row.value,
        score: row.stat.score,
        books: row.stat.books.size,
        wins: row.stat.wins,
      };
      const points = pointsByImprint.get(row.imprintId) ?? [];
      points.push(point);
      pointsByImprint.set(row.imprintId, points);
      totals.set(row.imprintId, (totals.get(row.imprintId) ?? 0) + row.value);
    });
  }

  const topIds = [...pointsByImprint.entries()]
    .map(([imprintId, points]) => {
      const latest = points.at(-1);
      return {
        imprintId,
        latestRank: latest?.rank ?? 999,
        latestValue: latest?.value ?? 0,
        total: totals.get(imprintId) ?? 0,
      };
    })
    .sort((a, b) => {
      if (windowMode === "cumulative") {
        return b.latestValue - a.latestValue || a.latestRank - b.latestRank || imprintName(imprintNames, a.imprintId).localeCompare(imprintName(imprintNames, b.imprintId));
      }
      return b.total - a.total || b.latestValue - a.latestValue || imprintName(imprintNames, a.imprintId).localeCompare(imprintName(imprintNames, b.imprintId));
    })
    .slice(0, topCount)
    .map((row) => row.imprintId);

  const series = topIds.map((imprintId, index) => {
    const info = imprintNames.get(imprintId);
    const points = pointsByImprint.get(imprintId) ?? [];
    const latest = points.at(-1);
    return {
      imprintId,
      name: info?.name ?? imprintId,
      publisherName: info?.publisherName,
      color: seriesColors[index % seriesColors.length],
      finalRank: latest?.rank ?? 0,
      finalValue: latest?.value ?? 0,
      points,
    };
  });

  return {
    rankedImprints: pointsByImprint.size,
    scoredEvents,
    series,
  };
}

function rollingStats(annual: Map<number, Map<string, YearStat>>, year: number, windowSize: number, minYear: number) {
  const merged = new Map<string, YearStat>();
  const start = Math.max(minYear, year - windowSize + 1);
  for (let currentYear = start; currentYear <= year; currentYear += 1) {
    mergeStatsInto(merged, annual.get(currentYear) ?? new Map<string, YearStat>());
  }
  return merged;
}

function updateRunningStats(running: Map<string, YearStat>, yearStats: Map<string, YearStat>) {
  for (const [imprintId, stat] of yearStats.entries()) {
    const current = running.get(imprintId) ?? { score: 0, wins: 0, books: new Set<string>() };
    current.score += stat.score;
    current.wins += stat.wins;
    for (const bookId of stat.books) current.books.add(bookId);
    running.set(imprintId, current);
  }
  return running;
}

function cloneStatsMap(stats: Map<string, YearStat>) {
  const clone = new Map<string, YearStat>();
  for (const [key, stat] of stats.entries()) {
    clone.set(key, { score: stat.score, wins: stat.wins, books: new Set(stat.books) });
  }
  return clone;
}

function mergeStatsInto(target: Map<string, YearStat>, source: Map<string, YearStat>) {
  for (const [imprintId, stat] of source.entries()) {
    const current = target.get(imprintId) ?? { score: 0, wins: 0, books: new Set<string>() };
    current.score += stat.score;
    current.wins += stat.wins;
    for (const bookId of stat.books) current.books.add(bookId);
    target.set(imprintId, current);
  }
}

function rangeOfYears(minYear: number, maxYear: number) {
  const years: number[] = [];
  for (let year = minYear; year <= maxYear; year += 1) years.push(year);
  return years;
}

function statValue(stat: YearStat, metric: Metric) {
  if (metric === "books") return stat.books.size;
  if (metric === "wins") return stat.wins;
  return stat.score;
}

function imprintName(names: Map<string, { name: string }>, imprintId: string) {
  return names.get(imprintId)?.name ?? imprintId;
}

function pointsToPath(points: RankedPoint[], xForYear: (year: number) => number, yForRank: (rank: number) => number) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xForYear(point.year).toFixed(2)} ${yForRank(point.rank).toFixed(2)}`)
    .join(" ");
}

function getYearTicks(minYear: number, maxYear: number) {
  const start = Math.ceil(minYear / 10) * 10;
  const ticks = [minYear];
  for (let year = start; year < maxYear; year += 10) {
    if (year !== minYear) ticks.push(year);
  }
  ticks.push(maxYear);
  return [...new Set(ticks)];
}

function formatMetric(metric: Metric, value: number) {
  const label = metric === "score" ? "score" : metric === "books" ? "books" : "wins";
  return `${value.toLocaleString()} ${label}`;
}

function DateRangeBrush({
  fullRange,
  onChange,
  value,
}: {
  fullRange: [number, number];
  onChange: (value: [number, number]) => void;
  value: [number, number];
}) {
  const [minYear, maxYear] = fullRange;
  const [startYear, endYear] = value;
  const startPct = ((startYear - minYear) / Math.max(1, maxYear - minYear)) * 100;
  const endPct = ((endYear - minYear) / Math.max(1, maxYear - minYear)) * 100;

  function setStart(nextStart: number) {
    onChange([Math.min(nextStart, endYear - 1), endYear]);
  }

  function setEnd(nextEnd: number) {
    onChange([startYear, Math.max(nextEnd, startYear + 1)]);
  }

  return (
    <div className="experiment-range-control border-x border-b hairline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="filter-label">Date range</p>
        <p className="plain-number text-sm text-[var(--ink)]">{startYear}-{endYear}</p>
      </div>
      <div
        className="experiment-range-track"
        style={{
          "--range-start": `${startPct}%`,
          "--range-end": `${endPct}%`,
        } as CSSProperties}
      >
        <input
          aria-label="Start year"
          max={maxYear - 1}
          min={minYear}
          onChange={(event) => setStart(Number(event.target.value))}
          type="range"
          value={startYear}
        />
        <input
          aria-label="End year"
          max={maxYear}
          min={minYear + 1}
          onChange={(event) => setEnd(Number(event.target.value))}
          type="range"
          value={endYear}
        />
      </div>
      <div className="mt-2 flex justify-between font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.1em] muted">
        <span>{minYear}</span>
        <span>{maxYear}</span>
      </div>
    </div>
  );
}

function ControlGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className="segmented-control">{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button className={`segment-button focus-ring ${active ? "segment-button-active" : ""}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="plain-number text-xl leading-none text-[var(--ink)]">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-[0.58rem] uppercase leading-none tracking-[0.15em] muted">{label}</p>
    </div>
  );
}
