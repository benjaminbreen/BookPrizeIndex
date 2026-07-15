import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  data,
  getBookStats,
  imprintsById,
  publishersById,
  sourcesById,
} from "../lib/data";
import type { Book, BookReaderProfile, SourceRef } from "../lib/types";

type Lane = "central_figures" | "central_places" | "argument" | "null_control" | "mixed";

type SemanticProfile = {
  centralFigures: Array<{
    name: string;
    confidence: number;
  }>;
  centralPlaces: Array<{
    name: string;
    confidence: number;
  }>;
  argument: {
    present: boolean;
    statement: string;
    confidence: number;
  };
  academicOrientation: {
    score: number;
    confidence: number;
  };
  profileConfidence: number;
};

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type PilotRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  lane: Lane;
  publicationYear?: number;
  primarySubject?: string;
  topics: string[];
  publisher?: string;
  imprint?: string;
  pageCount?: number;
  sourceSummary: string;
  sourceRefs: SourceRef[];
  existingReaderProfile?: BookReaderProfile;
  inputHash: string;
  model: string;
  status: "completed" | "error";
  responseId?: string;
  rawProfile?: SemanticProfile;
  profile?: SemanticProfile;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
  validationWarnings: string[];
  error?: string;
};

type CacheFile = {
  version: 1;
  updatedAt: string;
  model: string;
  results: Record<string, PilotRow>;
};

type Args = {
  model: string;
  limit: number;
  additional?: number;
  runLabel?: string;
  reviewLimit: number;
  concurrency: number;
  checkpointEvery: number;
  maxSummaryChars: number;
  maxOutputTokens: number;
  maxSpendUsd: number;
  retryErrors: boolean;
  reset: boolean;
};

type OutputPaths = {
  report: string;
  candidatesJson: string;
  reviewJson: string;
  reviewMarkdown: string;
  flaggedJson: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cachePath = path.join(root, "data", "cache", "semantic-profile-pilot-cache.json");
const reportsDir = path.join(root, "data", "reports");
const enrichmentPath = path.join(root, "sources", "enrichment", "semantic-profiles.generated.json");
const PROMPT_VERSION = 8;
const FIGURE_CONFIDENCE_THRESHOLD = 0.7;
const PLACE_CONFIDENCE_THRESHOLD = 0.75;
const ARGUMENT_CONFIDENCE_THRESHOLD = 0.6;
const LOWER_CONFIDENCE_CANDIDATE_THRESHOLD = 0.35;
const DEFAULT_ESTIMATED_COST_PER_REQUEST = 0.0006;
const MAX_RESERVED_COST_PER_REQUEST_USD = 0.0015;
const SPEND_GUARD_BUFFER_USD = 0.01;

const PRICING_USD_PER_MILLION = {
  input: 0.2,
  cachedInput: 0.02,
  output: 1.25,
};

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    centralFigures: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "confidence"],
      },
    },
    centralPlaces: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "confidence"],
      },
    },
    argument: {
      type: "object",
      additionalProperties: false,
      properties: {
        present: { type: "boolean" },
        statement: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["present", "statement", "confidence"],
    },
    academicOrientation: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["score", "confidence"],
    },
    profileConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["centralFigures", "centralPlaces", "argument", "academicOrientation", "profileConfidence"],
} as const;

const SYSTEM_PROMPT = `Extract concise, source-bounded nonfiction metadata. Use only the supplied fields; never use outside knowledge. Empty arrays and present=false are better than guesses. Confidence must be honest rather than inflated; candidates below the public acceptance thresholds may be retained for an opt-in experimental view.

Figures: return at most 3 named individual humans who are truly central: principal subjects, major actors, or participants/narrators around whom the book is organized. The person's printed name must appear in the supplied title, subtitle, or summary; do not expand a partial name with outside knowledge. Never return a country, place, group, organization, company, unnamed person, placeholder, reviewer, quoted authority, passing example, or contextual name. A person described only as the book's author, historian, journalist, biographer, scholar, or researcher is not a central figure. Include that person only when the book explicitly recounts their own life, experiences, participation, or personal journey. Return candidates at confidence 0.35 or above, ordered strongest first; a stricter 0.70 public threshold is applied downstream.

Places: return at most 3 real, named geographic locations—such as countries, regions, cities, landscapes, or a specific physical site—that organize the book's subject, setting, or major events. The place name must appear in the supplied title, subtitle, or summary. Never return a date, era, war, disaster, organization, company, government body, publication, people, abstract phrase, or passing location. Return candidates at confidence 0.35 or above, ordered strongest first; a stricter 0.75 public threshold is applied downstream.

Argument: return one explicit interpretive, causal, or normative claim supported by the supplied text, not a topic, plot description, approach, question, or marketing language. Use present=true at confidence 0.35 or above; a stricter 0.60 public threshold is applied downstream. Otherwise use present=false, an empty statement, and confidence=0.

Academic orientation: score intended readership and apparatus, not quality or importance. 0-20 popular trade, 21-40 serious trade, 41-60 crossover, 61-80 academic, 81-100 specialist/reference. Trade biography, narrative history, memoir, and reportage are usually 20-45 unless the description clearly signals a scholarly monograph.

Be succinct. The argument statement must be at most 35 words. Return no explanations outside the schema.`;

