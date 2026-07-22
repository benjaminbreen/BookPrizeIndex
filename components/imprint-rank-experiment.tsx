"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SectionPermalink } from "@/components/ui/section-permalink";

export type ImprintRankEvent = {
  year: number;
  imprintId: string;
  imprintName: string;
  imprintShortName?: string;
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
  shortName: string;
  publisherName?: string;
  color: string;
  finalRank: number;
  finalValue: number;
  finalPoint: RankedPoint;
  rankChange: number | null;
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
  const [windowMode, setWindowMode] = useState<WindowMode>("rolling5");
  const [metric, setMetric] = useState<Metric>("books");
  const [scope, setScope] = useState<Scope>("all");
  const [topCount, setTopCount] = useState(15);
  const [visibleRange, setVisibleRange] = useState<[number, number]>(yearRange);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const race = useMemo(() => buildRace(events, windowMode, metric, scope, visibleRange, topCount), [events, metric, scope, topCount, visibleRange, windowMode]);
  const leader = race.series[0];
  const activeSeriesId = hoverId ?? (selectedId && race.series.some((series) => series.imprintId === selectedId) ? selectedId : leader?.imprintId);
  const activeSeries = race.series.find((series) => series.imprintId === activeSeriesId) ?? leader;

  function selectSeries(imprintId: string) {
    setSelectedId((current) => current === imprintId ? null : imprintId);
  }

  return (
    <section className="mt-10 scroll-mt-24 border-t hairline pt-8" id="imprint-leaderboard">
      <div className="border-b hairline pb-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publishing imprints</p>
            <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">
              Imprint leaderboard over time
              <SectionPermalink id="imprint-leaderboard" label="Imprint leaderboard over time" />
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 muted">
              See which publishing imprints led nonfiction prize recognition in each period.
            </p>
          </div>

          <div className="imprint-leaderboard-metrics grid grid-cols-3 gap-5">
            <Metric label="Years" value={`${visibleRange[0]}–${visibleRange[1]}`} />
            <Metric label="Ranked imprints" value={String(race.rankedImprints)} />
            <Metric label="Rows scored" value={race.scoredEvents.toLocaleString()} />
          </div>
        </div>

        <div className="filter-toolbar mt-6 flex flex-wrap items-end gap-x-5 gap-y-3 border hairline p-3">
          <label className="filter-group" htmlFor="imprint-window">
            <span className="filter-label">Window</span>
            <select
              className="filter-select"
              id="imprint-window"
              onChange={(event) => setWindowMode(event.target.value as WindowMode)}
              value={windowMode}
            >
              <option value="rolling5">5-year rolling</option>
              <option value="rolling3">3-year rolling</option>
              <option value="annual">Annual</option>
              <option value="cumulative">All-time cumulative</option>
            </select>
          </label>
          <label className="filter-group" htmlFor="imprint-measure">
            <span className="filter-label">Measure</span>
            <select
              className="filter-select"
              id="imprint-measure"
              onChange={(event) => setMetric(event.target.value as Metric)}
              value={metric}
            >
              <option value="score">Recognition score</option>
              <option value="books">Recognized books</option>
              <option value="wins">Wins</option>
            </select>
          </label>
          <ControlGroup label="Awards">
            <SegmentButton active={scope === "major"} onClick={() => setScope("major")}>Major</SegmentButton>
            <SegmentButton active={scope === "all"} onClick={() => setScope("all")}>All</SegmentButton>
          </ControlGroup>
          <ControlGroup label="Show">
            {[5, 10, 15].map((count) => (
              <SegmentButton active={topCount === count} key={count} onClick={() => setTopCount(count)}>
                Top {count}
              </SegmentButton>
            ))}
          </ControlGroup>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-x border-t hairline px-4 py-3">
            <p className="filter-label">Rank within the selected {windowModeLabel(windowMode).toLowerCase()} window</p>
            <p className="text-xs leading-5 muted">Focused line: dashed below Top {topCount} · gap means no recognition</p>
          </div>
          <div className="max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))]">
            <ImprintBumpChart
              activeId={activeSeriesId}
              onHoverIdChange={setHoverId}
              onSelect={selectSeries}
              series={race.series}
              topCount={topCount}
              yearRange={visibleRange}
            />
          </div>
          <DateRangeBrush fullRange={yearRange} onChange={setVisibleRange} value={visibleRange} />
        </div>

        <aside className="imprint-ranking-rail border-t hairline pt-5 lg:sticky lg:top-6 lg:self-start lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          {leader ? (
            <div className="border-b hairline pb-5">
              <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Current leader</p>
              <p className="mt-3 font-[var(--font-serif)] text-2xl font-light leading-tight">{leader.name}</p>
              <p className="mt-1 text-sm leading-6 muted">
                {leader.publisherName ?? "Parent publisher not yet sourced"}
              </p>
              <p className="mt-2 plain-number text-sm text-[var(--ink)]">{formatMetric(metric, leader.finalValue)}</p>
            </div>
          ) : null}

          <div className="pt-5">
            <div className="flex items-end justify-between gap-3">
              <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Current ranking</p>
              <p className="font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.12em] muted">Change</p>
            </div>
            <div className="mt-3 border-y hairline">
              {race.series.map((series) => (
                <button
                  aria-pressed={selectedId === series.imprintId}
                  className={`experiment-ranking-row focus-ring ${activeSeriesId === series.imprintId ? "experiment-ranking-row-active" : ""}`}
                  key={series.imprintId}
                  onClick={() => selectSeries(series.imprintId)}
                  onFocus={() => setHoverId(series.imprintId)}
                  onBlur={() => setHoverId(null)}
                  onMouseEnter={() => setHoverId(series.imprintId)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{ "--series-color": series.color } as CSSProperties}
                  type="button"
                >
                  <span className="plain-number text-xs muted">{series.finalRank}</span>
                  <span className="experiment-legend-swatch" />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm text-[var(--ink)]">{series.name}</span>
                    <span className="mt-0.5 block truncate plain-number text-[0.68rem] muted">{formatMetric(metric, series.finalValue)}</span>
                  </span>
                  <RankChange value={series.rankChange} />
                </button>
              ))}
            </div>
          </div>

          {activeSeries ? (
            <div aria-live="polite" className="mt-6 border-t hairline pt-5">
              <p className="filter-label">Focused imprint</p>
              <p className="mt-3 text-sm text-[var(--ink)]">{activeSeries.name}</p>
              <p className="mt-1 text-xs leading-5 muted">{activeSeries.publisherName ?? "Parent publisher not yet sourced"}</p>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t hairline pt-3">
                <MiniMetric label="Score" value={activeSeries.finalPoint.score} />
                <MiniMetric label="Books" value={activeSeries.finalPoint.books} />
                <MiniMetric label="Wins" value={activeSeries.finalPoint.wins} />
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function ImprintBumpChart({
  activeId,
  onHoverIdChange,
  onSelect,
  series,
  topCount,
  yearRange,
}: {
  activeId?: string;
  onHoverIdChange: (id: string | null) => void;
  onSelect: (id: string) => void;
  series: Series[];
  topCount: number;
  yearRange: [number, number];
}) {
  const width = 960;
  const height = 500;
  const margin = { top: 30, right: 132, bottom: 52, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minYear = yearRange[0];
  const maxYear = yearRange[1];
  const rankFloor = topCount + 1;
  const yearTicks = getYearTicks(minYear, maxYear);
  const rankTicks = topCount === 5 ? [1, 2, 3, 4, 5] : topCount === 10 ? [1, 5, 10] : [1, 5, 10, 15];

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
      <desc>
        Imprint rankings over time. Select an imprint from the chart or ranking list to focus it. A dashed line at the
        bottom means the focused imprint ranked below the displayed cutoff; a gap means it had no recognition in the
        selected window.
      </desc>
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
      <text className="experiment-chart-axis" textAnchor="end" x={margin.left - 12} y={yForRank(rankFloor) + 4}>{`>${topCount}`}</text>
      {series.map((item) => {
        const active = activeId === item.imprintId;
        const dimmed = Boolean(activeId) && !active;
        const path = pointsToVisiblePath(item.points, xForYear, yForRank, topCount);
        const belowCutoffPath = active ? pointsToBelowCutoffPath(item.points, xForYear, yForRank, topCount) : "";
        const visiblePoints = item.points.filter((point) => point.rank <= topCount);
        const cutoffBoundaryPoints = active ? getCutoffBoundaryPoints(item.points, topCount) : [];
        const markerPoints = active
          ? visiblePoints.filter((point, index) => {
              const previous = visiblePoints[index - 1];
              const next = visiblePoints[index + 1];
              return !previous || !next || previous.rank !== point.rank || previous.year !== point.year - 1;
            })
          : visiblePoints.slice(-1);
        return (
          <g
            key={item.imprintId}
            onClick={() => onSelect(item.imprintId)}
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
            {belowCutoffPath ? (
              <path
                aria-hidden="true"
                className="experiment-series-hit-area"
                d={belowCutoffPath}
                fill="none"
                stroke="transparent"
              />
            ) : null}
            <path
              className={`experiment-series-line ${active ? "experiment-series-line-active" : ""} ${dimmed ? "experiment-series-line-dimmed" : ""}`}
              d={path}
              fill="none"
              stroke={item.color}
            />
            {belowCutoffPath ? (
              <path
                className="experiment-series-line experiment-series-line-below"
                d={belowCutoffPath}
                fill="none"
                stroke={item.color}
              />
            ) : null}
            {markerPoints.map((point) => (
                <circle
                  className={`experiment-series-dot ${dimmed ? "experiment-series-dot-dimmed" : ""}`}
                  cx={xForYear(point.year)}
                  cy={yForRank(point.rank)}
                  fill={item.color}
                  key={`${item.imprintId}-${point.year}`}
                  r={active ? 3.6 : 2.8}
                />
              ))}
            {cutoffBoundaryPoints.map((point) => (
              <circle
                className="experiment-series-cutoff-dot"
                cx={xForYear(point.year)}
                cy={yForRank(rankFloor)}
                fill="var(--paper)"
                key={`${item.imprintId}-cutoff-${point.year}`}
                r={2.7}
                stroke={item.color}
              />
            ))}
            {active ? (
              <text
                className="experiment-series-label experiment-series-label-active"
                fill={item.color}
                onMouseEnter={() => onHoverIdChange(item.imprintId)}
                x={width - margin.right + 10}
                y={yForRank(item.finalRank) + 4}
              >
                {item.shortName}
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
  const imprintNames = new Map<string, { name: string; shortName: string; publisherName?: string }>();
  const annual = new Map<number, Map<string, YearStat>>();
  let scoredEvents = 0;

  for (const event of events) {
    if (event.year < yearRange[0] || event.year > yearRange[1]) continue;
    if (scope === "major" && !event.isMajor) continue;
    const weight = scope === "major" ? event.majorWeight : event.weight;
    if (weight <= 0) continue;
    scoredEvents += 1;
    imprintNames.set(event.imprintId, {
      name: event.imprintName,
      shortName: event.imprintShortName ?? event.imprintName,
      publisherName: event.publisherName,
    });
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
  let latestRanked: { imprintId: string; stat: YearStat; value: number }[] = [];
  let currentYear = yearRange[0];

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

    if (ranked.length > 0) {
      latestRanked = ranked;
      currentYear = year;
    }

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
    });
  }

  const topIds = latestRanked
    .slice(0, topCount)
    .map((row) => row.imprintId);

  const series = topIds.map((imprintId, index) => {
    const info = imprintNames.get(imprintId);
    const points = pointsByImprint.get(imprintId) ?? [];
    const latest = points.findLast((point) => point.year === currentYear) ?? points.at(-1);
    if (!latest) return null;
    const previous = points.findLast((point) => point.year < currentYear);
    return {
      imprintId,
      name: info?.name ?? imprintId,
      shortName: info?.shortName ?? info?.name ?? imprintId,
      publisherName: info?.publisherName,
      color: seriesColors[index % seriesColors.length],
      finalRank: latest.rank,
      finalValue: latest.value,
      finalPoint: latest,
      rankChange: previous ? previous.rank - latest.rank : null,
      points,
    };
  }).filter((series): series is NonNullable<typeof series> => series !== null);

  return {
    rankedImprints: pointsByImprint.size,
    scoredEvents,
    series,
    currentYear,
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

function pointsToVisiblePath(
  points: RankedPoint[],
  xForYear: (year: number) => number,
  yForRank: (rank: number) => number,
  maxRank: number,
) {
  const commands: string[] = [];
  let previousVisibleYear: number | null = null;

  for (const point of points) {
    if (point.rank > maxRank) {
      previousVisibleYear = null;
      continue;
    }
    const command = previousVisibleYear === point.year - 1 ? "L" : "M";
    commands.push(`${command} ${xForYear(point.year).toFixed(2)} ${yForRank(point.rank).toFixed(2)}`);
    previousVisibleYear = point.year;
  }

  return commands.join(" ");
}

function pointsToBelowCutoffPath(
  points: RankedPoint[],
  xForYear: (year: number) => number,
  yForRank: (rank: number) => number,
  maxRank: number,
) {
  const commands: string[] = [];
  let previous: RankedPoint | undefined;
  let belowRunActive = false;

  for (const point of points) {
    const contiguous = previous?.year === point.year - 1;
    if (!contiguous) belowRunActive = false;

    if (point.rank > maxRank) {
      if (!belowRunActive) {
        if (contiguous && previous && previous.rank <= maxRank) {
          commands.push(`M ${xForYear(previous.year).toFixed(2)} ${yForRank(previous.rank).toFixed(2)}`);
          commands.push(`L ${xForYear(point.year).toFixed(2)} ${yForRank(maxRank + 1).toFixed(2)}`);
        } else {
          commands.push(`M ${xForYear(point.year).toFixed(2)} ${yForRank(maxRank + 1).toFixed(2)}`);
        }
      } else {
        commands.push(`L ${xForYear(point.year).toFixed(2)} ${yForRank(maxRank + 1).toFixed(2)}`);
      }
      belowRunActive = true;
    } else if (belowRunActive && contiguous && previous) {
      commands.push(`L ${xForYear(point.year).toFixed(2)} ${yForRank(point.rank).toFixed(2)}`);
      belowRunActive = false;
    }

    previous = point;
  }

  return commands.join(" ");
}

function getCutoffBoundaryPoints(points: RankedPoint[], maxRank: number) {
  return points.filter((point, index) => {
    if (point.rank <= maxRank) return false;
    const previous = points[index - 1];
    const next = points[index + 1];
    const startsRun = !previous || previous.year !== point.year - 1 || previous.rank <= maxRank;
    const endsRun = !next || next.year !== point.year + 1 || next.rank <= maxRank;
    return startsRun || endsRun;
  });
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

function windowModeLabel(windowMode: WindowMode) {
  if (windowMode === "rolling5") return "5-year rolling";
  if (windowMode === "rolling3") return "3-year rolling";
  if (windowMode === "annual") return "Annual";
  return "All-time cumulative";
}

function RankChange({ value }: { value: number | null }) {
  if (value === null) return <span className="plain-number text-xs muted">New</span>;
  if (value > 0) return <span className="plain-number text-xs text-[var(--data-green)]">↑{value}</span>;
  if (value < 0) return <span className="plain-number text-xs text-[var(--data-red)]">↓{Math.abs(value)}</span>;
  return <span className="plain-number text-xs muted">—</span>;
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="plain-number text-sm text-[var(--ink)]">{value.toLocaleString()}</p>
      <p className="mt-1 font-[var(--font-mono)] text-[0.52rem] uppercase tracking-[0.12em] muted">{label}</p>
    </div>
  );
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
