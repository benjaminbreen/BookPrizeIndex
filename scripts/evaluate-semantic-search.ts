import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  corpusTermWeights,
  semanticHybridScore,
  semanticQueryText,
  semanticRankingTerms,
  semanticRankFusion,
  searchTerms,
  type SemanticBookIndex,
  type SemanticQueryInterpretation,
} from "../lib/semantic-search";

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

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = resolveRootPath(readArg("--index") ?? "data/public/book-semantic-index.json");
const evaluationPath = path.join(root, "data", "semantic-evaluation-queries.json");
const reportPath = resolveRootPath(readArg("--report") ?? "data/public/semantic-evaluation-report.json");
const limit = positiveNumber(readArg("--limit"), 25);

async function main() {
  await loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to evaluate semantic search queries.");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as SemanticBookIndex;
  const evaluation = JSON.parse(await fs.readFile(evaluationPath, "utf8")) as EvaluationFile;
  const rows = [];
  const aggregate = {
    ndcgAt10: 0,
    precisionAt10: 0,
    excellentAt10: 0,
    judgedAt10: 0,
    anchorRecallAt25: 0,
  };
  for (const item of evaluation.queries) {
    const interpretation = fallbackInterpretation(item.query);
    const embeddingInput = semanticQueryText(item.query, interpretation);
    const queryEmbedding = await embedQuery(embeddingInput, index);
    const rankingTerms = semanticRankingTerms(item.query, interpretation);
    const termWeights = corpusTermWeights(rankingTerms, index.books);
    const results = semanticRankFusion(index.books.map((row) => ({
      bookId: row.bookId,
      ...semanticHybridScore({ interpretation, query: item.query, queryEmbedding, row, termWeights }),
    }))).sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    const judgments = normalizedJudgments(item);
    const negativeTitles = new Set((item.negativeTitles ?? []).map((title) => normalizeTitle(title)));
    const top = results.slice(0, limit).map((result, rank) => {
      const row = index.books.find((book) => book.bookId === result.bookId);
      const judgment = row ? judgmentForTitle(judgments, row.title) : undefined;
      return {
        rank: rank + 1,
        title: row?.title,
        author: row?.author,
        score: result.score,
        similarity: result.similarity,
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
      const rank = results.findIndex((result) => {
        const row = index.books.find((book) => book.bookId === result.bookId);
        return row ? titleMatchesExpected(normalizeTitle(row.title), normalized) : false;
      });
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
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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

function fallbackInterpretation(query: string): SemanticQueryInterpretation {
  const concepts = searchTerms(query).slice(0, 10);
  return {
    expandedQuery: [query, concepts.length ? `Key terms: ${concepts.join(", ")}` : ""].filter(Boolean).join(" / "),
    concepts,
    eras: [],
    subjects: [],
  };
}

async function embedQuery(input: string, index: SemanticBookIndex) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL,
      input,
      dimensions: index.dimensions,
      encoding_format: "float",
    }),
  });
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as EmbeddingResponse;
  return json.data[0]?.embedding ?? [];
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

function resolveRootPath(value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
