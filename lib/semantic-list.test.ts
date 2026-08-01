import assert from "node:assert/strict";
import test from "node:test";
import type { BrowseBookRow } from "@/lib/browse-types";
import {
  createSemanticListSnapshot,
  isSemanticListSnapshot,
  semanticListTitle,
  validateSemanticListDraft,
} from "@/lib/semantic-list";

const book: BrowseBookRow = {
  author: "Jane Author",
  authors: [{ id: "author-jane", name: "Jane Author", slug: "jane-author" }],
  awardIds: ["award-one"],
  hasCover: true,
  hasIsbn: true,
  hasPageCount: true,
  hasPublisher: true,
    readableInEnglish: true,
  hasSummary: true,
  id: "book-one",
  lists: 1,
  majorLonglists: 0,
  majorShortlists: 0,
  majorWins: 1,
  normalLonglists: 0,
  normalShortlists: 0,
  publicationYear: 2020,
  score: 4,
  searchText: "the test book jane author",
  slug: "the-test-book",
  subjects: ["History"],
  title: "The Test Book",
  topics: ["archives"],
  wins: 1,
};

test("semantic list drafts are bounded, deduplicated, and normalized", () => {
  const result = validateSemanticListDraft({
    query: "  books   about archives  ",
    filters: { region: "all" },
    interpretation: {
      expandedQuery: "Nonfiction about archives and historical evidence",
      concepts: ["archives"],
      eras: [],
      subjects: ["history"],
    },
    results: [
      { bookId: "book-one", score: 1.23456789 },
      { bookId: "book-one", score: 5 },
      { nope: true },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.query, "books about archives");
  assert.deepEqual(result.draft.results, [{ bookId: "book-one", score: 1.234568 }]);
});

test("snapshot ids are stable across creation times", () => {
  const validated = validateSemanticListDraft({
    query: "books about archives",
    filters: { region: "all" },
    interpretation: null,
    results: [{ bookId: "book-one", score: 1 }],
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const books = new Map([[book.id, book]]);
  const first = createSemanticListSnapshot(validated.draft, books, "2026-01-01T00:00:00.000Z");
  const second = createSemanticListSnapshot(validated.draft, books, "2026-07-01T00:00:00.000Z");
  assert.equal(first.id, second.id);
  assert.equal(isSemanticListSnapshot(first), true);
});

test("semantic list titles preserve the query while remaining bounded", () => {
  assert.equal(semanticListTitle("books Tyler Cowen might like?"), "Books Tyler Cowen might like");
  assert.ok(semanticListTitle("x".repeat(200)).length <= 120);
});
