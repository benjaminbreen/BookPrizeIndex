import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = path.join(root, "data", "reports");
const artifactsDir = path.join(reportsDir, "ci-artifacts");

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true });
  await compact("reader-traits-report.json", compactReaderTraits);
  await compact("semantic-profile-pilot-full-corpus-report.json", compactSemanticReport);
  await compact("semantic-profile-pilot-full-corpus-candidates.json", compactRowObject);
  await compact("semantic-profile-pilot-full-corpus-flagged-review.json", compactRowObject);
}

async function compact(filename: string, summarize: (report: Record<string, unknown>) => Record<string, unknown>) {
  const reportPath = path.join(reportsDir, filename);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as Record<string, unknown>;
  if (!containsDetailedRows(report)) return;
  await Promise.all([
    fs.writeFile(path.join(artifactsDir, filename), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(reportPath, `${JSON.stringify(summarize(report), null, 2)}\n`),
  ]);
  console.log(`Compacted ${filename}; full rows retained in data/reports/ci-artifacts/.`);
}

function containsDetailedRows(report: Record<string, unknown>) {
  return [report.rows, report.report].some((value) => Array.isArray(value) && value.length > 100);
}

function compactReaderTraits(report: Record<string, unknown>) {
  const rows = Array.isArray(report.report) ? report.report : [];
  const review = Array.isArray(report.review) ? report.review : [];
  return {
    generatedAt: report.generatedAt,
    totalBooks: report.totalBooks,
    classifiedBooks: report.classifiedBooks,
    traitCounts: report.traitCounts,
    readerLevelCounts: report.readerLevelCounts,
    rowCounts: { classified: rows.length, review: review.length },
    reviewSample: review.slice(0, 25),
  };
}

function compactSemanticReport(report: Record<string, unknown>) {
  const { rows, ...summary } = report;
  return { ...summary, rowCount: Array.isArray(rows) ? rows.length : 0 };
}

function compactRowObject(report: Record<string, unknown>) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const { rows: _rows, ...summary } = report;
  return {
    ...summary,
    rowCount: rows.length,
    sample: rows.slice(0, 25).map((row) => compactRow(row as Record<string, unknown>)),
  };
}

function compactRow(row: Record<string, unknown>) {
  return Object.fromEntries(["bookId", "slug", "status", "validationWarnings", "review"]
    .flatMap((key) => row[key] === undefined ? [] : [[key, row[key]]]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
