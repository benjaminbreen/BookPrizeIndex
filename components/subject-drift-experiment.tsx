"use client";

import { useMemo, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

export type SubjectDriftData = {
  /** Subject names ordered by total appearance count, descending. */
  subjects: string[];
  yearRange: [number, number];
  /** Sparse cube rows: [year, subjectIndex, regionIndex (US/UK/Canada/other), isWin, scopeIndex (general/other), count]. */
  rows: Array<[number, number, number, number, number, number]>;
};

type RegionFilter = "all" | "us" | "uk" | "canada" | "international";
type RecognitionFilter = "all" | "winners";
type RangeFilter = "modern" | "full";
type CorpusFilter = "general" | "all";

type SubjectDriftExperimentProps = {
  data: SubjectDriftData;
};

const SERIES_COLORS = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
  "var(--chart-cat-7)",
  "var(--chart-cat-8)",
  "var(--chart-cat-9)",
  "var(--chart-cat-10)",
];
const MODERN_START = 1950;

export function SubjectDriftExperiment({ data }: SubjectDriftExperimentProps) {
  const [region, setRegion] = useState<RegionFilter>("all");
  const [recognition, setRecognition] = useState<RecognitionFilter>("winners");
  const [corpus, setCorpus] = useState<CorpusFilter>("general");
  const [range, setRange] = useState<RangeFilter>("modern");
  const [selected, setSelected] = useState<Map<string, number>>(
    () => selectionMap(defaultSubjects(data)),
  );
  const [hover, setHover] = useState<{ subject: string | null; year: number } | null>(null);

  const minYear = range === "modern" ? Math.max(MODERN_START, data.yearRange[0]) : data.yearRange[0];
  // Exclude the in-progress calendar year, whose partial award cycle would mechanically skew shares.
  const maxYear = Math.min(data.yearRange[1], new Date().getFullYear() - 1);

  const series = useMemo(
    () => buildSeries(data, region, recognition, corpus, minYear, maxYear),
    [data, region, recognition, corpus, minYear, maxYear],
  );
  const rankedSubjects = useMemo(() => rankSubjects(series), [series]);
  const selectedEntries = rankedSubjects
    .filter((item) => selected.has(item.subject))
    .map((item) => [item.subject, selected.get(item.subject) as number] as [string, number]);
  const maxShare = useMemo(() => {
    let max = 0;
    for (const subject of selected.keys()) {
      const item = series.get(subject);
      if (!item) continue;
      for (const point of item.points) if (point && point.share > max) max = point.share;
    }
    return Math.min(0.6, Math.ceil((max + 0.02) * 10) / 10);
  }, [selected, series]);

  function toggleSubject(subject: string) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(subject)) {
        next.delete(subject);
        return next;
      }
      const used = new Set([...next.values()].map((slot) => slot % SERIES_COLORS.length));
      const available = SERIES_COLORS.findIndex((_, index) => !used.has(index));
      const slot = available >= 0 ? available : next.size % SERIES_COLORS.length;
      next.set(subject, slot);
      return next;
    });
  }

  function selectTopTen() {
    setSelected(selectionMap(rankedSubjects.slice(0, 10).map((item) => item.subject)));
  }

  function selectAll() {
    setSelected(selectionMap(rankedSubjects.map((item) => item.subject)));
  }

  return (
    <section className="mt-12 border-t hairline pt-8">
      <div className="border-b hairline pb-6">
        <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subjects over time</p>
        <h2 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-tight sm:text-4xl">Subject drift</h2>
        <p className="mt-4 max-w-3xl text-base leading-7 muted">
          How the subjects of prize-winning nonfiction have changed over time.
        </p>
      </div>

      <div className="filter-toolbar mt-6 flex flex-wrap items-center gap-4 border hairline p-3">
        <ControlGroup label="Awards">
          <SegmentButton active={region === "all"} onClick={() => setRegion("all")}>All</SegmentButton>
          <SegmentButton active={region === "us"} onClick={() => setRegion("us")}>US</SegmentButton>
          <SegmentButton active={region === "uk"} onClick={() => setRegion("uk")}>UK</SegmentButton>
          <SegmentButton active={region === "canada"} onClick={() => setRegion("canada")}>Canada</SegmentButton>
          <SegmentButton active={region === "international"} onClick={() => setRegion("international")}>Other</SegmentButton>
        </ControlGroup>
        <ControlGroup label="Corpus">
          <SegmentButton active={corpus === "general"} onClick={() => setCorpus("general")}>General prizes</SegmentButton>
          <SegmentButton active={corpus === "all"} onClick={() => setCorpus("all")}>All prizes</SegmentButton>
        </ControlGroup>
        <ControlGroup label="Recognition">
          <SegmentButton active={recognition === "all"} onClick={() => setRecognition("all")}>All</SegmentButton>
          <SegmentButton active={recognition === "winners"} onClick={() => setRecognition("winners")}>Winners</SegmentButton>
        </ControlGroup>
        <ControlGroup label="Years">
          <SegmentButton active={range === "modern"} onClick={() => setRange("modern")}>{MODERN_START}-present</SegmentButton>
          <SegmentButton active={range === "full"} onClick={() => setRange("full")}>Full range</SegmentButton>
        </ControlGroup>
      </div>

      <SubjectSelector
        onClear={() => setSelected(new Map())}
        onSelectAll={selectAll}
        onSelectTopTen={selectTopTen}
        onToggle={toggleSubject}
        rankedSubjects={rankedSubjects}
        selected={selected}
      />

      {selectedEntries.length > 0 ? (
        <PinnedComparison
          hover={hover}
          maxShare={maxShare}
          maxYear={maxYear}
          minYear={minYear}
          onHover={setHover}
          onUnpin={toggleSubject}
          pinnedEntries={selectedEntries}
          series={series}
        />
      ) : (
        <div className="mt-6 border hairline px-4 py-8 text-center text-sm muted">
          Select one or more subjects to draw the comparison chart.
        </div>
      )}

      <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {rankedSubjects.map((item) => {
          const subject = item.subject;
          return (
            <SubjectPanel
              hover={hover?.subject === subject ? hover : null}
              key={subject}
              maxYear={maxYear}
              minYear={minYear}
              onHover={setHover}
              onTogglePin={() => toggleSubject(subject)}
              pinnedSlot={selected.get(subject)}
              series={item}
              subject={subject}
            />
          );
        })}
      </div>

      <details className="mt-8 border hairline p-4 text-sm leading-6">
        <summary className="cursor-pointer font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">
          View as data table (share of recognition by decade)
        </summary>
        <DecadeTable maxYear={maxYear} minYear={minYear} series={series} subjects={rankedSubjects.map((item) => item.subject)} />
      </details>
    </section>
  );
}

