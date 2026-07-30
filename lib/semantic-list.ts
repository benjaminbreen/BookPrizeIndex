import { createHash } from "node:crypto";
import type { AwardRegionFilter } from "@/lib/award-region";
import type { BrowseBookRow } from "@/lib/browse-types";
import type { BookCatalogMetadataFilter } from "@/lib/book-catalog-query";
import type { SemanticQueryInterpretation } from "@/lib/semantic-search";

export const SEMANTIC_LIST_VERSION = 1;
export const MAX_SEMANTIC_LIST_RESULTS = 500;

export type SemanticListDiagnostics = {
  candidateBookCount?: number;
  embeddingModel?: string;
  indexGeneratedAt?: string;
  interpretationModel?: string;
  queryExpansionModel?: string;
  retrievalMode?: "expanded" | "direct";
  resultCount?: number;
  usedModelInterpretation?: boolean;
};

export type SemanticListFilters = {
  awardIds?: string[];
  awardLabel?: string;
  metadata?: BookCatalogMetadataFilter;
  publisherId?: string;
  publisherLabel?: string;
  region: AwardRegionFilter;
  subject?: string;
  topic?: string;
};

export type SemanticListDraft = {
  diagnostics?: SemanticListDiagnostics;
  filters: SemanticListFilters;
  interpretation: SemanticQueryInterpretation | null;
  query: string;
  results: Array<{ bookId: string; score?: number }>;
};

export type SemanticListBook = {
  author: string;
  bookId: string;
  imprint?: string;
  primarySubject?: string;
  publicationYear?: number;
  publisher?: string;
  semanticScore?: number;
  slug: string;
  thumbnailUrl?: string;
  title: string;
};

export type SemanticListSnapshot = {
  createdAt: string;
  diagnostics?: SemanticListDiagnostics;
  filters: SemanticListFilters;
  id: string;
  interpretation: SemanticQueryInterpretation | null;
  query: string;
  results: SemanticListBook[];
  title: string;
  version: typeof SEMANTIC_LIST_VERSION;
};

export type SemanticListDraftValidation =
  | { ok: true; draft: SemanticListDraft }
  | { ok: false; error: string };

export function validateSemanticListDraft(input: unknown): SemanticListDraftValidation {
  if (!isRecord(input)) return invalid("Invalid list snapshot.");
  const query = cleanString(input.query, 600);
  if (query.length < 3) return invalid("The search query must be at least 3 characters.");

  const filters = sanitizeFilters(input.filters);
  if (!filters) return invalid("The list has invalid search filters.");
  const interpretation = sanitizeInterpretation(input.interpretation);
  if (input.interpretation != null && !interpretation) return invalid("The interpreted search intent is invalid.");

  if (!Array.isArray(input.results)) return invalid("The list has no search results.");
  const seen = new Set<string>();
  const results: SemanticListDraft["results"] = [];
  for (const value of input.results.slice(0, MAX_SEMANTIC_LIST_RESULTS)) {
    if (!isRecord(value)) continue;
    const bookId = cleanString(value.bookId, 240);
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    const score = typeof value.score === "number" && Number.isFinite(value.score)
      ? Math.round(value.score * 1_000_000) / 1_000_000
      : undefined;
    results.push({ bookId, score });
  }
  if (!results.length) return invalid("The list has no valid search results.");

  return {
    ok: true,
    draft: {
      diagnostics: sanitizeDiagnostics(input.diagnostics),
      filters,
      interpretation,
      query,
      results,
    },
  };
}

export function createSemanticListSnapshot(
  draft: SemanticListDraft,
  booksById: ReadonlyMap<string, BrowseBookRow>,
  createdAt = new Date().toISOString(),
): SemanticListSnapshot {
  const results = draft.results.flatMap(({ bookId, score }) => {
    const book = booksById.get(bookId);
    if (!book) return [];
    return [{
      author: book.author,
      bookId,
      imprint: book.imprint,
      primarySubject: book.primarySubject,
      publicationYear: book.publicationYear,
      publisher: book.publisher,
      semanticScore: score,
      slug: book.slug,
      thumbnailUrl: book.thumbnailUrl,
      title: book.title,
    }];
  });
  if (!results.length) throw new Error("None of the selected books remain in the public catalog.");

  const content = {
    diagnostics: draft.diagnostics,
    filters: draft.filters,
    interpretation: draft.interpretation,
    query: draft.query,
    results,
    title: semanticListTitle(draft.query),
    version: SEMANTIC_LIST_VERSION,
  } as const;
  return {
    ...content,
    createdAt,
    id: semanticListId(content),
  };
}

export function semanticListTitle(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!normalized) return "A shared nonfiction reading list";
  const titled = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return titled.length <= 120 ? titled : `${titled.slice(0, 117).trimEnd()}…`;
}

export function semanticListId(content: Omit<SemanticListSnapshot, "createdAt" | "id">) {
  return createHash("sha256").update(stableStringify(content)).digest("base64url").slice(0, 22);
}

