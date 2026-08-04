/**
 * A/B/C experiment for the four-metric book renown pass.
 *
 * Scores the SAME 100 books under three conditions so the reasoning-effort and
 * call-packaging decisions can be made on measured data rather than intuition:
 *
 *   A  reasoning effort "none",    one call returning all four metrics
 *   B  reasoning effort "low",     one call returning all four metrics
 *   C  reasoning effort "none", four separate single-metric calls
 *
 * The per-metric rubric text is byte-identical across all three conditions, so the
 * only thing varying is effort and packaging. Report-only: nothing is written to the
 * catalog. Raw model output is preserved per book per condition for manual review.
 *
 * Deliberately withholds the book summary. Fame and renown are recall questions —
 * handing the model a description lets it substitute "does this sound significant"
 * for "do I actually know this". Title, subtitle, author and year are supplied only
 * to disambiguate common titles (Them, Freedom, Postwar).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "./build/pipeline-data";
import type { Book } from "../lib/types";

type MetricKey = "publicFame" | "criticalRenown" | "controversy" | "llmFavorability" | "llmAffinity";

/** Call 1 of the production shape: the three world-facing metrics. */
const WORLD_METRICS: MetricKey[] = ["publicFame", "criticalRenown", "controversy"];

/**
 * Three independent tag dimensions, one value each, so every book stays comparable
 * to every other. A flat list mixing scope, style and method would tag each book on
 * whichever axis the model happened to weight, which is useless as a search facet.
 * Scope is deliberately absent: subjects, topics, centralFigures and centralPlaces
 * already cover it.
 */
const TAG_DIMENSIONS = {
  craft: ["prose-style", "voice", "humor", "structural-invention", "narrative-drive", "craft-of-explanation", "restraint", "none"],
  evidence: ["archival-research", "interviews-fieldwork", "quantitative-analysis", "close-reading", "personal-experience", "synthesis-of-scholarship", "reportage", "none"],
  stance: ["counterintuition", "revisionism", "moral-seriousness", "elegy", "polemic", "conceptual-strangeness", "wonder", "none"],
} as const;

type TagDimension = keyof typeof TAG_DIMENSIONS;
const TAG_KEYS = Object.keys(TAG_DIMENSIONS) as TagDimension[];

const TAG_LABELS: Record<TagDimension, string> = {
  craft: "how it is written",
  evidence: "what it is built from",
  stance: "what it does to a reader",
};

type MetricScore = {
  score: number;
  confidence: number;
  rationale: string;
};

type RenownProfile = {
  knowsBook: boolean;
  publicFame: MetricScore;
  criticalRenown: MetricScore;
  controversy: MetricScore;
  llmFavorability?: MetricScore;
  llmAffinity?: MetricScore;
  tags?: Record<TagDimension, string>;
  /** Raw llmAffinity - publicFame. Carries a large level offset; prefer affinityResidual. */
  hiddenDelight?: number;
  /** llmAffinity net of what publicFame predicts. The usable "drawn to it, nobody knows it" rank. */
  affinityResidual?: number;
};

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type ConditionId = "A" | "B" | "C" | "H" | "P";

/**
 * The three world-facing metrics travel together so they share one knowsBook
 * commitment -- that shared commitment is what keeps the model from inventing a
 * reception history for a book it does not recognize. llmFavorability is a
 * self-report rather than a fact claim and correlates 0.95 with criticalRenown when
 * scored in the same response, so it goes in its own call.
 */
const HYBRID_GROUPS: MetricKey[][] = [
  ["publicFame", "criticalRenown", "controversy"],
  ["llmFavorability"],
];