function SubjectSelector({
  onClear,
  onSelectAll,
  onSelectTopTen,
  onToggle,
  rankedSubjects,
  selected,
}: {
  onClear: () => void;
  onSelectAll: () => void;
  onSelectTopTen: () => void;
  onToggle: (subject: string) => void;
  rankedSubjects: SubjectSeries[];
  selected: Map<string, number>;
}) {
  const selectedWithData = rankedSubjects.filter((item) => selected.has(item.subject)).length;
  return (
    <div className="mt-6 border hairline p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline pb-3">
        <p className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.16em] muted">
          Subjects / {selectedWithData} of {rankedSubjects.length} shown
        </p>
        <div className="flex flex-wrap gap-2">
          <SelectorAction onClick={onSelectTopTen}>Top 10</SelectorAction>
          <SelectorAction onClick={onSelectAll}>Show all</SelectorAction>
          <SelectorAction onClick={onClear}>Clear</SelectorAction>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rankedSubjects.map((item) => {
          const slot = selected.get(item.subject);
          const active = slot !== undefined;
          return (
            <button
              aria-pressed={active}
              className={`focus-ring inline-flex items-center gap-2 border hairline px-2.5 py-1.5 text-xs transition ${active ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "muted hover:text-[var(--ink)]"}`}
              key={item.subject}
              onClick={() => onToggle(item.subject)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: active ? SERIES_COLORS[slot % SERIES_COLORS.length] : "var(--line)" }}
              />
              {item.subject}
              <span className="plain-number muted">{item.total.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectorAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="focus-ring border hairline px-2 py-1 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.12em] muted hover:text-[var(--ink)]" onClick={onClick} type="button">
      {children}
    </button>
  );
}

type SeriesPoint = { year: number; share: number; count: number; totalCount: number } | null;
type SubjectSeries = { subject: string; points: SeriesPoint[]; total: number; latestShare: number | null };

function buildSeries(
  data: SubjectDriftData,
  region: RegionFilter,
  recognition: RecognitionFilter,
  corpus: CorpusFilter,
  minYear: number,
  maxYear: number,
): Map<string, SubjectSeries> {
  const countsBySubject = new Map<number, Map<number, number>>();
  const totalsByYear = new Map<number, number>();

  for (const [year, subjectIndex, regionIndex, isWin, scopeIndex, count] of data.rows) {
    if (region === "us" && regionIndex !== 0) continue;
    if (region === "uk" && regionIndex !== 1) continue;
    if (region === "canada" && regionIndex !== 2) continue;
    if (region === "international" && regionIndex !== 3) continue;
    if (recognition === "winners" && isWin !== 1) continue;
    if (corpus === "general" && scopeIndex !== 0) continue;
    totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + count);
    const subjectCounts = countsBySubject.get(subjectIndex) ?? new Map<number, number>();
    subjectCounts.set(year, (subjectCounts.get(year) ?? 0) + count);
    countsBySubject.set(subjectIndex, subjectCounts);
  }

  const result = new Map<string, SubjectSeries>();
  data.subjects.forEach((subject, subjectIndex) => {
    const subjectCounts = countsBySubject.get(subjectIndex) ?? new Map<number, number>();
    const points: SeriesPoint[] = [];
    let total = 0;
    let latestShare: number | null = null;
    for (let year = minYear; year <= maxYear; year += 1) {
      let windowCount = 0;
      let windowTotal = 0;
      for (let offset = -1; offset <= 1; offset += 1) {
        windowCount += subjectCounts.get(year + offset) ?? 0;
        windowTotal += totalsByYear.get(year + offset) ?? 0;
      }
      total += subjectCounts.get(year) ?? 0;
      if (windowTotal < 5) {
        points.push(null);
        continue;
      }
      const share = windowCount / windowTotal;
      points.push({ year, share, count: subjectCounts.get(year) ?? 0, totalCount: totalsByYear.get(year) ?? 0 });
      latestShare = share;
    }
    result.set(subject, { subject, points, total, latestShare });
  });
  return result;
}

function rankSubjects(series: Map<string, SubjectSeries>) {
  return [...series.values()]
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject));
}

