import assert from "node:assert/strict";
import test from "node:test";
import {
  containsSearchPhrase,
  createSemanticQueryContext,
  inferBookLengthIntent,
  inferPublicationPreference,
  semanticQueryText,
  semanticRankingTerms,
  semanticHybridScore,
  semanticRankFusion,
  semanticRowMatchesPublicationPreference,
  type SemanticBookIndexRow,
  type SemanticQueryInterpretation,
  type SemanticSearchResult,
} from "./semantic-search";

test("publication-age language is parsed as structured intent without confusing a book's subject", () => {
  assert.deepEqual(inferPublicationPreference("classic biographies"), {
    intent: "older",
    cutoff: new Date().getFullYear() - 50,
    mode: "soft",
  });
  assert.deepEqual(inferPublicationPreference("old books about painters"), {
    intent: "older",
    cutoff: new Date().getFullYear() - 40,
    mode: "soft",
  });
  assert.deepEqual(inferPublicationPreference("biographies of old painters"), {
    intent: "none",
    cutoff: null,
    mode: "none",
  });
  assert.equal(inferPublicationPreference("books published after 2015").mode, "filter");
  assert.equal(inferPublicationPreference("books preferably from before 1970").mode, "soft");
});

test("recent publication intent remains soft when a length adjective intervenes", () => {
  assert.deepEqual(inferPublicationPreference("recent short books about democracy"), {
    intent: "newer",
    cutoff: null,
    mode: "soft",
  });
});

test("reading-commitment language maps to generic book-length intent", () => {
  assert.equal(inferBookLengthIntent("fun beach reads"), "short");
  assert.equal(inferBookLengthIntent("a light read for vacation"), "short");
  assert.equal(inferBookLengthIntent("a light accessible book for vacation"), "short");
  assert.equal(inferBookLengthIntent("exhaustive biographies"), "long");
  assert.equal(inferBookLengthIntent("an in-depth authoritative history"), "long");
  assert.equal(inferBookLengthIntent("books about beach ecology"), "none");
  assert.equal(inferBookLengthIntent("a biography of epic poets"), "none");
});

test("reading-context words do not become topical beach or vacation matches", () => {
  const beachRead = createSemanticQueryContext("fun beach reads", {
    expandedQuery: "Light, entertaining nonfiction suitable for casual beach reading.",
    concepts: ["beach", "light reading"],
    coreConcepts: ["beach", "light reading"],
    eras: [],
    subjects: [],
  });
  const beachEcology = createSemanticQueryContext("literary reporting about beach ecology");
  assert.equal(beachRead.terms.includes("beach"), false);
  assert.equal(beachRead.coreConceptNeedles.includes("beach"), false);
  assert.equal(beachEcology.terms.includes("beach"), true);
});

test("publication cutoffs do not leak into subject-period matching", () => {
  const interpretation: SemanticQueryInterpretation = {
    expandedQuery: "books about painters published before 1970",
    concepts: ["painters"],
    coreConcepts: ["painters"],
    requiredConcepts: ["painters"],
    publicationDateIntent: "older",
    publicationDateMode: "filter",
    publicationYearCutoff: 1970,
    eras: [],
    subjects: ["art history"],
  };
  const context = createSemanticQueryContext("books about painters published before 1970", interpretation);
  assert.deepEqual(context.periods, []);
  assert.equal(semanticRowMatchesPublicationPreference(semanticTestRow("old", "painters", { publicationYear: 1969 }), interpretation), true);
  assert.equal(semanticRowMatchesPublicationPreference(semanticTestRow("new", "painters", { publicationYear: 1974 }), interpretation), false);
});

test("publication intent words do not compete with topical ranking terms", () => {
  const interpretation: SemanticQueryInterpretation = {
    expandedQuery: "classic nature writing and natural history",
    concepts: ["classic nature writing", "natural history"],
    coreConcepts: ["classic nature writing", "natural history"],
    publicationDateIntent: "older",
    publicationYearCutoff: 1975,
    eras: [],
    subjects: ["nature writing"],
  };
  const terms = semanticRankingTerms("old books about nature", interpretation);
  assert.equal(terms.includes("old"), false);
  assert.equal(terms.includes("classic"), false);
  assert.equal(terms.includes("nature"), true);
});

