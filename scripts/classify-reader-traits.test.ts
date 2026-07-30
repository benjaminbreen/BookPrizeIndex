import assert from "node:assert/strict";
import test from "node:test";
import type { Book } from "../lib/types";
import { classifyBook } from "./classify-reader-traits";

const allowed = new Set([
  "accessible",
  "character_driven",
  "literary",
  "narrative",
  "popular",
  "reported",
]);

function testBook(summary: string): Book {
  return {
    id: "book-reader-trait-test",
    slug: "reader-trait-test",
    title: "Reader Trait Test",
    authors: [{ id: "author-test", name: "Author Test" }],
    isbn13: [],
    subjects: [],
    topics: [],
    centralFigures: [],
    summary,
    links: {},
    sourceIds: [],
  };
}

test("following a defined group supplies conservative reported and narrative evidence", () => {
  const profile = classifyBook(
    testBook("A sociologist follows eight families through a year of housing insecurity."),
    allowed,
  );
  const traits = new Set(profile.traits.map((trait) => trait.id));
  assert.ok(traits.has("reported"));
  assert.ok(traits.has("character_driven"));
  assert.ok(traits.has("narrative"));
});

test("explicit prose descriptions supply literary evidence", () => {
  const profile = classifyBook(
    testBook("A beautifully written investigation praised for its lyrical and elegant prose."),
    allowed,
  );
  const traits = new Set(profile.traits.map((trait) => trait.id));
  assert.ok(traits.has("literary"));
  assert.ok(traits.has("reported"));
});
