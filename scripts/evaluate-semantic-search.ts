import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  corpusTermWeights,
  semanticHybridScore,
  semanticQueryText,
  semanticRankFusion,
  searchTerms,
  type SemanticBookIndex,
  type SemanticQueryInterpretation,
} from "../lib/semantic-search";

type EvaluationQuery = {
  query: string;
  expectedTitles: string[];
};

type EvaluationFile = {
  queries: EvaluationQuery[];
};

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "data", "public", "book-semantic-index.json");
const evaluationPath = path.join(root, "data", "semantic-evaluation-queries.json");
const reportPath = path.join(root, "data", "public", "semantic-evaluation-report.json");
const limit = positiveNumber(readArg("--limit"), 25);

async function main() {
  await loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to evaluate semantic search queries.");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as SemanticBookIndex;
  const evaluation = JSON.parse(await fs.readFile(evaluationPath, "utf8")) as EvaluationFile;
  const rows = [];
  for (const item of evaluation.queries) {
    const interpretation = fallbackInterpretation(item.query);
    const embeddingInput = semanticQueryText(item.query, interpretation);
    const queryEmbedding = await embedQuery(embeddingInput, index);
    const rankingTerms = searchTerms(embeddingInput);
    const termWeights = corpusTermWeights(rankingTerms, index.books);
    const results = semanticRankFusion(index.books.map((row) => ({
      bookId: row.bookId,
      ...semanticHybridScore({ interpretation, query: item.query, queryEmbedding, row, termWeights }),
    }))).sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    const top = results.slice(0, limit).map((result, rank) => {
      const row = index.books.find((book) => book.bookId === result.bookId);
      return {
        rank: rank + 1,
        title: row?.title,
        author: row?.author,
        score: result.score,
        similarity: result.similarity,
        lexicalScore: result.lexicalScore,
        reasons: result.reasons,
      };
    });
    const expected = item.expectedTitles.map((title) => {
      const normalized = normalizeTitle(title);
      const rank = results.findIndex((result) => {
        const row = index.books.find((book) => book.bookId === result.bookId);
        return row ? normalizeTitle(row.title).includes(normalized) || normalized.includes(normalizeTitle(row.title)) : false;
      });
      return {
        title,
        rank: rank >= 0 ? rank + 1 : null,
        inTop10: rank >= 0 && rank < 10,
        inTop25: rank >= 0 && rank < 25,
      };
    });
    rows.push({
      query: item.query,
      expected,
      top,
    });
    console.log(`${item.query}: ${expected.filter((row) => row.inTop25).length}/${expected.length} expected titles in top 25`);
  }
  const expectedRows = rows.flatMap((row) => row.expected);
  const report = {
    generatedAt: new Date().toISOString(),
    indexGeneratedAt: index.generatedAt,
    embeddingModel: index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL,
    queryCount: rows.length,
    expectedCount: expectedRows.length,
    expectedInTop10: expectedRows.filter((row) => row.inTop10).length,
    expectedInTop25: expectedRows.filter((row) => row.inTop25).length,
    rows,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Semantic evaluation report written to ${path.relative(root, reportPath)}.`);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