function outputPathsFor(runLabel: string | undefined): OutputPaths {
  if (!runLabel) {
    return {
      report: path.join(reportsDir, "semantic-profile-pilot-report.json"),
      candidatesJson: path.join(reportsDir, "semantic-profile-candidates.json"),
      reviewJson: path.join(reportsDir, "semantic-profile-manual-review.json"),
      reviewMarkdown: path.join(reportsDir, "semantic-profile-manual-review.md"),
      flaggedJson: path.join(reportsDir, "semantic-profile-flagged-review.json"),
    };
  }
  const safeLabel = runLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!safeLabel) throw new Error("--run-label must contain at least one letter or number.");
  const stem = `semantic-profile-pilot-${safeLabel}`;
  return {
    report: path.join(reportsDir, `${stem}-report.json`),
    candidatesJson: path.join(reportsDir, `${stem}-candidates.json`),
    reviewJson: path.join(reportsDir, `${stem}-manual-review.json`),
    reviewMarkdown: path.join(reportsDir, `${stem}-manual-review.md`),
    flaggedJson: path.join(reportsDir, `${stem}-flagged-review.json`),
  };
}

async function main() {
  const args = parseArgs();
  await loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required. Set it in .env.local before running semantic-profiles:pilot.");
  }

  await Promise.all([
    fs.mkdir(path.dirname(cachePath), { recursive: true }),
    fs.mkdir(reportsDir, { recursive: true }),
  ]);

  const cache = args.reset ? emptyCache(args.model) : await readCache(args.model);
  const selectionLimit = args.additional ?? args.limit;
  const excludedBookIds = args.additional ? new Set(Object.keys(cache.results)) : new Set<string>();
  const selected = selectBooks(selectionLimit, args.maxSummaryChars, excludedBookIds);
  const outputPaths = outputPathsFor(args.runLabel);
  const pending = selected.filter(({ book, inputHash }) => {
    const cached = cache.results[book.id];
    if (!cached || cached.model !== args.model || cached.inputHash !== inputHash) return true;
    return args.retryErrors && cached.status === "error";
  });

  const estimatedCostPerRequest = estimateTypicalRequestCost(cache, args.model);
  const projectedCostUsd = pending.length * estimatedCostPerRequest;
  if (projectedCostUsd > args.maxSpendUsd) {
    throw new Error(
      `Projected cost $${projectedCostUsd.toFixed(2)} exceeds --max-spend-usd $${args.maxSpendUsd.toFixed(2)} ` +
      `(${pending.length} calls at $${estimatedCostPerRequest.toFixed(6)} each).`,
    );
  }

  console.log(
    `Semantic-profile run: ${selected.length} selected, ${pending.length} API calls pending, model ${args.model}; ` +
    `projected $${projectedCostUsd.toFixed(2)}, hard guard $${args.maxSpendUsd.toFixed(2)}.`,
  );
  let completedThisRun = 0;
  let runCostUsd = 0;
  let inFlightRequests = 0;
  let spendLimitReached = false;
  let checkpointChain = Promise.resolve();

  const checkpoint = async (force = false) => {
    if (!force && completedThisRun % args.checkpointEvery !== 0) return;
    cache.updatedAt = new Date().toISOString();
    await writeOutputs(cache, selected, args, outputPaths);
    const available = selected.filter(({ book, inputHash }) => cache.results[book.id]?.inputHash === inputHash).length;
    console.log(`  checkpoint: ${available}/${selected.length} selected rows available`);
  };

  await mapConcurrent(pending, args.concurrency, async (selection, index) => {
    if (spendLimitReached) return;
    const guardedSpend = runCostUsd + (inFlightRequests + 1) * MAX_RESERVED_COST_PER_REQUEST_USD;
    if (guardedSpend > args.maxSpendUsd - SPEND_GUARD_BUFFER_USD) {
      spendLimitReached = true;
      console.warn(`Spend guard stopped new requests at $${runCostUsd.toFixed(4)} recorded cost.`);
      return;
    }
    inFlightRequests += 1;
    const displayIndex = selected.findIndex(({ book }) => book.id === selection.book.id) + 1;
    console.log(`[${displayIndex}/${selected.length}] ${selection.book.title}`);
    const result = await extractProfile(selection, args.model, args.maxOutputTokens);
    inFlightRequests -= 1;
    runCostUsd += result.estimatedCostUsd ?? 0;
    checkpointChain = checkpointChain.then(async () => {
      cache.results[selection.book.id] = result;
      completedThisRun += 1;
      await checkpoint();
    });
    await checkpointChain;
    if (result.status === "error") {
      console.warn(`  error: ${result.error}`);
    } else {
      console.log(`  figures ${result.profile?.centralFigures.length ?? 0}, places ${result.profile?.centralPlaces.length ?? 0}, argument ${result.profile?.argument.present ? "yes" : "no"}`);
    }
  });

  await checkpointChain;
  await checkpoint(true);

  const rows = rowsForSelection(cache, selected);
  const completed = rows.filter((row) => row.status === "completed");
  const failures = rows.filter((row) => row.status === "error");
  const cost = sum(completed.map((row) => row.estimatedCostUsd ?? 0));
  console.log(`Run complete: ${completed.length}/${rows.length} succeeded, ${failures.length} errors, estimated API cost $${cost.toFixed(4)}.`);
  if (spendLimitReached) console.warn("The spend guard stopped the run before every selected book was processed.");
  console.log(`Manual review: ${path.relative(root, outputPaths.reviewMarkdown)}`);
  console.log(`Flagged review: ${path.relative(root, outputPaths.flaggedJson)}`);
  console.log(`Reusable candidates: ${path.relative(root, outputPaths.candidatesJson)}`);
}

