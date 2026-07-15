import assert from "node:assert/strict";
import test from "node:test";
import type { RawAwardRecord } from "../../lib/award-records";
import { findRawRecordQualityIssues } from "./quality";

function record(overrides: Partial<RawAwardRecord> = {}): RawAwardRecord {
  return {
    awardId: "example-award",
    awardName: "Example Award",
    categoryId: "example-category",
    categoryName: "Nonfiction",
    year: 2025,
    status: "winner",
    title: "A Proper Book Title",
    authors: ["Ada Author"],
    sourceUrl: "https://example.org/awards/2025",
    sourceLabel: "Official archive",
    sourceConfidence: "official",
    ...overrides,
  };
}

test("accepts a clean source-backed record", () => {
  assert.deepEqual(findRawRecordQualityIssues([record()]), []);
});

test("rejects parser markup in titles and authors", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "A Book]]", authors: ['bgcolor="ffffdd" |Ada Author'] }),
  ]);
  assert.deepEqual(new Set(issues.map((issue) => issue.code)), new Set(["wiki_markup", "table_markup"]));
});

test("rejects placeholder titles and editorial notes in authors", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "(2 volumes)", authors: ["Ada Author. Accepting Award: An Editor"] }),
  ]);
  assert.deepEqual(new Set(issues.map((issue) => issue.code)), new Set(["placeholder_title", "author_note"]));
});

test("rejects a merged author/title pair", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "Bad Influence: How the Internet Hijacked Our Health and Fred Pearce for Despite It All: A Handbook for Climate Hopefuls" }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "merged_titles"));
});

test("does not confuse ordinary title grammar with a merged author/title pair", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "Unbroken: My Fight for Survival, Hope, and Justice for Indigenous Women and Girls" }),
  ]);
  assert.ok(!issues.some((issue) => issue.code === "merged_titles"));
});

test("does not confuse title clauses with merged author/title pairs", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "Begin Again: James Baldwin’s America and Its Urgent Lessons for Today" }),
  ]);
  assert.ok(!issues.some((issue) => issue.code === "merged_titles"));
});

test("rejects leaked publisher locations", () => {
  const issues = findRawRecordQualityIssues([
    record({ title: "Vancouver, for Missing Sarah: A Vancouver Woman Remembers Her Vanished Sister" }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "publisher_artifact"));
});

test("rejects truncated entities and empty contributor markers", () => {
  const issues = findRawRecordQualityIssues([
    record({ authors: ["H&auml", "Nikole Hannah-Jones ()"] }),
  ]);
  assert.deepEqual(new Set(issues.map((issue) => issue.code)), new Set(["broken_entity", "invalid_author"]));
});
