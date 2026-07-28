import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
  RawAwardRecordStatus,
} from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

// "Elizabeth Longford Prize for Historical Biography" is a redirect; this is the real page.
const pageTitle = "Elizabeth Longford Prize";
const prizeId = "elizabeth-longford-prize";
const categoryId = "elizabeth-longford-historical-biography";

/**
 * Corrections for specific observed source defects.
 *
 * The 2025 winner bullet is scrambled in the wikitext — the title's first half sits in an
 * italic run *before* the author and the second half after it:
 *   * Winner: ''Augustus the Strong:'' [[Tim Blanning]] for ''A Study in Artistic Greatness…''
 */
const rowOverrides = new Map<string, { title: string; authors: string[]; publisher?: string }>([
  [
    "2025:winner",
    {
      title: "Augustus the Strong: A Study in Artistic Greatness and Political Fiasco",
      authors: ["Tim Blanning"],
      publisher: "Allen Lane",
    },
  ],
]);

/** [[Yale Press]] is a redirect to the actual imprint name. */
const publisherAliases = new Map<string, string>([["Yale Press", "Yale University Press"]]);

/**
 * Observed source typos in publisher parentheticals. The title/author on these rows is
 * correct, so the row is kept and only the bad publisher string is dropped.
 * 2021 Sudhir Hazareesingh: "(Allen King)" is a typo for Allen Lane.
 */
const droppedPublishers = new Set<string>(["2021:Allen King"]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);

  console.log(`Fetching ${pageTitle} winners and shortlists from MediaWiki...`);
  const records = parseElizabethLongford(prize, category, await fetchMediaWikiWikitext(pageTitle));
  assertCoverage(records);

  const byStatus = countByStatus(records);
  await writeRawAwardRecords("elizabeth-longford-prize.json", records, {
    importer: "scripts/import-award-records/elizabeth-longford-prize.ts",
    source: category.sourceLabel,
    notes:
      "The official site publishes only the current year's shortlist, so Wikipedia is used. " +
      "Pre-2019 winner bullets carry no 'Winner:' prefix, so status is driven by the bold " +
      "'''YYYY''' year heading plus the literal 'Shortlist:' marker line rather than by the " +
      `bullet text. Official archive: ${category.officialUrl ?? "https://elhb.uk/winners/"}`,
    records: records.length,
    winners: byStatus.winner ?? 0,
    shortlisted: byStatus.shortlist ?? 0,
    yearRange: yearRange(records),
    coverageNotes:
      "Shortlists are archived only from 2019 onward. The 2023 shortlist row for Leanda de Lisle " +
      "carries two dangling publishers in the source, so only the first is recorded.",
  });
  console.log(`Imported ${records.length} Elizabeth Longford Prize records (${yearRange(records)}).`);
}

