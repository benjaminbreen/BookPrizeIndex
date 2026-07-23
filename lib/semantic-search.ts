import type { Book } from "@/lib/types";
import type { SemanticAuthorFacet, SemanticAuthorIntent } from "@/lib/author-discovery";
import type { AwardRegionFilter } from "@/lib/award-region";
import type { BookCatalogMetadataFilter } from "@/lib/book-catalog-query";
import { rollupSubjectName } from "@/lib/subject-rollup";

export const DEFAULT_SEMANTIC_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_SEMANTIC_DIMENSIONS = 512;

export type SemanticVector = number[] | Float32Array;

export type SemanticBookFilterMetadata = {
  awardIds: string[];
  publisherId?: string;
  recognitionByRegion: Record<AwardRegionFilter, { awardIds: string[]; lists: number }>;
  hasIsbn: boolean;
  hasPageCount: boolean;
  hasCover: boolean;
  hasSummary: boolean;
  hasPublisher: boolean;
};

export type SemanticBookIndexRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  authors?: SemanticAuthorFacet[];
  publicationYear?: number;
  primarySubject?: string;
  subjects: string[];
  primaryTopic?: string;
  topics: string[];
  imprint?: string;
  publisher?: string;
  awards: string[];
  recognitionScore: number;
  readerLevel?: string;
  readerTraits?: string[];
  narrativeScore?: number;
  accessibilityScore?: number;
  scholarlyScore?: number;
  centralFigures?: string[];
  centralPlaces?: string[];
  academicOrientationScore?: number;
  academicOrientationConfidence?: number;
  text: string;
  searchText: string;
  inputHash: string;
  filter: SemanticBookFilterMetadata;
  embedding: SemanticVector;
  norm: number;
};

export type SemanticBookIndex = {
  generatedAt: string;
  embeddingModel: string;
  dimensions: number;
  inputVersion: number;
  books: SemanticBookIndexRow[];
};

export type SemanticQueryInterpretation = {
  expandedQuery: string;
  audienceTerms?: string[];
  culturalReferences?: string[];
  concepts: string[];
  adventurousConcepts?: string[];
  coreConcepts?: string[];
  namedFigures?: string[];
  namedPlaces?: string[];
  publicationDateIntent?: "older" | "newer" | "none";
  publicationYearCutoff?: number | null;
  eras: string[];
  subjects: string[];
  authorIntent?: SemanticAuthorIntent;
};

export type SemanticQueryExpansionModel = "gpt-5.4-nano" | "gpt-5.4-mini" | "gemini-3.5-flash";

export type SemanticQueryContext = {
  adventurousConceptNeedles: string[];
  adventurousConcepts: string[];
  coreConceptNeedles: string[];
  coreConcepts: string[];
  periods: Array<{ label: string; start: number; end: number }>;
  personaTasteQuery: boolean;
  publicationDateQuery: boolean;
  readerExperienceQuery: boolean;
  terms: string[];
  topicNeedles: string[];
};

export type SemanticSearchResult = {
  bookId: string;
  score: number;
  similarity: number;
  lexicalScore?: number;
  keywordBoost: number;
  fieldBoost?: number;
  conceptBoost: number;
  entityBoost?: number;
  topicBoost: number;
  scopeBoost: number;
  periodBoost: number;
  publicationBoost?: number;
  recognitionBoost: number;
  readerIntentBoost?: number;
  authorFacetBoost?: number;
  evidenceConfidence?: number;
  reasons: string[];
};

export function semanticTextForBook({
  awards,
  authorFacets,
  book,
  imprint,
  publisher,
}: {
  awards: string[];
  authorFacets?: SemanticAuthorFacet[];
  book: Book;
  imprint?: string;
  publisher?: string;
}) {
  const summary = clippedText(book.displaySummary || book.summary, 1800);
  const experimentalProfile = book.experimentalSemanticProfile;
  const centralFigures = experimentalProfile?.centralFigures.map((figure) => figure.name) ?? book.centralFigures;
  const centralPlaces = experimentalProfile?.centralPlaces.map((place) => place.name) ?? [];
  const academicOrientation = experimentalProfile
    ? academicOrientationText(experimentalProfile.academicOrientation.score)
    : "";
  const parts = [
    `Title: ${[book.title, book.subtitle].filter(Boolean).join(": ")}`,
    `Author: ${book.authors.map((author) => author.name).join(", ")}`,
    authorFacets?.length ? `Author public discovery: ${authorFacets.map(authorFacetText).filter(Boolean).join("; ")}` : "",
    summary ? `Description: ${summary}` : "",
    experimentalProfile?.argument.present ? `Interpretive claim: ${experimentalProfile.argument.statement}` : "",
    centralFigures.length ? `Central figures: ${centralFigures.join(", ")}` : "",
    centralPlaces.length ? `Central places: ${centralPlaces.join(", ")}` : "",
    academicOrientation ? `Reading orientation: ${academicOrientation}` : "",
    book.primarySubject ? `Primary subject: ${book.primarySubject}` : "",
    book.subjects.length ? `Subjects: ${book.subjects.join(", ")}` : "",
    book.primaryTopic ? `Primary topic: ${book.primaryTopic}` : "",
    book.topics.length ? `Topics: ${book.topics.join(", ")}` : "",
    book.readerProfile ? `Reader profile: ${readerProfileText(book.readerProfile)}` : "",
    book.subjectCategories?.length
      ? `Catalog subject evidence: ${subjectEvidenceLabels(book.subjectCategories.map((category) => category.label)).join(", ")}`
      : "",
    imprint ? `Imprint: ${imprint}` : "",
    publisher ? `Publisher: ${publisher}` : "",
    awards.length ? `Award recognition: ${awards.slice(0, 14).join("; ")}` : "",
  ];
  return parts.filter(Boolean).join("\n").slice(0, 7200);
}