function parseArgs(): Args {
  return {
    model: readArg("--model") ?? "gpt-5.4-nano-2026-03-17",
    limit: positiveInteger(readArg("--limit"), 100),
    additional: optionalPositiveInteger(readArg("--additional")),
    runLabel: readArg("--run-label"),
    reviewLimit: positiveInteger(readArg("--review-limit"), 30),
    concurrency: positiveInteger(readArg("--concurrency"), 3),
    checkpointEvery: positiveInteger(readArg("--checkpoint-every"), 5),
    maxSummaryChars: positiveInteger(readArg("--max-summary-chars"), 4200),
    maxOutputTokens: positiveInteger(readArg("--max-output-tokens"), 400),
    maxSpendUsd: positiveNumber(readArg("--max-spend-usd"), 4.5),
    retryErrors: hasArg("--retry-errors"),
    reset: hasArg("--reset"),
  };
}

function selectBooks(limit: number, maxSummaryChars: number, excludedBookIds = new Set<string>()) {
  const eligible = data.books.filter((book) => cleanSummary(book).length >= 120 && !excludedBookIds.has(book.id));
  const ranked = [...eligible].sort((a, b) => {
    const scoreDifference = getBookStats(b.id).score - getBookStats(a.id).score;
    if (scoreDifference) return scoreDifference;
    const listsDifference = getBookStats(b.id).lists - getBookStats(a.id).lists;
    if (listsDifference) return listsDifference;
    return stableNumber(a.id) - stableNumber(b.id) || a.title.localeCompare(b.title);
  });

  const selected: Array<{ book: Book; lane: Lane; sourceSummary: string; inputHash: string }> = [];
  const chosen = new Set<string>();
  const add = (book: Book, lane: Lane) => {
    if (excludedBookIds.has(book.id) || chosen.has(book.id) || selected.length >= limit) return;
    const sourceSummary = cleanSummary(book).slice(0, maxSummaryChars);
    selected.push({ book, lane, sourceSummary, inputHash: inputHash(book, sourceSummary) });
    chosen.add(book.id);
  };

  for (const exactTitle of [
    "The Power Broker: Robert Moses and the Fall of New York",
    "Gods of the Upper Air: How a Circle of Renegade Anthropologists Reinvented Race, Sex, and Gender in the Twentieth Century",
  ]) {
    const book = ranked.find((candidate) => candidate.title === exactTitle);
    if (book) add(book, "central_figures");
  }

  const quotas = apportionedLaneQuotas(limit);

  for (const [lane, quota] of quotas) {
    const current = () => selected.filter((row) => row.lane === lane).length;
    for (const book of ranked.filter((candidate) => laneMatches(candidate, lane))) {
      if (current() >= quota || selected.length >= limit) break;
      add(book, lane);
    }
  }

  for (const book of ranked) add(book, "mixed");
  return selected;
}

