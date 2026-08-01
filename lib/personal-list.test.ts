import assert from "node:assert/strict";
import test from "node:test";
import type { BrowseBookRow } from "@/lib/browse-types";
import {
  createPersonalListSnapshot,
  isPersonalListSnapshot,
  validatePersonalListDraft,
} from "@/lib/personal-list";
import { personalListMarkdown } from "@/lib/personal-list-markdown";

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
  primarySubject: "History",
  publicationYear: 2020,
  score: 4,
  searchText: "the test book jane author",
  slug: "the-test-book",
  subjects: ["History"],
  title: "The Test Book",
  topics: ["archives"],
  wins: 1,
};

test("personal list drafts normalize text, selection, and duplicates", () => {
  const result = validatePersonalListDraft({
    creatorName: "Jane Reader",
    introduction: "  A short note.\n\n\nWith two paragraphs.  ",
    results: [{ bookId: "book-one" }, { bookId: "book-one" }, { nope: true }],
    title: "  My   reading list ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.title, "My reading list");
  assert.equal(result.draft.introduction, "A short note.\n\nWith two paragraphs.");
  assert.deepEqual(result.draft.results, [{ bookId: "book-one" }]);
});

test("personal list ids are stable across creation times", () => {
  const validation = validatePersonalListDraft({
    creatorName: "Jane Reader",
    results: [{ bookId: "book-one" }],
    title: "A durable list",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  const books = new Map([[book.id, book]]);
  const first = createPersonalListSnapshot(validation.draft, books, "2026-01-01T00:00:00.000Z");
  const second = createPersonalListSnapshot(validation.draft, books, "2026-07-01T00:00:00.000Z");
  assert.equal(first.id, second.id);
  assert.equal(isPersonalListSnapshot(first), true);
});

test("personal list markdown includes introduction and absolute book links", () => {
  const validation = validatePersonalListDraft({
    creatorName: "Jane Reader",
    introduction: "For an autumn seminar.",
    results: [{ bookId: "book-one" }],
    title: "Course books",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  const snapshot = createPersonalListSnapshot(validation.draft, new Map([[book.id, book]]));
  const markdown = personalListMarkdown(snapshot, "https://bookprizeindex.org");
  assert.match(markdown, /^# Course books/m);
  assert.match(markdown, /By Jane Reader/);
  assert.match(markdown, /For an autumn seminar\./);
  assert.match(markdown, /https:\/\/bookprizeindex\.org\/books\/the-test-book/);
});
