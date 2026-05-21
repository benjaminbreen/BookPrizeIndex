import { ExplorerHome } from "@/components/explorer-home";
import { browseData } from "@/lib/browse-data";
import type { HomeBrowseData } from "@/components/explorer-home";
import { Suspense } from "react";

export default async function Home() {
  return (
    <Suspense fallback={null}>
      <ExplorerHome data={homeBrowseData} defaultRegion="all" />
    </Suspense>
  );
}

const homeBrowseData = {
  generatedAt: browseData.generatedAt,
  stats: browseData.stats,
  home: browseData.home,
  books: browseData.books
    .slice()
    .sort(compareHomeRecognition)
    .slice(0, 500)
    .map((book) => ({
      id: book.id,
      slug: book.slug,
      title: book.title,
      author: book.author,
      publicationYear: book.publicationYear,
      firstRecognitionYear: book.firstRecognitionYear,
      publisher: book.publisher,
      imprint: book.imprint,
      thumbnailUrl: book.thumbnailUrl,
      subjects: book.subjects,
      wins: book.wins,
      lists: book.lists,
      score: book.score,
      majorWins: book.majorWins,
      majorShortlists: book.majorShortlists,
      normalShortlists: book.normalShortlists,
      majorLonglists: book.majorLonglists,
      normalLonglists: book.normalLonglists,
      searchText: [
        book.title,
        book.author,
        book.publisher,
        book.imprint,
        book.primarySubject,
        ...book.subjects,
        ...book.topics,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    })),
} satisfies HomeBrowseData;

function compareHomeRecognition(a: (typeof browseData.books)[number], b: (typeof browseData.books)[number]) {
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
