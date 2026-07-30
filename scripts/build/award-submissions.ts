import fs from "node:fs/promises";
import path from "node:path";
import type { Award, AwardProgram, AwardSubmission } from "../../lib/types";
import { sourcesDir } from "./paths";

export type AwardSubmissionsFile = {
  notes?: string;
  awards?: Record<string, AwardSubmission>;
  programs?: Record<string, AwardSubmission>;
};

export async function readAwardSubmissions(): Promise<AwardSubmissionsFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "award-submissions.json"), "utf8")) as AwardSubmissionsFile;
  } catch {
    return {};
  }
}

/**
 * Attaches curated submission windows. A category inherits its program's entry
 * rules unless it carries its own, which is how most multi-category prizes work.
 */
export function applyAwardSubmissions(
  submissions: AwardSubmissionsFile,
  awards: Map<string, Award>,
  programs: AwardProgram[],
) {
  for (const program of programs) {
    const submission = submissions.programs?.[program.id];
    if (submission) program.submission = submission;
  }
  const programSubmissions = new Map(programs.filter((program) => program.submission).map((program) => [program.id, program.submission!]));
  for (const award of awards.values()) {
    const submission = submissions.awards?.[award.id] ?? (award.programId ? programSubmissions.get(award.programId) : undefined);
    if (submission) award.submission = submission;
  }
}