test("lexical matching respects token boundaries", () => {
  assert.equal(containsSearchPhrase("the subtle wisdom of rocks", "rock"), false);
  assert.equal(containsSearchPhrase("independent rock criticism", "rock"), true);
  assert.equal(containsSearchPhrase("long-form reported nonfiction", "long form"), true);
});

test("persona searches separate audience labels from taste signals", () => {
  const interpretation: SemanticQueryInterpretation = {
    expandedQuery: "literary music criticism, independent culture, dry wit, and unconventional essays",
    audienceTerms: ["dads"],
    culturalReferences: ["Pavement"],
    concepts: ["independent music culture", "music criticism", "dry wit"],
    coreConcepts: ["independent music culture", "music criticism", "dry wit"],
    adventurousConcepts: ["unconventional essays"],
    namedFigures: [],
    namedPlaces: [],
    publicationDateIntent: "none",
    publicationYearCutoff: null,
    eras: [],
    subjects: ["music", "cultural criticism"],
  };
  const query = "books for dads who like Pavement";
  const terms = semanticRankingTerms(query, interpretation);
  const embeddingInput = semanticQueryText(query, interpretation);

  assert.equal(terms.includes("dads"), false);
  assert.equal(terms.includes("pavement"), true);
  assert.equal(embeddingInput.includes("books for dads"), false);
  assert.match(embeddingInput, /Taste references: Pavement/);
});

test("recognition and thin metadata cannot overrule stronger semantic support", () => {
  const base = {
    keywordBoost: 0,
    fieldBoost: 0,
    conceptBoost: 0,
    entityBoost: 0,
    topicBoost: 0,
    scopeBoost: 0,
    periodBoost: 0,
    publicationBoost: 0,
    readerIntentBoost: 0,
    lexicalScore: 0,
    reasons: [],
  } satisfies Omit<SemanticSearchResult, "bookId" | "score" | "similarity" | "recognitionBoost">;
  const results: SemanticSearchResult[] = [
    { ...base, bookId: "supported", score: 0, similarity: 0.72, recognitionBoost: 0, evidenceConfidence: 1 },
    { ...base, bookId: "famous-thin", score: 0, similarity: 0.41, recognitionBoost: 1, evidenceConfidence: 0.35 },
  ];
  const ranked = semanticRankFusion(results).sort((a, b) => b.score - a.score);
  assert.equal(ranked[0]?.bookId, "supported");
});

test("an explicit publication-age preference can reorder otherwise similar books", () => {
  const base = {
    keywordBoost: 0.5,
    fieldBoost: 0.5,
    conceptBoost: 0.5,
    entityBoost: 0,
    topicBoost: 0.5,
    scopeBoost: 0.5,
    periodBoost: 0,
    readerIntentBoost: 0,
    lexicalScore: 0.5,
    recognitionBoost: 0.3,
    evidenceConfidence: 1,
    reasons: [],
  } satisfies Omit<SemanticSearchResult, "bookId" | "publicationBoost" | "score" | "similarity">;
  const results: SemanticSearchResult[] = [
    { ...base, bookId: "newer", publicationBoost: 0, publicationYearKnown: true, score: 0, similarity: 0.62 },
    { ...base, bookId: "older", publicationBoost: 0.82, publicationYearKnown: true, score: 0, similarity: 0.59 },
  ];
  const ranked = semanticRankFusion(results).sort((a, b) => b.score - a.score);
  assert.equal(ranked[0]?.bookId, "older");
});

