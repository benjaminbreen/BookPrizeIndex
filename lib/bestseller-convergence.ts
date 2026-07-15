import rawBestsellerData from "@/data/public/nyt-bestsellers.json";
import { booksById, data } from "./data";

type RawBestsellerData = {
  coverage: Array<{
    listName: string;
    displayName: string;
    startDate: string;
    endDate: string;
    snapshots: number;
  }>;
  appearances: Array<{
    bookId: string;
    publishedDate: string;
  }>;
};

export type BestsellerConvergencePoint = {
  year: number;
  share: number;
  bestsellerBooks: number;
  recognizedBooks: number;
  topBook?: {
    title: string;
    bestRank: number;
    weeksOnList: number;
  };
  crossoverBooks: Array<{
    title: string;
    bestRank: number;
    weeksOnList: number;
  }>;
};

export type BestsellerConvergenceSeries = {
  points: BestsellerConvergencePoint[];
};

export type BestsellerConvergenceData = {
  startYear: number;
  endYear: number;
  listLabel: string;
  coverageStart: string;
  coverageEnd: string;
  matchedBooks: number;
  all: BestsellerConvergenceSeries;
  winners: BestsellerConvergenceSeries;
};

type BookYear = {
  bookId: string;
  year: number;
  winner: boolean;
};

export function buildBestsellerConvergenceData(): BestsellerConvergenceData {
  const bestsellerData = rawBestsellerData as RawBestsellerData;
  const coverage = bestsellerData.coverage[0];
  if (!coverage) {
    return emptyData();
  }

  const coverageStartYear = Number(coverage.startDate.slice(0, 4));
  const coverageEndYear = Number(coverage.endDate.slice(0, 4));
  const currentYear = new Date().getFullYear();
  const coverageEndMonth = Number(coverage.endDate.slice(5, 7));
  const finalCompleteYear = coverageEndYear >= currentYear
    ? currentYear - 1
    : coverageEndMonth === 12 ? coverageEndYear : coverageEndYear - 1;
  const startYear = coverageStartYear + 1;
  const endYear = Math.min(finalCompleteYear, Math.max(...data.appearances.map((appearance) => appearance.year)));

  const bookYears = new Map<string, BookYear>();
  for (const appearance of data.appearances) {
    if (appearance.year < startYear || appearance.year > endYear) continue;
    const key = `${appearance.bookId}|${appearance.year}`;
    const existing = bookYears.get(key);
    const winner = appearance.status === "winner" || appearance.status === "co_winner";
    bookYears.set(key, {
      bookId: appearance.bookId,
      year: appearance.year,
      winner: winner || existing?.winner === true,
    });
  }

  const bestsellerYearsByBook = new Map<string, Set<number>>();
  for (const appearance of bestsellerData.appearances) {
    const years = bestsellerYearsByBook.get(appearance.bookId) ?? new Set<number>();
    years.add(Number(appearance.publishedDate.slice(0, 4)));
    bestsellerYearsByBook.set(appearance.bookId, years);
  }

  const rows = [...bookYears.values()];
  return {
    startYear,
    endYear,
    listLabel: coverage.displayName,
    coverageStart: coverage.startDate,
    coverageEnd: coverage.endDate,
    matchedBooks: bestsellerYearsByBook.size,
    all: buildSeries(rows, bestsellerYearsByBook, startYear, endYear, false),
    winners: buildSeries(rows, bestsellerYearsByBook, startYear, endYear, true),
  };
}

function buildSeries(
  rows: BookYear[],
  bestsellerYearsByBook: Map<string, Set<number>>,
  startYear: number,
  endYear: number,
  winnersOnly: boolean,
): BestsellerConvergenceSeries {
  const points: BestsellerConvergencePoint[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const recognized = rows.filter((row) => row.year === year && (!winnersOnly || row.winner));
    const crossoverBooks = recognized.filter((row) => {
      const years = bestsellerYearsByBook.get(row.bookId);
      return years?.has(row.year) || years?.has(row.year - 1);
    });
    const crossoverBookStats = crossoverBooks
      .map((row) => booksById.get(row.bookId))
      .filter((book) => book?.nytBestseller)
      .sort((left, right) => {
        const leftStats = left?.nytBestseller;
        const rightStats = right?.nytBestseller;
        return (rightStats?.weeksOnList ?? 0) - (leftStats?.weeksOnList ?? 0)
          || (leftStats?.bestRank ?? 99) - (rightStats?.bestRank ?? 99);
      })
      .map((book) => ({
        title: book?.title ?? "",
        bestRank: book?.nytBestseller?.bestRank ?? 0,
        weeksOnList: book?.nytBestseller?.weeksOnList ?? 0,
      }));
    const topBook = crossoverBookStats[0];
    const bestsellerBooks = crossoverBooks.length;
    points.push({
      year,
      share: recognized.length ? (bestsellerBooks / recognized.length) * 100 : 0,
      bestsellerBooks,
      recognizedBooks: recognized.length,
      crossoverBooks: crossoverBookStats,
      ...(topBook ? { topBook } : {}),
    });
  }
  return { points };
}

function emptyData(): BestsellerConvergenceData {
  return {
    startYear: 2009,
    endYear: 2009,
    listLabel: "Hardcover Nonfiction",
    coverageStart: "",
    coverageEnd: "",
    matchedBooks: 0,
    all: { points: [] },
    winners: { points: [] },
  };
}
