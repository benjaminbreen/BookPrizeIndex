/**
 * Promotes the renown experiment's scores into sources/enrichment so build-data
 * merges them onto each Book as `renownProfile`.
 *
 * Anything dropped in sources/enrichment with a `books` map is merged by
 * readEnrichment, so this script's only job is reshaping report rows into that
 * shape. Rationales are deliberately left in the report rather than promoted --
 * four per book across 9,503 books is several MB of catalog bloat for text nothing
 * currently renders.
 *
 * Report-only input: the scores are model self-reports, not verified facts. The
 * `notes` field in the output says so, matching the other generated enrichment files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BookRenownProfile } from "../lib/types";

type MetricScore = { score: number; confidence: number; rationale: string };

type ReportRow = {
  bookId: string;
  title: string;
  status: string;
  profile?: {
    knowsBook: boolean;
    publicFame: MetricScore;
    criticalRenown: MetricScore;
    controversy: MetricScore;
    llmAffinity?: MetricScore;
    affinityResidual?: number;
    tags?: { craft: string; evidence: string; stance: string };
  };
};

type Report = {
  model: string;
  promptVersion: number;
  complete?: boolean;
  rows: ReportRow[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, readArg("--report") ?? "data/reports/renown-experiment-batch1-2000.json");
const outputPath = path.join(root, "sources", "enrichment", "renown.generated.json");

async function main() {
  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as Report;
  const usable = report.rows.filter((row) =>
    row.status === "completed" && row.profile?.llmAffinity && row.profile.tags);
  if (!usable.length) throw new Error(`No usable rows in ${path.relative(root, reportPath)}.`);

  const books: Record<string, { renownProfile: BookRenownProfile }> = {};
  for (const row of usable) {
    const profile = row.profile!;
    // Later rows win, so a re-scored book overwrites its earlier entry rather than
    // silently keeping whichever came first.
    books[row.bookId] = {
      renownProfile: {
        knowsBook: profile.knowsBook,
        publicFame: profile.publicFame.score,
        criticalRenown: profile.criticalRenown.score,
        controversy: profile.controversy.score,
        llmAffinity: profile.llmAffinity!.score,
        affinityResidual: profile.affinityResidual ?? 0,
        confidence: {
          publicFame: profile.publicFame.confidence,
          criticalRenown: profile.criticalRenown.confidence,
          controversy: profile.controversy.confidence,
          llmAffinity: profile.llmAffinity!.confidence,
        },
        tags: profile.tags!,
        model: report.model,
        promptVersion: report.promptVersion,
      },
    };
  }

  await fs.writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: report.model,
    promptVersion: report.promptVersion,
    notes: "Model-estimated renown, controversy and affinity scored from title/author/year only. " +
      "These are LLM self-reports, not verified bibliographic facts. Scores are ordinal; rank llmAffinity by affinityResidual.",
    sourceReport: path.relative(root, reportPath),
    books,
  }, null, 2)}\n`);

  const known = usable.filter((row) => row.profile!.knowsBook).length;
  console.log(
    `Promoted ${Object.keys(books).length} renown profiles to ${path.relative(root, outputPath)} ` +
    `(${known} recognized, ${usable.length - known} unrecognized).`,
  );
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
