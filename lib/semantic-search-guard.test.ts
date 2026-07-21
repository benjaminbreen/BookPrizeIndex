import assert from "node:assert/strict";
import test from "node:test";
import {
  createSemanticSearchGuard,
  semanticSearchEnabled,
  semanticSearchGuardConfig,
} from "./semantic-search-guard";

test("enforces a fixed request budget and reports the reset delay", () => {
  const guard = createSemanticSearchGuard({ maxConcurrent: 2, maxRequestsPerWindow: 2, windowMs: 1_000 });
  const first = guard.acquire(1_000);
  assert.equal(first.allowed, true);
  if (first.allowed) first.release();

  const second = guard.acquire(1_100);
  assert.equal(second.allowed, true);
  if (second.allowed) second.release();

  const denied = guard.acquire(1_200);
  assert.deepEqual(denied, {
    allowed: false,
    limit: 2,
    reason: "rate",
    remaining: 0,
    retryAfterSeconds: 1,
  });

  const afterReset = guard.acquire(2_000);
  assert.equal(afterReset.allowed, true);
});

test("caps concurrent provider work without storing client identifiers", () => {
  const guard = createSemanticSearchGuard({ maxConcurrent: 1, maxRequestsPerWindow: 5, windowMs: 1_000 });
  const first = guard.acquire(1_000);
  assert.equal(first.allowed, true);

  const busy = guard.acquire(1_001);
  assert.deepEqual(busy, {
    allowed: false,
    limit: 5,
    reason: "concurrency",
    remaining: 4,
    retryAfterSeconds: 2,
  });

  if (first.allowed) {
    first.release();
    first.release();
  }
  assert.equal(guard.acquire(1_002).allowed, true);
});

test("uses bounded environment configuration and supports a kill switch", () => {
  assert.deepEqual(
    semanticSearchGuardConfig({
      SEMANTIC_SEARCH_MAX_CONCURRENT: "500",
      SEMANTIC_SEARCH_REQUESTS_PER_MINUTE: "0",
    }),
    { maxConcurrent: 20, maxRequestsPerWindow: 1, windowMs: 60_000 },
  );
  assert.equal(semanticSearchEnabled({ SEMANTIC_SEARCH_ENABLED: "false" }), false);
  assert.equal(semanticSearchEnabled({ SEMANTIC_SEARCH_ENABLED: "true" }), true);
});
