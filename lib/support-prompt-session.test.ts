import assert from "node:assert/strict";
import test from "node:test";
import { recordDistinctBookView, SUPPORT_PROMPT_BOOK_THRESHOLD } from "./support-prompt-session";

test("counts distinct book records and reaches the prompt threshold on the tenth", () => {
  const viewedBooks = new Set<string>();

  for (let index = 1; index < SUPPORT_PROMPT_BOOK_THRESHOLD; index += 1) {
    const result = recordDistinctBookView(viewedBooks, `book-record-${index}`);
    assert.equal(result.added, true);
    assert.equal(result.count, index);
    assert.ok(result.count < SUPPORT_PROMPT_BOOK_THRESHOLD);
  }

  const thresholdResult = recordDistinctBookView(viewedBooks, "book-record-10");
  assert.deepEqual(thresholdResult, { added: true, count: SUPPORT_PROMPT_BOOK_THRESHOLD });
});

test("does not count the same book twice across a drawer id and normalized route id", () => {
  const viewedBooks = new Set<string>();
  const drawerBookId = "book-book-of-eels-patrik-svensson";
  const routeSlug = "book-of-eels-patrik-svensson";

  assert.deepEqual(recordDistinctBookView(viewedBooks, drawerBookId), { added: true, count: 1 });
  assert.deepEqual(recordDistinctBookView(viewedBooks, `book-${routeSlug}`), { added: false, count: 1 });
});

test("ignores empty book ids", () => {
  assert.deepEqual(recordDistinctBookView(new Set<string>(), "  "), { added: false, count: 0 });
});
