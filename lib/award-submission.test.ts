import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAwardSubmission } from "./award-submission";

const verifiedOn = "2026-05-08";

test("an unsourced award reads as unknown and sorts last", () => {
  const display = describeAwardSubmission(undefined, "2026-07-30");
  assert.equal(display.label, "Not yet sourced");
  assert.equal(display.tone, "unknown");
  assert.equal(display.sortKey, "9999-12-31");
});

test("a confirmed future close date is exact", () => {
  const display = describeAwardSubmission({ route: "publisher", nextCloseDate: "2026-10-15", closesOn: "10-15", verifiedOn }, "2026-07-30");
  assert.equal(display.label, "Closes 15 Oct 2026");
  assert.equal(display.detail, "in about 3 months");
  assert.equal(display.approximate, false);
  assert.equal(display.sortKey, "2026-10-15");
});

test("a close date within the alert window reads as closing", () => {
  const display = describeAwardSubmission({ route: "publisher", nextCloseDate: "2026-08-10", verifiedOn }, "2026-07-30");
  assert.equal(display.tone, "closing");
  assert.equal(display.detail, "in 11 days");
});

test("a passed cycle rolls forward to the recurring rule", () => {
  const display = describeAwardSubmission({ route: "publisher", nextCloseDate: "2026-02-27", closesOn: "02-27", verifiedOn }, "2026-07-30");
  assert.equal(display.label, "~Closes 27 Feb 2027");
  assert.equal(display.approximate, true);
  assert.equal(display.detail, "annual cycle");
});

test("a passed cycle with no recurring rule falls back to the confirmed date's month and day", () => {
  const display = describeAwardSubmission({ route: "publisher", nextCloseDate: "2025-11-10", verifiedOn }, "2026-07-30");
  assert.equal(display.label, "~Closes 10 Nov 2026");
  assert.equal(display.approximate, true);
});

test("an upcoming open date is surfaced instead of a countdown", () => {
  const display = describeAwardSubmission({ route: "publisher", opensOn: "09-22", closesOn: "11-10", verifiedOn }, "2026-07-30");
  assert.equal(display.label, "~Closes 10 Nov 2026");
  assert.equal(display.detail, "Opens ~22 Sep 2026");
  assert.equal(display.tone, "open");
});

test("committee-selected prizes never show a deadline and sort after dated prizes", () => {
  const display = describeAwardSubmission({ route: "committee", note: "Judges select from the field.", verifiedOn }, "2026-07-30");
  assert.equal(display.label, "No open call");
  assert.equal(display.tone, "passive");
  assert.ok(display.sortKey > "2027-12-31");
});

test("entries verified over a year ago are flagged stale", () => {
  const display = describeAwardSubmission({ route: "publisher", closesOn: "11-10", verifiedOn: "2024-01-01" }, "2026-07-30");
  assert.equal(display.stale, true);
});