function apportionedLaneQuotas(limit: number): Array<[Lane, number]> {
  const weights: Array<{ lane: Lane; weight: number }> = [
    { lane: "central_figures", weight: 0.3 },
    { lane: "central_places", weight: 0.2 },
    { lane: "argument", weight: 0.25 },
    { lane: "null_control", weight: 0.15 },
    { lane: "mixed", weight: 0.1 },
  ];
  const rows = weights.map((item, index) => {
    const exact = limit * item.weight;
    return { ...item, index, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = limit - sum(rows.map((row) => row.count));
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (!remaining) break;
    row.count += 1;
    remaining -= 1;
  }
  return rows.map((row) => [row.lane, row.count]);
}

function laneMatches(book: Book, lane: Lane) {
  const text = `${book.title} ${book.subtitle ?? ""} ${cleanSummary(book)}`.toLowerCase();
  const traits = new Set(book.readerProfile?.traits.map((trait) => trait.id) ?? []);
  const figureSignal =
    book.primarySubject === "Biography" ||
    book.primarySubject === "Memoir & Autobiography" ||
    traits.has("biographical") ||
    traits.has("character_driven") ||
    traits.has("memoiristic");
  const argumentSignal =
    traits.has("argument_driven") ||
    /\b(argues?|contends?|makes the case|case for|shows how|demonstrates?|challenges? the|reveals? how|why\b)/i.test(text);
  const placeSignal =
    book.primarySubject === "Travel & Place" ||
    /\b(new york|los angeles|chicago|london|paris|berlin|washington|california|texas|america|united states|england|britain|ireland|france|germany|italy|spain|russia|ukraine|china|japan|india|africa|europe|asia|middle east|caribbean|atlantic|pacific|arctic|amazon|mississippi|harlem|brooklyn)\b/i.test(text);

  if (lane === "central_figures") return figureSignal;
  if (lane === "central_places") return placeSignal && !figureSignal;
  if (lane === "argument") return argumentSignal && !figureSignal;
  if (lane === "null_control") return !figureSignal && !argumentSignal && !placeSignal;
  return true;
}

function inputHash(book: Book, sourceSummary: string) {
  return createHash("sha256")
    .update(JSON.stringify({
      promptVersion: PROMPT_VERSION,
      title: book.title,
      subtitle: book.subtitle,
      authors: book.authors.map((author) => author.name),
      publicationYear: book.publicationYear,
      primarySubject: book.primarySubject,
      topics: book.topics,
      pageCount: book.pageCount,
      publisher: book.publisherId ? publishersById.get(book.publisherId)?.name : undefined,
      imprint: book.imprintId ? imprintsById.get(book.imprintId)?.name : undefined,
      sourceSummary,
    }))
    .digest("hex");
}

async function extractProfile(
  selection: { book: Book; lane: Lane; sourceSummary: string; inputHash: string },
  model: string,
  maxOutputTokens: number,
): Promise<PilotRow> {
  const { book, lane, sourceSummary, inputHash } = selection;
  const base = baseRow(book, lane, sourceSummary, inputHash, model);
  try {
    const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              title: book.title,
              subtitle: book.subtitle ?? "",
              publicationYear: book.publicationYear ?? "unknown",
              primarySubject: book.primarySubject ?? "unknown",
              topics: book.topics,
              pageCount: book.pageCount ?? "unknown",
              publisher: book.publisherId ? publishersById.get(book.publisherId)?.name ?? "unknown" : "unknown",
              imprint: book.imprintId ? imprintsById.get(book.imprintId)?.name ?? "unknown" : "unknown",
              sourceSummary,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "nonfiction_semantic_profile",
            strict: true,
            schema: OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: maxOutputTokens,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    const payload = await response.json() as ResponsePayload;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error(`No structured output returned${payload.status ? ` (response status ${payload.status})` : ""}.`);
    }
    const rawProfile = normalizeRawProfile(JSON.parse(outputText) as SemanticProfile, book, sourceSummary);
    const profile = normalizeProfile(rawProfile, book);
    const usage = normalizeUsage(payload.usage);
    return {
      ...base,
      status: "completed",
      responseId: payload.id,
      rawProfile,
      profile,
      usage,
      estimatedCostUsd: estimateCost(usage),
      validationWarnings: validateProfile(book, sourceSummary, profile),
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      validationWarnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function baseRow(book: Book, lane: Lane, sourceSummary: string, inputHash: string, model: string): PilotRow {
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    lane,
    publicationYear: book.publicationYear,
    primarySubject: book.primarySubject,
    topics: book.topics,
    publisher: book.publisherId ? publishersById.get(book.publisherId)?.name : undefined,
    imprint: book.imprintId ? imprintsById.get(book.imprintId)?.name : undefined,
    pageCount: book.pageCount,
    sourceSummary,
    sourceRefs: book.sourceIds.map((sourceId) => sourcesById.get(sourceId)).filter((source): source is SourceRef => Boolean(source)),
    existingReaderProfile: book.readerProfile,
    inputHash,
    model,
    status: "error",
    validationWarnings: [],
  };
}

type ResponsePayload = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    total_tokens?: number;
  };
};

function extractOutputText(payload: ResponsePayload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || Boolean(item.text))
    .map((item) => item.text ?? "")
    .join("");
}

function normalizeUsage(usage: ResponsePayload["usage"]): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
  };
}

function estimateCost(usage: TokenUsage) {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return Number((
    (uncached * PRICING_USD_PER_MILLION.input +
      usage.cachedInputTokens * PRICING_USD_PER_MILLION.cachedInput +
      usage.outputTokens * PRICING_USD_PER_MILLION.output) /
    1_000_000
  ).toFixed(8));
}

function estimateTypicalRequestCost(cache: CacheFile, model: string) {
  const measured = Object.values(cache.results)
    .filter((row) => row.model === model && row.status === "completed" && typeof row.estimatedCostUsd === "number")
    .map((row) => row.estimatedCostUsd as number);
  if (!measured.length) return DEFAULT_ESTIMATED_COST_PER_REQUEST;
  return Math.max(DEFAULT_ESTIMATED_COST_PER_REQUEST, average(measured) * 1.15);
}

