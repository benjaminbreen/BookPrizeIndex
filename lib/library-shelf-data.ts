import rawShelf from "@/data/public/library-shelf.json";
import type {
  LibraryShelfArtifact,
  LibraryShelfNeighborhood,
  LibraryShelfWindow,
} from "@/lib/library-shelf-types";
import { stableFilingKey } from "@/lib/library-call-number";

export const libraryShelf = rawShelf as LibraryShelfArtifact;

const positionByBookId = new Map(libraryShelf.rows.map((row, index) => [row.id, index]));
const positionBySlug = new Map(libraryShelf.rows.map((row, index) => [row.slug, index]));

export function libraryShelfNeighborhoodFor(bookId: string, radius = 3): LibraryShelfNeighborhood | undefined {
  const position = positionByBookId.get(bookId);
  if (position === undefined) return undefined;
  return {
    selected: libraryShelf.rows[position],
    before: libraryShelf.rows.slice(Math.max(0, position - radius), position),
    after: libraryShelf.rows.slice(position + 1, Math.min(libraryShelf.rows.length, position + radius + 1)),
    position,
    total: libraryShelf.rows.length,
  };
}

export function getLibraryShelfWindow({
  book,
  classCode,
  index,
  query,
  radius = 15,
}: {
  book?: string;
  classCode?: string;
  index?: number;
  query?: string;
  radius?: number;
} = {}): LibraryShelfWindow {
  const safeRadius = Math.max(3, Math.min(30, Math.round(radius)));
  const normalizedQuery = stableFilingKey(query ?? "");
  const matches = normalizedQuery
    ? libraryShelf.rows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(({ row }) => stableFilingKey(`${row.title} ${row.author} ${row.callNumber}`).includes(normalizedQuery))
    : [];
  const requestedPosition = book
    ? positionBySlug.get(book) ?? positionByBookId.get(book)
    : undefined;
  const classPosition = classCode
    ? libraryShelf.classes.find((row) => row.code === classCode.toUpperCase())?.startIndex
    : undefined;
  const defaultPosition = libraryShelf.classes.find((row) => row.code === "H")?.startIndex ?? 0;
  const selectedIndex = clamp(
    requestedPosition ?? matches[0]?.rowIndex ?? classPosition ?? index ?? defaultPosition,
    0,
    Math.max(libraryShelf.rows.length - 1, 0),
  );
  const windowStart = Math.max(0, selectedIndex - safeRadius);
  const windowEnd = Math.min(libraryShelf.rows.length - 1, selectedIndex + safeRadius);
  return {
    generatedAt: libraryShelf.generatedAt,
    stats: libraryShelf.stats,
    classes: libraryShelf.classes,
    selectedIndex,
    windowStart,
    windowEnd,
    rows: libraryShelf.rows.slice(windowStart, windowEnd + 1),
    query: query?.trim() || undefined,
    matchCount: normalizedQuery ? matches.length : undefined,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
