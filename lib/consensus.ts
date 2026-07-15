import { awardsById, data } from "@/lib/data";
import type { AwardAppearance } from "@/lib/types";

const WINDOW_SIZE = 5;

const PANEL = [
  { id: "pulitzer-prize", label: "Pulitzer" },
  { id: "national-book-awards", label: "National Book Awards" },
  { id: "national-book-critics-circle-awards", label: "NBCC" },
  { id: "los-angeles-times-book-prize", label: "Los Angeles Times" },
] as const;

export type ConsensusPoint = {
  year: number;
  overlap: number;
  sharedBooks: number;
};

export type ConsensusSeries = {
  points: ConsensusPoint[];
};

export type ConsensusData = {
  startYear: number;
  endYear: number;
  windowSize: number;
  programLabels: string[];
  all: ConsensusSeries;
  winners: ConsensusSeries;
};

type PanelAppearance = {
  appearance: AwardAppearance;
  programId: string;
};

export function buildConsensusData(): ConsensusData {
  const panelIds = new Set<string>(PANEL.map((program) => program.id));
  const rows: PanelAppearance[] = [];

  for (const appearance of data.appearances) {
    const award = awardsById.get(appearance.awardId);
    if (!award?.programId || !panelIds.has(award.programId)) continue;
    rows.push({ appearance, programId: award.programId });
  }

  const coverage = PANEL.map((program) => {
    const years = rows.filter((row) => row.programId === program.id).map((row) => row.appearance.year);
    return { first: Math.min(...years), last: Math.max(...years) };
  });
  const startYear = Math.max(...coverage.map((item) => item.first));
  const endYear = Math.min(...coverage.map((item) => item.last));

  return {
    startYear,
    endYear,
    windowSize: WINDOW_SIZE,
    programLabels: PANEL.map((program) => program.label),
    all: buildSeries(rows, startYear, endYear, false),
    winners: buildSeries(rows, startYear, endYear, true),
  };
}

function buildSeries(rows: PanelAppearance[], startYear: number, endYear: number, winnersOnly: boolean): ConsensusSeries {
  const qualifiedRows = rows.filter((row) => {
    if (row.appearance.year < startYear || row.appearance.year > endYear) return false;
    return !winnersOnly || isWinner(row.appearance.status);
  });
  const points: ConsensusPoint[] = [];

  for (let year = startYear + WINDOW_SIZE - 1; year <= endYear; year += 1) {
    const windowStart = year - WINDOW_SIZE + 1;
    const booksByProgram = new Map<string, Set<string>>(PANEL.map((program) => [program.id, new Set<string>()]));
    const programsByBook = new Map<string, Set<string>>();

    for (const row of qualifiedRows) {
      if (row.appearance.year < windowStart || row.appearance.year > year) continue;
      booksByProgram.get(row.programId)?.add(row.appearance.bookId);
      const programs = programsByBook.get(row.appearance.bookId) ?? new Set<string>();
      programs.add(row.programId);
      programsByBook.set(row.appearance.bookId, programs);
    }

    let overlapTotal = 0;
    let pairCount = 0;
    for (let left = 0; left < PANEL.length; left += 1) {
      for (let right = left + 1; right < PANEL.length; right += 1) {
        const leftBooks = booksByProgram.get(PANEL[left].id) ?? new Set<string>();
        const rightBooks = booksByProgram.get(PANEL[right].id) ?? new Set<string>();
        const smaller = leftBooks.size <= rightBooks.size ? leftBooks : rightBooks;
        const larger = smaller === leftBooks ? rightBooks : leftBooks;
        if (smaller.size === 0) continue;
        let shared = 0;
        for (const bookId of smaller) {
          if (larger.has(bookId)) shared += 1;
        }
        overlapTotal += shared / smaller.size;
        pairCount += 1;
      }
    }

    points.push({
      year,
      overlap: pairCount > 0 ? (overlapTotal / pairCount) * 100 : 0,
      sharedBooks: [...programsByBook.values()].filter((programs) => programs.size >= 2).length,
    });
  }

  return { points };
}

function isWinner(status: AwardAppearance["status"]) {
  return status === "winner" || status === "co_winner";
}
