import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLibraryCallNumbers,
  isElectronicCallNumber,
  parseLibraryCallNumber,
  stableFilingKey,
} from "@/lib/library-call-number";

function parse(value: string) {
  const result = parseLibraryCallNumber(value);
  assert.equal(result.ok, true, `${value} should parse`);
  if (!result.ok) throw new Error(`${value} did not parse`);
  return result;
}

function sorted(values: string[]) {
  return values
    .map((value) => parse(value))
    .sort((a, b) => compareLibraryCallNumbers(a.parts, b.parts))
    .map((value) => value.normalized);
}

test("parses and normalizes common monograph call numbers", () => {
  const result = parse("  hv6322.7.P69   2003 ");
  assert.equal(result.normalized, "HV6322.7 .P69 2003");
  assert.equal(result.completeness, "full_call_number");
  assert.deepEqual(result.parts, {
    classLetters: "HV",
    classWholeNumber: 6322,
    classDecimalDigits: "7",
    cutters: [{ letters: "P", decimalDigits: "69" }],
    year: 2003,
    suffix: undefined,
    trailingTokens: undefined,
  });
});

test("cosmetic spacing variants normalize identically", () => {
  const values = [
    "HV6322.7.P69 2003",
    "HV6322.7 .P69 2003",
    "HV 6322.7 P69 2003",
  ];
  assert.deepEqual([...new Set(values.map((value) => parse(value).normalized))], ["HV6322.7 .P69 2003"]);
});

test("orders official G55 whole-number examples numerically", () => {
  const values = ["TH7414", "TH149", "TH1", "TH1096", "TH17", "TH915"];
  assert.deepEqual(sorted(values), ["TH1", "TH17", "TH149", "TH915", "TH1096", "TH7414"]);
});

test("orders official G55 decimal examples as decimals", () => {
  const values = ["QA76.65", "QA76.642", "QA76.64"];
  assert.deepEqual(sorted(values), ["QA76.64", "QA76.642", "QA76.65"]);
});

test("orders Cutter digits as decimals rather than integers", () => {
  const values = ["E185 .A2 2000", "E185 .A19 2000", "E185 .A11 2000"];
  assert.deepEqual(sorted(values), ["E185 .A11 2000", "E185 .A19 2000", "E185 .A2 2000"]);
});

test("supports multiple Cutters and dates", () => {
  const result = parse("HN670.3.Z9C6 2012");
  assert.equal(result.normalized, "HN670.3 .Z9 C6 2012");
  assert.deepEqual(result.parts.cutters, [
    { letters: "Z", decimalDigits: "9" },
    { letters: "C", decimalDigits: "6" },
  ]);
});

test("keeps partial classifications out of full-call-number coverage", () => {
  const result = parse("QH361");
  assert.equal(result.completeness, "classification_only");
  assert.equal(result.parts.cutters.length, 0);
});

test("recognizes electronic suffixes", () => {
  const result = parse("HC110.P6 E343 2015eb");
  assert.equal(result.normalized, "HC110 .P6 E343 2015eb");
  assert.equal(isElectronicCallNumber(result), true);
});

test("rejects unsupported and non-LCC values", () => {
  assert.equal(parseLibraryCallNumber("2004110229").ok, false);
  assert.equal(parseLibraryCallNumber("978-0-1234-5678-9").ok, false);
  assert.equal(parseLibraryCallNumber("not cataloged").ok, false);
});

test("stable filing keys ignore diacritics, punctuation, and hyphens", () => {
  assert.equal(stableFilingKey("Hände—El Paso"), "HANDE EL PASO");
});
