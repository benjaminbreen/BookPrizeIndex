import type { BrowseBookRow } from "@/lib/browse-types";

export function sortBrowseBooksByRecognition(books: BrowseBookRow[]) {
  return [...books].sort(compareBrowseBookRecognition);
}

function compareBrowseBookRecognition(a: BrowseBookRow, b: BrowseBookRow) {
  return (
    b.score - a.score ||
    b.majorWins - a.majorWins ||
    b.majorShortlists - a.majorShortlists ||
    b.wins - a.wins ||
    b.lists - a.lists ||
    b.normalShortlists - a.normalShortlists ||
    b.majorLonglists - a.majorLonglists ||
    b.normalLonglists - a.normalLonglists ||
    (b.publicationYear ?? b.firstRecognitionYear ?? 0) - (a.publicationYear ?? a.firstRecognitionYear ?? 0) ||
    a.title.localeCompare(b.title)
  );
}
