import type { Book, BookStats } from "../lib/types";

export type CatalogMissingBookField =
  | "isbn13"
  | "publicationYear"
  | "publisherId"
  | "imprintId"
  | "pageCount"
  | "summary"
  | "thumbnailUrl"
  | "publisherLink";

export type DeferredMissingBookField = "wikipedia";

export type EnrichmentLane =
  | "high_value"
  | "identity_needed"
  | "cover_needed"
  | "summary_needed"
  | "imprint_only"
  | "catalog_completion"
  | "low_confidence_review";

export type EnrichmentAttemptStatus = "enriched" | "no_missing_fields" | "no_new_fields" | "not_found" | "low_confidence" | "error";

export type EnrichmentAttemptLike = {
  status?: EnrichmentAttemptStatus;
  missingFields?: CatalogMissingBookField[];
};

const laneRank: Record<EnrichmentLane, number> = {
  high_value: 0,
  identity_needed: 1,
  cover_needed: 2,
  summary_needed: 3,
  catalog_completion: 4,
  imprint_only: 5,
  low_confidence_review: 6,
};

export function catalogMissingFieldsForBook(book: Book): CatalogMissingBookField[] {
  const fields: CatalogMissingBookField[] = [];
  if (!book.isbn13.length) fields.push("isbn13");
  if (!book.publicationYear) fields.push("publicationYear");
  if (!book.publisherId) fields.push("publisherId");
  if (!book.imprintId) fields.push("imprintId");
  if (!book.pageCount) fields.push("pageCount");
  if (!book.summary) fields.push("summary");
  if (!book.thumbnailUrl) fields.push("thumbnailUrl");
  if (!book.links.publisher) fields.push("publisherLink");
  return fields;
}

export function deferredMissingFieldsForBook(book: Book): DeferredMissingBookField[] {
  return book.links.wikipedia ? [] : ["wikipedia"];
}

export function missingFieldsForSelection(book: Book, fields: Set<CatalogMissingBookField> | undefined) {
  const missing = catalogMissingFieldsForBook(book);
  return fields?.size ? missing.filter((field) => fields.has(field)) : missing;
}

export function enrichmentLaneForBook(
  book: Book,
  stats: BookStats,
  attempt?: EnrichmentAttemptLike,
): EnrichmentLane {
  const missing = catalogMissingFieldsForBook(book);
  if (!missing.length) return "catalog_completion";
  if (isUnproductiveAttempt(attempt) && sameMissingFields(attempt?.missingFields, missing)) return "low_confidence_review";
  if (missing.every((field) => field === "imprintId")) return "imprint_only";
  if (isHighValueBook(stats)) return "high_value";
  if (missing.some((field) => field === "isbn13" || field === "publicationYear" || field === "publisherId" || field === "publisherLink")) {
    return "identity_needed";
  }
  if (missing.includes("thumbnailUrl")) return "cover_needed";
  if (missing.includes("summary")) return "summary_needed";
  return "catalog_completion";
}

export function enrichmentPriorityScore(book: Book, stats: BookStats, lane: EnrichmentLane) {
  const missing = catalogMissingFieldsForBook(book);
  const recencyBoost = book.publicationYear ? Math.max(0, book.publicationYear - 1990) / 10 : 0;
  const missingBoost = missing.filter((field) => field !== "imprintId").length * 2;
  const highValueBoost = stats.majorWins * 25 + stats.wins * 12 + stats.majorShortlists * 6 + stats.score;
  const laneBoost = (Object.keys(laneRank).length - laneRank[lane]) * 3;
  return Number((highValueBoost + missingBoost + recencyBoost + laneBoost).toFixed(2));
}

export function compareEnrichmentPriority(
  a: { title: string; lane: EnrichmentLane; priorityScore: number; missingFields: CatalogMissingBookField[]; score: number },
  b: { title: string; lane: EnrichmentLane; priorityScore: number; missingFields: CatalogMissingBookField[]; score: number },
) {
  return (
    laneRank[a.lane] - laneRank[b.lane] ||
    b.priorityScore - a.priorityScore ||
    b.score - a.score ||
    b.missingFields.length - a.missingFields.length ||
    a.title.localeCompare(b.title)
  );
}

export function isUnproductiveAttempt(attempt: EnrichmentAttemptLike | undefined) {
  return Boolean(attempt?.status && ["low_confidence", "not_found", "no_new_fields", "error"].includes(attempt.status));
}

export function sameMissingFields(a: CatalogMissingBookField[] | undefined, b: CatalogMissingBookField[]) {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

export function parseMissingFieldSet(value: string | undefined): Set<CatalogMissingBookField> | undefined {
  if (!value) return undefined;
  const allowed: CatalogMissingBookField[] = [
    "isbn13",
    "publicationYear",
    "publisherId",
    "imprintId",
    "pageCount",
    "summary",
    "thumbnailUrl",
    "publisherLink",
  ];
  const allowedSet = new Set(allowed);
  const fields = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const field of fields) {
    if (!allowedSet.has(field as CatalogMissingBookField)) {
      throw new Error(`Unknown enrichment field "${field}". Expected one of: ${allowed.join(", ")}`);
    }
  }
  return new Set(fields as CatalogMissingBookField[]);
}

export function parseLane(value: string | undefined): EnrichmentLane | undefined {
  if (!value) return undefined;
  if (!(value in laneRank)) {
    throw new Error(`Unknown enrichment lane "${value}". Expected one of: ${Object.keys(laneRank).join(", ")}`);
  }
  return value as EnrichmentLane;
}

function isHighValueBook(stats: BookStats) {
  return stats.majorWins > 0 || stats.wins > 0 || stats.majorShortlists > 0 || stats.score >= 12;
}
