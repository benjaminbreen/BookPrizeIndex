import type { AwardRegionFilter } from "@/lib/award-region";
import type { BrowseBookRecognitionStats, BrowseBookRow } from "@/lib/browse-types";

export type RecognitionRankableBook = Pick<
  BrowseBookRow,
  | "awardIds"
  | "firstRecognitionYear"
  | "lists"
  | "majorLonglists"
  | "majorShortlists"
  | "majorWins"
  | "normalLonglists"
  | "normalShortlists"
  | "publicationYear"
  | "recognitionByRegion"
  | "score"
  | "title"
  | "wins"
>;

export function sortBrowseBooksByRecognition(books: BrowseBookRow[], region: AwardRegionFilter = "all") {
  return [...books].sort((a, b) => compareBrowseBookRecognition(a, b, region));
}

export function compareBrowseBookRecognition(
  a: RecognitionRankableBook,
  b: RecognitionRankableBook,
  region: AwardRegionFilter = "all",
) {
  const aStats = bookRecognition(a, region);
  const bStats = bookRecognition(b, region);
  return (
    bStats.score - aStats.score ||
    bStats.majorWins - aStats.majorWins ||
    bStats.wins - aStats.wins ||
    bStats.majorShortlists - aStats.majorShortlists ||
    bStats.normalShortlists - aStats.normalShortlists ||
    bStats.majorLonglists - aStats.majorLonglists ||
    bStats.normalLonglists - aStats.normalLonglists ||
    (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

export function bookRecognition(
  book: RecognitionRankableBook,
  region: AwardRegionFilter,
): BrowseBookRecognitionStats {
  return book.recognitionByRegion?.[region] ?? {
    awardIds: book.awardIds,
    firstRecognitionYear: book.firstRecognitionYear,
    lists: book.lists,
    majorLonglists: book.majorLonglists,
    majorShortlists: book.majorShortlists,
    majorWins: book.majorWins,
    normalLonglists: book.normalLonglists,
    normalShortlists: book.normalShortlists,
    score: book.score,
    wins: book.wins,
  };
}
