import assert from "node:assert/strict";
import test from "node:test";
import rawShelf from "@/data/public/library-shelf.json";
import { compareLibraryCallNumbers, parseLibraryCallNumber } from "@/lib/library-call-number";
import { getLibraryShelfWindow } from "@/lib/library-shelf-data";
import type { LibraryShelfArtifact } from "@/lib/library-shelf-types";

const shelf = rawShelf as LibraryShelfArtifact;

test("the shelf artifact has internally consistent coverage totals", () => {
  assert.equal(shelf.rows.length, shelf.stats.shelfBooks);
  assert.equal(
    shelf.stats.highConfidence + shelf.stats.mediumConfidence,
    shelf.stats.shelfBooks,
  );
  assert.equal(new Set(shelf.rows.map((row) => row.id)).size, shelf.rows.length);
  assert.equal(new Set(shelf.rows.map((row) => row.slug)).size, shelf.rows.length);
});

test("every public shelf row has a complete parseable call number and provenance", () => {
  for (const row of shelf.rows) {
    const parsed = parseLibraryCallNumber(row.callNumber);
    assert.equal(parsed.ok, true, `${row.id}: ${row.callNumber}`);
    if (!parsed.ok) continue;
    assert.equal(parsed.completeness, "full_call_number", `${row.id}: ${row.callNumber}`);
    assert.equal(parsed.parts.classLetters.charAt(0), row.mainClass);
    assert.ok(row.sourceId, `${row.id} should retain a source ID`);
  }
});

test("rows are in structured Library of Congress filing order", () => {
  for (let index = 1; index < shelf.rows.length; index += 1) {
    const previous = parseLibraryCallNumber(shelf.rows[index - 1].callNumber);
    const current = parseLibraryCallNumber(shelf.rows[index].callNumber);
    assert.equal(previous.ok, true);
    assert.equal(current.ok, true);
    if (!previous.ok || !current.ok) continue;
    assert.ok(
      compareLibraryCallNumbers(previous.parts, current.parts) <= 0,
      `${shelf.rows[index - 1].callNumber} should file before ${shelf.rows[index].callNumber}`,
    );
  }
});

test("class ranges are contiguous and cover every shelf row", () => {
  let expectedStart = 0;
  let covered = 0;
  for (const shelfClass of shelf.classes) {
    assert.equal(shelfClass.startIndex, expectedStart);
    assert.equal(shelfClass.endIndex - shelfClass.startIndex + 1, shelfClass.count);
    for (let index = shelfClass.startIndex; index <= shelfClass.endIndex; index += 1) {
      assert.equal(shelf.rows[index].mainClass, shelfClass.code);
    }
    expectedStart = shelfClass.endIndex + 1;
    covered += shelfClass.count;
  }
  assert.equal(covered, shelf.rows.length);
});

test("a clean shelf visit begins at the natural start of shelf order", () => {
  const window = getLibraryShelfWindow();
  assert.equal(window.selectedIndex, 0);
  assert.equal(window.rows[0].id, shelf.rows[0].id);
});
