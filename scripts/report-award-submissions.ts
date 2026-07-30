/**
 * Coverage and staleness report for curated entry windows.
 *
 * Prints the work queue for `sources/award-submissions.json`: which prizes have
 * no sourced entry window, which entries were verified long enough ago that the
 * dates should be re-checked, and which confirmed cycle dates have passed and
 * now fall back to the recurring rule. Only prizes that appear on /awards are
 * reported, since those are the rows an applicant actually sees.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PublicData } from "../lib/types";
import type { BrowseAwardRow } from "../lib/browse-types";
import { todayIso } from "../lib/award-submission";
import { publicDataDir } from "./build/paths";

const RECHECK_AFTER_DAYS = 180;

const today = todayIso();
const entities = JSON.parse(await fs.readFile(path.join(publicDataDir, "catalog-entities.json"), "utf8")) as PublicData;
const browse = JSON.parse(await fs.readFile(path.join(publicDataDir, "browse.json"), "utf8")) as { awards: BrowseAwardRow[] };

const awardsById = new Map(entities.awards.map((award) => [award.id, award]));
const programsById = new Map((entities.awardPrograms ?? []).map((program) => [program.id, program]));

const missing: string[] = [];
const recheck: string[] = [];
const passed: string[] = [];

for (const row of browse.awards) {
  const url = row.id.startsWith("program-")
    ? programsById.get(row.id.slice("program-".length))?.officialUrl
    : awardsById.get(row.id)?.links.submission ?? awardsById.get(row.id)?.links.official;
  const key = row.id.startsWith("program-") ? `programs.${row.id.slice("program-".length)}` : `awards.${row.id}`;

  if (!row.submission) {
    missing.push(`  ${row.name}\n      key: ${key}\n      ${url ?? "no official URL on file"}`);
    continue;
  }
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.submission.verifiedOn}T00:00:00Z`)) / 86_400_000);
  if (age > RECHECK_AFTER_DAYS) {
    recheck.push(`  ${row.name} — verified ${row.submission.verifiedOn} (${age} days ago) — ${row.submission.sourceUrl ?? row.submission.url ?? url ?? "no source URL"}`);
  }
  if (row.submission.nextCloseDate && row.submission.nextCloseDate < today) {
    passed.push(`  ${row.name} — verified cycle closed ${row.submission.nextCloseDate}${row.submission.closesOn ? `; now shown as ~${row.submission.closesOn} annually` : "; no recurring rule, shown as undated"}`);
  }
}

const total = browse.awards.length;
console.log(`Award entry windows — ${total - missing.length} of ${total} listed prizes have a sourced window (${today}).\n`);
section("Missing an entry window (curate from the official page)", missing);
section(`Verified more than ${RECHECK_AFTER_DAYS} days ago (re-check dates)`, recheck);
section("Confirmed cycle has passed (confirm the next cycle's date)", passed);

function section(title: string, lines: string[]) {
  if (!lines.length) return;
  console.log(`${title}: ${lines.length}`);
  console.log(lines.sort().join("\n"));
  console.log("");
}
