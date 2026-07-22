import fs from "node:fs";
import path from "node:path";
import type { BookStats, PublicData } from "../../lib/types";
import { cacheDataDir } from "./paths";
import { FULL_CATALOG_CACHE_FILENAME } from "./public-catalog-artifacts";

const catalogPath = path.join(cacheDataDir, FULL_CATALOG_CACHE_FILENAME);

export const data = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as PublicData;
export const statsByBookId = new Map(data.stats.map((row) => [row.bookId, row]));
export const publishersById = new Map(data.publishers.map((row) => [row.id, row]));
export const imprintsById = new Map(data.imprints.map((row) => [row.id, row]));
export const sourcesById = new Map(data.sources.map((row) => [row.id, row]));
export const appearancesByBookId = groupBy(data.appearances, (row) => row.bookId);

export function getBookStats(bookId: string): BookStats {
  return statsByBookId.get(bookId) ?? {
    bookId,
    wins: 0,
    lists: 0,
    score: 0,
    majorWins: 0,
    normalWins: 0,
    majorShortlists: 0,
    normalShortlists: 0,
    majorLonglists: 0,
    normalLonglists: 0,
    statuses: {
      winner: 0,
      co_winner: 0,
      finalist: 0,
      shortlist: 0,
      longlist: 0,
      honorable_mention: 0,
      commended: 0,
      notable: 0,
      unknown: 0,
    },
  };
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }
  return grouped;
}
