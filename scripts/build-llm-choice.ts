/**
 * Builds the LLM's Choice panel data from the renown pass.
 *
 * Two rankings, deliberately: raw affinity correlates ~0.6 with public fame, so on
 * its own it produces a greatest-hits list that mostly restates what is already
 * famous. The residual -- affinity net of what fame predicts -- is the ranking that
 * surfaces books nobody has seen on a list before, and it is what the panel leads
 * with.
 *
 * Only books the model actually recognized are ranked. An unrecognized book has no
 * meaningful affinity score, and including them would fill the tail with noise.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { BrowseData } from "../lib/browse-types";
import type { Book } from "../lib/types";
import type { LlmChoiceBook, LlmChoiceData, LlmChoiceTagDimension } from "../lib/llm-choice-types";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "data/public/catalog-books.json");
const BROWSE_PATH = path.join(ROOT, "data/public/browse.json");
// Rationales are not promoted into the catalog -- four per book across 9,503 books is
// megabytes of text nothing else renders. Only the ranked books need them, so they are
// read straight from the scoring report here.
const REPORT_PATH = path.join(ROOT, "data/reports/renown-experiment-batch1-2000.json");
const OUTPUT_PATH = path.join(ROOT, "public/fun/llm-choice.json");
// Deep enough that filtering by a tag still leaves a real list. The panel derives
// its chips from these ranked books rather than from corpus-wide counts, so a
// shallow pool would leave chips that match nothing.
const RANK_SIZE = 120;
const TAG_KEYS: LlmChoiceTagDimension[] = ["craft", "evidence", "stance"];
const GRID = 28;

type ScoringReport = {
  rows: Array<{
    bookId: string;
    status: string;
    profile?: {
      llmAffinity?: { rationale: string };
      publicFame?: { rationale: string };
    };
  }>;
};

async function main() {
  const [catalog, browse, report] = await Promise.all([
    readJson<{ books: Book[] }>(CATALOG_PATH),
    readJson<BrowseData>(BROWSE_PATH),
    readJson<ScoringReport>(REPORT_PATH),
  ]);
  const browseById = new Map(browse.books.map((row) => [row.id, row]));
  const notesById = new Map(report.rows
    .filter((row) => row.status === "completed" && row.profile)
    .map((row) => [row.bookId, {
      affinityNote: row.profile!.llmAffinity?.rationale,
      fameNote: row.profile!.publicFame?.rationale,
    }]));

  const scored = catalog.books.flatMap((book) => {
    const profile = book.renownProfile;
    if (!profile || !profile.knowsBook) return [];
    const row = browseById.get(book.id);
    return [{
      bookId: book.id,
      slug: book.slug,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      publicationYear: book.publicationYear,
      thumbnailUrl: row?.thumbnailUrl,
      primaryTopic: book.primaryTopic,
      affinity: profile.llmAffinity,
      fame: profile.publicFame,
      criticalRenown: profile.criticalRenown,
      residual: profile.affinityResidual,
      tags: profile.tags as Record<LlmChoiceTagDimension, string>,
      ...notesById.get(book.id),
    } satisfies LlmChoiceBook];
  });
  if (!scored.length) throw new Error("No recognized books carry a renownProfile. Run promote-renown-profiles first.");

  const affinity = scored.map((book) => book.affinity);
  const fame = scored.map((book) => book.fame);

  const tagCounts = Object.fromEntries(TAG_KEYS.map((key) => {
    const counts = new Map<string, number>();
    for (const book of scored) {
      const value = book.tags?.[key];
      if (!value || value === "none") continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [key, [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))];
  })) as LlmChoiceData["tagCounts"];

  const data: LlmChoiceData = {
    generatedAt: new Date().toISOString(),
    model: catalog.books.find((book) => book.renownProfile)?.renownProfile?.model ?? "unknown",
    count: scored.length,
    meanAffinity: round(mean(affinity)),
    meanFame: round(mean(fame)),
    affinityFameCorrelation: round(pearson(affinity, fame), 3),
    tagCounts,
    overlooked: rank(scored, (book) => book.residual),
    favorites: rank(scored, (book) => book.affinity),
    grid: GRID,
    density: densityGrid(scored),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(data)}\n`);
  console.log(
    `LLM's Choice ready: ${data.count.toLocaleString("en-US")} recognized books, ` +
    `mean affinity ${data.meanAffinity} vs mean fame ${data.meanFame}, r=${data.affinityFameCorrelation}.`,
  );
}

/**
 * Bins books into a GRID x GRID lattice over (fame, affinity). Shipping all 7,554
 * points cost 1.3 MB and drew as an unreadable blob; the binned form is a few KB and
 * reads as a proper density cloud.
 */
function densityGrid(books: LlmChoiceBook[]) {
  const bins = new Map<string, number>();
  for (const book of books) {
    const x = Math.min(GRID - 1, Math.floor((book.fame / 100) * GRID));
    const y = Math.min(GRID - 1, Math.floor((book.affinity / 100) * GRID));
    const key = `${x}:${y}`;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  return [...bins.entries()].map(([key, n]) => {
    const [x, y] = key.split(":").map(Number);
    return { x, y, n };
  });
}

/** Ties break by title so the output is stable across rebuilds. */
function rank(books: LlmChoiceBook[], score: (book: LlmChoiceBook) => number) {
  return [...books]
    .sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title))
    .slice(0, RANK_SIZE);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(a: number[], b: number[]) {
  const meanA = mean(a);
  const meanB = mean(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) *
    b.reduce((sum, value) => sum + (value - meanB) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
}

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
