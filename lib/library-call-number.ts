import type { LibraryCallNumberSortParts } from "@/lib/types";

export type LibraryCallNumberParseResult =
  | {
      ok: true;
      raw: string;
      normalized: string;
      completeness: "full_call_number" | "classification_only";
      parts: LibraryCallNumberSortParts;
      warnings: string[];
    }
  | {
      ok: false;
      raw: string;
      normalized: string;
      reason: string;
    };

const BASE_PATTERN = /^([A-Z]{1,3})\s*(\d{1,4})(?:\s*\.\s*(\d+))?(.*)$/;
const CUTTER_PATTERN = /^\s*\.?\s*([A-Z]{1,3})\s*(\d+(?:\.\d+)?)/;
const YEAR_PATTERN = /^\s+(\d{4})([A-Z]{0,3})\b/i;
const KNOWN_TRAILING_PATTERN = /^(?:\s+|[,;/:-]+)*(V\.?\s*\d+|VOL\.?\s*\d+|PT\.?\s*\d+|NO\.?\s*\d+|C\.?\s*\d+|COPY\s*\d+)$/i;

export function parseLibraryCallNumber(raw: string): LibraryCallNumberParseResult {
  const normalizedInput = normalizeInput(raw);
  const base = BASE_PATTERN.exec(normalizedInput);
  if (!base) {
    return { ok: false, raw, normalized: normalizedInput, reason: "unsupported_base_pattern" };
  }

  const classLetters = base[1];
  const classWholeNumber = Number(base[2]);
  const classDecimalDigits = normalizeDigitSequence(base[3]);
  let rest = base[4] ?? "";
  const cutters: LibraryCallNumberSortParts["cutters"] = [];
  const warnings: string[] = [];

  while (rest.trim()) {
    const year = YEAR_PATTERN.exec(rest);
    if (year) {
      const parsedYear = Number(year[1]);
      const suffix = year[2]?.toLowerCase() || undefined;
      rest = rest.slice(year[0].length);
      const trailing = rest.trim();
      const trailingTokens = trailing ? parseKnownTrailingTokens(trailing) : undefined;
      if (trailing && !trailingTokens) {
        return {
          ok: false,
          raw,
          normalized: normalizedInput,
          reason: `unsupported_trailing_tokens:${trailing}`,
        };
      }
      const parts: LibraryCallNumberSortParts = {
        classLetters,
        classWholeNumber,
        classDecimalDigits,
        cutters,
        year: parsedYear,
        suffix,
        trailingTokens,
      };
      if (suffix === "eb" || suffix === "ebook") warnings.push("electronic_suffix");
      return successResult(raw, parts, warnings);
    }

    const cutter = CUTTER_PATTERN.exec(rest);
    if (!cutter) {
      const trailing = rest.trim();
      const trailingTokens = parseKnownTrailingTokens(trailing);
      if (!trailingTokens) {
        return {
          ok: false,
          raw,
          normalized: normalizedInput,
          reason: `unsupported_component:${trailing}`,
        };
      }
      return successResult(raw, {
        classLetters,
        classWholeNumber,
        classDecimalDigits,
        cutters,
        trailingTokens,
      }, warnings);
    }
    cutters.push({
      letters: cutter[1],
      decimalDigits: normalizeCutterDigits(cutter[2]),
    });
    rest = rest.slice(cutter[0].length);
  }

  return successResult(raw, {
    classLetters,
    classWholeNumber,
    classDecimalDigits,
    cutters,
  }, warnings);
}

export function normalizeLibraryCallNumber(raw: string) {
  const parsed = parseLibraryCallNumber(raw);
  return parsed.ok ? parsed.normalized : parsed.normalized;
}

export function compareLibraryCallNumbers(a: LibraryCallNumberSortParts, b: LibraryCallNumberSortParts) {
  return (
    asciiCompare(a.classLetters, b.classLetters) ||
    a.classWholeNumber - b.classWholeNumber ||
    compareDecimalDigits(a.classDecimalDigits, b.classDecimalDigits) ||
    compareCutters(a.cutters, b.cutters) ||
    compareOptionalNumber(a.year, b.year) ||
    asciiCompare(a.suffix ?? "", b.suffix ?? "") ||
    compareStringArrays(a.trailingTokens ?? [], b.trailingTokens ?? [])
  );
}

export function mainClassForCallNumber(parts: LibraryCallNumberSortParts) {
  return parts.classLetters.charAt(0);
}

export function subclassForCallNumber(parts: LibraryCallNumberSortParts) {
  return parts.classLetters;
}

export function isElectronicCallNumber(result: LibraryCallNumberParseResult) {
  if (!result.ok) return false;
  if (result.warnings.includes("electronic_suffix")) return true;
  return result.parts.trailingTokens?.some((token) => /\b(?:EB|EBOOK|E-BOOK|ELECTRONIC)\b/i.test(token)) ?? false;
}

export function stableFilingKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function successResult(
  raw: string,
  parts: LibraryCallNumberSortParts,
  warnings: string[],
): Extract<LibraryCallNumberParseResult, { ok: true }> {
  return {
    ok: true,
    raw,
    normalized: formatLibraryCallNumber(parts),
    completeness: parts.cutters.length ? "full_call_number" : "classification_only",
    parts,
    warnings,
  };
}

function formatLibraryCallNumber(parts: LibraryCallNumberSortParts) {
  let output = `${parts.classLetters}${parts.classWholeNumber}`;
  if (parts.classDecimalDigits) output += `.${parts.classDecimalDigits}`;
  parts.cutters.forEach((cutter, index) => {
    output += `${index === 0 ? " ." : " "}${cutter.letters}${cutter.decimalDigits}`;
  });
  if (parts.year) output += ` ${parts.year}${parts.suffix ?? ""}`;
  if (parts.trailingTokens?.length) output += ` ${parts.trailingTokens.join(" ")}`;
  return output;
}

function normalizeInput(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[\u00a0\t\r\n]+/g, " ")
    .replace(/^\s*[\[(]+|[\])]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeDigitSequence(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/^0+(?=\d)/, "").replace(/0+$/, "");
  return normalized || "0";
}

function normalizeCutterDigits(value: string) {
  return value.replace(/\./g, "").replace(/^0+(?=\d)/, "") || "0";
}

function parseKnownTrailingTokens(value: string) {
  if (!value) return undefined;
  if (!KNOWN_TRAILING_PATTERN.test(value)) return undefined;
  return [value.replace(/\s+/g, " ").trim().toUpperCase()];
}

function compareCutters(
  a: LibraryCallNumberSortParts["cutters"],
  b: LibraryCallNumberSortParts["cutters"],
) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left) return -1;
    if (!right) return 1;
    const compared = asciiCompare(left.letters, right.letters) || compareDecimalDigits(left.decimalDigits, right.decimalDigits);
    if (compared) return compared;
  }
  return 0;
}

function compareDecimalDigits(a: string | undefined, b: string | undefined) {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  const length = Math.max(a.length, b.length);
  return asciiCompare(a.padEnd(length, "0"), b.padEnd(length, "0"));
}

function compareOptionalNumber(a: number | undefined, b: number | undefined) {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a - b;
}

function compareStringArrays(a: string[], b: string[]) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] === b[index]) continue;
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    return asciiCompare(a[index], b[index]);
  }
  return 0;
}

function asciiCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