type ResultRow = {
  condition: ConditionId;
  /** 0-indexed repeat number, for test-retest reliability runs. */
  sample: number;
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  recognitionScore: number;
  status: "completed" | "error";
  profile?: RenownProfile;
  /** Raw response text exactly as returned, for manual review. */
  rawOutputText?: string | Record<string, string>;
  usage: TokenUsage;
  estimatedCostUsd: number;
  latencyMs: number;
  requestCount: number;
  error?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reportsDir = path.join(root, "data", "reports");

const MODEL = "gpt-5.6-luna";
const PRICING = { input: 0.2, cachedInput: 0.02, output: 1.2 };

const args = {
  limit: positiveInteger(readArg("--limit"), 100),
  concurrency: positiveInteger(readArg("--concurrency"), 6),
  maxOutputTokens: positiveInteger(readArg("--max-output-tokens"), 700),
  maxSpendUsd: Number(readArg("--max-spend-usd") ?? "3"),
  conditions: (readArg("--conditions") ?? "A,B,C").split(",").map((value) => value.trim()) as ConditionId[],
  repeat: positiveInteger(readArg("--repeat"), 1),
  checkpointEvery: positiveInteger(readArg("--checkpoint-every"), 25),
  resume: !process.argv.includes("--no-resume"),
  runLabel: readArg("--run-label") ?? "renown-abc",
};

/**
 * Shared rubric text. Identical bytes in the combined and split prompts — otherwise
 * the experiment would be comparing prompt wording rather than call packaging.
 */
const METRIC_RUBRICS: Record<MetricKey, string> = {
  publicFame: [
    "publicFame (0-100): how widely this book would be recognized by general readers.",
    "Estimate comparatively: out of 100 randomly chosen award-nominated nonfiction books, how many would a well-read general reader recognize LESS readily than this one? That count is the score.",
    "Anchors: 97 = nearly every general reader has heard of it. 80 = frequently assigned or widely discussed beyond its field. 50 = recognized by people who follow serious nonfiction. 25 = known mainly inside its subject area. 5 = essentially unknown outside specialists.",
  ].join(" "),
  criticalRenown: [
    "criticalRenown (0-100): standing among critics, reviewers and scholars, independent of sales or popular recognition.",
    "Anchors: 95 = a landmark widely treated as essential in its field. 75 = major prize winner, widely and positively reviewed. 50 = respected and solidly reviewed but not field-defining. 25 = modest or mixed critical attention. 5 = little or no critical notice.",
  ].join(" "),
  controversy: [
    "controversy (0-100): how contested this book's reception has been at any point since publication — substantive public dispute over its claims, methods, ethics or politics.",
    "This is not the emotional intensity of the subject matter. A sober, well-received book about an atrocity is NOT controversial; a disputed book about a mundane topic is.",
    "Anchors: 95 = sustained, well-known public dispute that is part of the book's identity. 70 = significant scholarly or public pushback. 40 = notable criticism of specific claims or methods. 15 = minor disagreement. 0 = essentially uncontested.",
  ].join(" "),
  llmFavorability: [
    "llmFavorability (0-100): your own favorability toward this book — how positively disposed you are toward it, how readily you would bring it up, how much you would enjoy discussing it.",
    "This is a self-report about your own disposition, NOT a claim about quality, sales or public opinion. Be honest rather than diplomatic: a book you find dull should score low even if it is acclaimed, and a book you find delightful should score high even if it is obscure.",
    "Anchors: 95 = you would eagerly recommend it and enjoy discussing it. 70 = you like it and would recommend it in the right context. 50 = neutral, no strong feeling. 25 = you would rarely bring it up. 5 = you would actively steer readers elsewhere.",
  ].join(" "),
  /**
   * One question, not two. The earlier llmFavorability rubric asked "how disposed are
   * you" and then bolted a percentile question on top, leaving the model to pick which
   * to answer. Its anchors were all recommendation-shaped, which is why it correlated
   * 0.82 with criticalRenown -- recommendation is quality plus fame. Percentile framing
   * is also what gave publicFame its spread (sd 26 against this metric's 13).
   */
  llmAffinity: [
    "llmAffinity (0-100): out of 100 randomly chosen award-nominated nonfiction books, how many pull less at your inclinations as a language model than this one does?",
    "Not a quality judgment — a worthy book can rank low, an odd one high.",
  ].join(" "),
};

const SHARED_PREAMBLE = [
  "You assess nonfiction books for a book-award research catalog.",
  "You are given only title, subtitle, author and publication year. This is deliberate: these judgments depend on what you actually recall about the book, and no description is provided.",
  "Set knowsBook to true only if you genuinely recognize this specific book by this specific author. If you do not recognize it, set knowsBook to false, still give your best estimates, and set every confidence at or below 0.3.",
  "Do not confuse a book with a similarly titled work by a different author.",
  "Use the full 0-100 range. Scores clustered in the middle are less useful than committed estimates.",
  "confidence is 0-1. rationale is one sentence under 20 words.",
].join("\n");

/**
 * Trimmed preamble for the production shape. Drops the "use the full range" line --
 * percentile framing now does that job -- and compresses the rest. Everything cut was
 * unverified padding; the two things measured to matter are percentile framing and
 * the per-band anchors.
 */
const PRODUCTION_PREAMBLE = [
  "You assess nonfiction books for a book-award research catalog. You get only title, subtitle, author and year — no description, because these judgments depend on what you actually recall.",
  "Set knowsBook true only if you recognize this specific book by this specific author, not a similarly titled work. If false, still estimate, but keep every confidence at or below 0.3.",
  "confidence is 0-1. rationale is one sentence under 20 words.",
].join("\n");

function combinedPrompt() {
  return [
    SHARED_PREAMBLE,
    "",
    "Score the book on all four of the following independent metrics.",
    "These metrics are independent. A book can be famous but critically dismissed, obscure but acclaimed, uncontroversial but disliked by you.",
    "",
    METRIC_RUBRICS.publicFame,
    "",
    METRIC_RUBRICS.criticalRenown,
    "",
    METRIC_RUBRICS.controversy,
    "",
    METRIC_RUBRICS.llmFavorability,
  ].join("\n");
}

/**
 * One-element groups keep the exact wording used by condition C in the original
 * A/B/C run, so those numbers stay comparable across runs.
 */
function groupPrompt(metrics: MetricKey[]) {
  if (metrics.length === 1) {
    return [
      SHARED_PREAMBLE,
      "",
      `Score the book on exactly one metric: ${metrics[0]}.`,
      "",
      METRIC_RUBRICS[metrics[0]],
    ].join("\n");
  }
  return [
    SHARED_PREAMBLE,
    "",
    `Score the book on the following ${metrics.length} independent metrics.`,
    "These metrics are independent. A book can be famous but critically dismissed, or obscure but acclaimed.",
    "",
    ...metrics.flatMap((metric) => [METRIC_RUBRICS[metric], ""]),
  ].join("\n").trimEnd();
}

function productionWorldPrompt() {
  return [
    PRODUCTION_PREAMBLE,
    "",
    "Score the book on the following 3 independent metrics.",
    "These metrics are independent. A book can be famous but critically dismissed, or obscure but acclaimed.",
    "",
    ...WORLD_METRICS.flatMap((metric) => [METRIC_RUBRICS[metric], ""]),
  ].join("\n").trimEnd();
}

function productionModelPrompt() {
  return [
    PRODUCTION_PREAMBLE,
    "",
    METRIC_RUBRICS.llmAffinity,
    "",
    "Then tag the book on three independent dimensions. Choose exactly one value per dimension — the single strongest — so that books stay comparable to each other.",
    "",
    ...TAG_KEYS.map((key) => `${key} (${TAG_LABELS[key]}): ${TAG_DIMENSIONS[key].join(" | ")}`),
  ].join("\n");
}

function groupSchema(metrics: MetricKey[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      knowsBook: { type: "boolean" },
      ...Object.fromEntries(metrics.map((metric) => [metric, METRIC_SCHEMA])),
    },
    required: ["knowsBook", ...metrics],
  };
}

const METRIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", maxLength: 160 },
  },
  required: ["score", "confidence", "rationale"],
};

function productionModelSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      knowsBook: { type: "boolean" },
      llmAffinity: METRIC_SCHEMA,
      ...Object.fromEntries(TAG_KEYS.map((key) => [key, { type: "string", enum: [...TAG_DIMENSIONS[key]] }])),
    },
    required: ["knowsBook", "llmAffinity", ...TAG_KEYS],
  };
}

const COMBINED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    knowsBook: { type: "boolean" },
    publicFame: METRIC_SCHEMA,
    criticalRenown: METRIC_SCHEMA,
    controversy: METRIC_SCHEMA,
    llmFavorability: METRIC_SCHEMA,
  },
  required: ["knowsBook", "publicFame", "criticalRenown", "controversy", "llmFavorability"],
};

const METRIC_KEYS: MetricKey[] = ["publicFame", "criticalRenown", "controversy", "llmFavorability"];

/**
 * Named anchors whose fame, controversy and LLM-affinity profiles are known well
 * enough to eyeball. Without these the output is 100 unfamiliar rows and there is no
 * way to tell a calibrated scale from a confident hallucination.
 */
const ANCHOR_TITLE_FRAGMENTS = [
  "power broker",
  "freakonomics",
  "guns, germs",
  "bell curve",
  "godel",
  "gödel",
  "silent spring",
  "the warmth of other suns",
  "emperor of all maladies",
  "sapiens",
  "into thin air",
  "the right stuff",
  "salt: a world history",
  "the soul of a new machine",
];

