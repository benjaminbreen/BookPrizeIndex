import fs from "node:fs/promises";
import path from "node:path";
import type { RawAwardRecord } from "../../lib/award-records";
import { rawAwardRecordsDir, slugify } from "./helpers";

type RawRecordFile = {
  generatedAt?: string;
  metadata?: Record<string, unknown>;
  records?: RawAwardRecord[];
};

async function main() {
  const files = (await fs.readdir(rawAwardRecordsDir)).filter((file) => file.endsWith(".json") && file !== "import-report.json").sort();
  const records: RawAwardRecord[] = [];
  const filesReport = [];

  for (const file of files) {
    const parsed = JSON.parse(await fs.readFile(path.join(rawAwardRecordsDir, file), "utf8")) as RawRecordFile;
    const fileRecords = parsed.records ?? [];
    records.push(...fileRecords);
    filesReport.push({
      file,
      generatedAt: parsed.generatedAt,
      records: fileRecords.length,
    });
  }

  const duplicateKeys = findDuplicateKeys(records);
  const report = {
    generatedAt: new Date().toISOString(),
    files: filesReport,
    totals: {
      records: records.length,
      awards: new Set(records.map((record) => record.awardId)).size,
      categories: new Set(records.map((record) => record.categoryId)).size,
      recordsMissingSourceUrl: records.filter((record) => !record.sourceUrl).length,
      recordsMissingTitle: records.filter((record) => !record.title).length,
      recordsMissingAuthors: records.filter((record) => !record.authors.length).length,
      duplicateCanonicalKeys: duplicateKeys.length,
    },
    byCategory: Object.values(
      records.reduce<Record<string, {
        awardId: string;
        categoryId: string;
        categoryName: string;
        records: number;
        winners: number;
        finalists: number;
        earliestYear: number;
        latestYear: number;
      }>>((acc, record) => {
        const current = acc[record.categoryId] ?? {
          awardId: record.awardId,
          categoryId: record.categoryId,
          categoryName: record.categoryName,
          records: 0,
          winners: 0,
          finalists: 0,
          earliestYear: record.year,
          latestYear: record.year,
        };
        current.records += 1;
        if (record.status === "winner" || record.status === "co_winner") current.winners += 1;
        if (record.status === "finalist") current.finalists += 1;
        current.earliestYear = Math.min(current.earliestYear, record.year);
        current.latestYear = Math.max(current.latestYear, record.year);
        acc[record.categoryId] = current;
        return acc;
      }, {}),
    ).sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
    duplicateKeys: duplicateKeys.slice(0, 100),
  };

  await fs.writeFile(path.join(rawAwardRecordsDir, "import-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Validated ${records.length} raw award records across ${files.length} files.`);
  console.log(`Missing source URLs: ${report.totals.recordsMissingSourceUrl}; duplicate canonical keys: ${report.totals.duplicateCanonicalKeys}.`);
}

function findDuplicateKeys(records: RawAwardRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = [
      record.awardId,
      record.categoryId,
      record.year,
      record.status,
      slugify(record.title),
      record.authors.map(slugify).join("+"),
    ].join(":");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