function academicOrientationText(score: number) {
  const rounded = Math.round(score);
  if (rounded <= 20) return `popular trade (${rounded}/100 academic orientation)`;
  if (rounded <= 40) return `serious trade (${rounded}/100 academic orientation)`;
  if (rounded <= 60) return `trade/academic crossover (${rounded}/100 academic orientation)`;
  if (rounded <= 80) return `academic (${rounded}/100 academic orientation)`;
  return `specialist or reference (${rounded}/100 academic orientation)`;
}

export function semanticQueryText(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const coreConcepts = semanticCoreConcepts(interpretation);
  const adventurousConcepts = semanticAdventurousConcepts(interpretation);
  const tasteQuery = isPersonaTasteQuery(query);
  const parts = [
    !tasteQuery || !interpretation ? `Reader query: ${query}` : "",
    interpretation?.expandedQuery ? `Expanded search intent: ${tasteQuery ? tasteIntentText(interpretation.expandedQuery, interpretation) : interpretation.expandedQuery}` : "",
    interpretation?.culturalReferences?.length ? `Taste references: ${interpretation.culturalReferences.join(", ")}` : "",
    coreConcepts.length ? `Core concepts: ${coreConcepts.join(", ")}` : "",
    adventurousConcepts.length ? `Adventurous adjacent concepts: ${adventurousConcepts.join(", ")}` : "",
    interpretation?.namedFigures?.length ? `Named figures: ${interpretation.namedFigures.join(", ")}` : "",
    interpretation?.namedPlaces?.length ? `Named places: ${interpretation.namedPlaces.join(", ")}` : "",
    interpretation?.publicationDateIntent && interpretation.publicationDateIntent !== "none"
      ? `Publication preference: ${interpretation.publicationDateIntent}${interpretation.publicationYearCutoff ? ` than ${interpretation.publicationYearCutoff}` : ""}`
      : "",
    interpretation?.eras.length ? `Eras and periods: ${interpretation.eras.join(", ")}` : "",
    interpretation?.subjects.length ? `Likely subjects: ${interpretation.subjects.join(", ")}` : "",
    interpretation?.authorIntent?.countries?.length ? `Author country connections: ${interpretation.authorIntent.countries.join(", ")}` : "",
    interpretation?.authorIntent?.lifeStatus && interpretation.authorIntent.lifeStatus !== "any" ? `Author life status: ${interpretation.authorIntent.lifeStatus}` : "",
    interpretation?.authorIntent?.platforms?.length ? `Author public platforms: ${interpretation.authorIntent.platforms.join(", ")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

function authorFacetText(author: SemanticAuthorFacet) {
  const facts = [
    author.countries.length ? author.countries.map((country) => country.name).join(", ") : "",
    author.lifeStatus !== "unknown" ? author.lifeStatus : "",
    author.platforms.length ? author.platforms.join(", ") : "",
  ].filter(Boolean);
  return facts.length ? `${author.name}: ${facts.join(", ")}` : "";
}

export function semanticRankingTerms(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const culturalReferenceTerms = new Set(searchTerms((interpretation?.culturalReferences ?? []).join(" ")));
  const audienceTerms = new Set([
    ...searchTerms((interpretation?.audienceTerms ?? []).join(" ")),
    ...(isPersonaTasteQuery(query) ? personaAudienceTerms : []),
  ].filter((term) => !culturalReferenceTerms.has(term)));
  return uniqueValues([
    ...(!isPersonaTasteQuery(query) || !interpretation ? searchTerms(query) : []),
    ...searchTerms((interpretation?.culturalReferences ?? []).join(" ")),
    ...searchTerms([...(interpretation?.namedFigures ?? []), ...(interpretation?.namedPlaces ?? [])].join(" ")),
    ...searchTerms(semanticCoreConcepts(interpretation).join(" ")),
    ...searchTerms((interpretation?.subjects ?? []).join(" ")),
    ...searchTerms(positiveLexicalText(interpretation?.expandedQuery ?? "")),
    ...searchTerms((interpretation?.eras ?? []).join(" ")),
    ...searchTerms(semanticAdventurousConcepts(interpretation).join(" ")),
  ]).filter((term) => !audienceTerms.has(term)).slice(0, 36);
}

export function isPersonaTasteQuery(query: string) {
  return /\b(?:books?|stuff|recommendations?)\s+for\b|\b(?:would|might)\s+(?:like|enjoy)\b|\bfor fans? of\b|\b(?:taste|sensibility|vibe|read next)\b/i.test(query);
}

const personaAudienceTerms = [
  "audience", "beginner", "beginners", "dad", "dads", "father", "fathers", "fan", "fans", "mom", "moms",
  "mother", "mothers", "parent", "parents", "professional", "professionals", "student", "students",
];

function tasteIntentText(input: string, interpretation: SemanticQueryInterpretation) {
  const culturalReferenceTerms = new Set(searchTerms((interpretation.culturalReferences ?? []).join(" ")));
  const excluded = new Set([
    ...searchTerms((interpretation.audienceTerms ?? []).join(" ")),
    ...personaAudienceTerms,
  ].filter((term) => !culturalReferenceTerms.has(term)));
  return input
    .split(/\s+/)
    .filter((term) => !excluded.has(tokenBoundaryText(term)))
    .join(" ");
}

export function semanticCoreConcepts(interpretation?: SemanticQueryInterpretation | null) {
  if (interpretation?.coreConcepts?.length) return uniqueValues(interpretation.coreConcepts);
  return uniqueValues(interpretation?.concepts ?? []);
}

export function semanticAdventurousConcepts(interpretation?: SemanticQueryInterpretation | null) {
  return uniqueValues(interpretation?.adventurousConcepts ?? []);
}

export function createSemanticQueryContext(query: string, interpretation?: SemanticQueryInterpretation | null): SemanticQueryContext {
  const coreConcepts = semanticCoreConcepts(interpretation);
  const adventurousConcepts = semanticAdventurousConcepts(interpretation);
  const personaTasteQuery = isPersonaTasteQuery(query);
  const readerExperienceQuery = isReaderExperienceQuery(query, interpretation);
  const coreConceptNeedles = uniqueNormalized([...coreConcepts, ...(interpretation?.subjects ?? [])])
    .filter((needle) => needle.length >= 4)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const adventurousConceptNeedles = uniqueNormalized(adventurousConcepts)
    .filter((needle) => needle.length >= 4)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const topicNeedles = uniqueNormalized(readerExperienceQuery
    ? [
        ...(interpretation?.subjects ?? []),
        ...(personaTasteQuery ? [] : inferredSubjectNeedles(query, interpretation)),
      ]
    : [
        ...(interpretation?.subjects ?? []),
        ...coreConcepts,
        ...adventurousConcepts,
        ...(personaTasteQuery ? [] : inferredSubjectNeedles(query, interpretation)),
      ])
    .filter(Boolean)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  return {
    adventurousConceptNeedles,
    adventurousConcepts,
    coreConceptNeedles,
    coreConcepts,
    periods: inferPeriodRanges([query, interpretation?.expandedQuery, ...(interpretation?.eras ?? [])].filter(Boolean).join(" ")),
    personaTasteQuery,
    publicationDateQuery: isPublicationDateQuery(query, interpretation),
    readerExperienceQuery,
    terms: semanticRankingTerms(query, interpretation)
      .filter((term) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(term)),
    topicNeedles,
  };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeForSearch(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsSearchPhrase(haystack: string, needle: string) {
  const normalizedNeedle = tokenBoundaryText(needle);
  if (!normalizedNeedle) return false;
  return ` ${tokenBoundaryText(haystack)} `.includes(` ${normalizedNeedle} `);
}

function tokenBoundaryText(input: string) {
  const cached = tokenBoundaryTextCache.get(input);
  if (cached !== undefined) return cached;
  const normalized = normalizeForSearch(input).replace(/[&-]/g, " ").replace(/\s+/g, " ").trim();
  if (tokenBoundaryTextCache.size >= 50_000) tokenBoundaryTextCache.clear();
  tokenBoundaryTextCache.set(input, normalized);
  return normalized;
}

const tokenBoundaryTextCache = new Map<string, string>();

function positiveLexicalText(input: string) {
  return input.replace(/\b(?:not|without|excluding|except(?: for)?|rather than|instead of)\s+(?:[\w'-]+\s*){1,3}/gi, " ");
}

export function vectorNorm(vector: SemanticVector) {
  let squared = 0;
  for (const value of vector) squared += value * value;
  return Math.sqrt(squared);
}

export function cosineSimilarity(a: SemanticVector, b: SemanticVector, bNorm = vectorNorm(b)) {
  const aNorm = vectorNorm(a);
  if (!aNorm || !bNorm) return 0;
  let dot = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
  }
  return dot / (aNorm * bNorm);
}

export function semanticRowMatchesFilters(
  row: SemanticBookIndexRow,
  filters: {
    awardIds?: string[];
    metadata?: BookCatalogMetadataFilter;
    publisherId?: string;
    region?: AwardRegionFilter;
    subject?: string;
    topic?: string;
  },
) {
  const region = filters.region ?? "us";
  const recognition = row.filter.recognitionByRegion[region];
  if (!recognition || recognition.lists === 0) return false;
  if (filters.topic && !row.topics.includes(filters.topic)) return false;
  if (filters.subject && !row.subjects.some((subject) => rollupSubjectName(subject) === filters.subject)) return false;
  if (filters.awardIds?.length && !filters.awardIds.some((awardId) => recognition.awardIds.includes(awardId))) return false;
  if (filters.publisherId && row.filter.publisherId !== filters.publisherId) return false;

  const metadata = filters.metadata ?? "all";
  const complete = row.filter.hasIsbn && row.filter.hasPageCount && row.filter.hasCover && row.filter.hasPublisher;
  if (metadata === "complete") return complete;
  if (metadata === "missing") return !complete;
  if (metadata === "has_cover") return row.filter.hasCover;
  if (metadata === "missing_cover") return !row.filter.hasCover;
  if (metadata === "missing_publisher") return !row.filter.hasPublisher;
  return true;
}

export function searchTerms(input: string) {
  const stop = new Set([
    "about",
    "after",
    "all",
    "age",
    "also",
    "and",
    "are",
    "associated",
    "book",
    "books",
    "but",
    "based",
    "could",
    "called",
    "era",
    "explore",
    "exploring",
    "for",
    "from",
    "give",
    "having",
    "how",
    "interest",
    "interests",
    "into",
    "just",
    "key",
    "like",
    "likes",
    "looking",
    "matter",
    "more",
    "most",
    "novel",
    "nonfiction",
    "period",
    "periods",
    "public",
    "recommend",
    "recommendation",
    "recommendations",
    "read",
    "reading",
    "search",
    "serious",
    "show",
    "someone",
    "something",
    "such",
    "still",
    "stuff",
    "terms",
    "than",
    "that",
    "the",
    "this",
    "things",
    "through",
    "understand",
    "understanding",
    "under",
    "versus",
    "who",
    "whose",
    "will",
    "with",
    "would",
    "writing",
    "why",
  ]);
  return Array.from(
    new Set(
      normalizeForSearch(input)
        .split(" ")
        .filter((term) => term.length >= 3 && !stop.has(term)),
    ),
  ).slice(0, 42);
}

export function corpusTermWeights(terms: string[], rows: SemanticBookIndexRow[]) {
  const weights = new Map<string, number>();
  const uniqueTerms = Array.from(new Set(terms));
  const normalizedTerms = new Map(uniqueTerms.map((term) => [term, tokenBoundaryText(term)]));
  const preparedRows = rows.map((row) => ` ${tokenBoundaryText(row.searchText)} `);
  const rowCount = Math.max(rows.length, 1);
  for (const term of uniqueTerms) {
    const normalizedTerm = normalizedTerms.get(term);
    let documentFrequency = 0;
    if (normalizedTerm) {
      const needle = ` ${normalizedTerm} `;
      for (const rowSearch of preparedRows) {
        if (rowSearch.includes(needle)) documentFrequency += 1;
      }
    }
    weights.set(term, Math.log((rowCount + 1) / (documentFrequency + 1)) + 1);
  }
  return weights;
}

export function semanticTermWeights(
  query: string,
  interpretation: SemanticQueryInterpretation | null | undefined,
  rows: SemanticBookIndexRow[],
) {
  const terms = semanticRankingTerms(query, interpretation);
  const weights = corpusTermWeights(terms, rows);
  const priority = new Map<string, number>();
  const applyPriority = (input: string, multiplier: number) => {
    for (const term of searchTerms(input)) {
      priority.set(term, Math.max(priority.get(term) ?? 0, multiplier));
    }
  };
  if (!isPersonaTasteQuery(query) || !interpretation) applyPriority(query, 2.4);
  applyPriority((interpretation?.culturalReferences ?? []).join(" "), 2.5);
  applyPriority([...(interpretation?.namedFigures ?? []), ...(interpretation?.namedPlaces ?? [])].join(" "), 3);
  applyPriority(semanticCoreConcepts(interpretation).join(" "), 1.7);
  applyPriority((interpretation?.subjects ?? []).join(" "), 1.15);
  applyPriority(positiveLexicalText(interpretation?.expandedQuery ?? ""), 0.8);
  applyPriority((interpretation?.eras ?? []).join(" "), 0.8);
  applyPriority(semanticAdventurousConcepts(interpretation).join(" "), 0.45);
  for (const term of terms) weights.set(term, (weights.get(term) ?? 1) * (priority.get(term) ?? 0.7));
  return weights;
}

export function inferPeriodRanges(input: string): Array<{ label: string; start: number; end: number }> {
  const normalized = normalizeForSearch(input);
  const ranges: Array<{ label: string; start: number; end: number }> = [];
  for (const match of normalized.matchAll(/\b(1[5-9]\d0|20\d0)s\b/g)) {
    const start = Number(match[1]);
    if (Number.isFinite(start)) ranges.push({ label: `${start}s`, start, end: start + 9 });
  }
  for (const match of normalized.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)) {
    const year = Number(match[1]);
    if (Number.isFinite(year)) ranges.push({ label: String(year), start: year - 4, end: year + 4 });
  }
  if (/\bvictorian\b/.test(normalized)) ranges.push({ label: "Victorian era", start: 1837, end: 1901 });
  if (/\bgilded age\b/.test(normalized)) ranges.push({ label: "Gilded Age", start: 1870, end: 1900 });
  if (/\bprogressive era\b/.test(normalized)) ranges.push({ label: "Progressive Era", start: 1890, end: 1920 });
  return ranges;
}

export function semanticHybridScore({
  context,
  interpretation,
  query,
  queryEmbedding,
  row,
  termWeights,
}: {
  context?: SemanticQueryContext;
  interpretation?: SemanticQueryInterpretation | null;
  query: string;
  queryEmbedding: number[];
  row: SemanticBookIndexRow;
  termWeights?: Map<string, number>;
}) {
  const queryContext = context ?? createSemanticQueryContext(query, interpretation);
  const { adventurousConcepts, coreConcepts, readerExperienceQuery, terms } = queryContext;
  const rowSearch = readerExperienceQuery ? semanticBodySearchText(row) : row.searchText;
  const hits = terms.filter((term) => containsSearchPhrase(rowSearch, term));
  const totalTermWeight = terms.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const hitTermWeight = hits.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const keywordBoost = totalTermWeight ? Math.min(1, hitTermWeight / totalTermWeight) : 0;
  const fieldBoost = fieldAwareTermScore(row, terms, termWeights, readerExperienceQuery);
  const { coreConceptNeedles, adventurousConceptNeedles } = queryContext;
  const conceptNeedles = uniqueNormalized([...coreConceptNeedles, ...adventurousConceptNeedles]);
  const conceptHits = conceptNeedles.filter((needle) => containsSearchPhrase(rowSearch, needle));
  const totalConceptWeight =
    coreConceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0) +
    adventurousConceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights) * 0.65, 0);
  const hitConceptWeight =
    coreConceptNeedles.filter((needle) => containsSearchPhrase(rowSearch, needle)).reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0) +
    adventurousConceptNeedles.filter((needle) => containsSearchPhrase(rowSearch, needle)).reduce((sum, needle) => sum + conceptWeight(needle, termWeights) * 0.65, 0);
  const conceptBoost = totalConceptWeight ? Math.min(1, hitConceptWeight / totalConceptWeight) : 0;
  const { score: entityBoost, hits: entityHits } = entityMatchScore(interpretation, row);
  const topicNeedles = queryContext.topicNeedles;
  const topicHaystack = semanticRowSearchText(row).topics;
  const topicHits = topicNeedles.filter((needle) => needle && containsSearchPhrase(topicHaystack, needle));
  const topicBoost = topicNeedles.length ? Math.min(1, topicHits.length / Math.min(topicNeedles.length, 6)) : 0;
  const scopeBoost = queryContext.personaTasteQuery ? 0 : subjectScopeScore(query, interpretation, row);
  const periodBoost = rowMentionsPeriod(row, queryContext.periods, queryContext.publicationDateQuery) ? 1 : 0;
  const publicationBoost = publicationPreferenceScore(interpretation, row.publicationYear);
  const readerIntentBoost = readerIntentScore(query, interpretation, row);
  const recognitionBoost = Math.min(1, Math.log1p(Math.max(0, row.recognitionScore)) / Math.log1p(32));
  const similarity = cosineSimilarity(queryEmbedding, row.embedding, row.norm);
  const evidenceConfidence = semanticEvidenceConfidence(row);
  const phraseBoost = phraseMatchBoost(query, interpretation, row);
  const positiveReaderIntentBoost = Math.max(0, readerIntentBoost);
  const lexicalScore = Math.min(1,
    keywordBoost * 0.13 +
    fieldBoost * 0.15 +
    conceptBoost * 0.12 +
    entityBoost * 0.19 +
    topicBoost * 0.09 +
    scopeBoost * 0.1 +
    periodBoost * 0.06 +
    publicationBoost * 0.08 +
    phraseBoost * 0.04 +
    positiveReaderIntentBoost * 0.04,
  );
  const supportedLexicalScore = lexicalScore * (0.55 + evidenceConfidence * 0.45);
  const score = similarity * 0.76 + supportedLexicalScore * 0.22 + recognitionBoost * 0.02;
  const reasons = [
    hits.slice(0, 4).length ? `Matched terms: ${hits.slice(0, 4).join(", ")}` : "",
    conceptHits.slice(0, 3).length ? `Matched concepts: ${conceptHits.slice(0, 3).join(", ")}` : "",
    entityHits.length ? `Matched entities: ${entityHits.slice(0, 3).join(", ")}` : "",
    topicHits.slice(0, 3).length ? `Matched concepts: ${topicHits.slice(0, 3).join(", ")}` : "",
    scopeBoost ? "Matched subject scope" : "",
    periodBoost ? "Matched period signal" : "",
    publicationBoost ? "Matched publication-date preference" : "",
    readerIntentBoost ? "Matched reader-experience signal" : "",
  ].filter(Boolean);
  return {
    conceptBoost,
    entityBoost,
    evidenceConfidence,
    fieldBoost,
    keywordBoost,
    lexicalScore: Number(lexicalScore.toFixed(6)),
    periodBoost,
    publicationBoost,
    recognitionBoost,
    readerIntentBoost: Number(readerIntentBoost.toFixed(6)),
    reasons,
    score: Number(score.toFixed(6)),
    similarity: Number(similarity.toFixed(6)),
    scopeBoost,
    topicBoost,
  };
}

export function semanticRankFusion(results: SemanticSearchResult[]) {
  const vectorRanks = ranksBy(results, (row) => row.similarity);
  const lexicalRanks = ranksBy(results, (row) => row.lexicalScore ?? lexicalScore(row));
  const topicRanks = ranksBy(results, (row) => row.scopeBoost + row.topicBoost * 0.8 + row.conceptBoost * 0.5 + row.periodBoost * 0.35);
  const readerRanks = positiveRanksBy(results, (row) => Math.max(0, row.readerIntentBoost ?? 0));
  const entityRanks = positiveRanksBy(results, (row) => row.entityBoost ?? 0);
  const publicationRanks = positiveRanksBy(results, (row) => row.publicationBoost ?? 0);
  const recognitionRanks = ranksBy(results, (row) => row.recognitionBoost);
  const hasReaderSignal = results.some((row) => Math.abs(row.readerIntentBoost ?? 0) > 0.001);
  const hasEntitySignal = results.some((row) => (row.entityBoost ?? 0) > 0.001);
  const hasPublicationSignal = results.some((row) => (row.publicationBoost ?? 0) > 0.001);
  const k = 60;
  return results.map((row) => {
    const rankSignals = [
      { active: true, rank: vectorRanks.get(row.bookId), weight: 0.52 },
      { active: true, rank: lexicalRanks.get(row.bookId), weight: 0.24 },
      { active: true, rank: topicRanks.get(row.bookId), weight: 0.14 },
      { active: hasEntitySignal, rank: entityRanks.get(row.bookId), weight: 0.16 },
      { active: hasPublicationSignal, rank: publicationRanks.get(row.bookId), weight: 0.11 },
      { active: hasReaderSignal, rank: readerRanks.get(row.bookId), weight: 0.08 },
      { active: true, rank: recognitionRanks.get(row.bookId), weight: 0.02 },
    ].filter((signal) => signal.active);
    const totalWeight = rankSignals.reduce((sum, signal) => sum + signal.weight, 0);
    const fused = rankSignals.reduce(
      (sum, signal) => sum + (signal.weight / totalWeight) / (k + (signal.rank ?? results.length)),
      0,
    );
    const readerPenalty = Math.min(0, row.readerIntentBoost ?? 0) * 1.15;
    const vectorRank = vectorRanks.get(row.bookId) ?? results.length;
    const semanticSupport = clamp01(1 - (vectorRank - 1) / Math.min(250, Math.max(50, results.length * 0.04)));
    const evidenceConfidence = row.evidenceConfidence ?? 0.5;
    const fitBonus = semanticSupport * (
      Math.max(0, row.readerIntentBoost ?? 0) * 0.12 +
      (row.entityBoost ?? 0) * 0.22 +
      (row.publicationBoost ?? 0) * 0.12 +
      row.scopeBoost * 0.08 +
      row.recognitionBoost * 0.025
    );
    const evidencePenalty = (1 - evidenceConfidence) * 0.035;
    return {
      ...row,
      score: Number((fused * 100 + fitBonus + readerPenalty - evidencePenalty).toFixed(6)),
    };
  });
}

function ranksBy(results: SemanticSearchResult[], score: (row: SemanticSearchResult) => number) {
  return new Map(
    [...results]
      .sort((a, b) => score(b) - score(a) || b.similarity - a.similarity)
      .map((row, index) => [row.bookId, index + 1]),
  );
}

function positiveRanksBy(results: SemanticSearchResult[], score: (row: SemanticSearchResult) => number) {
  return new Map(
    results
      .filter((row) => score(row) > 0.001)
      .sort((a, b) => score(b) - score(a) || b.similarity - a.similarity)
      .map((row, index) => [row.bookId, index + 1]),
  );
}

function semanticEvidenceConfidence(row: SemanticBookIndexRow) {
  if (/\nDescription:/i.test(row.text)) return 1;
  if (/\nInterpretive claim:/i.test(row.text)) return 0.85;
  if (row.readerLevel || row.readerTraits?.length || row.centralFigures?.length || row.centralPlaces?.length) return 0.68;
  return 0.35;
}

function lexicalScore(row: SemanticSearchResult) {
  return row.keywordBoost * 0.13 +
    (row.fieldBoost ?? 0) * 0.15 +
    row.conceptBoost * 0.12 +
    (row.entityBoost ?? 0) * 0.19 +
    row.topicBoost * 0.09 +
    row.scopeBoost * 0.1 +
    row.periodBoost * 0.06 +
    (row.publicationBoost ?? 0) * 0.08 +
    Math.max(0, row.readerIntentBoost ?? 0) * 0.04;
}

function entityMatchScore(
  interpretation: SemanticQueryInterpretation | null | undefined,
  row: SemanticBookIndexRow,
) {
  const desired = [
    ...(interpretation?.namedFigures ?? []).map((name) => ({ name, type: "figure" as const, weight: 1 })),
    ...(interpretation?.namedPlaces ?? []).map((name) => ({ name, type: "place" as const, weight: 0.85 })),
  ];
  if (!desired.length) return { score: 0, hits: [] as string[] };
  const figures = row.centralFigures ?? [];
  const places = row.centralPlaces ?? [];
  let matchedWeight = 0;
  let matchedFigure = false;
  const hits: string[] = [];
  for (const entity of desired) {
    const haystack = entity.type === "figure" ? figures : places;
    if (!haystack.some((candidate) => entityNamesMatch(entity.name, candidate))) continue;
    matchedWeight += entity.weight;
    if (entity.type === "figure") matchedFigure = true;
    hits.push(entity.name);
  }
  const totalWeight = desired.reduce((sum, entity) => sum + entity.weight, 0);
  if (!matchedWeight || !totalWeight) return { score: 0, hits };
  const coverage = matchedWeight / totalWeight;
  const ceiling = matchedFigure ? 1 : 0.62;
  return { score: Math.min(ceiling, (matchedFigure ? 0.65 : 0.38) + coverage * 0.35), hits };
}

function entityNamesMatch(left: string, right: string) {
  const a = normalizeForSearch(left);
  const b = normalizeForSearch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.split(" ").length >= 2 && longer.includes(shorter);
}

function publicationPreferenceScore(
  interpretation: SemanticQueryInterpretation | null | undefined,
  publicationYear: number | undefined,
) {
  const intent = interpretation?.publicationDateIntent ?? "none";
  if (intent === "none" || !publicationYear) return 0;
  const cutoff = interpretation?.publicationYearCutoff;
  if (cutoff && intent === "older") return clamp01(1 - Math.max(0, publicationYear - cutoff) / 25);
  if (cutoff && intent === "newer") return clamp01(1 - Math.max(0, cutoff - publicationYear) / 15);
  const age = new Date().getFullYear() - publicationYear;
  if (intent === "older") return clamp01((age - 10) / 60);
  return clamp01((25 - age) / 25);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rowMentionsPeriod(row: SemanticBookIndexRow, periods: Array<{ label: string; start: number; end: number }>, allowPublicationYear: boolean) {
  if (!periods.length) return false;
  if (allowPublicationYear && row.publicationYear && periods.some((period) => row.publicationYear! >= period.start && row.publicationYear! <= period.end)) return true;
  const rowSearch = semanticContentSearchText(row);
  return periods.some((period) => {
    const label = normalizeForSearch(period.label);
    if (label && rowSearch.includes(label)) return true;
    if (period.label.endsWith("s") && rowSearch.includes(String(period.start).slice(0, 3))) return true;
    for (const match of rowSearch.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)) {
      const year = Number(match[1]);
      if (year >= period.start && year <= period.end) return true;
    }
    return false;
  });
}

function isPublicationDateQuery(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([query, interpretation?.expandedQuery ?? ""].join(" "));
  return /\b(published|publication|released|came out|from the|books from|written in|recent|new|contemporary)\b/.test(normalized);
}

function subjectScopeScore(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const originalQuery = normalizeForSearch(query);
  const normalized = normalizeForSearch([
    query,
    ...(interpretation?.subjects ?? []),
    ...semanticCoreConcepts(interpretation),
  ].join(" "));
  const rowScope = normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" "))
    .replace(/\bpersonal history\b/g, "personal narrative");
  let score = 0;
  if (/\b(histories|history|historical)\b/.test(normalized)) {
    const historyWeight = /\b(histories|history|historical)\b/.test(originalQuery) ? 1 : 0.62;
    if (/\bhistory\b/.test(rowScope)) score = Math.max(score, historyWeight);
    if (/\b(world war|holocaust|civil rights|cold war|political history|intellectual history|regional history|local history)\b/.test(rowScope)) score = Math.max(score, 0.72);
  }
  if (/\b(science|scientific|nature|discovery)\b/.test(normalized)) {
    if (/\b(science|nature|discovery|environment|medicine|public health)\b/.test(rowScope)) score = Math.max(score, 1);
  }
  if (/\b(memoir|grief|family|illness)\b/.test(normalized)) {
    if (/\b(memoir|biography|family|medicine|public health)\b/.test(rowScope)) score = Math.max(score, 0.85);
  }
  if (/\b(poverty|housing|inequality)\b/.test(normalized)) {
    if (/\b(poverty|housing|cities|urban|economics|social movements|race)\b/.test(rowScope)) score = Math.max(score, 1);
  }
  if (/\b(environment|environmental|ecology|pollution|climate|capitalism|industry|industrial|factory|agriculture|land)\b/.test(normalized)) {
    if (/\b(environment|conservation|pollution|climate|weather|disaster|agriculture|land|business|economics|cities|urban|science|nature)\b/.test(rowScope)) {
      score = Math.max(score, 0.9);
    }
  }
  if (/\b(cold war|espionage|intelligence|spy|spies|cia|fbi|soviet|russia)\b/.test(normalized)) {
    if (/\b(cold war|war|military|politics|government|europe|russia|terrorism|intelligence)\b/.test(rowScope)) score = Math.max(score, 0.92);
  }
  if (/\b(race|racism|medicine|medical|health|public health|disease|illness|cancer|care)\b/.test(normalized)) {
    if (/\b(medicine|public health|science|race|africa|african diaspora|biography|memoir|social movements)\b/.test(rowScope)) score = Math.max(score, 0.88);
  }
  if (/\b(technology|digital|data|algorithm|algorithms|ai|computing|surveillance|platform|internet|robot|robots)\b/.test(normalized)) {
    if (/\b(technology|computing|ai|science|business|economics|politics|government|rights|inequality)\b/.test(rowScope)) score = Math.max(score, 0.9);
  }
  if (/\b(empire|imperial|trade|commodity|commodities|slavery|colonial|capitalism|global)\b/.test(normalized)) {
    if (/\b(empire|colonialism|slavery|business|economics|world history|africa|diaspora|trade|politics|government)\b/.test(rowScope)) score = Math.max(score, 0.88);
  }
  if (/\b(ancient|antiquity|archaeology|archeology|rome|roman|greece|greek|egypt|mesopotamia|classical)\b/.test(normalized)) {
    if (/\b(history|ancient|archaeology|art|criticism|science|religion|world history|europe|russia)\b/.test(rowScope)) score = Math.max(score, 0.86);
  }
  return score;
}

function fieldAwareTermScore(row: SemanticBookIndexRow, terms: string[], termWeights: Map<string, number> | undefined, bodyOnly: boolean) {
  if (!terms.length) return 0;
  const prepared = semanticRowSearchText(row);
  const fields = [
    bodyOnly ? undefined : { text: prepared.title, weight: 3 },
    bodyOnly ? undefined : { text: prepared.author, weight: 1.2 },
    bodyOnly ? undefined : { text: prepared.topics, weight: 2.4 },
    { text: prepared.body, weight: 1 },
  ].filter((field): field is { text: string; weight: number } => Boolean(field?.text));
  const totalWeight = terms.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  if (!totalWeight) return 0;
  let score = 0;
  for (const term of terms) {
    const termWeight = termWeights?.get(term) ?? 1;
    const bestField = fields.reduce((best, field) => containsSearchPhrase(field.text, term) ? Math.max(best, field.weight) : best, 0);
    score += termWeight * Math.min(1, bestField / 3);
  }
  return Math.min(1, score / totalWeight);
}

function semanticContentSearchText(row: SemanticBookIndexRow) {
  return semanticRowSearchText(row).content;
}

function semanticBodySearchText(row: SemanticBookIndexRow) {
  return semanticRowSearchText(row).body;
}

type SemanticRowSearchText = {
  author: string;
  body: string;
  content: string;
  title: string;
  topics: string;
};

const semanticRowSearchTextCache = new WeakMap<SemanticBookIndexRow, SemanticRowSearchText>();

function semanticRowSearchText(row: SemanticBookIndexRow) {
  const cached = semanticRowSearchTextCache.get(row);
  if (cached) return cached;
  const lines = row.text.split("\n");
  const prepared: SemanticRowSearchText = {
    author: normalizeForSearch(row.author),
    body: normalizeForSearch(lines
      .filter((line) => !/^(?:title|author|reading orientation|primary subject|subjects|primary topic|topics|reader profile|catalog subject evidence|imprint|publisher|award recognition|book publication year):/i.test(line))
      .join("\n")),
    content: normalizeForSearch(lines
      .filter((line) => !/^award recognition:/i.test(line) && !/^book publication year:/i.test(line))
      .join("\n")),
    title: normalizeForSearch(row.title),
    topics: normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" ")),
  };
  semanticRowSearchTextCache.set(row, prepared);
  return prepared;
}

function phraseMatchBoost(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const phrases = uniqueNormalized([
    ...quotedPhrases(query),
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
    ...(interpretation?.subjects ?? []),
    ...(interpretation?.eras ?? []),
  ]).filter((phrase) => phrase.includes(" ") && phrase.length >= 8);
  if (!phrases.length) return 0;
  const content = semanticContentSearchText(row);
  const hits = phrases.filter((phrase) => containsSearchPhrase(content, phrase));
  return Math.min(1, hits.length / Math.min(phrases.length, 4));
}

function quotedPhrases(input: string) {
  return Array.from(input.matchAll(/["'“”]([^"'“”]{3,80})["'“”]/g)).map((match) => match[1]);
}

function clippedText(input: string | undefined, maxLength: number) {
  const normalized = input?.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength);
  return clipped.slice(0, Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","), maxLength - 120)).trim();
}

function subjectEvidenceLabels(labels: string[]) {
  const generic = new Set(["general", "nonfiction", "history", "biography", "books", "literature"]);
  return Array.from(
    new Set(
      labels
        .map((label) => label.trim())
        .filter((label) => label.length >= 4 && !generic.has(normalizeForSearch(label))),
    ),
  ).slice(0, 8);
}

function readerProfileText(profile: NonNullable<Book["readerProfile"]>) {
  const traits = profile.traits
    .filter((trait) => trait.score >= 0.25)
    .slice(0, 8)
    .map((trait) => trait.id.replaceAll("_", " "))
    .join(", ");
  return [
    `level ${profile.readerLevel}`,
    `narrative ${profile.narrativeScore}`,
    `accessible ${profile.accessibilityScore}`,
    `scholarly ${profile.scholarlyScore}`,
    traits ? `traits ${traits}` : "",
  ].filter(Boolean).join("; ");
}

function readerIntentScore(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const normalized = normalizeForSearch([
    query,
    interpretation?.expandedQuery ?? "",
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
    ...(interpretation?.subjects ?? []),
  ].join(" "));
  const wantsReadable = /\b(fun|readable|engaging|accessible|popular|page turner|page-turner|good read|general reader|not academic|beach read)\b/.test(normalized);
  const wantsNarrative = /\b(narrative|story|stories|character|character driven|people|lives|biographical|reported|journalistic|immersive)\b/.test(normalized);
  const wantsReported = /\b(reporting|reported|journalistic|journalism|investigative|investigation|fieldwork|interviews?)\b/.test(normalizeForSearch(query));
  const wantsScholarly = !/\bnot academic\b/.test(normalized) && /\b(academic|scholarly|dense|historiography|historiographical|theory|monograph|specialist)\b/.test(normalized);
  const academicOrientation = confidenceAdjustedAcademicOrientation(row);
  let score = 0;
  if (wantsReadable) {
    score += (row.accessibilityScore ?? 0) * 0.5;
    score += row.readerLevel === "popular" ? 0.22 : row.readerLevel === "crossover" && (row.accessibilityScore ?? 0) >= 0.2 ? 0.08 : 0;
    score -= (row.scholarlyScore ?? 0) * 0.72;
    if ((row.accessibilityScore ?? 0) < 0.12 && row.readerLevel !== "popular") score -= 0.16;
    if (row.readerLevel === "academic" || row.readerLevel === "reference") score -= 0.42;
    if (row.readerTraits?.some((trait) => ["dense", "academic", "scholarly", "reference"].includes(trait))) score -= 0.18;
    if (row.readerTraits?.some((trait) => ["popular", "accessible", "narrative", "character_driven", "reported", "memoiristic"].includes(trait))) score += 0.12;
    score -= academicOrientation * 0.28;
  }
  if (wantsNarrative) {
    score += (row.narrativeScore ?? 0) * 0.48;
    if (row.readerTraits?.some((trait) => ["character_driven", "biographical", "reported", "memoiristic", "narrative"].includes(trait))) score += 0.2;
    if (row.readerTraits?.includes("argument_driven") && !wantsScholarly) score -= 0.08;
    if (!wantsScholarly) score -= (row.scholarlyScore ?? 0) * 0.45;
    if (!wantsScholarly && (row.readerLevel === "academic" || row.readerLevel === "reference")) score -= 0.2;
    if (!wantsScholarly && (row.narrativeScore ?? 0) < 0.1 && (row.scholarlyScore ?? 0) >= 0.25) score -= 0.35;
    if ((row.narrativeScore ?? 0) < 0.1 && !row.readerTraits?.some((trait) => ["character_driven", "biographical", "reported", "memoiristic", "narrative"].includes(trait))) score -= 0.2;
  }
  if (wantsReported) {
    const reportingEvidence = reportingMethodEvidence(row);
    score += reportingEvidence >= 0.65 ? 0.34 : reportingEvidence >= 0.3 ? 0.12 : -0.42;
  }
  if (wantsReadable && wantsNarrative && (row.accessibilityScore ?? 0) < 0.12 && (row.narrativeScore ?? 0) < 0.12) score -= 0.18;
  if (wantsScholarly) {
    score += (row.scholarlyScore ?? 0) * 0.5;
    if (row.readerLevel === "academic") score += 0.18;
    score += academicOrientation * 0.24;
  }
  if (!wantsReadable && !wantsNarrative && !wantsReported && !wantsScholarly) return 0;
  return Math.max(-1, Math.min(1, score));
}

function reportingMethodEvidence(row: SemanticBookIndexRow) {
  const content = semanticBodySearchText(row);
  const strongSignals = ["based on reporting", "meticulously reported", "years of reporting", "investigative reporting", "fieldwork"];
  if (strongSignals.some((signal) => containsSearchPhrase(content, signal))) return 1;
  const signals = ["reporting", "reported", "reporter", "journalist", "interview", "interviews", "investigative", "investigation", "dispatches"];
  if (signals.some((signal) => containsSearchPhrase(content, signal))) return 0.72;
  if (row.readerTraits?.includes("reported")) return 0.2;
  return 0;
}

function confidenceAdjustedAcademicOrientation(row: SemanticBookIndexRow) {
  if (row.academicOrientationScore === undefined) return 0;
  const confidence = clamp01(row.academicOrientationConfidence ?? 0);
  const score = Math.max(0, Math.min(100, row.academicOrientationScore));
  const adjusted = 50 + (score - 50) * confidence;
  return (adjusted - 50) / 50;
}

function inferredSubjectNeedles(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([query, ...(interpretation?.subjects ?? [])].join(" "));
  const needles: string[] = [];
  if (/\b(environment|environmental|ecology|pollution|climate|capitalism|industry|industrial|factory|agriculture|land)\b/.test(normalized)) {
    needles.push("environment", "pollution", "climate", "agriculture", "business", "economics", "industry", "capitalism");
  }
  if (/\b(cold war|espionage|intelligence|spy|spies|cia|fbi|soviet|russia)\b/.test(normalized)) {
    needles.push("cold war", "espionage", "intelligence", "war", "military", "politics", "russia");
  }
  if (/\b(race|racism|medicine|medical|health|public health|disease|illness|cancer|care)\b/.test(normalized)) {
    needles.push("medicine", "public health", "race", "illness", "care", "science");
  }
  if (/\b(memoir|grief|family|illness|death|bereavement)\b/.test(normalized)) {
    needles.push("memoir", "family", "grief", "illness", "biography");
  }
  return needles;
}

const readerIntentLexicalStopwords = new Set([
  "accessible",
  "character",
  "driven",
  "engaging",
  "fun",
  "histories",
  "history",
  "narrative",
  "narratives",
  "popular",
  "readable",
  "stories",
  "story",
]);

function isReaderExperienceQuery(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([
    query,
    interpretation?.expandedQuery ?? "",
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
  ].join(" "));
  return /\b(fun|readable|engaging|accessible|popular|page turner|page-turner|good read|general reader|beach read|narrative|story|stories|character driven|immersive)\b/.test(normalized);
}

function uniqueNormalized(values: string[]) {
  return Array.from(new Set(values.map(normalizeForSearch).filter(Boolean)));
}

function conceptWeight(needle: string, termWeights?: Map<string, number>) {
  const terms = searchTerms(needle);
  if (!terms.length) return 1;
  return Math.max(...terms.map((term) => termWeights?.get(term) ?? 1));
}
