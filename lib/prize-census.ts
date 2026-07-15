import registryJson from "@/sources/prizes.json";
import type { PrizeRegistryEntry } from "@/lib/award-records";
import { awardsById, data } from "@/lib/data";

export type CensusPrize = {
  id: string;
  name: string;
  organization: string;
  geography: string;
  foundedYear: number;
  /** Final year the prize was awarded; undefined while the prize is still active. */
  finalYear?: number;
  dormantYears: Array<[number, number]>;
  /** Corpus coverage: first/last year with imported records, and how many. */
  firstRecordYear?: number;
  lastRecordYear?: number;
  recordCount: number;
};

export type CensusYear = {
  year: number;
  /** Prize programs active this year according to registry founding metadata. */
  active: number;
  /** Programs whose first edition was this year. */
  founded: string[];
  /** Programs whose final edition was this year. */
  discontinued: string[];
  /** Award appearances in the corpus dated to this year. */
  records: number;
};

export type PrizeCensus = {
  prizes: CensusPrize[];
  years: CensusYear[];
  currentYear: number;
};

const registry = registryJson as PrizeRegistryEntry[];

function isDormant(prize: Pick<CensusPrize, "dormantYears">, year: number) {
  return prize.dormantYears.some(([start, end]) => year >= start && year <= end);
}

export function buildPrizeCensus(): PrizeCensus {
  const recordStats = new Map<string, { first: number; last: number; count: number }>();
  const recordsByYear = new Map<number, number>();
  let maxRecordYear = 0;

  for (const appearance of data.appearances) {
    recordsByYear.set(appearance.year, (recordsByYear.get(appearance.year) ?? 0) + 1);
    maxRecordYear = Math.max(maxRecordYear, appearance.year);
    const award = awardsById.get(appearance.awardId);
    const programId = award?.programId;
    if (!programId) continue;
    const stat = recordStats.get(programId);
    if (!stat) {
      recordStats.set(programId, { first: appearance.year, last: appearance.year, count: 1 });
    } else {
      stat.first = Math.min(stat.first, appearance.year);
      stat.last = Math.max(stat.last, appearance.year);
      stat.count += 1;
    }
  }

  const prizes: CensusPrize[] = registry
    .filter((entry) => entry.foundedYear !== undefined)
    .map((entry) => {
      const stat = recordStats.get(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        organization: entry.organization,
        geography: entry.geography,
        foundedYear: entry.foundedYear as number,
        ...(entry.discontinuedYear !== undefined ? { finalYear: entry.discontinuedYear } : {}),
        dormantYears: entry.dormantYears ?? [],
        ...(stat ? { firstRecordYear: stat.first, lastRecordYear: stat.last } : {}),
        recordCount: stat?.count ?? 0,
      };
    })
    .sort((a, b) => a.foundedYear - b.foundedYear || a.name.localeCompare(b.name));

  const minYear = Math.min(...prizes.map((prize) => prize.foundedYear));
  const currentYear = Math.max(maxRecordYear, new Date().getFullYear());

  const years: CensusYear[] = [];
  for (let year = minYear; year <= currentYear; year += 1) {
    const active = prizes.filter(
      (prize) => year >= prize.foundedYear && year <= (prize.finalYear ?? currentYear) && !isDormant(prize, year),
    ).length;
    years.push({
      year,
      active,
      founded: prizes.filter((prize) => prize.foundedYear === year).map((prize) => prize.name),
      discontinued: prizes.filter((prize) => prize.finalYear === year).map((prize) => prize.name),
      records: recordsByYear.get(year) ?? 0,
    });
  }

  return { prizes, years, currentYear };
}