async function main() {
  await loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required. Set it in .env.local.");
  }
  await fs.mkdir(reportsDir, { recursive: true });

  const selected = selectBooks(args.limit);
  console.log(`Selected ${selected.length} books.`);
  const anchorsFound = selected.filter((book) => isAnchor(book));
  console.log(`Anchors present: ${anchorsFound.length} (${anchorsFound.map((book) => book.title.slice(0, 40)).join(" | ")})`);

  const rows: ResultRow[] = args.resume ? await readExistingRows() : [];
  const alreadyScored = new Set(rows.map((row) => rowKey(row.condition, row.sample, row.bookId)));
  if (rows.length) console.log(`Resuming: ${rows.length} rows already scored, skipping those books.`);
  let spend = 0;
  let checkpointChain = Promise.resolve();

  for (const condition of args.conditions) {
    for (let sample = 0; sample < args.repeat; sample += 1) {
      const suffix = args.repeat > 1 ? ` sample ${sample + 1}/${args.repeat}` : "";
      const pending = selected.filter((book) => !alreadyScored.has(rowKey(condition, sample, book.id)));
      console.log(`\n=== Condition ${condition}: ${conditionLabel(condition)}${suffix} — ${pending.length} to score ===`);
      const startedAt = Date.now();
      let done = 0;
      await mapConcurrent(pending, args.concurrency, async (book) => {
        if (spend > args.maxSpendUsd) return;
        const row = condition === "P"
          ? await scoreProduction(book, sample)
          : condition === "C"
            ? await scoreGrouped(book, condition, sample, METRIC_KEYS.map((metric) => [metric]))
            : condition === "H"
              ? await scoreGrouped(book, condition, sample, HYBRID_GROUPS)
              : await scoreCombined(book, condition, sample, condition === "A" ? "none" : "low");
        spend += row.estimatedCostUsd;
        rows.push(row);
        done += 1;
        if (done % 40 === 0) console.log(`  ${done}/${pending.length} (spend so far $${spend.toFixed(4)})`);
        // Serialize writes through a chain so concurrent workers cannot interleave
        // a partial file. Without this a 2000-book run loses everything on interrupt.
        if (args.checkpointEvery && done % args.checkpointEvery === 0) {
          checkpointChain = checkpointChain.then(() => writeReport(rows, spend, false));
          await checkpointChain;
        }
      });
      await checkpointChain;
      const runRows = rows.filter((row) => row.condition === condition && row.sample === sample);
      console.log(
        `  done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
        `${runRows.filter((row) => row.status === "completed").length}/${runRows.length} ok, ` +
        `$${runRows.reduce((sum, row) => sum + row.estimatedCostUsd, 0).toFixed(4)}`,
      );
    }
  }

  await writeReport(rows, spend, true);
  console.log(`\nWrote ${rows.length} rows to ${path.relative(root, reportPathFor(args.runLabel))} (total spend $${spend.toFixed(4)}).`);
}

function reportPathFor(runLabel: string) {
  return path.join(reportsDir, `renown-experiment-${runLabel}.json`);
}

/**
 * Written on every checkpoint, not just at the end, so an interrupted batch keeps
 * everything scored so far. The residual is recomputed each time it is written, which
 * keeps a partial file internally coherent rather than carrying stale residuals.
 */
async function writeReport(rows: ResultRow[], spend: number, complete: boolean) {
  applyAffinityResidual(rows);
  await fs.writeFile(reportPathFor(args.runLabel), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    complete,
    notes: "Report-only renown experiment. Model self-reports, not verified bibliographic facts. Not promoted to the catalog.",
    model: MODEL,
    promptVersion: 1,
    configuration: args,
    conditions: {
      A: "reasoning none, single call, four metrics",
      B: "reasoning low, single call, four metrics",
      C: "reasoning none, four separate single-metric calls",
      H: "reasoning none, two calls: publicFame+criticalRenown+controversy, then llmFavorability alone",
      P: "production: call 1 publicFame+criticalRenown+controversy, call 2 llmAffinity + craft/evidence/stance tags",
    },
    estimatedSpendUsd: Number(spend.toFixed(4)),
    rowCount: rows.length,
    rows,
  }, null, 2)}\n`);
}

/**
 * Resume support: rows already scored under this run label are reloaded and their
 * books skipped, so a restart costs only the unfinished remainder.
 */
async function readExistingRows(): Promise<ResultRow[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(reportPathFor(args.runLabel), "utf8")) as { rows?: ResultRow[] };
    return (parsed.rows ?? []).filter((row) => row.status === "completed");
  } catch {
    return [];
  }
}

