import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RawAwardRecord } from "../lib/award-records";
import { reportsDataDir } from "./build/paths";
import { findRawRecordQualityIssues } from "./import-award-records/quality";
import { rawAwardRecordsDir, slugify } from "./import-award-records/helpers";

type RawRecordFile = {
  generatedAt?: string;
  metadata?: Record<string, unknown>;
  records?: RawAwardRecord[];
};

type FileAudit = {
  file: string;
  baselineRecords: number;
  refreshedRecords: number;
  retainedBaselineRecords: number;
  acceptedNewRecords: number;
  rejectedNewRecords: number;
  replacedRevisions: number;
  repairedBaselineRecords: number;
  excludedCorruptBaselineRecords: number;
  accepted: Array<ReturnType<typeof summarizeRecord>>;
  rejected: Array<ReturnType<typeof summarizeRecord> & { issues: string[] }>;
};

const execFileAsync = promisify(execFile);
const baselineRef = readArg("--baseline-ref") ?? "HEAD";
const shouldWrite = process.argv.includes("--write");

async function main() {
  const files = (await fs.readdir(rawAwardRecordsDir))
    .filter((file) => file.endsWith(".json") && file !== "import-report.json")
    .sort();
  const audits: FileAudit[] = [];

  for (const file of files) {
    const currentPath = path.join(rawAwardRecordsDir, file);
    const current = JSON.parse(await fs.readFile(currentPath, "utf8")) as RawRecordFile;
    const baseline = await readBaselineFile(file);
    const refreshedRecords = current.records ?? [];
    const baselineRecords = baseline?.records ?? [];
    const baselineMatches = new Set<number>();
    const resolvedBaseline = baselineRecords.map((record) => ({
      record,
      include: findRawRecordQualityIssues([record]).length === 0,
    }));
    const acceptedNew: RawAwardRecord[] = [];
    const rejected: FileAudit["rejected"] = [];
    let replacedRevisions = 0;
    let repairedBaselineRecords = 0;

    for (const rawRecord of refreshedRecords) {
      const record = cleanSafeParserBoundaries(rawRecord);
      const matchIndex = bestBaselineMatch(record, baselineRecords, baselineMatches);
      if (matchIndex !== undefined) {
        baselineMatches.add(matchIndex);
        if (!sameRecord(record, baselineRecords[matchIndex])) {
          replacedRevisions += 1;
          const currentIssues = findRawRecordQualityIssues([record]);
          const baselineIssues = findRawRecordQualityIssues([baselineRecords[matchIndex]]);
          if (!currentIssues.length && baselineIssues.length) {
            resolvedBaseline[matchIndex] = { record, include: true };
            repairedBaselineRecords += 1;
          }
        }
        continue;
      }

      const issues = findRawRecordQualityIssues([record]);
      if (issues.length) {
        rejected.push({ ...summarizeRecord(record), issues: [...new Set(issues.map((issue) => issue.code))] });
        continue;
      }
      acceptedNew.push(record);
    }

    const retainedBaseline = resolvedBaseline.filter((item) => item.include).map((item) => item.record);
    const excludedCorruptBaselineRecords = baselineRecords.length - retainedBaseline.length;
    const reconciled = [...acceptedNew.sort(compareRecords), ...retainedBaseline];
    audits.push({
      file,
      baselineRecords: baselineRecords.length,
      refreshedRecords: refreshedRecords.length,
      retainedBaselineRecords: retainedBaseline.length,
      acceptedNewRecords: acceptedNew.length,
      rejectedNewRecords: rejected.length,
      replacedRevisions,
      repairedBaselineRecords,
      excludedCorruptBaselineRecords,
      accepted: acceptedNew.map(summarizeRecord),
      rejected,
    });

    if (shouldWrite) {
      const changed = acceptedNew.length || rejected.length || replacedRevisions || excludedCorruptBaselineRecords;
      if (!changed && baseline) {
        await fs.writeFile(currentPath, `${JSON.stringify(baseline, null, 2)}\n`);
        continue;
      }
      await fs.writeFile(
        currentPath,
        `${JSON.stringify({
          generatedAt: new Date().toISOString(),
          metadata: {
            ...(current.metadata ?? baseline?.metadata ?? {}),
            reconciliation: {
              baselineRef,
              retainedBaselineRecords: retainedBaseline.length,
              acceptedNewRecords: acceptedNew.length,
              rejectedNewRecords: rejected.length,
              repairedBaselineRecords,
              excludedCorruptBaselineRecords,
            },
          },
          records: reconciled,
        }, null, 2)}\n`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baselineRef,
    wroteChanges: shouldWrite,
    totals: {
      files: audits.length,
      retainedBaselineRecords: audits.reduce((sum, audit) => sum + audit.retainedBaselineRecords, 0),
      acceptedNewRecords: audits.reduce((sum, audit) => sum + audit.acceptedNewRecords, 0),
      rejectedNewRecords: audits.reduce((sum, audit) => sum + audit.rejectedNewRecords, 0),
      replacedRevisions: audits.reduce((sum, audit) => sum + audit.replacedRevisions, 0),
      repairedBaselineRecords: audits.reduce((sum, audit) => sum + audit.repairedBaselineRecords, 0),
      excludedCorruptBaselineRecords: audits.reduce((sum, audit) => sum + audit.excludedCorruptBaselineRecords, 0),
    },
    files: audits.filter((audit) =>
      audit.acceptedNewRecords || audit.rejectedNewRecords || audit.replacedRevisions || audit.excludedCorruptBaselineRecords || audit.baselineRecords !== audit.refreshedRecords),
  };
  await fs.mkdir(reportsDataDir, { recursive: true });
  await fs.writeFile(path.join(reportsDataDir, "award-record-refresh-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Audit written to data/reports/award-record-refresh-audit.json${shouldWrite ? "; raw files reconciled" : ""}.`);
}

async function readBaselineFile(file: string): Promise<RawRecordFile | undefined> {
  const relativePath = path.posix.join("data", "raw", "award-records", file);
  try {
    const { stdout } = await execFileAsync("git", ["show", `${baselineRef}:${relativePath}`], {
      cwd: path.resolve(rawAwardRecordsDir, "..", "..", ".."),
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(stdout) as RawRecordFile;
  } catch {
    return undefined;
  }
}

function bestBaselineMatch(record: RawAwardRecord, baseline: RawAwardRecord[], used: Set<number>) {
  let best: { index: number; score: number } | undefined;
  for (let index = 0; index < baseline.length; index += 1) {
    if (used.has(index)) continue;
    const candidate = baseline[index];
    if (candidate.awardId !== record.awardId || candidate.categoryId !== record.categoryId || candidate.status !== record.status) continue;
    if (Math.abs(candidate.year - record.year) > 1) continue;
    const score = revisionScore(record, candidate);
    if (score < 0.72) continue;
    if (!best || score > best.score) best = { index, score };
  }
  return best?.index;
}

function revisionScore(a: RawAwardRecord, b: RawAwardRecord) {
  const titleA = slugify(a.title);
  const titleB = slugify(b.title);
  const authorA = new Set(a.authors.map(slugify));
  const authorB = new Set(b.authors.map(slugify));
  const titleExact = titleA === titleB ? 1 : tokenSimilarity(titleA, titleB);
  const authorExact = setEquals(authorA, authorB) ? 1 : setOverlap(authorA, authorB);
  const sameYear = a.year === b.year ? 1 : 0;
  if (titleExact === 1) return 0.82 + authorExact * 0.13 + sameYear * 0.05;
  if (authorExact === 1 && uniqueAuthorMatch(authorA, authorB)) return 0.74 + titleExact * 0.21 + sameYear * 0.05;
  return titleExact * 0.62 + authorExact * 0.28 + sameYear * 0.1;
}

function uniqueAuthorMatch(a: Set<string>, b: Set<string>) {
  return a.size > 0 && b.size > 0 && a.size === b.size;
}

function tokenSimilarity(a: string, b: string) {
  const tokensA = new Set(a.split("-").filter((token) => token.length > 1));
  const tokensB = new Set(b.split("-").filter((token) => token.length > 1));
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union ? intersection / union : 0;
}

function setOverlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  return [...a].filter((value) => b.has(value)).length / Math.max(a.size, b.size);
}

function setEquals(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function sameRecord(a: RawAwardRecord, b: RawAwardRecord) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function summarizeRecord(record: RawAwardRecord) {
  return {
    awardId: record.awardId,
    categoryId: record.categoryId,
    year: record.year,
    status: record.status,
    title: record.title,
    authors: record.authors,
    sourceUrl: record.sourceUrl,
  };
}

function cleanSafeParserBoundaries(record: RawAwardRecord): RawAwardRecord {
  const cleanBoundary = (value: string) => value.replace(/^\s*\|+\s*|\s*\|+\s*$/g, "").trim();
  return {
    ...record,
    title: cleanBoundary(record.title),
    authors: record.authors.map(cleanBoundary).filter(Boolean),
  };
}

function compareRecords(a: RawAwardRecord, b: RawAwardRecord) {
  return b.year - a.year || statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title);
}

function statusRank(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist" || status === "shortlist") return 2;
  if (status === "longlist") return 3;
  return 9;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
