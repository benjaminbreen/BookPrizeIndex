import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  corpusTermWeights,
  inferPeriodRanges,
  semanticHybridScore,
  semanticQueryText,
  searchTerms,
  type SemanticBookIndex,
  type SemanticQueryInterpretation,
  type SemanticSearchResult,
} from "@/lib/semantic-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SemanticSearchRequest = {
  candidateBookIds?: string[];
  limit?: number;
  query?: string;
};

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

type ResponsesApiJson = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

let indexCache: Promise<SemanticBookIndex | null> | null = null;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SemanticSearchRequest | null;
  const query = body?.query?.trim() ?? "";
  if (query.length < 3) {
    return Response.json({ error: "Query must be at least 3 characters." }, { status: 400 });
  }
  if (query.length > 600) {
    return Response.json({ error: "Query is too long for semantic search." }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  }

  const index = await loadSemanticIndex();
  if (!index?.books.length) {
    return Response.json({ error: "Semantic index is missing. Run `npm run semantic:index` first." }, { status: 503 });
  }

  const limit = Math.min(Math.max(body?.limit ?? 120, 1), 500);
  const candidateIds = new Set((body?.candidateBookIds ?? []).filter(Boolean));
  const candidates = candidateIds.size ? index.books.filter((row) => candidateIds.has(row.bookId)) : index.books;
  if (!candidates.length) {
    return Response.json({
      query,
      interpretation: null,
      results: [],
      warning: "No candidate books were available for the current filters.",
    });
  }

  const { interpretation, model: interpretationModel, usedModelInterpretation, warning } = await interpretQuery(query);
  const embeddingInput = semanticQueryText(query, interpretation);
  const queryEmbedding = await embedQuery(embeddingInput, index);
  const rankingTerms = searchTerms(embeddingInput);
  const termWeights = corpusTermWeights(rankingTerms, candidates);
  const results = candidates
    .map((row): SemanticSearchResult => ({
      bookId: row.bookId,
      ...semanticHybridScore({ interpretation, query, queryEmbedding, row, termWeights }),
    }))
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
    .slice(0, limit);

  return Response.json({
    diagnostics: {
      candidateBookCount: candidates.length,
      embeddingInput,
      embeddingModel: index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL,
      indexBookCount: index.books.length,
      indexGeneratedAt: index.generatedAt,
      interpretationModel,
      rankingTerms,
      resultCount: results.length,
      usedModelInterpretation,
    },
    query,
    interpretation,
    results,
    warning,
  });
}

async function loadSemanticIndex() {
  if (indexCache) return indexCache;
  try {
    const content = await fs.readFile(path.join(process.cwd(), "data", "public", "book-semantic-index.json"), "utf8");
    const parsed = JSON.parse(content) as SemanticBookIndex;
    indexCache = Promise.resolve(parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function embedQuery(input: string, index: SemanticBookIndex) {
  const response = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
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
  }, 3, 20000);
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as EmbeddingResponse;
  return json.data[0]?.embedding ?? [];
}

async function interpretQuery(query: string): Promise<{ interpretation: SemanticQueryInterpretation | null; model?: string; usedModelInterpretation: boolean; warning?: string }> {
  if (!shouldInterpretQuery(query)) return { interpretation: null, usedModelInterpretation: false };
  const model = process.env.OPENAI_SEMANTIC_QUERY_MODEL ?? "gpt-5.4-mini";
  const fallback = fallbackInterpretation(query);
  try {
    const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Rewrite a reader's natural-language book discovery query into concise nonfiction search intent. Preserve dates, periods, themes, disciplines, and named entities. Return JSON only.",
          },
          {
            role: "user",
            content: query,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "semantic_search_interpretation",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                expandedQuery: { type: "string" },
                concepts: { type: "array", items: { type: "string" }, maxItems: 10 },
                eras: { type: "array", items: { type: "string" }, maxItems: 6 },
                subjects: { type: "array", items: { type: "string" }, maxItems: 6 },
              },
              required: ["expandedQuery", "concepts", "eras", "subjects"],
            },
          },
        },
      }),
    }, 2, 12000);
    if (!response.ok) return { interpretation: fallback, model, usedModelInterpretation: false, warning: `Query expansion unavailable (${response.status}); used local interpretation.` };
    const json = await response.json() as ResponsesApiJson;
    const textOut = json.output_text ?? json.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
    const parsed = JSON.parse(textOut) as SemanticQueryInterpretation;
    return { interpretation: sanitizeInterpretation(parsed, fallback), model, usedModelInterpretation: true };
  } catch (error) {
    return {
      interpretation: fallback,
      model,
      usedModelInterpretation: false,
      warning: `Query expansion unavailable; used local interpretation. ${error instanceof Error ? error.message.slice(0, 120) : ""}`.trim(),
    };
  }
}

function shouldInterpretQuery(query: string) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length >= 5 || /\b(writing|book called|recommend|looking for|similar to|about)\b/i.test(query);
}

function fallbackInterpretation(query: string): SemanticQueryInterpretation {
  const quotedPhrases = Array.from(query.matchAll(/["'“”]([^"'“”]{3,80})["'“”]/g)).map((match) => match[1]);
  const eras = inferPeriodRanges(query).map((period) => period.label);
  const concepts = unique([...quotedPhrases, ...searchTerms(query)]).slice(0, 10);
  return {
    expandedQuery: [query, concepts.length ? `Key terms: ${concepts.join(", ")}` : "", eras.length ? `Periods: ${eras.join(", ")}` : ""].filter(Boolean).join(" / "),
    concepts,
    eras: unique(eras),
    subjects: [],
  };
}

function sanitizeInterpretation(parsed: SemanticQueryInterpretation, fallback: SemanticQueryInterpretation): SemanticQueryInterpretation {
  const parsedConcepts = unique(parsed.concepts ?? []);
  const parsedEras = unique(parsed.eras ?? []);
  const parsedSubjects = unique(parsed.subjects ?? []);
  return {
    expandedQuery: (parsed.expandedQuery || fallback.expandedQuery).slice(0, 800),
    concepts: (parsedConcepts.length ? parsedConcepts : fallback.concepts).slice(0, 10),
    eras: unique([...(parsedEras.length ? parsedEras : []), ...fallback.eras]).slice(0, 6),
    subjects: (parsedSubjects.length ? parsedSubjects : fallback.subjects).slice(0, 6),
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function fetchWithRetry(url: string, init: RequestInit, attempts: number, timeoutMs: number) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}