function selectionMap(subjects: string[]) {
  return new Map(subjects.map((subject, index) => [subject, index % SERIES_COLORS.length]));
}

function defaultSubjects(data: SubjectDriftData) {
  const minYear = Math.max(MODERN_START, data.yearRange[0]);
  const maxYear = Math.min(data.yearRange[1], new Date().getFullYear() - 1);
  const defaultSeries = buildSeries(data, "all", "winners", "general", minYear, maxYear);
  return rankSubjects(defaultSeries).slice(0, 10).map((item) => item.subject);
}

const PANEL = { width: 224, height: 84, top: 6, bottom: 68, left: 4, right: 220 };

function SubjectPanel({
  hover,
  maxYear,
  minYear,
  onHover,
  onTogglePin,
  pinnedSlot,
  series,
  subject,
}: {
  hover: { subject: string | null; year: number } | null;
  maxYear: number;
  minYear: number;
  onHover: (value: { subject: string | null; year: number } | null) => void;
  onTogglePin: () => void;
  pinnedSlot: number | undefined;
  series: SubjectSeries;
  subject: string;
}) {
  const color = pinnedSlot !== undefined ? SERIES_COLORS[pinnedSlot % SERIES_COLORS.length] : "var(--muted)";
  const peakShare = Math.max(0, ...series.points.map((point) => point?.share ?? 0));
  const panelMax = Math.max(0.04, peakShare * 1.15);
  const x = (year: number) => PANEL.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * (PANEL.right - PANEL.left);
  const y = (share: number) => PANEL.bottom - (share / panelMax) * (PANEL.bottom - PANEL.top);
  const { linePath, areaPath } = pathsForPoints(series.points, x, y, PANEL.bottom);
  const hoveredPoint = hover ? series.points.find((point) => point?.year === hover.year) ?? null : null;

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const year = Math.round(minYear + ((event.clientX - rect.left) / rect.width) * (maxYear - minYear));
    onHover({ subject, year: Math.min(maxYear, Math.max(minYear, year)) });
  }

  return (
    <div className="relative min-w-0">
      <button
        aria-pressed={pinnedSlot !== undefined}
        className="focus-ring flex w-full items-baseline justify-between gap-2 text-left"
        onClick={onTogglePin}
        title={pinnedSlot !== undefined ? "Remove subject from comparison" : "Add subject to comparison"}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2 text-sm">
          {pinnedSlot !== undefined ? (
            <span aria-hidden="true" className="inline-block h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: color }} />
          ) : null}
          <span className="truncate">{subject}</span>
        </span>
        <span className="plain-number shrink-0 text-xs muted">
          {series.latestShare === null ? "-" : formatShare(series.latestShare)}
        </span>
      </button>
      <svg
        aria-label={`${subject} share of recognition over time`}
        className="mt-1 block h-auto w-full border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))]"
        onPointerLeave={() => onHover(null)}
        onPointerMove={handlePointer}
        role="img"
        viewBox={`0 0 ${PANEL.width} ${PANEL.height}`}
      >
        <line stroke="var(--line)" strokeWidth={0.75} x1={PANEL.left} x2={PANEL.right} y1={PANEL.bottom} y2={PANEL.bottom} />
        <text
          className="experiment-chart-axis"
          style={{ fontSize: "7px", letterSpacing: "0.04em" }}
          textAnchor="end"
          x={PANEL.right - 3}
          y={PANEL.top + 6}
        >
          peak {formatShare(peakShare)}
        </text>
        {areaPath ? <path d={areaPath} fill={color} opacity={0.1} /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} /> : null}
        {hover && hoveredPoint ? (
          <g>
            <line stroke="var(--ink)" strokeOpacity={0.4} strokeWidth={0.75} x1={x(hover.year)} x2={x(hover.year)} y1={PANEL.top} y2={PANEL.bottom} />
            <circle cx={x(hoveredPoint.year)} cy={y(hoveredPoint.share)} fill={color} r={3} stroke="var(--paper)" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
      {hover && hoveredPoint ? (
        <div className="pointer-events-none absolute right-0 top-7 z-10 border hairline bg-[var(--panel)] px-2 py-1 text-xs leading-5 shadow-sm">
          <span className="plain-number text-[var(--ink)]">{formatShare(hoveredPoint.share)}</span>
          <span className="muted"> in {hover.year} ({hoveredPoint.count} that year)</span>
        </div>
      ) : null}
    </div>
  );
}