test("required concepts penalize partial matches in compound queries", () => {
  const interpretation: SemanticQueryInterpretation = {
    expandedQuery: "Cold War history in Africa",
    concepts: ["Cold War", "Africa"],
    coreConcepts: ["Cold War", "Africa"],
    requiredConcepts: ["Cold War", "Africa"],
    eras: ["Cold War"],
    subjects: ["African political history"],
  };
  const complete = semanticHybridScore({
    interpretation,
    query: "Cold War history set in Africa",
    queryEmbedding: [1],
    row: semanticTestRow("complete", "A Cold War history of proxy conflict and liberation movements in Africa."),
  });
  const partial = semanticHybridScore({
    interpretation,
    query: "Cold War history set in Africa",
    queryEmbedding: [1],
    row: semanticTestRow("partial", "A Cold War history of Soviet intelligence in Europe."),
  });
  assert.equal(complete.constraintCoverage, 1);
  assert.ok((partial.constraintCoverage ?? 0) < 1);
  assert.deepEqual(partial.missingConstraints, ["Africa"]);
  const ranked = semanticRankFusion([
    { bookId: "complete", ...complete },
    { bookId: "partial", ...partial },
  ]).sort((a, b) => b.score - a.score);
  assert.equal(ranked[0]?.bookId, "complete");
});

test("short-book intent uses page count without excluding unknown lengths", () => {
  const short = semanticHybridScore({
    query: "a short accessible introduction",
    queryEmbedding: [1],
    row: semanticTestRow("short", "An accessible introduction.", { pageCount: 190 }),
  });
  const long = semanticHybridScore({
    query: "a short accessible introduction",
    queryEmbedding: [1],
    row: semanticTestRow("long", "An accessible introduction.", { pageCount: 720 }),
  });
  const unknown = semanticHybridScore({
    query: "a short accessible introduction",
    queryEmbedding: [1],
    row: semanticTestRow("unknown", "An accessible introduction."),
  });
  assert.equal(short.lengthBoost, 1);
  assert.equal(long.lengthBoost, 0);
  assert.equal(unknown.pageCountKnown, false);
  const ranked = semanticRankFusion([
    { bookId: "short", ...short },
    { bookId: "long", ...long },
    { bookId: "unknown", ...unknown },
  ]).sort((a, b) => b.score - a.score);
  assert.equal(ranked[0]?.bookId, "short");
});

test("an explicit reporting-method request requires descriptive reporting evidence", () => {
  const base: SemanticBookIndexRow = {
    bookId: "base",
    slug: "base",
    title: "Base",
    author: "Author",
    subjects: [],
    topics: [],
    awards: [],
    recognitionScore: 0,
    text: "Title: Base\nDescription: An elegant narrative with vivid scenes.",
    searchText: "base elegant narrative vivid scenes",
    inputHash: "hash",
    filter: {
      awardIds: [],
      recognitionByRegion: {
        us: { awardIds: [], lists: 1 },
        international: { awardIds: [], lists: 1 },
        all: { awardIds: [], lists: 1 },
      },
      hasIsbn: false,
      hasPageCount: false,
      hasCover: false,
      hasSummary: false,
      hasPublisher: false,
    },
    embedding: [1],
    norm: 1,
  };
  const interpretation: SemanticQueryInterpretation = {
    expandedQuery: "literary nonfiction grounded in reporting and vivid narrative scenes",
    concepts: ["literary nonfiction", "reported journalism"],
    coreConcepts: ["literary nonfiction", "reported journalism"],
    eras: [],
    subjects: [],
  };
  const unsupported = semanticHybridScore({ interpretation, query: "beautiful prose based in reporting", queryEmbedding: [1], row: base });
  const context = createSemanticQueryContext("beautiful prose based in reporting", interpretation);
  const unsupportedWithPreparedContext = semanticHybridScore({ context, interpretation, query: "beautiful prose based in reporting", queryEmbedding: [1], row: base });
  const supported = semanticHybridScore({
    interpretation,
    query: "beautiful prose based in reporting",
    queryEmbedding: [1],
    row: {
      ...base,
      bookId: "reported",
      text: "Title: Reported\nDescription: Based on years of reporting and interviews, this book builds vivid narrative scenes.",
      searchText: "reported based on years of reporting interviews vivid narrative scenes",
    },
  });

  assert.ok((supported.readerIntentBoost ?? 0) > (unsupported.readerIntentBoost ?? 0));
  assert.ok(supported.score > unsupported.score);
  assert.deepEqual(unsupportedWithPreparedContext, unsupported);
});

