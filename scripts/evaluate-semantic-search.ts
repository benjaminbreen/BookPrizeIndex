import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  createSemanticQueryContext,
  semanticExpandedQueryText,
  semanticHybridScore,
  semanticQueryText,
  semanticRawQueryText,
  semanticRankFusion,
  semanticTermWeights,
  type SemanticBookIndex,
  type SemanticQueryExpansionModel,
  type SemanticQueryInterpretation,
} from "../lib/semantic-search";
import { readSemanticBookIndex } from "../lib/semantic-index-storage";
import {
  SEMANTIC_QUERY_INTERPRETATION_VERSION,
  embedSemanticQuery,
  interpretSemanticQuery,
} from "../app/api/search/semantic/route";

type EvaluationQuery = {
  query: string;
  description?: string;
  relevantTitles?: RelevanceJudgment[];
  expectedTitles?: string[];
  negativeTitles?: string[];
};

type EvaluationFile = {
  queries: EvaluationQuery[];
};

type RelevanceJudgment = {
  title: string;
  rating: 0 | 1 | 2 | 3;
  rationale?: string;
};

type EvaluationStrategy = "legacy" | "dual" | "multi";

type CachedInterpretation = {
  interpretation: SemanticQueryInterpretation | null;
  model?: string;
  usedModelInterpretation: boolean;
  warning?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = resolveRootPath(readArg("--index") ?? "data/public/book-semantic-index.json");
const evaluationPath = path.join(root, "data", "semantic-evaluation-queries.json");
const reportPath = resolveRootPath(readArg("--report") ?? "data/reports/semantic-evaluation-report.json");
const poolReportPath = resolveRootPath(
  readArg("--pool-report") ??
    path.join(
      "data/reports/ci-artifacts/semantic-experiments",
      `${path.parse(reportPath).name}-judgment-pool.json`,
    ),
);
const interpretationCachePath = path.join(root, "data/cache/semantic-evaluation-interpretations.json");
const limit = positiveNumber(readArg("--limit"), 25);
const queryExpansionModel = queryModelArg(readArg("--query-model"));
const queryFilter = readArg("--query");
const strategy = strategyArg(readArg("--strategy"));

async function main() {
  await loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to evaluate semantic search queries.");
  const index = await readSemanticBookIndex(indexPath);
  const booksById = new Map(index.books.map((book) => [book.bookId, book]));
  const evaluation = JSON.parse(await fs.readFile(evaluationPath, "utf8")) as EvaluationFile;
  const interpretationCache = await readInterpretationCache(reportPath);
  const rows = [];
  const aggregate = {
    ndcgAt10: 0,
    precisionAt10: 0,
    excellentAt10: 0,
    judgedAt10: 0,
    anchorRecallAt25: 0,
  };
  const evaluationQueries = queryFilter
    ? evaluation.queries.filter((item) => item.query.toLowerCase().includes(queryFilter.toLowerCase()))
    : evaluation.queries;
  if (!evaluationQueries.length) throw new Error(`No evaluation query matched: ${queryFilter}`);
  for (const item of evaluationQueries) {
    const interpretationResult = interpretationCache.get(interpretationCacheKey(item.query, queryExpansionModel)) ??
      await interpretAndCache(item.query, queryExpansionModel, interpretationCache);
    const interpretation = interpretationResult.interpretation;
    const embeddingInput = semanticQueryText(item.query, interpretation);
    const rawEmbeddingInput = semanticRawQueryText(item.query, interpretation);
    const expandedEmbeddingInput = semanticExpandedQueryText(item.query, interpretation);
    const queryEmbedding = strategy === "legacy"
      ? await embedSemanticQuery(embeddingInput, index)
      : undefined;
    const [rawQueryEmbedding, expandedQueryEmbedding] = strategy === "legacy"
      ? [undefined, undefined]
      : await Promise.all([
          embedSemanticQuery(rawEmbeddingInput, index),
          expandedEmbeddingInput === rawEmbeddingInput
            ? embedSemanticQuery(rawEmbeddingInput, index)
            : embedSemanticQuery(expandedEmbeddingInput, index),
        ]);
    const queryContext = createSemanticQueryContext(item.query, interpretation);
    const rankingTerms = queryContext.terms;
    const termWeights = semanticTermWeights(item.query, interpretation, index.books);
    const results = semanticRankFusion(index.books.map((row) => ({
      bookId: row.bookId,
      ...semanticHybridScore({
        context: queryContext,
        expandedQueryEmbedding,
        interpretation,
        query: item.query,
        queryEmbedding,
        rawQueryEmbedding,
        row,
        termWeights,
        useExperienceVector: strategy === "multi",
      }),
    }))).sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    const judgments = normalizedJudgments(item);
    const negativeTitles = new Set((item.negativeTitles ?? []).map((title) => normalizeTitle(title)));
    const resultRanksByBookId = new Map(results.map((result, rank) => [result.bookId, rank]));
    const top = results.slice(0, limit).map((result, rank) => {
      const row = booksById.get(result.bookId);
      const judgment = row ? judgmentForTitle(judgments, row.title) : undefined;
      return {
        rank: rank + 1,
        title: row?.title,
        author: row?.author,
        score: result.score,
        similarity: result.similarity,
        rawSimilarity: result.rawSimilarity,
        expandedSimilarity: result.expandedSimilarity,
        experienceSimilarity: result.experienceSimilarity,
        lexicalScore: result.lexicalScore,
        relevance: judgment?.rating ?? null,
        judged: Boolean(judgment),
        expectedBad: row ? negativeTitles.has(normalizeTitle(row.title)) : false,
        reasons: result.reasons,
      };
    });
    const expected = judgments.map((judgment) => {
      const normalized = normalizeTitle(judgment.title);
      const matchedBook = index.books.find((book) => titleMatchesExpected(normalizeTitle(book.title), normalized));
      const rank = matchedBook ? resultRanksByBookId.get(matchedBook.bookId) ?? -1 : -1;
      const matchedResult = rank >= 0 ? results[rank] : undefined;
      return {
        title: judgment.title,
        relevance: judgment.rating,
        rationale: judgment.rationale,
        bookId: matchedBook?.bookId ?? null,
        hasDescription: matchedBook ? /\nDescription:/.test(matchedBook.text) : false,
        primarySubject: matchedBook?.primarySubject ?? null,
        primaryTopic: matchedBook?.primaryTopic ?? null,
        topics: matchedBook?.topics ?? [],
        readerLevel: matchedBook?.readerLevel ?? null,
        readerTraits: matchedBook?.readerTraits ?? [],
        score: matchedResult?.score ?? null,
        similarity: matchedResult?.similarity ?? null,
        rawSimilarity: matchedResult?.rawSimilarity ?? null,
        expandedSimilarity: matchedResult?.expandedSimilarity ?? null,
        experienceSimilarity: matchedResult?.experienceSimilarity ?? null,
        lexicalScore: matchedResult?.lexicalScore ?? null,
        readerIntentBoost: matchedResult?.readerIntentBoost ?? null,
        evidenceConfidence: matchedResult?.evidenceConfidence ?? null,
        rank: rank >= 0 ? rank + 1 : null,
        inTop10: rank >= 0 && rank < 10,
        inTop25: rank >= 0 && rank < 25,
      };
    });
    const metrics = metricsForQuery(top, expected);
    aggregate.ndcgAt10 += metrics.ndcgAt10;
    aggregate.precisionAt10 += metrics.precisionAt10;
    aggregate.excellentAt10 += metrics.excellentAt10;
    aggregate.judgedAt10 += metrics.judgedAt10;
    aggregate.anchorRecallAt25 += metrics.anchorRecallAt25;
    rows.push({
      query: item.query,
      description: item.description,
      rankingTerms,
      embeddingInputs: {
        combined: embeddingInput,
        expanded: expandedEmbeddingInput,
        raw: rawEmbeddingInput,
      },
      interpretation,
      interpretationModel: interpretationResult.model,
      usedModelInterpretation: interpretationResult.usedModelInterpretation,
      interpretationWarning: interpretationResult.warning,
      metrics,
      expected,
      top,
      unjudgedTop10: top.filter((row) => !row.judged).slice(0, 10).map((row) => row.title),
    });
    console.log(`${item.query}: NDCG@10 ${metrics.ndcgAt10.toFixed(3)}, precision@10 ${metrics.precisionAt10.toFixed(2)}, anchors@25 ${metrics.anchorRecallAt25.toFixed(2)}`);
  }
  const expectedRows = rows.flatMap((row) => row.expected);
  const queryCount = Math.max(rows.length, 1);
  const report = {
    generatedAt: new Date().toISOString(),
    indexGeneratedAt: index.generatedAt,
    embeddingModel: index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL,
    dimensions: index.dimensions,
    vectorProfile: index.vectorProfile ?? "legacy",
    strategy,
    queryExpansionModel,
    queryCount: rows.length,
    expectedCount: expectedRows.length,
    averageNdcgAt10: round(aggregate.ndcgAt10 / queryCount),
    averagePrecisionAt10: round(aggregate.precisionAt10 / queryCount),
    averageExcellentAt10: round(aggregate.excellentAt10 / queryCount),
    averageJudgedAt10: round(aggregate.judgedAt10 / queryCount),
    averageAnchorRecallAt25: round(aggregate.anchorRecallAt25 / queryCount),
    expectedInTop10: expectedRows.filter((row) => row.inTop10).length,
    expectedInTop25: expectedRows.filter((row) => row.inTop25).length,
    expectedMissingDescription: expectedRows.filter((row) => row.bookId && !row.hasDescription).length,
    expectedNotMatched: expectedRows.filter((row) => !row.bookId).length,
    rows,
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(interpretationCachePath), { recursive: true });
  await fs.mkdir(path.dirname(poolReportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(
    interpretationCachePath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      interpretations: Object.fromEntries(interpretationCache),
    }, null, 2)}\n`,
  );
  await fs.writeFile(poolReportPath, `${JSON.stringify(buildJudgmentPool(report), null, 2)}\n`);
  console.log(`Semantic evaluation report written to ${path.relative(root, reportPath)}.`);
}

function normalizedJudgments(item: EvaluationQuery): RelevanceJudgment[] {
  const explicit = item.relevantTitles ?? [];
  const fallback = (item.expectedTitles ?? []).map((title): RelevanceJudgment => ({ title, rating: 3 }));
  const merged = new Map<string, RelevanceJudgment>();
  for (const judgment of [...explicit, ...fallback]) {
    const key = normalizeTitle(judgment.title);
    const existing = merged.get(key);
    if (!existing || judgment.rating > existing.rating) merged.set(key, judgment);
  }
  return [...merged.values()].filter((judgment) => judgment.rating > 0);
}

function judgmentForTitle(judgments: RelevanceJudgment[], title: string) {
  const normalized = normalizeTitle(title);
  return judgments.find((judgment) => titleMatchesExpected(normalized, normalizeTitle(judgment.title)));
}

function metricsForQuery(
  top: Array<{ relevance: number | null; judged: boolean }>,
  expected: Array<{ relevance: number; inTop25: boolean }>,
) {
  const at10 = top.slice(0, 10);
  const relevantAt10 = at10.filter((row) => (row.relevance ?? 0) >= 2).length;
  const excellentAt10 = at10.filter((row) => (row.relevance ?? 0) >= 3).length;
  const judgedAt10 = at10.filter((row) => row.judged).length;
  const dcgAt10 = dcg(at10.map((row) => row.relevance ?? 0));
  const idealAt10 = dcg(expected.map((row) => row.relevance).sort((a, b) => b - a).slice(0, 10));
  const anchors = expected.filter((row) => row.relevance >= 3);
  return {
    ndcgAt10: round(idealAt10 ? dcgAt10 / idealAt10 : 0),
    precisionAt10: round(relevantAt10 / 10),
    excellentAt10: round(excellentAt10 / 10),
    judgedAt10: round(judgedAt10 / 10),
    anchorRecallAt25: round(anchors.length ? anchors.filter((row) => row.inTop25).length / anchors.length : 0),
  };
}

function dcg(relevances: number[]) {
  return relevances.reduce((sum, relevance, index) => sum + ((2 ** relevance) - 1) / Math.log2(index + 2), 0);
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function normalizeTitle(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleMatchesExpected(bookTitle: string, expectedTitle: string) {
  if (bookTitle === expectedTitle) return true;
  if (bookTitle.startsWith(`${expectedTitle} `)) return true;
  if (bookTitle.startsWith(`${expectedTitle} a `)) return true;
  if (bookTitle.startsWith(`${expectedTitle} the `)) return true;
  if (bookTitle.startsWith(`${expectedTitle} an `)) return true;
  return expectedTitle.length >= 10 && bookTitle.includes(expectedTitle);
}

async function readInterpretationCache(seedReportPath: string) {
  const cache = new Map<string, CachedInterpretation>();
  try {
    const parsed = JSON.parse(await fs.readFile(interpretationCachePath, "utf8")) as {
      interpretations?: Record<string, CachedInterpretation>;
    };
    for (const [key, value] of Object.entries(parsed.interpretations ?? {})) cache.set(key, value);
  } catch {
    // Seed from a prior evaluation report below.
  }
  if (cache.size) return cache;
  const candidateReports = Array.from(new Set([
    seedReportPath,
    path.join(root, "data/reports/semantic-evaluation-report.json"),
  ]));
  for (const candidate of candidateReports) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8")) as {
        queryExpansionModel?: SemanticQueryExpansionModel;
        rows?: Array<{
          query: string;
          interpretation: SemanticQueryInterpretation | null;
          interpretationModel?: string;
          usedModelInterpretation?: boolean;
          interpretationWarning?: string;
        }>;
      };
      const model = parsed.queryExpansionModel ?? queryExpansionModel;
      for (const row of parsed.rows ?? []) {
        cache.set(interpretationCacheKey(row.query, model), {
          interpretation: row.interpretation,
          model: row.interpretationModel,
          usedModelInterpretation: row.usedModelInterpretation ?? false,
          warning: row.interpretationWarning,
        });
      }
      if (cache.size) return cache;
    } catch {
      // Try the next seed report.
    }
  }
  return cache;
}

async function interpretAndCache(
  query: string,
  model: SemanticQueryExpansionModel,
  cache: Map<string, CachedInterpretation>,
) {
  const result = await interpretSemanticQuery(query, model);
  const cached: CachedInterpretation = {
    interpretation: result.interpretation,
    model: result.model,
    usedModelInterpretation: result.usedModelInterpretation,
    warning: result.warning,
  };
  cache.set(interpretationCacheKey(query, model), cached);
  return cached;
}

function interpretationCacheKey(query: string, model: SemanticQueryExpansionModel) {
  return `${SEMANTIC_QUERY_INTERPRETATION_VERSION}:${model}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function buildJudgmentPool(report: {
  generatedAt: string;
  indexGeneratedAt: string;
  embeddingModel: string;
  dimensions: number;
  strategy: EvaluationStrategy;
  rows: Array<{
    query: string;
    top: Array<{
      rank: number;
      title?: string;
      author?: string;
      score: number;
      similarity: number;
      rawSimilarity?: number;
      expandedSimilarity?: number;
      experienceSimilarity?: number;
      judged: boolean;
      relevance: number | null;
      reasons: string[];
    }>;
  }>;
}) {
  return {
    generatedAt: report.generatedAt,
    indexGeneratedAt: report.indexGeneratedAt,
    embeddingModel: report.embeddingModel,
    dimensions: report.dimensions,
    strategy: report.strategy,
    instructions: "Review unjudged candidates and add clearly relevant titles to data/semantic-evaluation-queries.json with ratings 1-3.",
    queries: report.rows.map((row) => ({
      query: row.query,
      candidates: row.top
        .filter((candidate) => !candidate.judged && candidate.title)
        .slice(0, 20)
        .map(({ judged: _judged, relevance: _relevance, ...candidate }) => candidate),
    })),
  };
}

async function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local env file.
    }
  }
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveNumber(value: string | undefined, fallback = 25) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function queryModelArg(value: string | undefined): SemanticQueryExpansionModel {
  return value === "gpt-5.4-mini" || value === "gemini-3.5-flash" ? value : "gpt-5.4-nano";
}

function strategyArg(value: string | undefined): EvaluationStrategy {
  if (value === "legacy" || value === "dual" || value === "multi") return value;
  return "multi";
}

function resolveRootPath(value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
