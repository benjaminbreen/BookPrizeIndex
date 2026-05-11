import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "../lib/data";
import type { Book } from "../lib/types";
import {
  catalogMissingFieldsForBook,
  compareEnrichmentPriority,
  deferredMissingFieldsForBook,
  enrichmentLaneForBook,
  enrichmentPriorityScore,
  parseLane,
  parseMissingFieldSet,
  type CatalogMissingBookField,
  type DeferredMissingBookField,
  type EnrichmentAttemptLike,
  type EnrichmentLane,
} from "./book-enrichment-priority";

type QueueRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  score: number;
  priorityScore: number;
  lane: EnrichmentLane;
  missingFields: CatalogMissingBookField[];
  deferredFields: DeferredMissingBookField[];
  recommendedAction: "catalog_completion" | "imprint_review" | "focused_completion" | "manual_review";
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDataDir = path.join(root, "data", "public");
const attemptsPath = path.join(publicDataDir, "book-enrichment-attempts.json");
const limit = Number(process.env.ENRICH_LIMIT ?? readArg("--limit") ?? "100");
const requestedLane = parseLane(readArg("--lane") ?? process.env.ENRICH_LANE);
const requestedFields = parseMissingFieldSet(readArg("--fields") ?? process.env.ENRICH_FIELDS);

async function main() {
  const generatedAt = new Date().toISOString();
  const attempts = await readAttempts();
  const queue = data.books
    .map((book) => toQueueRow(book, attempts[book.id]))
    .filter((row) => row.missingFields.length > 0)
    .filter((row) => !requestedLane || row.lane === requestedLane)
    .filter((row) => !requestedFields?.size || row.missingFields.some((field) => requestedFields.has(field)))
    .sort(compareEnrichmentPriority)
    .slice(0, limit);

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(
    path.join(publicDataDir, "book-enrichment-queue.json"),
    `${JSON.stringify({ generatedAt, limit, lane: requestedLane, fields: requestedFields ? [...requestedFields] : undefined, count: queue.length, lanes: summarizeLanes(queue), queue }, null, 2)}\n`,
  );

  console.log(`Queued ${queue.length} books for enrichment. Report written to data/public/book-enrichment-queue.json.`);
}

async function readAttempts(): Promise<Record<string, EnrichmentAttemptLike>> {
  try {
    const parsed = JSON.parse(await fs.readFile(attemptsPath, "utf8")) as { attempts?: Record<string, EnrichmentAttemptLike> };
    return parsed.attempts ?? {};
  } catch {
    return {};
  }
}

function toQueueRow(book: Book, attempt?: EnrichmentAttemptLike): QueueRow {
  const stats = getBookStats(book.id);
  const missingFields = catalogMissingFieldsForBook(book);
  const lane = enrichmentLaneForBook(book, stats, attempt);
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((item) => item.name).join(" "),
    score: stats.score,
    priorityScore: enrichmentPriorityScore(book, stats, lane),
    lane,
    missingFields,
    deferredFields: deferredMissingFieldsForBook(book),
    recommendedAction: recommendedAction(lane, missingFields),
  };
}

function recommendedAction(lane: EnrichmentLane, missingFields: CatalogMissingBookField[]): QueueRow["recommendedAction"] {
  if (lane === "low_confidence_review") return "manual_review";
  if (missingFields.every((field) => field === "imprintId")) return "imprint_review";
  if (lane === "cover_needed" || lane === "summary_needed" || lane === "identity_needed") return "focused_completion";
  return "catalog_completion";
}

function summarizeLanes(queue: QueueRow[]) {
  const summary: Record<string, number> = {};
  for (const row of queue) summary[row.lane] = (summary[row.lane] ?? 0) + 1;
  return summary;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