test("dual query embeddings preserve raw intent while adding expanded recall", () => {
  const row: SemanticBookIndexRow = {
    bookId: "dual",
    slug: "dual",
    title: "Dual",
    author: "Author",
    subjects: [],
    topics: [],
    awards: [],
    recognitionScore: 0,
    text: "Title: Dual\nDescription: A narrative history.",
    searchText: "dual narrative history",
    inputHash: "hash",
    filter: {
      awardIds: [],
      recognitionByRegion: {
        us: { awardIds: [], lists: 1 },
        international: { awardIds: [], lists: 1 },
        all: { awardIds: [], lists: 1 },
      },
      hasIsbn: false,
      hasPageCount: false,
      hasCover: false,
      hasSummary: true,
      hasPublisher: false,
    },
    embedding: [1, 0],
    norm: 1,
  };
  const result = semanticHybridScore({
    query: "narrative history",
    rawQueryEmbedding: [1, 0],
    expandedQueryEmbedding: [0, 1],
    row,
  });
  assert.equal(result.rawSimilarity, 1);
  assert.equal(result.expandedSimilarity, 0);
  assert.ok(result.similarity > 0.5);
});

test("experience vectors influence reader-experience queries without replacing content relevance", () => {
  const row: SemanticBookIndexRow = {
    bookId: "experience",
    slug: "experience",
    title: "Experience",
    author: "Author",
    subjects: ["History"],
    topics: [],
    awards: [],
    recognitionScore: 0,
    readerLevel: "popular",
    readerTraits: ["narrative", "accessible"],
    narrativeScore: 0.8,
    accessibilityScore: 0.8,
    text: "Title: Experience\nDescription: A history.",
    searchText: "experience history",
    inputHash: "hash",
    filter: {
      awardIds: [],
      recognitionByRegion: {
        us: { awardIds: [], lists: 1 },
        international: { awardIds: [], lists: 1 },
        all: { awardIds: [], lists: 1 },
      },
      hasIsbn: false,
      hasPageCount: false,
      hasCover: false,
      hasSummary: true,
      hasPublisher: false,
    },
    embedding: [1, 0],
    norm: 1,
    experienceEmbedding: [0, 1],
    experienceNorm: 1,
  };
  const result = semanticHybridScore({
    query: "accessible narrative history",
    rawQueryEmbedding: [1, 0],
    expandedQueryEmbedding: [0, 1],
    row,
  });
  assert.equal(result.experienceSimilarity, 0.65);
  assert.ok(result.similarity > 0.5);
  assert.ok(result.similarity < 0.65);
});

function semanticTestRow(
  bookId: string,
  text: string,
  overrides: Partial<SemanticBookIndexRow> = {},
): SemanticBookIndexRow {
  return {
    bookId,
    slug: bookId,
    title: bookId,
    author: "Author",
    subjects: [],
    topics: [],
    awards: [],
    recognitionScore: 0,
    text: `Title: ${bookId}\nDescription: ${text}`,
    searchText: text.toLowerCase(),
    inputHash: bookId,
    filter: {
      awardIds: [],
      recognitionByRegion: {
        us: { awardIds: [], lists: 0 },
        international: { awardIds: [], lists: 0 },
        all: { awardIds: [], lists: 0 },
      },
      hasIsbn: false,
      hasPageCount: Boolean(overrides.pageCount),
      hasCover: false,
      hasSummary: true,
      hasPublisher: false,
    },
    embedding: [1],
    norm: 1,
    ...overrides,
  };
}