export function parseElizabethLongford(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "Winners", "References");
  const records: RawAwardRecord[] = [];
  let year: number | undefined;
  let status: RawAwardRecordStatus = "winner";

  for (const rawLine of section.split("\n")) {
    const line = stripRefs(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("=")) continue; // decade sub-headings

    const heading = line.match(/^'''\s*((?:19|20)\d{2})\s*'''$/);
    if (heading) {
      year = Number(heading[1]);
      status = "winner"; // every year block starts with its winner bullet(s)
      continue;
    }

    if (/^Shortlist\s*:?$/i.test(line)) {
      if (!year) throw new Error("Elizabeth Longford shortlist marker before any year heading");
      status = "shortlist";
      continue;
    }

    if (!line.startsWith("*")) continue;
    if (!year) throw new Error(`Elizabeth Longford bullet before any year heading: ${line}`);

    const body = line.replace(/^\*\s*/, "").replace(/^Winner\s*:\s*/i, "").trim();
    if (!body) continue;

    const parsed = rowOverrides.get(`${year}:${status}`) ?? parseRow(year, body);
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status,
      title: parsed.title,
      authors: parsed.authors,
      publisher: parsed.publisher,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official archive: ${category.officialUrl}` : undefined,
    });
  }

  return records.sort((a, b) => b.year - a.year || statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title));
}

/**
 * Bullet grammar (both with and without the "Winner:" prefix, already stripped):
 *   AUTHOR for ''TITLE'' (PUBLISHER)
 * with several observed deviations: a missing "for", a title split across two adjacent
 * italic runs, and publisher parentheses that sit inside the italics.
 */
function parseRow(year: number, body: string) {
  const firstItalic = body.indexOf("''");
  if (firstItalic < 0) throw new Error(`No italic title in ${year} bullet: ${body}`);

  const authorText = cleanText(wikiToPlainText(body.slice(0, firstItalic)))
    .replace(/\s+for$/i, "")
    .replace(/[,\s]+$/, "");
  const authors = normalizeAuthorList(authorText);
  if (!authors.length) throw new Error(`No authors parsed for ${year}: ${body}`);

  // Collect consecutive italic runs that belong to the title; stop at the first run that is
  // really a publisher parenthetical (2024 M.W. Rowe, 2023 Leanda de Lisle).
  const runs = /''([\s\S]*?)''/g;
  const titleParts: string[] = [];
  let tailIndex = body.length;
  let match: RegExpExecArray | null;
  runs.lastIndex = firstItalic;
  while ((match = runs.exec(body))) {
    const text = cleanText(wikiToPlainText(match[1]));
    if (!text || text.startsWith("(")) {
      tailIndex = match.index;
      break;
    }
    titleParts.push(text);
    tailIndex = runs.lastIndex;
  }

  const title = cleanText(titleParts.join(" ")).replace(/[,\s]+$/, "");
  if (!title) throw new Error(`No title parsed for ${year}: ${body}`);

  return { title, authors, publisher: parsePublisher(year, body.slice(tailIndex)) };
}

function parsePublisher(year: number, tail: string) {
  const text = cleanText(wikiToPlainText(tail));
  const paren = text.match(/\(([^()]+)\)/);
  if (!paren) return undefined;
  const value = cleanText(paren[1]);
  // "(bio of Edward Heath)" and friends are annotations, not publishers.
  if (!/^[A-Z]/.test(value)) return undefined;
  if (droppedPublishers.has(`${year}:${value}`)) return undefined;
  return publisherAliases.get(value) ?? value;
}

function stripRefs(value: string) {
  return value.replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<ref[^>]*\/>/gi, "");
}

function statusRank(status: RawAwardRecordStatus) {
  return status === "winner" ? 0 : 1;
}

function sectionBetween(wikitext: string, startLabel: string, endLabel: string) {
  const start = wikitext.search(new RegExp(`^==\\s*${startLabel}\\s*==\\s*$`, "mi"));
  const end = wikitext.search(new RegExp(`^==\\s*${endLabel}\\s*==\\s*$`, "mi"));
  if (start < 0 || end <= start) throw new Error(`Could not find ${startLabel} section`);
  return wikitext.slice(start, end);
}

function countByStatus(records: RawAwardRecord[]) {
  const counts: Partial<Record<RawAwardRecordStatus, number>> = {};
  for (const record of records) counts[record.status] = (counts[record.status] ?? 0) + 1;
  return counts;
}

export function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== 54) throw new Error(`Expected exactly 54 Elizabeth Longford records, got ${records.length}`);
  const winners = records.filter((record) => record.status === "winner");
  if (winners.length !== 24) throw new Error(`Expected exactly 24 Elizabeth Longford winners, got ${winners.length}`);
  if (yearRange(records) !== "2003-2026") throw new Error(`Unexpected Elizabeth Longford range: ${yearRange(records)}`);

  const winnerYears = new Set(winners.map((record) => record.year));
  for (let year = 2003; year <= 2026; year += 1) {
    const count = winners.filter((record) => record.year === year).length;
    if (count !== 1) throw new Error(`Expected exactly 1 Elizabeth Longford winner in ${year}, got ${count}`);
  }
  if (winnerYears.size !== 24) throw new Error(`Expected 24 distinct Elizabeth Longford winner years`);
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
