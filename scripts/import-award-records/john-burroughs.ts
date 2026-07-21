import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "John Burroughs Medal";
const official2025Url = "https://us.macmillan.com/books/9781250875891/turningtostone/";
const excludedNonNonfictionTitles = new Set([
  "Nature Poems",
  "Those of the Forest",
  "Martin Marten",
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "john-burroughs-medal");
  const category = prize?.categories.find((entry) => entry.id === "john-burroughs-medal");
  if (!prize || !category) throw new Error("Missing John Burroughs Medal registry entry");

  console.log(`Fetching ${pageTitle} recipients from MediaWiki...`);
  const historical = parseJohnBurroughs(prize, category, await fetchMediaWikiWikitext(pageTitle))
    .filter((record) => record.year !== 2025);
  const records = [...historical, official2025Record(prize, category)]
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("john-burroughs.json", records, {
    importer: "scripts/import-award-records/john-burroughs.ts",
    source: category.sourceLabel,
    notes: "Imports book winners only, omitting explicit no-award years, non-book lifetime recognition, one poetry collection, and the medal's two fiction winners. The 2025 record uses the publisher's official book page.",
    records: records.length,
    winners: records.length,
    yearRange: yearRange(records),
    explicitNoAwardYears: [1931, 1935, 1937, 1944, 1947, 1951, 1959, 1975, 1980],
    unresolvedSourceGaps: [2019],
    excludedOutOfScope: [...excludedNonNonfictionTitles],
  });
  console.log(`Imported ${records.length} John Burroughs Medal nonfiction book winners (${yearRange(records)}).`);
}

export function parseJohnBurroughs(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = extractSection(wikitext, "== List of recipients of the John Burroughs Medal ==");
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    const match = line.match(/^\*\s*((?:19|20)\d{2})\s*[–—-]\s*(.+)$/);
    if (!match || /\bno award\b/i.test(match[2])) continue;
    const year = Number(match[1]);
    const titleMatches = [...match[2].matchAll(/''((?:(?!'').)+?)''/g)];
    const titleMatch = titleMatches[0];
    if (!titleMatch) continue;
    const title = titleMatches.length > 1 && /\(set\)/i.test(match[2])
      ? `${titleMatches.map((item) => cleanText(wikiToPlainText(item[1]))).join(", ")} (set)`
      : cleanListTitle(wikiToPlainText(titleMatch[1]));
    if (!title || excludedNonNonfictionTitles.has(title)) continue;

    const rawAuthors = match[2].slice(0, titleMatch.index)
      .replace(/\s+(?:and|&)\s+(?:\[\[[^\]]+\]\]|[^,;]+)\s*\(illustrator\)\s*,?\s*$/i, "")
      .replace(/[,;\s]+$/, "");
    const authors = normalizeAuthorList(wikiToPlainText(rawAuthors));
    if (!authors.length) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "winner",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official medal information: ${category.officialUrl}` : undefined,
    });
  }

  return records;
}

function official2025Record(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: 2025,
    status: "winner",
    title: "Turning to Stone: Discovering the Subtle Wisdom of Rocks",
    authors: ["Marcia Bjornerud"],
    publisher: "Flatiron Books",
    sourceUrl: official2025Url,
    sourceLabel: "Macmillan official Turning to Stone book page",
    sourceConfidence: "official",
  };
}

function extractSection(wikitext: string, heading: string) {
  const label = heading.replace(/^=+\s*|\s*=+$/g, "");
  const match = new RegExp(`^==\\s*${escapeRegExp(label)}\\s*==\\s*$`, "m").exec(wikitext);
  if (!match || match.index === undefined) throw new Error(`Could not find section ${heading}`);
  const start = match.index + match[0].length;
  const next = /^==[^=].*==\s*$/m.exec(wikitext.slice(start));
  return wikitext.slice(start, next?.index === undefined ? undefined : start + next.index);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanListTitle(value: string) {
  const title = cleanText(value).replace(/[,;\s]+$/, "");
  return /(?:Jr|Sr)\.$/.test(title) ? title : title.replace(/\.$/, "");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 85) throw new Error(`Expected at least 85 John Burroughs nonfiction book winners, got ${records.length}`);
  const presentTitles = new Set(records.map((record) => record.title));
  for (const excluded of excludedNonNonfictionTitles) {
    if (presentTitles.has(excluded)) throw new Error(`Out-of-scope John Burroughs work was imported: ${excluded}`);
  }
  if (yearRange(records) !== "1926-2025") throw new Error(`Unexpected John Burroughs range: ${yearRange(records)}`);
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
