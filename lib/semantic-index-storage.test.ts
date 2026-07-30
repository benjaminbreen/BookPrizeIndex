import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { filterBookCatalogRows, type BookCatalogQuery } from "@/lib/book-catalog-query";
import type { BrowseData } from "@/lib/browse-types";
import { readSemanticBookIndex } from "@/lib/semantic-index-storage";
import { semanticRowMatchesFilters } from "@/lib/semantic-search";

const root = process.cwd();

test("binary semantic vectors load and embedded filter metadata matches browse filtering", async () => {
  const [browse, index] = await Promise.all([
    fs.readFile(path.join(root, "data/public/browse.json"), "utf8").then((value) => JSON.parse(value) as BrowseData),
    readSemanticBookIndex(path.join(root, "data/public/book-semantic-index.json")),
  ]);
  assert.equal(index.books.length, browse.books.length);
  assert.equal(index.books[0]?.embedding.length, index.dimensions);
  assert.ok(index.books[0]?.embedding instanceof Float32Array);
  assert.equal(index.vectorProfile, "content-experience");
  assert.equal(index.books[0]?.experienceEmbedding?.length, index.dimensions);
  assert.ok(index.books[0]?.experienceEmbedding instanceof Float32Array);

  const queries: Array<Pick<BookCatalogQuery, "awardIds" | "metadata" | "publisherId" | "region" | "subject" | "topic">> = [
    ...(["us", "international", "all"] as const).flatMap((region) =>
      (["all", "complete", "missing", "has_cover", "missing_cover", "missing_publisher"] as const)
        .map((metadata) => ({ region, metadata }))),
    ...browse.books.slice(0, 30).flatMap((book) => [
      { region: "all" as const, awardIds: book.awardIds.slice(0, 2) },
      { region: "all" as const, publisherId: book.publisherId },
      { region: "all" as const, subject: book.subjects[0] },
      { region: "all" as const, topic: book.topics[0] },
    ]).filter((query) => Object.values(query).every(Boolean)),
  ];

  for (const query of queries) {
    const browseIds = filterBookCatalogRows(browse.books, query).map((row) => row.id).sort();
    const semanticIds = index.books.filter((row) => semanticRowMatchesFilters(row, query)).map((row) => row.bookId).sort();
    assert.deepEqual(semanticIds, browseIds, `Filter mismatch for ${JSON.stringify(query)}`);
  }
});