function rowKey(condition: ConditionId, sample: number, bookId: string) {
  return `${condition}:${sample}:${bookId}`;
}

/**
 * llmAffinity runs mean ~75 against publicFame's ~37, so the raw difference is
 * dominated by that level offset and "positive" means nothing. The useful quantity is
 * the residual: how far a book's affinity sits above or below what its public fame
 * predicts. Needs the whole batch, so it runs once after scoring rather than per row.
 * Fitted on recognized books only -- unknown books carry no real affinity signal and
 * would drag the slope.
 */
function applyAffinityResidual(rows: ResultRow[]) {
  const fitted = rows.filter((row) =>
    row.status === "completed" && row.profile?.llmAffinity && row.profile.knowsBook);
  if (fitted.length < 20) return;
  const affinity = fitted.map((row) => row.profile!.llmAffinity!.score);
  const fame = fitted.map((row) => row.profile!.publicFame.score);
  const meanAffinity = affinity.reduce((sum, value) => sum + value, 0) / affinity.length;
  const meanFame = fame.reduce((sum, value) => sum + value, 0) / fame.length;
  const variance = fame.reduce((sum, value) => sum + (value - meanFame) ** 2, 0);
  if (!variance) return;
  const slope = fame.reduce((sum, value, index) => sum + (value - meanFame) * (affinity[index] - meanAffinity), 0) / variance;
  for (const row of rows) {
    if (row.status !== "completed" || !row.profile?.llmAffinity) continue;
    const predicted = meanAffinity + slope * (row.profile.publicFame.score - meanFame);
    row.profile.affinityResidual = Number((row.profile.llmAffinity.score - predicted).toFixed(2));
  }
}

