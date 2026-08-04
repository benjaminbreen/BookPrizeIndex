/**
 * Central registry of the LLM models this project calls, and their list prices.
 *
 * Model ids were previously hardcoded in five places, which made a swap a hunt
 * rather than a one-line change. Prices are USD per 1M tokens as of August 2026;
 * they drive the `--budget-usd` guards, so a stale entry silently mis-reports spend.
 */

export type LlmModelId =
  | "gpt-4o-mini"
  | "gpt-5.4-nano"
  | "gpt-5.6-luna"
  | "gemini-3.5-flash";

export type LlmPricing = {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached input tokens, when the provider bills cache hits separately. */
  cachedInput?: number;
  /** USD per 1M output tokens. Reasoning tokens bill as output. */
  output: number;
};

export const LLM_PRICING: Record<string, LlmPricing> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

/**
 * Cheap, high-volume classification. Left on gpt-4o-mini deliberately: it is
 * cheaper than gpt-5.6-luna on both input (0.15 vs 0.20) and output (0.60 vs 1.20),
 * so moving these would raise cost, not lower it.
 */
export const CLASSIFICATION_MODEL = "gpt-4o-mini" as const satisfies LlmModelId;

/** Default model for query interpretation and staging enrichment. */
export const DEFAULT_REASONING_MODEL = "gpt-5.4-nano" as const satisfies LlmModelId;

/**
 * Selectable alternative tier for query interpretation. Replaced gpt-5.4-mini
 * ($0.75/$4.50), which it beats on 6 published benchmarks to 0 at a quarter of the
 * price -- so as a replacement for that tier it is strictly better value.
 *
 * It is NOT an upgrade over the default. Measured on this project's own evals it is
 * slightly worse than gpt-5.4-nano: NDCG@10 0.252 vs 0.296 on the 16-query search
 * set, and 86% vs 100% precision on the resolver's 23 labelled cases, where it
 * accepted a Croatian-language title as an English translation. Keep the default on
 * nano unless a future eval says otherwise.
 */
export const ALTERNATE_REASONING_MODEL = "gpt-5.6-luna" as const satisfies LlmModelId;

/**
 * Human-facing names for the model ids, so user-visible credits stay tied to the id
 * recorded in the data rather than being typed out per page. Unknown ids fall through
 * to the raw id, which is wrong-looking enough to notice but never blank.
 */
const LLM_DISPLAY_NAMES: Record<string, string> = {
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-5.4-nano": "GPT-5.4 Nano",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
};

export function llmDisplayName(model: string) {
  return LLM_DISPLAY_NAMES[model] ?? model;
}

export function llmCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const price = LLM_PRICING[model];
  if (!price) throw new Error(`No pricing recorded for model ${model}`);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
