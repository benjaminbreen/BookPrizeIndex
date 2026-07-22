import { ExplorerHome } from "@/components/explorer-home";
import { browseData } from "@/lib/browse-data";
import { compareBrowseBookRecognition } from "@/lib/browse-ranking";
import type { HomeBrowseData } from "@/components/explorer-home";
import { Suspense } from "react";

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  return (
    <Suspense fallback={null}>
      <ExplorerHome data={homeBrowseData} defaultRegion="all" />
    </Suspense>
  );
}

const homeBookCandidates = [...new Map(
  (["all", "us", "international"] as const)
    .flatMap((region) => browseData.books
      .slice()
      .sort((a, b) => compareBrowseBookRecognition(a, b, region))
      .slice(0, 500))
    .map((book) => [book.id, book]),
).values()];

const homeBrowseData = {
  generatedAt: browseData.generatedAt,
  stats: browseData.stats,
  home: browseData.home,
  books: homeBookCandidates
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
      awardIds: book.awardIds,
      wins: book.wins,
      lists: book.lists,
      score: book.score,
      majorWins: book.majorWins,
      majorShortlists: book.majorShortlists,
      normalShortlists: book.normalShortlists,
      majorLonglists: book.majorLonglists,
      normalLonglists: book.normalLonglists,
      recognitionByRegion: book.recognitionByRegion,
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
