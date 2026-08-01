import assert from "node:assert/strict";
import test from "node:test";
import { compareBrowseBookRecognition, sortBrowseBooksByRecognition } from "@/lib/browse-ranking";
import type { BrowseBookRow, BrowseBookRecognitionStats } from "@/lib/browse-types";

test("recognition ranking uses the selected region", () => {
  const internationalLeader = book("international", 5, 20);
  const usLeader = book("us", 20, 5);

  assert.equal(sortBrowseBooksByRecognition([internationalLeader, usLeader], "us")[0]?.id, "us");
  assert.equal(sortBrowseBooksByRecognition([internationalLeader, usLeader], "international")[0]?.id, "international");
});

test("recognition ties use one deterministic comparator", () => {
  const moreWins = book("more-wins", 20, 0, { wins: 3, majorShortlists: 0 });
  const moreShortlists = book("more-shortlists", 20, 0, { wins: 2, majorShortlists: 3 });

  assert.ok(compareBrowseBookRecognition(moreWins, moreShortlists, "all") < 0);
});

function book(
  id: string,
  usScore: number,
  internationalScore: number,
  allOverrides: Partial<BrowseBookRecognitionStats> = {},
): BrowseBookRow {
  const all = stats(Math.max(usScore, internationalScore), allOverrides);
  return {
    id,
    slug: id,
    title: id,
    author: "Author",
    authors: [{ id: "person-author", name: "Author", slug: "author" }],
    subjects: [],
    topics: [],
    awardIds: [],
    wins: all.wins,
    lists: all.lists,
    score: all.score,
    majorWins: all.majorWins,
    majorShortlists: all.majorShortlists,
    normalShortlists: all.normalShortlists,
    majorLonglists: all.majorLonglists,
    normalLonglists: all.normalLonglists,
    hasIsbn: false,
    hasPageCount: false,
    hasCover: false,
    hasSummary: false,
    hasPublisher: false,
    readableInEnglish: true,
    searchText: id,
    recognitionByRegion: {
      all,
      us: stats(usScore),
      international: stats(internationalScore),
    },
  };
}

function stats(score: number, overrides: Partial<BrowseBookRecognitionStats> = {}): BrowseBookRecognitionStats {
  return {
    awardIds: [],
    lists: score > 0 ? 1 : 0,
    majorLonglists: 0,
    majorShortlists: 0,
    majorWins: 0,
    normalLonglists: 0,
    normalShortlists: 0,
    score,
    wins: 0,
    ...overrides,
  };
}
