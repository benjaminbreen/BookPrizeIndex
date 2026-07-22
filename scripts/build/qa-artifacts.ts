import fs from "node:fs/promises";
import path from "node:path";

type QaRow = Record<string, unknown>;

export async function writeRowQaArtifact({
  filename,
  generatedAt,
  reportsDir,
  rows,
}: {
  filename: string;
  generatedAt: string;
  reportsDir: string;
  rows: QaRow[];
}) {
  const artifactsDir = path.join(reportsDir, "ci-artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(artifactsDir, filename), `${JSON.stringify(rows, null, 2)}\n`),
    fs.writeFile(path.join(reportsDir, filename), `${JSON.stringify(summarizeQaRows(generatedAt, rows), null, 2)}\n`),
  ]);
}

export async function writeAggregateQaArtifact({
  filename,
  generatedAt,
  reportsDir,
  report,
  rowCounts,
  summary,
}: {
  filename: string;
  generatedAt: string;
  reportsDir: string;
  report: unknown;
  rowCounts: Record<string, number>;
  summary: unknown;
}) {
  const artifactsDir = path.join(reportsDir, "ci-artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(artifactsDir, filename), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(reportsDir, filename), `${JSON.stringify({ generatedAt, rowCounts, summary }, null, 2)}\n`),
  ]);
}

function summarizeQaRows(generatedAt: string, rows: QaRow[]) {
  const countFields = ["confidence", "primarySubject", "primaryTopic", "readerLevel", "reason", "reviewReason", "suggestedSubject"];
  return {
    generatedAt,
    rowCount: rows.length,
    counts: Object.fromEntries(countFields
      .map((field) => [field, countValues(rows.map((row) => row[field]))] as const)
      .filter(([, counts]) => Object.keys(counts).length)),
    issueCounts: countValues(rows.flatMap((row) => [
      ...(Array.isArray(row.reasons) ? row.reasons : []),
      ...(Array.isArray(row.warnings) ? row.warnings : []),
    ])),
    sample: rows.slice(0, 25).map(compactSampleRow),
  };
}

function compactSampleRow(row: QaRow) {
  return Object.fromEntries([
    "bookId", "title", "author", "primarySubject", "primaryTopic", "confidence", "reason", "reviewReason", "suggestedSubject", "reasons", "warnings",
  ].flatMap((field) => row[field] === undefined ? [] : [[field, row[field]]]));
}

function countValues(values: unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
