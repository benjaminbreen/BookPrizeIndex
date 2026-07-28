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

const pageTitle = "Arthur Ross Book Award";
const prizeId = "arthur-ross-book-award";
const categoryId = "arthur-ross-international-affairs";

/**
 * Tier labels used on the Wikipedia list. The third tier was called "Honorable Mention"
 * through 2015 and "Bronze Medal" from 2016 onward; both are recorded with the literal
 * label in `notes` so the medal lineage survives the status mapping.
 */
const tierStatus = new Map<string, RawAwardRecordStatus>([
  ["Gold Medal", "winner"],
  ["Silver Medal", "finalist"],
  ["Bronze Medal", "finalist"],
  ["Honorable Mention", "honorable_mention"],
]);

/**
 * Corrections for specific observed source defects, not substitutes for parsing.
 * 2022 Bronze is written as [[Target|''Title'' 7]] — italics inside the pipe-link plus a
 * stray trailing " 7" left behind by a botched edit.
 */
const titleOverrides = new Map<string, string>([
  ["2022:Bronze Medal", "This Is How They Tell Me the World Ends: The Cyberweapons Arms Race"],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);

  console.log(`Fetching ${pageTitle} medalists from MediaWiki...`);
  const records = parseArthurRoss(prize, category, await fetchMediaWikiWikitext(pageTitle));
  assertCoverage(records);

  const byStatus = countByStatus(records);
  await writeRawAwardRecords("arthur-ross-book-award.json", records, {
    importer: "scripts/import-award-records/arthur-ross-book-award.ts",
    source: category.sourceLabel,
    notes:
      "Wikipedia's year-by-year medal list is used instead of the official CFR winners page, " +
      "which omits 2002 and 2010 and carries title typos. Gold Medal is recorded as winner, " +
      "Silver Medal as finalist, Bronze Medal as finalist, and Honorable Mention as " +
      "honorable_mention; the literal medal label is preserved in each record's notes. " +
      `Official archive: ${category.officialUrl ?? "https://www.cfr.org/arthur-ross-book-award"}`,
    records: records.length,
    winners: byStatus.winner ?? 0,
    finalists: byStatus.finalist ?? 0,
    honorableMentions: byStatus.honorable_mention ?? 0,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Arthur Ross Book Award records (${yearRange(records)}).`);
}

export function parseArthurRoss(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "List of winners", "See also");
  const records: RawAwardRecord[] = [];
  let year: number | undefined;

  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();

    // Year headings are definition-list terms and may carry a <ref> tail: ";2013<ref>…"
    const heading = line.match(/^;\s*((?:19|20)\d{2})\b/);
    if (heading) {
      year = Number(heading[1]);
      continue;
    }

    const bullet = line.match(/^\*\s*(Gold Medal|Silver Medal|Bronze Medal|Honorable Mention)\s*[–—-]\s*(.+)$/);
    if (!bullet) continue;
    if (!year) throw new Error(`Arthur Ross bullet before any year heading: ${line}`);

    const tier = bullet[1];
    const status = tierStatus.get(tier);
    if (!status) throw new Error(`Unmapped Arthur Ross tier label: ${tier}`);

    const body = bullet[2].replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<ref[^>]*\/>/gi, "").trim();
    const split = body.search(/\s+for\s+(?=''|\[\[)/);
    if (split < 0) throw new Error(`Could not split author/title for ${year} ${tier}: ${body}`);

    const authors = normalizeAuthorList(cleanText(wikiToPlainText(body.slice(0, split))));
    if (!authors.length) throw new Error(`No authors parsed for ${year} ${tier}: ${body}`);

    const title = titleOverrides.get(`${year}:${tier}`) ?? extractTitle(body.slice(split).replace(/^\s*for\s+/, ""));
    if (!title) throw new Error(`No title parsed for ${year} ${tier}: ${body}`);

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status,
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: tier,
    });
  }

  return records.sort((a, b) => b.year - a.year || tierRank(a) - tierRank(b));
}

function extractTitle(titlePart: string) {
  const italic = titlePart.startsWith("''") ? titlePart.slice(2).match(/^([\s\S]*?)''/)?.[1] : undefined;
  const raw = italic ?? titlePart;
  return cleanText(wikiToPlainText(raw)).replace(/[.,\s]+$/, "");
}

function tierRank(record: RawAwardRecord) {
  const order = ["Gold Medal", "Silver Medal", "Bronze Medal", "Honorable Mention"];
  const index = order.indexOf(record.notes ?? "");
  return index < 0 ? order.length : index;
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
  if (records.length !== 72) throw new Error(`Expected exactly 72 Arthur Ross records, got ${records.length}`);
  if (yearRange(records) !== "2002-2025") throw new Error(`Unexpected Arthur Ross range: ${yearRange(records)}`);

  const perYear = new Map<number, RawAwardRecord[]>();
  for (const record of records) perYear.set(record.year, [...(perYear.get(record.year) ?? []), record]);
  if (perYear.size !== 24) throw new Error(`Expected 24 Arthur Ross years, got ${perYear.size}`);
  for (const [year, rows] of perYear) {
    if (rows.length !== 3) throw new Error(`Expected 3 Arthur Ross medalists in ${year}, got ${rows.length}`);
    const winners = rows.filter((row) => row.status === "winner").length;
    if (winners !== 1) throw new Error(`Expected exactly 1 Arthur Ross Gold Medal in ${year}, got ${winners}`);
  }
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