function normalizeRawProfile(profile: SemanticProfile, book: Book, sourceSummary: string): SemanticProfile {
  const authorNames = book.authors.map((author) => normalizeText(author.name)).filter(Boolean);
  const keepListedAuthors = book.primarySubject === "Memoir & Autobiography";
  const suppliedText = normalizeText([
    book.title,
    book.subtitle,
    book.authors.map((author) => author.name).join(" "),
    sourceSummary,
  ].filter(Boolean).join(" "));
  const uniqueFigures = uniqueBy(
    (profile.centralFigures ?? []).filter((item) => {
      if (clamp(item.confidence, 0, 1) < LOWER_CONFIDENCE_CANDIDATE_THRESHOLD) return false;
      if (!supportedEntityName(item.name, suppliedText)) return false;
      if (keepListedAuthors) return true;
      const normalizedFigure = normalizeText(item.name);
      return !authorNames.some((authorName) => entityNamesOverlap(authorName, normalizedFigure));
    }),
    (item) => normalizeText(item.name),
  ).slice(0, 3);
  const uniquePlaces = uniqueBy(
    (profile.centralPlaces ?? []).filter((item) => (
      clamp(item.confidence, 0, 1) >= LOWER_CONFIDENCE_CANDIDATE_THRESHOLD && supportedEntityName(item.name, suppliedText)
    )),
    (item) => normalizeText(item.name),
  ).slice(0, 3);
  const argumentPresent = Boolean(profile.argument?.present)
    && Boolean(cleanString(profile.argument?.statement))
    && clamp(profile.argument?.confidence, 0, 1) >= LOWER_CONFIDENCE_CANDIDATE_THRESHOLD;
  return {
    centralFigures: uniqueFigures.map((item) => ({
      name: cleanString(item.name),
      confidence: clamp(item.confidence, 0, 1),
    })),
    centralPlaces: uniquePlaces.map((item) => ({
      name: cleanString(item.name),
      confidence: clamp(item.confidence, 0, 1),
    })),
    argument: {
      present: argumentPresent,
      statement: argumentPresent ? cleanString(profile.argument.statement) : "",
      confidence: argumentPresent ? clamp(profile.argument.confidence, 0, 1) : 0,
    },
    academicOrientation: {
      score: clamp(profile.academicOrientation?.score, 0, 100),
      confidence: clamp(profile.academicOrientation?.confidence, 0, 1),
    },
    profileConfidence: clamp(profile.profileConfidence, 0, 1),
  };
}

function normalizeProfile(normalized: SemanticProfile, _book: Book): SemanticProfile {
  const argumentPresent = normalized.argument.present && normalized.argument.confidence >= ARGUMENT_CONFIDENCE_THRESHOLD;
  return {
    centralFigures: normalized.centralFigures.filter((item) => item.confidence >= FIGURE_CONFIDENCE_THRESHOLD),
    centralPlaces: normalized.centralPlaces.filter((item) => item.confidence >= PLACE_CONFIDENCE_THRESHOLD),
    argument: {
      present: argumentPresent,
      statement: argumentPresent ? normalized.argument.statement : "",
      confidence: argumentPresent ? normalized.argument.confidence : 0,
    },
    academicOrientation: normalized.academicOrientation,
    profileConfidence: normalized.profileConfidence,
  };
}

function validateProfile(book: Book, sourceSummary: string, profile: SemanticProfile) {
  const warnings: string[] = [];
  const suppliedText = normalizeText([
    book.title,
    book.subtitle,
    book.authors.map((author) => author.name).join(" "),
    sourceSummary,
  ].filter(Boolean).join(" "));
  const authorNames = book.authors.map((author) => normalizeText(author.name)).filter(Boolean);

  for (const figure of profile.centralFigures) {
    const normalizedFigure = normalizeText(figure.name);
    if (!supportedEntityName(figure.name, suppliedText)) warnings.push(`unsupported_figure_name: ${figure.name}`);
    if (authorNames.some((authorName) => entityNamesOverlap(authorName, normalizedFigure))) {
      warnings.push(`author_included_for_review: ${figure.name}`);
    }
  }
  for (let index = 0; index < profile.centralFigures.length; index += 1) {
    for (let comparison = index + 1; comparison < profile.centralFigures.length; comparison += 1) {
      if (entityNamesOverlap(normalizeText(profile.centralFigures[index].name), normalizeText(profile.centralFigures[comparison].name))) {
        warnings.push(`possible_duplicate_figure: ${profile.centralFigures[index].name} / ${profile.centralFigures[comparison].name}`);
      }
    }
  }
  if (profile.centralFigures.length === 3) warnings.push("central_figures_hit_schema_cap");
  for (const place of profile.centralPlaces) {
    if (!supportedEntityName(place.name, suppliedText)) warnings.push(`unsupported_place_name: ${place.name}`);
  }
  if (profile.centralPlaces.length === 3) warnings.push("central_places_hit_schema_cap");
  if (profile.argument.present) {
    if (!profile.argument.statement) warnings.push("argument_missing_statement");
  } else if (profile.argument.statement || profile.argument.confidence) {
    warnings.push("absent_argument_has_content");
  }
  if (profile.profileConfidence > 0.9 && sourceSummary.length < 300) warnings.push("high_confidence_from_short_summary");
  return warnings;
}