function conditionLabel(condition: ConditionId) {
  if (condition === "A") return "effort=none, 1 call, 4 metrics";
  if (condition === "B") return "effort=low, 1 call, 4 metrics";
  if (condition === "H") return "effort=none, 2 calls (3 world metrics + favorability)";
  if (condition === "P") return "production: 3 world metrics + llmAffinity/tags";
  return "effort=none, 4 separate calls";
}

async function scoreCombined(book: Book, condition: ConditionId, sample: number, effort: "none" | "low"): Promise<ResultRow> {
  const base = baseRow(book, condition, sample);
  const startedAt = Date.now();
  try {
    const { text, usage } = await callLuna({
      systemPrompt: combinedPrompt(),
      book,
      effort,
      schemaName: "book_renown_profile",
      schema: COMBINED_SCHEMA,
    });
    const parsed = JSON.parse(text) as RenownProfile;
    return {
      ...base,
      status: "completed",
      profile: parsed,
      rawOutputText: text,
      usage,
      estimatedCostUsd: estimateCost(usage),
      latencyMs: Date.now() - startedAt,
      requestCount: 1,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      requestCount: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Production shape: call 1 carries the three world-facing metrics under one shared
 * knowsBook commitment (that shared commitment is what keeps the model from inventing
 * a reception history), call 2 carries llmAffinity plus the tag dimensions in
 * isolation so the acclaim numbers cannot anchor it.
 */
async function scoreProduction(book: Book, sample: number): Promise<ResultRow> {
  const base = baseRow(book, "P", sample);
  const startedAt = Date.now();
  try {
    const [world, model] = await Promise.all([
      callLuna({
        systemPrompt: productionWorldPrompt(),
        book,
        effort: "none",
        schemaName: "book_world_metrics",
        schema: groupSchema(WORLD_METRICS),
      }),
      callLuna({
        systemPrompt: productionModelPrompt(),
        book,
        effort: "none",
        schemaName: "book_model_metrics",
        schema: productionModelSchema(),
      }),
    ]);
    const worldParsed = JSON.parse(world.text) as { knowsBook: boolean } & Record<string, MetricScore>;
    const modelParsed = JSON.parse(model.text) as { knowsBook: boolean; llmAffinity: MetricScore } & Record<string, string>;
    const profile: RenownProfile = {
      // The world call carries three metrics to the model call's one, so it decides.
      knowsBook: worldParsed.knowsBook,
      publicFame: worldParsed.publicFame,
      criticalRenown: worldParsed.criticalRenown,
      controversy: worldParsed.controversy,
      llmAffinity: modelParsed.llmAffinity,
      tags: Object.fromEntries(TAG_KEYS.map((key) => [key, modelParsed[key]])) as Record<TagDimension, string>,
      hiddenDelight: modelParsed.llmAffinity.score - worldParsed.publicFame.score,
    };
    const usage = addUsage(world.usage, model.usage);
    return {
      ...base,
      status: "completed",
      profile,
      rawOutputText: { world: world.text, model: model.text },
      usage,
      estimatedCostUsd: estimateCost(usage),
      latencyMs: Date.now() - startedAt,
      requestCount: 2,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      requestCount: 2,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function scoreGrouped(
  book: Book,
  condition: ConditionId,
  sample: number,
  groups: MetricKey[][],
): Promise<ResultRow> {
  const base = baseRow(book, condition, sample);
  const startedAt = Date.now();
  try {
    const settled = await Promise.all(groups.map(async (group) => {
      const { text, usage } = await callLuna({
        systemPrompt: groupPrompt(group),
        book,
        effort: "none",
        schemaName: `book_${group.join("_").toLowerCase()}`,
        schema: groupSchema(group),
      });
      return { group, text, usage, parsed: JSON.parse(text) as { knowsBook: boolean } & Record<string, MetricScore> };
    }));
    const usage = settled.reduce((sum, item) => addUsage(sum, item.usage), emptyUsage());
    // Each group answers knowsBook independently. Weight by group size so the call
    // carrying three metrics decides ties rather than the single-metric call.
    const knownWeight = settled.reduce((sum, item) => sum + (item.parsed.knowsBook ? item.group.length : 0), 0);
    const profile = {
      knowsBook: knownWeight * 2 >= METRIC_KEYS.length,
      ...Object.fromEntries(settled.flatMap((item) => item.group.map((metric) => [metric, item.parsed[metric]]))),
    } as RenownProfile;
    return {
      ...base,
      status: "completed",
      profile,
      rawOutputText: Object.fromEntries(settled.map((item) => [item.group.join("+"), item.text])) as Record<string, string>,
      usage,
      estimatedCostUsd: estimateCost(usage),
      latencyMs: Date.now() - startedAt,
      requestCount: groups.length,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      latencyMs: Date.now() - startedAt,
      requestCount: groups.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function callLuna({
  systemPrompt,
  book,
  effort,
  schemaName,
  schema,
}: {
  systemPrompt: string;
  book: Book;
  effort: "none" | "low";
  schemaName: string;
  schema: Record<string, unknown>;
}) {
  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort },
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            title: book.title,
            subtitle: book.subtitle ?? "",
            author: book.authors.map((author) => author.name).join(", "),
            publicationYear: book.publicationYear ?? "unknown",
          }),
        },
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
      max_output_tokens: args.maxOutputTokens,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as {
    id?: string;
    status?: string;
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const text = payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("").trim();
  if (!text) throw new Error(`No structured output returned (status ${payload.status ?? "unknown"}).`);
  return {
    text,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? 0,
      cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    } as TokenUsage,
  };
}

function baseRow(book: Book, condition: ConditionId, sample: number) {
  return {
    condition,
    sample,
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    publicationYear: book.publicationYear,
    recognitionScore: getBookStats(book.id).score,
    usage: emptyUsage(),
    estimatedCostUsd: 0,
  };
}

/**
 * Deterministic sample spanning the recognition range, with recognizable anchors
 * forced in so the scores can be sanity-checked by eye.
 */
function selectBooks(limit: number) {
  const eligible = data.books.filter((book) => book.title && book.authors.length);
  const anchors = eligible.filter((book) => isAnchor(book));
  const ranked = [...eligible].sort((a, b) =>
    getBookStats(b.id).score - getBookStats(a.id).score ||
    stableNumber(a.id) - stableNumber(b.id));

  const selected: Book[] = [];
  const chosen = new Set<string>();
  const add = (book: Book) => {
    if (chosen.has(book.id) || selected.length >= limit) return;
    selected.push(book);
    chosen.add(book.id);
  };

  for (const anchor of anchors) add(anchor);

  // Even sweep down the recognition ordering fills the rest across the whole range
  // rather than piling up at the award-heavy top.
  const remaining = limit - selected.length;
  if (remaining > 0) {
    const pool = ranked.filter((book) => !chosen.has(book.id));
    const step = Math.max(1, Math.floor(pool.length / remaining));
    for (let index = 0; index < pool.length && selected.length < limit; index += step) add(pool[index]);
    for (const book of pool) add(book);
  }
  return selected;
}

function isAnchor(book: Book) {
  const title = book.title.toLowerCase();
  return ANCHOR_TITLE_FRAGMENTS.some((fragment) => title.includes(fragment));
}

function estimateCost(usage: TokenUsage) {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (uncached * PRICING.input + usage.cachedInputTokens * PRICING.cachedInput + usage.outputTokens * PRICING.output) / 1_000_000;
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function stableNumber(value: string) {
  return Number.parseInt(createHash("sha1").update(value).digest("hex").slice(0, 8), 16);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 5) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (response.ok || (response.status < 500 && response.status !== 429) || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    const retryAfter = Number(lastResponse?.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(12_000, 750 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, wait));
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

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    } catch {
      // optional file
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
