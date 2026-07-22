import assert from "node:assert/strict";
import test from "node:test";
import {
  containsSearchPhrase,
  createSemanticQueryContext,
  semanticQueryText,
  semanticRankingTerms,
  semanticHybridScore,
  semanticRankFusion,
  type SemanticBookIndexRow,
  type SemanticQueryInterpretation,
  type SemanticSearchResult,
} from "./semantic-search";

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