function entityNamesOverlap(first: string, second: string) {
  if (!first || !second) return false;
  if (first === second || first.includes(second) || second.includes(first)) return true;
  const firstTokens = first.split(" ").filter((token) => token.length > 2);
  const secondTokens = second.split(" ").filter((token) => token.length > 2);
  const overlap = firstTokens.filter((token) => secondTokens.includes(token));
  return overlap.length >= 2 && overlap.length >= Math.min(firstTokens.length, secondTokens.length) - 1;
}

function supportedEntityName(name: string, suppliedText: string) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return false;
  if (suppliedText.includes(normalizedName)) return true;
  const parts = normalizedName.split(" ").filter((part) => part.length > 2);
  return parts.length >= 2 && parts.every((part) => suppliedText.includes(part));
}

async function writeOutputs(
  cache: CacheFile,
  selected: Array<{ book: Book; lane: Lane; sourceSummary: string; inputHash: string }>,
  args: Args,
  outputPaths: OutputPaths,
) {
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  const rows = rowsForSelection(cache, selected);
  const completed = rows.filter((row) => row.status === "completed" && row.profile);
  const flaggedRows = completed.filter((row) => row.validationWarnings.length > 0);
  const reviewRows = selectReviewRows(completed, args.reviewLimit);
  const generatedAt = new Date().toISOString();
  const usage = aggregateUsage(completed);
  const report = {
    generatedAt,
    notes: args.runLabel === "full-corpus"
      ? "Experimental gpt-5.4-nano metadata bounded to supplied catalog metadata and summaries. A complete run is also written to generated enrichment for clearly labeled public experiments and discovery."
      : "Report-only gpt-5.4-nano pilot. No output is applied to catalog or curation files. Model claims are bounded to supplied catalog metadata and summaries and require review before use.",
    configuration: {
      model: args.model,
      runLabel: args.runLabel,
      additionalBooks: args.additional,
      selectedBooks: selected.length,
      reviewBooks: reviewRows.length,
      concurrency: args.concurrency,
      checkpointEvery: args.checkpointEvery,
      maxSummaryChars: args.maxSummaryChars,
      maxOutputTokens: args.maxOutputTokens,
      maxSpendUsd: args.maxSpendUsd,
      structuredOutput: true,
      promptVersion: PROMPT_VERSION,
      confidenceThresholds: {
        centralFigures: FIGURE_CONFIDENCE_THRESHOLD,
        centralPlaces: PLACE_CONFIDENCE_THRESHOLD,
        argument: ARGUMENT_CONFIDENCE_THRESHOLD,
        lowerConfidenceCandidates: LOWER_CONFIDENCE_CANDIDATE_THRESHOLD,
      },
    },
    summary: summarizeRows(rows),
    tokenUsage: usage,
    pricingBasisUsdPerMillionTokens: PRICING_USD_PER_MILLION,
    estimatedApiCostUsd: Number(sum(completed.map((row) => row.estimatedCostUsd ?? 0)).toFixed(6)),
    rows,
  };
  await fs.writeFile(outputPaths.report, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(
    outputPaths.candidatesJson,
    `${JSON.stringify({
      generatedAt,
      notes: "Compact generated candidates for downstream review and experimental discovery. These are model interpretations, not verified bibliographic facts.",
      model: args.model,
      promptVersion: PROMPT_VERSION,
      profileCount: completed.length,
      rows: completed.map((row) => ({
        bookId: row.bookId,
        slug: row.slug,
        inputHash: row.inputHash,
        model: row.model,
        rawProfile: row.rawProfile,
        profile: row.profile,
        reviewStatus: row.validationWarnings.length ? "flagged" : "unreviewed",
        validationWarnings: row.validationWarnings,
      })),
    }, null, 2)}\n`,
  );
  if (args.runLabel === "full-corpus" && completed.length === selected.length) {
    await fs.mkdir(path.dirname(enrichmentPath), { recursive: true });
    await fs.writeFile(
      enrichmentPath,
      `${JSON.stringify({
        generatedAt,
        model: args.model,
        promptVersion: PROMPT_VERSION,
        notes: "Experimental, unverified semantic profiles generated from catalog metadata and descriptions. Public UI must retain an accuracy warning.",
        books: Object.fromEntries(completed.map((row) => [
          row.bookId,
          {
            centralFigures: row.profile!.centralFigures.map((figure) => figure.name),
            experimentalSemanticProfile: {
              ...row.profile,
              lowerConfidenceCandidates: lowerConfidenceCandidates(row),
              model: row.model,
              promptVersion: PROMPT_VERSION,
              inputHash: row.inputHash,
              reviewStatus: row.validationWarnings.length ? "flagged" : "unreviewed",
              validationWarnings: row.validationWarnings,
            },
          },
        ])),
      }, null, 2)}\n`,
    );
  }
  await fs.writeFile(
    outputPaths.reviewJson,
    `${JSON.stringify({
      generatedAt,
      instructions: "For each row, mark the four review fields true/false and add notes. Do not promote output to the catalog until reviewed.",
      model: args.model,
      reviewCount: reviewRows.length,
      rows: reviewRows.map((row) => ({
        ...row,
        review: {
          figuresCorrect: null,
          placesCorrect: null,
          argumentCorrect: null,
          academicOrientationReasonable: null,
          notes: "",
        },
      })),
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    outputPaths.flaggedJson,
    `${JSON.stringify({
      generatedAt,
      instructions: "These rows were flagged by mechanical source-support, confidence, duplication, author-inclusion, or schema-cap checks. Flags are review prompts, not automatic rejections.",
      model: args.model,
      flaggedCount: flaggedRows.length,
      rows: flaggedRows.map((row) => ({
        ...row,
        review: {
          disposition: null,
          correctedProfile: null,
          notes: "",
        },
      })),
    }, null, 2)}\n`,
  );
  await fs.writeFile(outputPaths.reviewMarkdown, renderReviewMarkdown(reviewRows, generatedAt, args.model));
}

function rowsForSelection(
  cache: CacheFile,
  selected: Array<{ book: Book; lane: Lane; sourceSummary: string; inputHash: string }>,
) {
  return selected
    .map(({ book, sourceSummary, inputHash }) => {
      const row = cache.results[book.id];
      if (!row || row.inputHash !== inputHash) return undefined;
      if (!row?.profile) return row;
      const rawProfile = normalizeRawProfile(row.rawProfile ?? row.profile, book, sourceSummary);
      const profile = normalizeProfile(rawProfile, book);
      return { ...row, rawProfile, profile, validationWarnings: validateProfile(book, sourceSummary, profile) };
    })
    .filter((row): row is PilotRow => Boolean(row));
}

function lowerConfidenceCandidates(row: PilotRow) {
  const raw = row.rawProfile ?? row.profile;
  const accepted = row.profile;
  if (!raw || !accepted) return undefined;
  const acceptedFigures = new Set(accepted.centralFigures.map((item) => normalizeText(item.name)));
  const acceptedPlaces = new Set(accepted.centralPlaces.map((item) => normalizeText(item.name)));
  const centralFigures = raw.centralFigures.filter((item) => !acceptedFigures.has(normalizeText(item.name)));
  const centralPlaces = raw.centralPlaces.filter((item) => !acceptedPlaces.has(normalizeText(item.name)));
  const argument = !accepted.argument.present && raw.argument.present
    ? { statement: raw.argument.statement, confidence: raw.argument.confidence }
    : undefined;
  if (!centralFigures.length && !centralPlaces.length && !argument) return undefined;
  return {
    centralFigures: centralFigures.length ? centralFigures : undefined,
    centralPlaces: centralPlaces.length ? centralPlaces : undefined,
    argument,
  };
}

function selectReviewRows(rows: PilotRow[], limit: number) {
  const selected: PilotRow[] = [];
  const chosen = new Set<string>();
  const add = (row: PilotRow) => {
    if (selected.length >= limit || chosen.has(row.bookId)) return;
    selected.push(row);
    chosen.add(row.bookId);
  };

  for (const row of [...rows].sort((a, b) =>
    b.validationWarnings.length - a.validationWarnings.length ||
    (a.profile?.profileConfidence ?? 1) - (b.profile?.profileConfidence ?? 1) ||
    a.title.localeCompare(b.title)
  ).slice(0, Math.min(10, limit))) add(row);

  const lanes: Lane[] = ["central_figures", "central_places", "argument", "null_control", "mixed"];
  for (const lane of lanes) {
    const laneRows = rows
      .filter((row) => row.lane === lane)
      .sort((a, b) => (a.profile?.academicOrientation?.score ?? 0) - (b.profile?.academicOrientation?.score ?? 0));
    const wanted = Math.max(1, Math.floor(limit / lanes.length));
    for (let index = 0; index < wanted; index += 1) {
      const position = laneRows.length <= 1 ? 0 : Math.round(index * (laneRows.length - 1) / Math.max(1, wanted - 1));
      if (laneRows[position]) add(laneRows[position]);
    }
  }

  for (const row of [...rows].sort((a, b) => stableNumber(a.bookId) - stableNumber(b.bookId))) add(row);
  return selected.slice(0, limit);
}

function summarizeRows(rows: PilotRow[]) {
  const completed = rows.filter((row) => row.status === "completed" && row.profile);
  const profiles = completed.map((row) => row.profile as SemanticProfile);
  const warningCounts: Record<string, number> = {};
  for (const row of completed) {
    for (const warning of row.validationWarnings) {
      const key = warning.split(":")[0];
      warningCounts[key] = (warningCounts[key] ?? 0) + 1;
    }
  }
  return {
    selected: rows.length,
    completed: completed.length,
    errors: rows.filter((row) => row.status === "error").length,
    laneCounts: countBy(rows, (row) => row.lane),
    booksWithCentralFigures: profiles.filter((profile) => profile.centralFigures.length > 0).length,
    totalCentralFigures: sum(profiles.map((profile) => profile.centralFigures.length)),
    booksWithCentralPlaces: profiles.filter((profile) => profile.centralPlaces.length > 0).length,
    totalCentralPlaces: sum(profiles.map((profile) => profile.centralPlaces.length)),
    booksWithArgument: profiles.filter((profile) => profile.argument.present).length,
    averageAcademicOrientation: average(profiles.map((profile) => profile.academicOrientation.score)),
    averageProfileConfidence: average(profiles.map((profile) => profile.profileConfidence)),
    rowsWithValidationWarnings: completed.filter((row) => row.validationWarnings.length > 0).length,
    validationWarningCounts: warningCounts,
  };
}

function aggregateUsage(rows: PilotRow[]) {
  return {
    inputTokens: sum(rows.map((row) => row.usage?.inputTokens ?? 0)),
    cachedInputTokens: sum(rows.map((row) => row.usage?.cachedInputTokens ?? 0)),
    outputTokens: sum(rows.map((row) => row.usage?.outputTokens ?? 0)),
    reasoningTokens: sum(rows.map((row) => row.usage?.reasoningTokens ?? 0)),
    totalTokens: sum(rows.map((row) => row.usage?.totalTokens ?? 0)),
  };
}

function renderReviewMarkdown(rows: PilotRow[], generatedAt: string, model: string) {
  const header = `# Semantic profile pilot: manual review\n\nGenerated ${generatedAt} with \`${model}\`. These results are report-only and have not been applied to the catalog.\n\nFor each book, check whether the extraction is supported by the supplied summary—not whether it happens to be true from outside knowledge.\n\n`;
  const entries = rows.map((row, index) => {
    const profile = row.profile as SemanticProfile;
    const figures = profile.centralFigures.length
      ? profile.centralFigures.map((item) => `  - **${escapeMarkdown(item.name)}** — confidence ${item.confidence}`).join("\n")
      : "  - None";
    const places = profile.centralPlaces.length
      ? profile.centralPlaces.map((item) => `  - **${escapeMarkdown(item.name)}** — confidence ${item.confidence}`).join("\n")
      : "  - None";
    const argument = profile.argument.present
      ? `${escapeMarkdown(profile.argument.statement)} (confidence ${profile.argument.confidence})`
      : "None extracted";
    const warningText = row.validationWarnings.length ? row.validationWarnings.map((warning) => `\`${escapeMarkdown(warning)}\``).join(", ") : "None";
    const sources = row.sourceRefs.slice(0, 5).map((source) => `[${escapeMarkdown(source.label)}](${source.url})`).join(" · ") || "Catalog summary; no linked source reference resolved";
    return `## ${String(index + 1).padStart(2, "0")}. ${escapeMarkdown(row.title)}\n\n**${escapeMarkdown(row.author)}**${row.publicationYear ? ` · ${row.publicationYear}` : ""} · ${escapeMarkdown(row.primarySubject ?? "Unclassified")} · sample lane: \`${row.lane}\`\n\n- [ ] Central figures are correct and truly central\n- [ ] Central places are correct and truly central\n- [ ] Argument is supported and is an argument, not merely a topic\n- [ ] Academic-orientation score is reasonable (within roughly ±15 points)\n\n**Source summary**\n\n> ${blockquote(row.sourceSummary)}\n\n**Extracted central figures**\n${figures}\n\n**Extracted central places**\n${places}\n\n**Extracted argument**\n\n- ${argument}\n\n**Academic orientation**\n\n- Score: **${profile.academicOrientation.score}/100**\n- Confidence: ${profile.academicOrientation.confidence}\n- Overall profile confidence: ${profile.profileConfidence}\n\n**Automated validation warnings:** ${warningText}\n\n**Catalog sources:** ${sources}\n\n**Reviewer notes:**\n\n---\n`;
  }).join("\n");
  return `${header}${entries}`;
}

async function readCache(model: string): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile;
    if (parsed.version === 1) return parsed;
  } catch {
    // Start a fresh cache.
  }
  return emptyCache(model);
}

function emptyCache(model: string): CacheFile {
  return { version: 1, updatedAt: new Date().toISOString(), model, results: {} };
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

async function fetchWithRetry(url: string, init: RequestInit, attempts = 5) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90000) });
      if (response.ok || (response.status < 500 && response.status !== 429) || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    const retryAfter = Number(lastResponse?.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(12000, 750 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

async function mapConcurrent<T>(items: T[], width: number, worker: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function cleanSummary(book: Book) {
  return cleanString(book.summary ?? book.displaySummary ?? "");
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableNumber(value: string) {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function clamp(value: unknown, minimum: number, maximum: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : minimum;
  return Number(Math.min(maximum, Math.max(minimum, number)).toFixed(3));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? Number((sum(values) / values.length).toFixed(2)) : 0;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function blockquote(value: string) {
  return escapeMarkdown(value).replace(/\n/g, "\n> ");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, received "${value}".`);
  return parsed;
}

function optionalPositiveInteger(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received "${value}".`);
  return parsed;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
