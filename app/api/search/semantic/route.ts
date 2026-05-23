import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  corpusTermWeights,
  inferPeriodRanges,
  semanticAdventurousConcepts,
  semanticCoreConcepts,
  semanticHybridScore,
  semanticQueryText,
  semanticRankingTerms,
  semanticRankFusion,
  searchTerms,
  type SemanticBookIndex,
  type SemanticQueryExpansionModel,
  type SemanticQueryInterpretation,
  type SemanticSearchResult,
} from "@/lib/semantic-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SemanticSearchRequest = {
  candidateBookIds?: string[];
  limit?: number;
  query?: string;
  queryExpansionModel?: SemanticQueryExpansionModel;
};

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

type ResponsesApiJson = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

type GeminiApiJson = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

let indexCache: Promise<SemanticBookIndex | null> | null = null;

const DEFAULT_QUERY_EXPANSION_MODEL: SemanticQueryExpansionModel = "gemini-3.5-flash";
const QUERY_INTERPRETATION_PROMPT =
  [
    "Rewrite a reader's natural-language book discovery query into concise nonfiction search intent.",
    "This is semantic query expansion, not keyword extraction. Do not merely repeat the user's words.",
    "Preserve dates, periods, themes, disciplines, and named entities, but add adjacent nonfiction domains that would help retrieval.",
    "Return both grounded coreConcepts and more adventurousConcepts. Core concepts are defensible, central meanings. Adventurous concepts are surprising, idiosyncratic, adjacent taste signals that may broaden discovery.",
    "For taste or persona queries about a public figure, online handle, community, publication, movement, or cultural reference, infer broadly recognizable nonfiction themes, styles, and adjacent domains when supported.",
    "For persona/taste queries, prioritize taste signals over biographical facts or books literally about that person. Include canonical interests and surprising long-tail interests when culturally recognizable.",
    "If a named reference is ambiguous, keep the name and add cautious adjacent concepts from the surrounding query rather than overcommitting to one same-name product or organization.",
    "Avoid generic filler such as books, stuff, things, someone, something, would like, recommendations, why, still, and matter.",
    "Good expansion examples:",
    "Query: books for understanding why the 1970s still matter -> expandedQuery: nonfiction about the political, economic, cultural, energy, labor, and conservative-turn legacies of the 1970s; coreConcepts: stagflation, oil crisis, labor decline, New Right, late Cold War, social change; adventurousConcepts: urban crisis, evangelical politics, punk and counterculture, deregulation, environmentalism; eras: 1970s, late 20th century; subjects: history, politics, economics, culture.",
    "Query: something for a smart teenager who likes maps, ruins, and mysteries -> expandedQuery: accessible narrative nonfiction about cartography, archaeology, ancient civilizations, exploration, decipherment, and historical puzzles; coreConcepts: cartography, archaeology, ancient ruins, lost cities, decipherment, historical mysteries; adventurousConcepts: manuscript studies, cave exploration, shipwrecks, vanished empires, museum collections; subjects: history, science, travel.",
    "Query: books Obama would like but weirder -> expandedQuery: politically and culturally serious nonfiction adjacent to Barack Obama's public reading taste, but more unconventional, speculative, quirky, or idea-driven; coreConcepts: democracy, race, power, global politics, literary nonfiction, cultural criticism; adventurousConcepts: speculative science, intellectual biography, postcolonial travel, experimental memoir, unusual natural history; subjects: politics, history, culture, science.",
    "Query: stuff Tyler Cowen would like -> expandedQuery: nonfiction adjacent to Tyler Cowen's public taste: economics, progress, institutions, high-low culture, travel, food, and unusual expertise; coreConcepts: economics, progress studies, state capacity, talent discovery, economic history, technology; adventurousConcepts: strip mall food, regional restaurant culture, niche local histories, literature in translation, travel notes, obscure expertise, museum-like curiosity, high-low culture; subjects: economics, history, technology, culture, food.",
    "Return JSON only.",
  ].join("\n");
const GEMINI_STRICT_QUERY_INTERPRETATION_PROMPT =
  [
    QUERY_INTERPRETATION_PROMPT,
    "Extra requirement: produce at least four useful concepts that are not simple substrings of the original query unless the query only names a title or exact entity.",
    "Do not include filler words as concepts. If the first interpretation would only echo the query, infer broader nonfiction retrieval concepts instead.",
  ].join("\n");
