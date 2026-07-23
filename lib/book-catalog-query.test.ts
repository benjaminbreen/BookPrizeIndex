import assert from "node:assert/strict";
import test from "node:test";
import { queryBookCatalog } from "@/lib/book-catalog-query";
import { browseData } from "@/lib/browse-data";

test("every award filter option resolves to books in the generated browse catalog", () => {
  for (const award of browseData.awards) {
    assert.ok(award.awardIds.length > 0, `${award.name} has no underlying award IDs`);

    const result = queryBookCatalog(browseData.books, {
      awardIds: award.awardIds,
      pageSize: 1,
      region: "all",
    });

    assert.ok(result.total > 0, `${award.name} returned no books`);
  }
});

test("a grouped prize filter matches any of its constituent award categories", () => {
  const pulitzer = browseData.awards.find((award) => award.id === "program-pulitzer-prize");
  assert.ok(pulitzer);
  assert.ok(pulitzer.awardIds.length > 1);

  const expectedBookIds = new Set(
    browseData.books
      .filter((book) => pulitzer.awardIds.some((awardId) => book.recognitionByRegion?.all.awardIds.includes(awardId)))
      .map((book) => book.id),
  );
  const result = queryBookCatalog(browseData.books, {
    awardIds: pulitzer.awardIds,
    pageSize: 100,
    region: "all",
  });

  assert.equal(result.total, expectedBookIds.size);
});
