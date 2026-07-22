import { createHash } from "node:crypto";
import path from "node:path";
import { bookAuthorsMatchIntent, fallbackAuthorIntent } from "@/lib/author-discovery";
import type { BookCatalogQuery } from "@/lib/book-catalog-query";
import { readSemanticBookIndex } from "@/lib/semantic-index-storage";
import {
  getSemanticSearchGuard,
  semanticSearchEnabled,
  type SemanticSearchPermit,
} from "@/lib/semantic-search-guard";
import {
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  createSemanticQueryContext,
  inferPeriodRanges,
  semanticAdventurousConcepts,
  semanticCoreConcepts,
  semanticHybridScore,
  semanticQueryText,
  semanticRankFusion,
  semanticRowMatchesFilters,
  semanticTermWeights,
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
  filters?: Pick<BookCatalogQuery, "awardId" | "metadata" | "publisherId" | "region" | "subject" | "topic">;
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
const interpretationCache = new Map<string, PromiseCacheEntry<SemanticInterpretationResult>>();
const embeddingCache = new Map<string, PromiseCacheEntry<number[]>>();
const semanticResultCache = new Map<string, ValueCacheEntry<SemanticSearchResponsePayload>>();

type SemanticInterpretationResult = {
  interpretation: SemanticQueryInterpretation | null;
  model?: string;
  usedModelInterpretation: boolean;
  warning?: string;
};

type SemanticSearchResponsePayload = {
  diagnostics: Record<string, unknown>;
  query: string;
  interpretation: SemanticQueryInterpretation | null;
  results: SemanticSearchResult[];
  warning?: string;
};

type PromiseCacheEntry<T> = { expiresAt: number; promise: Promise<T> };
type ValueCacheEntry<T> = { expiresAt: number; value: T };

const DEFAULT_QUERY_EXPANSION_MODEL: SemanticQueryExpansionModel = "gpt-5.4-nano";
const QUERY_INTERPRETATION_PROMPT =
  [
    "Rewrite a reader's natural-language book discovery query into compact nonfiction search intent.",
    "Keep expandedQuery to 20-45 words. Prefer three to six short core concepts; use at most three adventurous concepts.",
    "Do not enumerate every possible subtopic, system, example, failure mode, or synonym. The expansion must stay narrower than a research outline.",
    "Preserve important dates, periods, themes, disciplines, people, and places. Put people in namedFigures and geographic entities in namedPlaces so exact entity matches can be ranked separately.",
    "For a place-centered topic with one broadly recognized, genuinely central individual, include at most that one person in namedFigures; otherwise leave namedFigures empty.",
    "Set publicationDateIntent to older or newer only when the reader asks for classic/old/older/recent/newer books as publications. A historical period discussed inside a book belongs in eras instead. Set publicationYearCutoff to 0 unless the reader supplies or clearly implies a useful cutoff.",
    "This is semantic query expansion, not keyword extraction. Add only adjacent domains that materially improve retrieval.",
    "Core concepts are central meanings. Adventurous concepts are optional, surprising adjacent taste signals; omit them for straightforward topical queries.",
    "Distinguish a requested writing method or reading experience from subject matter. For a query asking for reported, narrative, lyrical, accessible, or scholarly writing without naming a topic, keep subjects empty and express the method or style in coreConcepts.",
    "Describe only desired attributes in expandedQuery and concept arrays. Do not restate exclusions as phrases such as 'rather than memoir' or 'not academic'; simply omit the excluded concept.",
    "Set concepts to the compact union of coreConcepts and adventurousConcepts.",
    "For taste or persona queries about a public figure, online handle, community, publication, movement, or cultural reference, infer broadly recognizable nonfiction themes, styles, and adjacent domains when supported.",
    "For persona/taste queries, prioritize taste signals over biographical facts or books literally about that person. Include canonical interests and surprising long-tail interests when culturally recognizable.",
    "Separate the intended audience from the desired content. Put audience labels such as parents, students, beginners, or professionals in audienceTerms; do not repeat them in coreConcepts, subjects, or expandedQuery unless the reader explicitly wants books about that group.",
    "Use authorIntent only for public author facets: country connections, living/deceased status, and public platforms such as Substack.",
    "Set authorIntent.mode to filter when the reader explicitly asks for books by authors with those attributes, such as 'by living Irish writers' or 'writers on Substack'. Set it to boost for audience-taste guesses such as 'books Substack readers would like'. Otherwise use none.",
    "Do not confuse a book's subject geography with its author's country. 'Biographies about Latin America' is a book-topic/place request; 'biographies by Latin American writers' is an author request.",
    "Put bands, magazines, communities, movements, public figures used as taste references, and similar reference points in culturalReferences. Translate their recognizable sensibility into core concepts; do not turn a taste reference into a literal same-word subject.",
    "If a named reference is ambiguous, keep the name and add cautious adjacent concepts from the surrounding query rather than overcommitting to one same-name product or organization.",
    "Avoid generic filler such as books, stuff, things, someone, something, would like, recommendations, why, still, and matter.",
    "Examples:",
    "Query: books about the remaking of modern Paris -> expandedQuery: nonfiction about the planning, public works, political authority, and social consequences that reshaped modern Paris; coreConcepts: urban transformation, public works, planning power; adventurousConcepts: infrastructure politics; namedFigures: Georges-Eugène Haussmann; namedPlaces: Paris; eras: 19th century; subjects: urban history, architecture; publicationDateIntent: none; publicationYearCutoff: 0.",
    "Query: older works worth rediscovering -> expandedQuery: earlier nonfiction works whose arguments or influence merit renewed attention; coreConcepts: neglected works, intellectual rediscovery, changing reception; adventurousConcepts: empty; namedFigures: empty; namedPlaces: empty; eras: empty; subjects: criticism, intellectual history; publicationDateIntent: older; publicationYearCutoff: 1990.",
    "Query: books Obama would like but weirder -> expandedQuery: politically serious, literary nonfiction with unconventional or idea-driven choices; audienceTerms: empty; culturalReferences: Barack Obama; coreConcepts: democracy, race, power, global politics; adventurousConcepts: unusual natural history, experimental memoir; namedFigures: empty; namedPlaces: empty; subjects: politics, culture; publicationDateIntent: none; publicationYearCutoff: 0.",
    "Return JSON only.",
  ].join("\n");
const GEMINI_STRICT_QUERY_INTERPRETATION_PROMPT =
  [
    QUERY_INTERPRETATION_PROMPT,
    "Extra requirement: produce at least three useful core concepts, but remain within the length and item caps.",
    "Do not add detail merely to make the response look comprehensive.",
  ].join("\n");
const QUERY_INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    expandedQuery: { type: "string", maxLength: 320 },
    audienceTerms: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 4 },
    culturalReferences: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    concepts: { type: "array", items: { type: "string", maxLength: 72 }, maxItems: 8 },
    adventurousConcepts: { type: "array", items: { type: "string", maxLength: 72 }, maxItems: 3 },
    coreConcepts: { type: "array", items: { type: "string", maxLength: 72 }, maxItems: 6 },
    namedFigures: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    namedPlaces: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    publicationDateIntent: { type: "string", enum: ["older", "newer", "none"] },
    publicationYearCutoff: { type: "integer", minimum: 0, maximum: 2100 },
    eras: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 3 },
    subjects: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 4 },
    authorIntent: {
      type: "object",
      additionalProperties: false,
      properties: {
        countries: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 4 },
        lifeStatus: { type: "string", enum: ["living", "deceased", "unknown", "any"] },
        platforms: { type: "array", items: { type: "string", enum: ["substack"] }, maxItems: 2 },
        mode: { type: "string", enum: ["filter", "boost", "none"] },
      },
      required: ["countries", "lifeStatus", "platforms", "mode"],
    },
  },
  required: ["expandedQuery", "audienceTerms", "culturalReferences", "concepts", "coreConcepts", "adventurousConcepts", "namedFigures", "namedPlaces", "publicationDateIntent", "publicationYearCutoff", "eras", "subjects", "authorIntent"],
};

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  const body = await request.json().catch(() => null) as SemanticSearchRequest | null;
  const query = body?.query?.trim() ?? "";
  if (query.length < 3) {
    return privateJson({ error: "Query must be at least 3 characters." }, { status: 400 });
  }
  if (query.length > 600) {
    return privateJson({ error: "Query is too long for semantic search." }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return privateJson({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  }
  if (!semanticSearchEnabled()) {
    return privateJson({ error: "Meaning search is temporarily disabled." }, { status: 503 });
  }

  const index = await loadSemanticIndex();
  if (!index?.books.length) {
    return privateJson({ error: "Semantic index is missing. Run `npm run semantic:index` first." }, { status: 503 });
  }

  const limit = Math.min(Math.max(body?.limit ?? 120, 1), 500);
  const candidateIds = new Set((body?.candidateBookIds ?? []).filter(Boolean));
  const candidates = index.books.filter((row) =>
    (!candidateIds.size || candidateIds.has(row.bookId)) && (!body?.filters || semanticRowMatchesFilters(row, body.filters)),
  );
  if (!candidates.length) {
    return privateJson({
      diagnostics: {
        candidateBookCount: 0,
        indexBookCount: index.books.length,
        indexGeneratedAt: index.generatedAt,
        queryExpansionModel: parseQueryExpansionModel(body?.queryExpansionModel),
        resultCount: 0,
        usedModelInterpretation: false,
      },
      query,
      interpretation: null,
      results: [],
      warning: "No candidate books were available for the current filters.",
    });
  }

  const queryExpansionModel = parseQueryExpansionModel(body?.queryExpansionModel);
  const resultCacheKey = semanticResultCacheKey({ body, index, limit, query, queryExpansionModel });
  const cachedResult = readValueCache(semanticResultCache, resultCacheKey);
  if (cachedResult) {
    const totalMs = elapsedMs(requestStartedAt);
    return privateJson({
      ...cachedResult,
      diagnostics: { ...cachedResult.diagnostics, cacheHit: true, totalMs },
    }, { headers: { "Server-Timing": `total;dur=${totalMs}, cache;desc=hit` } });
  }

  const permit = getSemanticSearchGuard().acquire();
  if (!permit.allowed) return semanticSearchLimitResponse(permit);

  try {
    const interpretationStartedAt = performance.now();
    const { interpretation, model: interpretationModel, usedModelInterpretation, warning } = await interpretSemanticQuery(query, queryExpansionModel);
    const interpretationMs = elapsedMs(interpretationStartedAt);
    const embeddingInput = semanticQueryText(query, interpretation);
    const embeddingStartedAt = performance.now();
    const queryEmbedding = await embedSemanticQuery(embeddingInput, index);
    const embeddingMs = elapsedMs(embeddingStartedAt);
    const rankingStartedAt = performance.now();
    const queryContext = createSemanticQueryContext(query, interpretation);
    const rankingTerms = queryContext.terms;
    const authorIntent = interpretation?.authorIntent;
    const rankedCandidates = authorIntent?.mode === "filter"
      ? candidates.filter((row) => bookAuthorsMatchIntent(row.authors, authorIntent))
      : candidates;
    const termWeights = semanticTermWeights(query, interpretation, rankedCandidates);
    const scored = rankedCandidates
      .map((row): SemanticSearchResult => {
        const base = semanticHybridScore({ context: queryContext, interpretation, query, queryEmbedding, row, termWeights });
        const authorMatch = bookAuthorsMatchIntent(row.authors, authorIntent);
        const authorFacetBoost = authorIntent?.mode === "boost" && authorMatch ? 0.55 : 0;
        return {
          bookId: row.bookId,
          ...base,
          score: base.score + authorFacetBoost,
          authorFacetBoost,
          reasons: authorFacetBoost ? [...base.reasons, "public author profile matches the requested preference"] : base.reasons,
        };
      });
    const results = semanticRankFusion(scored)
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
      .slice(0, limit);
    const rankingMs = elapsedMs(rankingStartedAt);
    const totalMs = elapsedMs(requestStartedAt);

    const responseBody: SemanticSearchResponsePayload = {
      diagnostics: {
        cacheHit: false,
        candidateBookCount: rankedCandidates.length,
        authorFacetMode: authorIntent?.mode ?? "none",
        embeddingInput,
        embeddingModel: index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL,
        indexBookCount: index.books.length,
        indexGeneratedAt: index.generatedAt,
        interpretationModel,
        queryExpansionModel,
        rankingTerms,
        resultCount: results.length,
        timing: { embeddingMs, interpretationMs, rankingMs, totalMs },
        totalMs,
        usedModelInterpretation,
      },
      query,
      interpretation,
      results,
      warning,
    };
    writeValueCache(semanticResultCache, resultCacheKey, responseBody, 10 * 60_000, 100);
    return privateJson(responseBody, {
      headers: {
        ...semanticSearchRateHeaders(permit),
        "Server-Timing": `interpretation;dur=${interpretationMs}, embedding;dur=${embeddingMs}, ranking;dur=${rankingMs}, total;dur=${totalMs}`,
      },
    });
  } finally {
    permit.release();
  }
}

function semanticSearchLimitResponse(permit: Extract<SemanticSearchPermit, { allowed: false }>) {
  const error = permit.reason === "concurrency"
    ? "Meaning search is busy. Please try again in a moment."
    : "Meaning search has reached its short-term request limit. Please try again shortly.";
  return privateJson({ error }, {
    status: 429,
    headers: {
      "Retry-After": String(permit.retryAfterSeconds),
      ...semanticSearchRateHeaders(permit),
    },
  });
}

function semanticSearchRateHeaders(permit: Pick<SemanticSearchPermit, "limit" | "remaining">) {
  return {
    "X-RateLimit-Limit": String(permit.limit),
    "X-RateLimit-Remaining": String(permit.remaining),
  };
}

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

async function loadSemanticIndex() {
  if (indexCache) return indexCache;
  try {
    const parsed = await readSemanticBookIndex(path.join(process.cwd(), "data", "public", "book-semantic-index.json"));
    indexCache = Promise.resolve(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function embedSemanticQuery(input: string, index: SemanticBookIndex) {
  const model = index.embeddingModel || DEFAULT_SEMANTIC_EMBEDDING_MODEL;
  const cacheKey = `${model}:${index.dimensions}:${input}`;
  return cachedPromise(embeddingCache, cacheKey, 30 * 60_000, 200, () => embedSemanticQueryUncached(input, index));
}

async function embedSemanticQueryUncached(input: string, index: SemanticBookIndex) {
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

export async function interpretSemanticQuery(
  query: string,
  queryExpansionModel: SemanticQueryExpansionModel,
): Promise<SemanticInterpretationResult> {
  const cacheKey = `${queryExpansionModel}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return cachedPromise(interpretationCache, cacheKey, 30 * 60_000, 200, () => interpretSemanticQueryUncached(query, queryExpansionModel));
}

async function interpretSemanticQueryUncached(
  query: string,
  queryExpansionModel: SemanticQueryExpansionModel,
): Promise<SemanticInterpretationResult> {
  if (!shouldInterpretQuery(query)) return { interpretation: null, usedModelInterpretation: false };
  const fallback = fallbackInterpretation(query);
  if (queryExpansionModel === "gemini-3.5-flash") return interpretQueryWithGemini(query, fallback);
  return interpretQueryWithOpenAI(query, fallback, queryExpansionModel);
}

async function interpretQueryWithOpenAI(
  query: string,
  fallback: SemanticQueryInterpretation,
  requestedModel: "gpt-5.4-nano" | "gpt-5.4-mini" = "gpt-5.4-nano",
): Promise<{ interpretation: SemanticQueryInterpretation; model: string; usedModelInterpretation: boolean; warning?: string }> {
  const model = process.env.OPENAI_SEMANTIC_QUERY_MODEL ?? requestedModel;
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
        max_output_tokens: 800,
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
  const openAiResult = await interpretQueryWithOpenAI(query, fallback, "gpt-5.4-nano");
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
        maxOutputTokens: 700,
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
  return value === "gemini-3.5-flash" ? value : DEFAULT_QUERY_EXPANSION_MODEL;
}

function fallbackInterpretation(query: string): SemanticQueryInterpretation {
  const quotedPhrases = Array.from(query.matchAll(/["'“”]([^"'“”]{3,80})["'“”]/g)).map((match) => match[1]);
  const eras = inferPeriodRanges(query).map((period) => period.label);
  const concepts = unique([...quotedPhrases, ...searchTerms(query)]).slice(0, 10);
  const publicationPreference = inferPublicationPreference(query);
  return {
    expandedQuery: [query, concepts.length ? `Key terms: ${concepts.slice(0, 6).join(", ")}` : "", eras.length ? `Periods: ${eras.join(", ")}` : ""].filter(Boolean).join(" / ").slice(0, 320),
    audienceTerms: [],
    culturalReferences: [],
    concepts,
    adventurousConcepts: [],
    coreConcepts: concepts.slice(0, 6),
    namedFigures: [],
    namedPlaces: [],
    publicationDateIntent: publicationPreference.intent,
    publicationYearCutoff: publicationPreference.cutoff,
    eras: unique(eras),
    subjects: [],
    authorIntent: fallbackAuthorIntent(query),
  };
}

function sanitizeInterpretation(parsed: SemanticQueryInterpretation, fallback: SemanticQueryInterpretation): SemanticQueryInterpretation {
  const parsedCoreConcepts = unique(parsed.coreConcepts ?? []);
  const parsedConcepts = unique(parsed.concepts ?? []);
  const parsedAdventurousConcepts = unique(parsed.adventurousConcepts ?? []);
  const parsedEras = unique(parsed.eras ?? []);
  const parsedSubjects = unique(parsed.subjects ?? []);
  const audienceTerms = cleanPhrases(parsed.audienceTerms ?? [], 4, 60);
  const culturalReferences = cleanPhrases(parsed.culturalReferences ?? [], 4, 80);
  const explicitPublicationPreference = inferPublicationPreference(fallback.expandedQuery.split(" / ")[0] ?? "");
  const coreConcepts = cleanPhrases(parsedCoreConcepts.length ? parsedCoreConcepts : parsedConcepts.length ? parsedConcepts : semanticCoreConcepts(fallback), 6, 72);
  const adventurousConcepts = parsedAdventurousConcepts
    .filter((concept) => !coreConcepts.some((coreConcept) => normalizeComparable(coreConcept) === normalizeComparable(concept)))
    .map((concept) => concept.slice(0, 72))
    .slice(0, 3);
  const publicationDateIntent = explicitPublicationPreference.intent !== "none"
    ? explicitPublicationPreference.intent
    : parsed.publicationDateIntent ?? fallback.publicationDateIntent ?? "none";
  const parsedCutoff = Number(parsed.publicationYearCutoff);
  const publicationYearCutoff = explicitPublicationPreference.cutoff ??
    (Number.isInteger(parsedCutoff) && parsedCutoff >= 1400 && parsedCutoff <= 2100 ? parsedCutoff : null);
  const fallbackIntent = fallback.authorIntent;
  const parsedIntent = parsed.authorIntent;
  const parsedLifeStatus = parsedIntent?.lifeStatus;
  const parsedMode = parsedIntent?.mode;
  const authorIntent = parsedIntent || fallbackIntent ? {
    countries: cleanPhrases(parsedIntent?.countries?.length ? parsedIntent.countries : fallbackIntent?.countries ?? [], 4, 60),
    lifeStatus: ["living", "deceased", "unknown", "any"].includes(parsedLifeStatus ?? "") ? parsedLifeStatus : fallbackIntent?.lifeStatus ?? "any",
    platforms: (parsedIntent?.platforms ?? fallbackIntent?.platforms ?? []).filter((platform) => platform === "substack").slice(0, 2),
    mode: fallbackIntent?.mode === "filter" ? "filter" : ["filter", "boost", "none"].includes(parsedMode ?? "") ? parsedMode : fallbackIntent?.mode ?? "none",
  } satisfies NonNullable<SemanticQueryInterpretation["authorIntent"]> : undefined;
  return {
    expandedQuery: (parsed.expandedQuery || fallback.expandedQuery).replace(/\s+/g, " ").trim().slice(0, 320),
    audienceTerms,
    culturalReferences,
    concepts: unique([...coreConcepts, ...adventurousConcepts]).slice(0, 8),
    adventurousConcepts,
    coreConcepts,
    namedFigures: cleanPhrases(parsed.namedFigures ?? [], 4, 80),
    namedPlaces: cleanPhrases(parsed.namedPlaces ?? [], 4, 80),
    publicationDateIntent,
    publicationYearCutoff,
    eras: cleanPhrases(unique([...(parsedEras.length ? parsedEras : []), ...fallback.eras]), 3, 60),
    subjects: cleanPhrases(parsedSubjects.length ? parsedSubjects : fallback.subjects, 4, 60),
    authorIntent,
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
  if (/\b(would like|might like|for fans of|taste|sensibility|stuff)\b/i.test(query) && semanticAdventurousConcepts(interpretation).length < 1) return true;
  if (concepts.length < 2 && !interpretation.subjects.length && !interpretation.eras.length) return true;
  if (novelConceptTerms.length < 2 && novelConceptPhrases.length < 1 && interpretation.subjects.length < 1) return true;
  return false;
}

function inferPublicationPreference(query: string): { intent: "older" | "newer" | "none"; cutoff: number | null } {
  const normalized = normalizeComparable(query);
  const before = normalized.match(/\b(?:published |released )?before (1[5-9]\d{2}|20\d{2})\b/);
  if (before) return { intent: "older", cutoff: Number(before[1]) };
  const after = normalized.match(/\b(?:published |released )?after (1[5-9]\d{2}|20\d{2})\b/);
  if (after) return { intent: "newer", cutoff: Number(after[1]) };
  if (/\b(classic|older|old|vintage|forgotten|neglected) (?:nonfiction )?(?:book|books|work|works)\b/.test(normalized) || /\b(?:book|books|works) from earlier decades\b/.test(normalized)) {
    return { intent: "older", cutoff: /\bclassic\b/.test(normalized) ? 1990 : null };
  }
  if (/\b(recent|newer|new|latest|newly published|recently published) (?:nonfiction )?(?:book|books|work|works)\b/.test(normalized)) {
    return { intent: "newer", cutoff: null };
  }
  return { intent: "none", cutoff: null };
}

function cleanPhrases(values: string[], maxItems: number, maxLength: number) {
  return unique(values
    .map((value) => value.replace(/\s+/g, " ").trim().slice(0, maxLength))
    .filter((value) => value && !/^(empty|none|n\/?a|null)$/i.test(value)))
    .slice(0, maxItems);
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

function semanticResultCacheKey({
  body,
  index,
  limit,
  query,
  queryExpansionModel,
}: {
  body: SemanticSearchRequest | null;
  index: SemanticBookIndex;
  limit: number;
  query: string;
  queryExpansionModel: SemanticQueryExpansionModel;
}) {
  return createHash("sha256").update(JSON.stringify({
    candidateBookIds: body?.candidateBookIds ?? [],
    filters: body?.filters ?? {},
    indexGeneratedAt: index.generatedAt,
    limit,
    query: query.toLowerCase().replace(/\s+/g, " "),
    queryExpansionModel,
  })).digest("hex");
}

function cachedPromise<T>(
  cache: Map<string, PromiseCacheEntry<T>>,
  key: string,
  ttlMs: number,
  maxEntries: number,
  load: () => Promise<T>,
) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) cache.delete(key);
  const promise = load();
  cache.set(key, { expiresAt: now + ttlMs, promise });
  trimCache(cache, maxEntries);
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

function readValueCache<T>(cache: Map<string, ValueCacheEntry<T>>, key: string) {
  const cached = cache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return cached.value;
}

function writeValueCache<T>(
  cache: Map<string, ValueCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  trimCache(cache, maxEntries);
}

function trimCache<T>(cache: Map<string, T>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function elapsedMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(1));
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