const QUERY_INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    expandedQuery: { type: "string" },
    concepts: { type: "array", items: { type: "string" }, maxItems: 10 },
    adventurousConcepts: { type: "array", items: { type: "string" }, maxItems: 8 },
    coreConcepts: { type: "array", items: { type: "string" }, maxItems: 8 },
    eras: { type: "array", items: { type: "string" }, maxItems: 6 },
    subjects: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["expandedQuery", "concepts", "coreConcepts", "adventurousConcepts", "eras", "subjects"],
};

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

  const queryExpansionModel = parseQueryExpansionModel(body?.queryExpansionModel);
  const { interpretation, model: interpretationModel, usedModelInterpretation, warning } = await interpretQuery(query, queryExpansionModel);
  const embeddingInput = semanticQueryText(query, interpretation);
  const queryEmbedding = await embedQuery(embeddingInput, index);
  const rankingTerms = semanticRankingTerms(query, interpretation);
  const termWeights = corpusTermWeights(rankingTerms, candidates);
  const scored = candidates
    .map((row): SemanticSearchResult => ({
      bookId: row.bookId,
      ...semanticHybridScore({ interpretation, query, queryEmbedding, row, termWeights }),
    }));
  const results = semanticRankFusion(scored)
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
      queryExpansionModel,
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

async function interpretQuery(
  query: string,
  queryExpansionModel: SemanticQueryExpansionModel,
): Promise<{ interpretation: SemanticQueryInterpretation | null; model?: string; usedModelInterpretation: boolean; warning?: string }> {
  if (!shouldInterpretQuery(query)) return { interpretation: null, usedModelInterpretation: false };
  const fallback = fallbackInterpretation(query);
  if (queryExpansionModel === "gemini-3.5-flash") return interpretQueryWithGemini(query, fallback);
  return interpretQueryWithOpenAI(query, fallback);
}

async function interpretQueryWithOpenAI(
  query: string,
  fallback: SemanticQueryInterpretation,
): Promise<{ interpretation: SemanticQueryInterpretation; model: string; usedModelInterpretation: boolean; warning?: string }> {
  const model = process.env.OPENAI_SEMANTIC_QUERY_MODEL ?? "gpt-5.4-mini";
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
            content: QUERY_INTERPRETATION_PROMPT,
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
            schema: QUERY_INTERPRETATION_JSON_SCHEMA,
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

async function interpretQueryWithGemini(
  query: string,
  fallback: SemanticQueryInterpretation,
): Promise<{ interpretation: SemanticQueryInterpretation; model: string; usedModelInterpretation: boolean; warning?: string }> {
  const model = process.env.GEMINI_SEMANTIC_QUERY_MODEL ?? "gemini-3.5-flash";
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return fallbackToOpenAIAfterGeminiFailure(query, fallback, "Gemini query expansion unavailable; GEMINI_API_KEY is not configured.");
  }
  try {
    const first = await fetchGeminiInterpretation({ apiKey, model, prompt: QUERY_INTERPRETATION_PROMPT, query });
    if (!first.response.ok) {
      const detail = summarizeProviderError(await first.response.text());
      return fallbackToOpenAIAfterGeminiFailure(query, fallback, `Gemini query expansion unavailable (${first.response.status}${detail ? `: ${detail}` : ""}).`);
    }
    const firstParsed = await parseGeminiInterpretation(first.response);
    if (!isShallowInterpretation(query, firstParsed)) {
      return { interpretation: sanitizeInterpretation(firstParsed, fallback), model, usedModelInterpretation: true };
    }
    const retry = await fetchGeminiInterpretation({ apiKey, model, prompt: GEMINI_STRICT_QUERY_INTERPRETATION_PROMPT, query });
    if (!retry.response.ok) {
      return {
        interpretation: sanitizeInterpretation(firstParsed, fallback),
        model,
        usedModelInterpretation: true,
        warning: "Gemini query expansion looked shallow; stricter retry failed, so the first interpretation was used.",
      };
    }
    const retryParsed = await parseGeminiInterpretation(retry.response);
    const interpretation = isShallowInterpretation(query, retryParsed) ? firstParsed : retryParsed;
    return {
      interpretation: sanitizeInterpretation(interpretation, fallback),
      model,
      usedModelInterpretation: true,
      warning: isShallowInterpretation(query, retryParsed) ? "Gemini query expansion may be conservative for this query." : undefined,
    };
  } catch (error) {
    return fallbackToOpenAIAfterGeminiFailure(query, fallback, `Gemini query expansion unavailable. ${error instanceof Error ? error.message.slice(0, 120) : ""}`.trim());
  }
}

async function fallbackToOpenAIAfterGeminiFailure(query: string, fallback: SemanticQueryInterpretation, reason: string) {
  const openAiResult = await interpretQueryWithOpenAI(query, fallback);
  return {
    ...openAiResult,
    warning: `${reason} ${openAiResult.usedModelInterpretation ? "Used OpenAI query expansion instead." : "Used local interpretation."}`,
  };
}

async function fetchGeminiInterpretation({
  apiKey,
  model,
  prompt,
  query,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  query: string;
}) {
  const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: prompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: query }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: QUERY_INTERPRETATION_JSON_SCHEMA,
        temperature: 0.1,
      },
    }),
  }, 2, 12000);
  return { response };
}