const COMPARE = { width: 960, height: 300, top: 24, bottom: 262, left: 52, right: 860 };

function PinnedComparison({
  hover,
  maxShare,
  maxYear,
  minYear,
  onHover,
  onUnpin,
  pinnedEntries,
  series,
}: {
  hover: { subject: string | null; year: number } | null;
  maxShare: number;
  maxYear: number;
  minYear: number;
  onHover: (value: { subject: string | null; year: number } | null) => void;
  onUnpin: (subject: string) => void;
  pinnedEntries: Array<[string, number]>;
  series: Map<string, SubjectSeries>;
}) {
  const x = (year: number) => COMPARE.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * (COMPARE.right - COMPARE.left);
  const y = (share: number) => COMPARE.bottom - (share / maxShare) * (COMPARE.bottom - COMPARE.top);
  const shareTicks = shareAxisTicks(maxShare);
  const hoverYear = hover?.subject === null ? hover.year : null;

  const endLabels = useMemo(() => {
    const labels = pinnedEntries
      .map(([subject, slot]) => {
        const item = series.get(subject);
        const lastPoint = [...(item?.points ?? [])].reverse().find((point) => point !== null) ?? null;
        return lastPoint ? { subject, slot, y: y(lastPoint.share) } : null;
      })
      .filter((label): label is { subject: string; slot: number; y: number } => label !== null)
      .sort((a, b) => a.y - b.y);
    const gap = 13;
    const minLabelY = COMPARE.top + 4;
    const maxLabelY = COMPARE.bottom - 4;
    if (labels.length) labels[0].y = Math.max(labels[0].y, minLabelY);
    for (let index = 1; index < labels.length; index += 1) {
      labels[index].y = Math.max(labels[index].y, labels[index - 1].y + gap);
    }
    if (labels.at(-1) && labels.at(-1)!.y > maxLabelY) {
      labels[labels.length - 1].y = maxLabelY;
      for (let index = labels.length - 2; index >= 0; index -= 1) {
        labels[index].y = Math.min(labels[index].y, labels[index + 1].y - gap);
      }
    }
    return labels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedEntries, series, minYear, maxYear, maxShare]);

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * COMPARE.width;
    const year = Math.round(minYear + ((vx - COMPARE.left) / (COMPARE.right - COMPARE.left)) * (maxYear - minYear));
    onHover({ subject: null, year: Math.min(maxYear, Math.max(minYear, year)) });
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {pinnedEntries.map(([subject, slot]) => (
          <button
            className="focus-ring inline-flex items-center gap-2 border hairline px-2.5 py-1 text-xs"
            key={subject}
            onClick={() => onUnpin(subject)}
            title="Unpin subject"
            type="button"
          >
            <span aria-hidden="true" className="inline-block h-[3px] w-4" style={{ background: SERIES_COLORS[slot % SERIES_COLORS.length] }} />
            {subject}
            <span aria-hidden="true" className="muted">×</span>
          </button>
        ))}
        <span className="font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.14em] muted">
          Share of recognition, 3-year window
        </span>
      </div>
      <div className="mt-3 max-w-full overflow-x-auto border hairline bg-[color-mix(in_srgb,var(--paper)_86%,var(--panel))]">
        <div className="relative min-w-[48rem]">
        <svg
          aria-label="Comparison of selected subject shares over time"
          className="experiment-chart"
          onPointerLeave={() => onHover(null)}
          onPointerMove={handlePointer}
          role="img"
          viewBox={`0 0 ${COMPARE.width} ${COMPARE.height}`}
        >
          <rect className="experiment-chart-bg" height={COMPARE.height} width={COMPARE.width} />
          {yearAxisTicks(minYear, maxYear).map((year) => (
            <g key={year}>
              <line className="experiment-chart-grid" x1={x(year)} x2={x(year)} y1={COMPARE.top} y2={COMPARE.bottom} />
              <text className="experiment-chart-axis" textAnchor="middle" x={x(year)} y={COMPARE.bottom + 20}>
                {year}
              </text>
            </g>
          ))}
          {shareTicks.map((tick) => (
            <g key={tick}>
              <line className="experiment-chart-grid" x1={COMPARE.left} x2={COMPARE.right} y1={y(tick)} y2={y(tick)} />
              <text className="experiment-chart-axis" textAnchor="end" x={COMPARE.left - 8} y={y(tick) + 3}>
                {formatShare(tick)}
              </text>
            </g>
          ))}
          {pinnedEntries.map(([subject, slot]) => {
            const item = series.get(subject);
            if (!item) return null;
            const { linePath } = pathsForPoints(item.points, x, y, COMPARE.bottom);
            return linePath ? (
              <path
                d={linePath}
                fill="none"
                key={subject}
                stroke={SERIES_COLORS[slot % SERIES_COLORS.length]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            ) : null;
          })}
          {endLabels.map((label) => (
            <text className="experiment-series-label" fill="var(--ink)" key={label.subject} x={COMPARE.right + 10} y={label.y + 3}>
              <tspan fill={SERIES_COLORS[label.slot % SERIES_COLORS.length]}>—</tspan> {truncate(label.subject, 18)}
            </text>
          ))}
          {hoverYear !== null ? (
            <line stroke="var(--ink)" strokeOpacity={0.45} strokeWidth={1} x1={x(hoverYear)} x2={x(hoverYear)} y1={COMPARE.top} y2={COMPARE.bottom} />
          ) : null}
        </svg>
        {hoverYear !== null ? (
          <div
            className="pointer-events-none absolute top-3 z-10 w-56 -translate-x-1/2 border hairline bg-[var(--panel)] p-3 text-xs leading-5 shadow-sm"
            style={{ left: `${Math.min(85, Math.max(12, (x(hoverYear) / COMPARE.width) * 100))}%` }}
          >
            <p className="muted">{hoverYear}</p>
            {pinnedEntries.map(([subject, slot]) => {
              const point = series.get(subject)?.points.find((item) => item?.year === hoverYear) ?? null;
              return (
                <p className="mt-1 flex items-baseline justify-between gap-3" key={subject}>
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="inline-block h-[3px] w-4 shrink-0" style={{ background: SERIES_COLORS[slot % SERIES_COLORS.length] }} />
                    <span className="truncate muted">{subject}</span>
                  </span>
                  <span className="plain-number shrink-0 text-[var(--ink)]">{point ? formatShare(point.share) : "-"}</span>
                </p>
              );
            })}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

function DecadeTable({
  maxYear,
  minYear,
  series,
  subjects,
}: {
  maxYear: number;
  minYear: number;
  series: Map<string, SubjectSeries>;
  subjects: string[];
}) {
  const decades: number[] = [];
  for (let decade = Math.floor(minYear / 10) * 10; decade <= maxYear; decade += 10) decades.push(decade);

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead>
          <tr className="border-b hairline font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.14em] muted">
            <th className="py-2 pr-4 font-normal">Subject</th>
            {decades.map((decade) => (
              <th className="plain-number py-2 pr-3 text-right font-normal" key={decade}>
                {decade}s
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subjects.map((subject) => {
            const item = series.get(subject);
            if (!item || item.total === 0) return null;
            return (
              <tr className="border-b hairline" key={subject}>
                <td className="py-1.5 pr-4">{subject}</td>
                {decades.map((decade) => {
                  const points = item.points.filter((point) => point && point.year >= decade && point.year < decade + 10);
                  const count = points.reduce((sum, point) => sum + (point?.count ?? 0), 0);
                  const total = points.reduce((sum, point) => sum + (point?.totalCount ?? 0), 0);
                  const share = total > 0 ? count / total : null;
                  return (
                    <td className="plain-number py-1.5 pr-3 text-right" key={decade}>
                      {share === null ? "-" : formatShare(share)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pathsForPoints(
  points: SeriesPoint[],
  x: (year: number) => number,
  y: (share: number) => number,
  baseline: number,
) {
  let linePath = "";
  let areaPath = "";
  let segment: Array<{ px: number; py: number }> = [];

  const flush = () => {
    if (segment.length < 2) {
      segment = [];
      return;
    }
    linePath += `M${segment.map((point) => `${point.px},${point.py}`).join(" L")} `;
    areaPath += `M${segment[0].px},${baseline} L${segment.map((point) => `${point.px},${point.py}`).join(" L")} L${segment.at(-1)?.px},${baseline} Z `;
    segment = [];
  };

  for (const point of points) {
    if (!point) {
      flush();
      continue;
    }
    segment.push({ px: round1(x(point.year)), py: round1(y(point.share)) });
  }
  flush();

  return { linePath: linePath.trim() || null, areaPath: areaPath.trim() || null };
}

function shareAxisTicks(maxShare: number) {
  const step = maxShare <= 0.2 ? 0.05 : 0.1;
  const ticks: number[] = [];
  for (let tick = 0; tick <= maxShare + 1e-9; tick += step) ticks.push(Number(tick.toFixed(2)));
  return ticks;
}

function yearAxisTicks(minYear: number, maxYear: number) {
  const step = maxYear - minYear > 60 ? 20 : 10;
  const ticks: number[] = [];
  for (let year = Math.ceil(minYear / step) * step; year <= maxYear; year += step) ticks.push(year);
  return ticks;
}

function formatShare(share: number) {
  if (share === 0) return "0%";
  return `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function ControlGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className="segmented-control">{children}</div>
    </div>
  );
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`segment-button focus-ring ${active ? "segment-button-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
