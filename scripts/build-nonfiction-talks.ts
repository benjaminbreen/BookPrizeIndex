/**
 * Builds "What Nonfiction Talks About" from the interpretive claims extracted by the
 * semantic profile pass, placed on a year axis.
 *
 * One row per year, one strip per book. Row length is the count, so the page itself
 * shows the corpus widening; colour is the stance tag from the renown pass. Year is
 * the unit deliberately -- decade buckets would smooth away the growth that is the
 * most legible thing here, and per-year counts run 96-195 claims from 2010 on, which
 * is plenty of mass to render honestly.
 *
 * Claims live in sources/enrichment, not the public catalog: compactBook strips
 * experimentalSemanticProfile from the shipped artifact.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Book } from "../lib/types";
import type { NonfictionTalksClaim, NonfictionTalksData, NonfictionTalksYear } from "../lib/nonfiction-talks-types";

const ROOT = process.cwd();
const PROFILES_PATH = path.join(ROOT, "sources/enrichment/semantic-profiles.generated.json");
const CATALOG_PATH = path.join(ROOT, "data/public/catalog-books.json");
const OUTPUT_PATH = path.join(ROOT, "public/fun/nonfiction-talks.json");
/** Before this the corpus thins to single digits a year; the tail stays but stops earlier. */
const MIN_YEAR = 1960;

type ProfilesFile = {
  books: Record<string, { experimentalSemanticProfile?: { argument?: { present: boolean; statement: string } } }>;
};

async function main() {
  const [profiles, catalog] = await Promise.all([
    readJson<ProfilesFile>(PROFILES_PATH),
    readJson<{ books: Book[] }>(CATALOG_PATH),
  ]);

  const claimById = new Map<string, string>();
  for (const [bookId, entry] of Object.entries(profiles.books)) {
    const argument = entry.experimentalSemanticProfile?.argument;
    if (argument?.present && argument.statement) claimById.set(bookId, argument.statement.trim());
  }

  // Collected with label strings first; indices are assigned once both label sets are
  // complete, so a single pass over the catalog is enough.
  type LabelledClaim = { stance: string; subject: string; title: string; slug: string; claim: string };
  const subjects = new Set<string>();
  const stances = new Set<string>();
  const byYear = new Map<number, { claims: LabelledClaim[]; unclaimed: number }>();
  const maxYear = new Date().getFullYear();

  for (const book of catalog.books) {
    const year = book.publicationYear;
    if (!year || year < MIN_YEAR || year > maxYear) continue;
    const row = byYear.get(year) ?? { claims: [], unclaimed: 0 };
    const claim = claimById.get(book.id);
    if (claim) {
      const subject = book.primarySubject ?? "Unclassified";
      const stance = book.renownProfile?.tags?.stance ?? "none";
      subjects.add(subject);
      stances.add(stance);
      row.claims.push({ stance, subject, title: book.title, slug: book.slug, claim });
    } else {
      row.unclaimed += 1;
    }
    byYear.set(year, row);
  }

  // "none" last so the neutral band sits at the end of each row rather than mid-run.
  const stanceList = [...stances].filter((value) => value !== "none").sort();
  if (stances.has("none")) stanceList.push("none");
  const subjectList = [...subjects].sort();
  const stanceIndex = new Map(stanceList.map((value, index) => [value, index]));
  const subjectIndex = new Map(subjectList.map((value, index) => [value, index]));

  const years: NonfictionTalksYear[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, row]) => ({
      year,
      // Sorted by stance so each row reads as colour bands instead of confetti.
      claims: row.claims
        .map((claim): NonfictionTalksClaim => ({
          stance: stanceIndex.get(claim.stance) ?? stanceList.length - 1,
          subject: subjectIndex.get(claim.subject) ?? 0,
          title: claim.title,
          slug: claim.slug,
          claim: claim.claim,
        }))
        .sort((a, b) => a.stance - b.stance || a.title.localeCompare(b.title)),
      unclaimed: row.unclaimed,
    }));

  const claimCount = years.reduce((sum, row) => sum + row.claims.length, 0);
  const bookCount = years.reduce((sum, row) => sum + row.claims.length + row.unclaimed, 0);
  const data: NonfictionTalksData = {
    generatedAt: new Date().toISOString(),
    claimCount,
    bookCount,
    minYear: years[0]?.year ?? MIN_YEAR,
    maxYear: years[years.length - 1]?.year ?? maxYear,
    maxRow: Math.max(...years.map((row) => row.claims.length + row.unclaimed), 1),
    subjects: subjectList,
    stances: stanceList,
    years,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(data)}\n`);
  console.log(
    `Nonfiction Talks ready: ${claimCount.toLocaleString("en-US")} claims across ${years.length} years ` +
    `(${data.minYear}-${data.maxYear}), ${bookCount.toLocaleString("en-US")} books total, widest row ${data.maxRow}.`,
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