export function isSemanticListSnapshot(input: unknown): input is SemanticListSnapshot {
  if (!isRecord(input)) return false;
  if (input.version !== SEMANTIC_LIST_VERSION) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(String(input.id ?? ""))) return false;
  if (!cleanString(input.query, 600) || !cleanString(input.title, 140)) return false;
  if (!Number.isFinite(Date.parse(String(input.createdAt ?? "")))) return false;
  if (!sanitizeFilters(input.filters)) return false;
  if (input.interpretation != null && !sanitizeInterpretation(input.interpretation)) return false;
  if (!Array.isArray(input.results) || input.results.length < 1 || input.results.length > MAX_SEMANTIC_LIST_RESULTS) return false;
  return input.results.every((result) =>
    isRecord(result)
    && Boolean(cleanString(result.bookId, 240))
    && Boolean(cleanString(result.slug, 240))
    && Boolean(cleanString(result.title, 500))
    && Boolean(cleanString(result.author, 500)),
  );
}

function sanitizeFilters(input: unknown): SemanticListFilters | null {
  if (!isRecord(input)) return null;
  const region = input.region;
  if (region !== "us" && region !== "international" && region !== "all") return null;
  const metadata = input.metadata;
  const validMetadata = metadata === undefined || ["all", "complete", "missing", "has_cover", "missing_cover", "missing_publisher"].includes(String(metadata));
  if (!validMetadata) return null;
  return {
    awardIds: cleanStringArray(input.awardIds, 40, 160),
    awardLabel: optionalString(input.awardLabel, 160),
    metadata: metadata as BookCatalogMetadataFilter | undefined,
    publisherId: optionalString(input.publisherId, 180),
    publisherLabel: optionalString(input.publisherLabel, 180),
    region,
    subject: optionalString(input.subject, 120),
    topic: optionalString(input.topic, 120),
  };
}

function sanitizeDiagnostics(input: unknown): SemanticListDiagnostics | undefined {
  if (!isRecord(input)) return undefined;
  return {
    candidateBookCount: optionalPositiveInteger(input.candidateBookCount),
    embeddingModel: optionalString(input.embeddingModel, 120),
    indexGeneratedAt: optionalDate(input.indexGeneratedAt),
    interpretationModel: optionalString(input.interpretationModel, 120),
    queryExpansionModel: optionalString(input.queryExpansionModel, 120),
    retrievalMode: input.retrievalMode === "direct" ? "direct" : input.retrievalMode === "expanded" ? "expanded" : undefined,
    resultCount: optionalPositiveInteger(input.resultCount),
    usedModelInterpretation: typeof input.usedModelInterpretation === "boolean" ? input.usedModelInterpretation : undefined,
  };
}

function sanitizeInterpretation(input: unknown): SemanticQueryInterpretation | null {
  if (input == null) return null;
  if (!isRecord(input)) return null;
  const expandedQuery = cleanString(input.expandedQuery, 320);
  if (!expandedQuery || !Array.isArray(input.concepts) || !Array.isArray(input.eras) || !Array.isArray(input.subjects)) return null;
  const publicationDateIntent = ["older", "newer", "none"].includes(String(input.publicationDateIntent))
    ? input.publicationDateIntent as SemanticQueryInterpretation["publicationDateIntent"]
    : undefined;
  const publicationDateMode = ["soft", "filter", "none"].includes(String(input.publicationDateMode))
    ? input.publicationDateMode as SemanticQueryInterpretation["publicationDateMode"]
    : undefined;
  const publicationYearCutoff = typeof input.publicationYearCutoff === "number"
    && Number.isInteger(input.publicationYearCutoff)
    && input.publicationYearCutoff >= 0
    && input.publicationYearCutoff <= 2100
      ? input.publicationYearCutoff
      : null;
  const authorIntent = sanitizeAuthorIntent(input.authorIntent);
  return {
    expandedQuery,
    audienceTerms: cleanStringArray(input.audienceTerms, 4, 60),
    culturalReferences: cleanStringArray(input.culturalReferences, 4, 80),
    concepts: cleanStringArray(input.concepts, 8, 72) ?? [],
    adventurousConcepts: cleanStringArray(input.adventurousConcepts, 3, 72),
    coreConcepts: cleanStringArray(input.coreConcepts, 6, 72),
    requiredConcepts: cleanStringArray(input.requiredConcepts, 4, 72),
    namedFigures: cleanStringArray(input.namedFigures, 4, 80),
    namedPlaces: cleanStringArray(input.namedPlaces, 4, 80),
    publicationDateIntent,
    publicationDateMode,
    publicationYearCutoff,
    eras: cleanStringArray(input.eras, 3, 60) ?? [],
    subjects: cleanStringArray(input.subjects, 4, 60) ?? [],
    authorIntent,
  };
}

function sanitizeAuthorIntent(input: unknown): SemanticQueryInterpretation["authorIntent"] {
  if (!isRecord(input)) return undefined;
  const mode = input.mode;
  const lifeStatus = input.lifeStatus;
  if (!["filter", "boost", "none"].includes(String(mode))) return undefined;
  if (!["living", "deceased", "unknown", "any"].includes(String(lifeStatus))) return undefined;
  return {
    countries: cleanStringArray(input.countries, 4, 60) ?? [],
    lifeStatus: lifeStatus as "living" | "deceased" | "unknown" | "any",
    mode: mode as "filter" | "boost" | "none",
    platforms: (cleanStringArray(input.platforms, 2, 40) ?? []).filter((platform): platform is "substack" => platform === "substack"),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function optionalString(value: unknown, maxLength: number) {
  const cleaned = cleanString(value, maxLength);
  return cleaned || undefined;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function optionalPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(error: string): SemanticListDraftValidation {
  return { ok: false, error };
}