async function parseGeminiInterpretation(response: Response) {
  const json = await response.json() as GeminiApiJson;
  const textOut = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return JSON.parse(textOut) as SemanticQueryInterpretation;
}

function shouldInterpretQuery(query: string) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3 || QUERY_INTERPRETATION_TRIGGER.test(query);
}

const QUERY_INTERPRETATION_TRIGGER =
  /\b(writing|book called|recommend(?:ation|ations)?|looking for|similar to|about|would like|would enjoy|might like|for fans of|books? for|stuff for|vibe|sensibility|taste|adjacent|like this|like these|read next|what to read|interested in|into|on the subject of)\b/i;

function parseQueryExpansionModel(value: unknown): SemanticQueryExpansionModel {
  return value === "gemini-3.5-flash" || value === "gpt-5.4-mini" ? value : DEFAULT_QUERY_EXPANSION_MODEL;
}

function fallbackInterpretation(query: string): SemanticQueryInterpretation {
  const quotedPhrases = Array.from(query.matchAll(/["'“”]([^"'“”]{3,80})["'“”]/g)).map((match) => match[1]);
  const eras = inferPeriodRanges(query).map((period) => period.label);
  const concepts = unique([...quotedPhrases, ...searchTerms(query)]).slice(0, 10);
  return {
    expandedQuery: [query, concepts.length ? `Key terms: ${concepts.join(", ")}` : "", eras.length ? `Periods: ${eras.join(", ")}` : ""].filter(Boolean).join(" / "),
    concepts,
    adventurousConcepts: [],
    coreConcepts: concepts.slice(0, 8),
    eras: unique(eras),
    subjects: [],
  };
}

function sanitizeInterpretation(parsed: SemanticQueryInterpretation, fallback: SemanticQueryInterpretation): SemanticQueryInterpretation {
  const parsedCoreConcepts = unique(parsed.coreConcepts ?? []);
  const parsedConcepts = unique(parsed.concepts ?? []);
  const parsedAdventurousConcepts = unique(parsed.adventurousConcepts ?? []);
  const parsedEras = unique(parsed.eras ?? []);
  const parsedSubjects = unique(parsed.subjects ?? []);
  const coreConcepts = (parsedCoreConcepts.length ? parsedCoreConcepts : parsedConcepts.length ? parsedConcepts : semanticCoreConcepts(fallback)).slice(0, 8);
  const adventurousConcepts = parsedAdventurousConcepts
    .filter((concept) => !coreConcepts.some((coreConcept) => normalizeComparable(coreConcept) === normalizeComparable(concept)))
    .slice(0, 8);
  return {
    expandedQuery: (parsed.expandedQuery || fallback.expandedQuery).slice(0, 800),
    concepts: unique([...coreConcepts, ...adventurousConcepts.slice(0, 4)]).slice(0, 10),
    adventurousConcepts,
    coreConcepts,
    eras: unique([...(parsedEras.length ? parsedEras : []), ...fallback.eras]).slice(0, 6),
    subjects: (parsedSubjects.length ? parsedSubjects : fallback.subjects).slice(0, 6),
  };
}

function isShallowInterpretation(query: string, interpretation: SemanticQueryInterpretation) {
  const queryText = normalizeComparable(query);
  const concepts = unique([...semanticCoreConcepts(interpretation), ...semanticAdventurousConcepts(interpretation)]);
  const conceptText = normalizeComparable(concepts.join(" "));
  const conceptTerms = new Set(searchTerms(conceptText));
  const queryTerms = new Set(searchTerms(queryText));
  const novelConceptTerms = [...conceptTerms].filter((term) => !queryTerms.has(term));
  const novelConceptPhrases = concepts.filter((concept) => {
    const normalized = normalizeComparable(concept);
    return normalized.length >= 4 && !queryText.includes(normalized);
  });
  const expanded = normalizeComparable(interpretation.expandedQuery ?? "");
  if (!concepts.length) return true;
  if (/\bkey terms\b/.test(expanded)) return true;
  if (/\b(would like|might like|for fans of|taste|sensibility|stuff)\b/i.test(query) && semanticAdventurousConcepts(interpretation).length < 3) return true;
  if (concepts.length < 4 && !interpretation.subjects.length && !interpretation.eras.length) return true;
  if (novelConceptTerms.length < 3 && novelConceptPhrases.length < 2 && interpretation.subjects.length < 2) return true;
  return false;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function summarizeProviderError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
    return [parsed.error?.status, parsed.error?.message].filter(Boolean).join(" - ").slice(0, 180);
  } catch {
    return body.replace(/\s+/g, " ").trim().slice(0, 180);
  }
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
