import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "New York Historical book prizes";
const prizeId = "gilder-lehrman-military-history-prize";
const categoryId = "gilder-lehrman-military-history";

const prizeHistoryNote =
  "Established in 2013 as the Guggenheim-Lehrman Prize in Military History and renamed the Gilder Lehrman Prize for Military History at the New-York Historical Society in 2016.";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} entry in sources/prizes.json`);

  console.log(`Fetching Gilder Lehrman Military History Prize winners from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseGilderLehrmanMilitaryHistory(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("gilder-lehrman-military-history-prize.json", records, {
    importer: "scripts/import-award-records/gilder-lehrman-military-history-prize.ts",
    source: `MediaWiki "Gilder Lehrman Prize for Military History" section of "${pageTitle}"`,
    notes: [
      prizeHistoryNote,
      "Official Gilder Lehrman pages return HTTP 403 to automated fetches, so the cited Wikipedia section is used as a secondary source.",
      "Year labels denote the award cycle and are recorded as printed; each cycle is announced the following year.",
      "Finalist slates appear only in Gilder Lehrman press releases, which block automated fetching, so finalists are not covered.",
      `Official awards URL: ${category.officialUrl ?? prize.officialUrl}`,
    ].join(" "),
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    yearRange: yearRange(records),
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Gilder Lehrman Military History Prize records (${yearRange(records)}).`);
}

export function parseGilderLehrmanMilitaryHistory(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = extractSection(wikitext);
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    if (!/^\*\s*\d{4}\s+/.test(line)) continue;
    const parsed = parseWinnerLine(line);
    if (!parsed) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: parsed.year,
      status: "winner",
      title: parsed.title,
      authors: parsed.authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: [
        prizeHistoryNote,
        "The year is the award cycle as printed in the source; the winner is announced the following year.",
        category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      ].filter(Boolean).join(" "),
    });
  }

  return records;
}

function parseWinnerLine(line: string) {
  const withoutRefs = removeRefs(line);
  const match = withoutRefs.match(/^\*\s*(\d{4})\s+(.+?),\s+''(.+?)''/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const authors = normalizeAuthorList(wikiToPlainText(match[2]));
  const title = cleanText(wikiToPlainText(match[3]).replace(/^['" ]+|['" ]+$/g, ""));
  if (!year || !authors.length || !isLikelyTitle(title)) return undefined;

  return { year, title, authors };
}

function extractSection(wikitext: string) {
  const start = wikitext.search(/^==\s*Gilder Lehrman Prize for Military History\s*==/m);
  if (start < 0) throw new Error("Could not find the Gilder Lehrman Prize for Military History section");
  const rest = wikitext.slice(start + 1);
  const end = rest.search(/^==[^=]/m);
  const section = end < 0 ? wikitext.slice(start) : wikitext.slice(start, start + 1 + end);

  const winnersStart = section.search(/^===\s*Winners\s*===/m);
  if (winnersStart < 0) throw new Error("Could not find the Gilder Lehrman Military History winners subsection");
  return section.slice(winnersStart);
}

function removeRefs(input: string) {
  return input
    .replace(/<ref\b[^>]*\/>/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== 12) {
    throw new Error(`Expected exactly 12 Gilder Lehrman Military History Prize rows, got ${records.length}`);
  }
  const years = records.map((record) => record.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (min !== 2013 || max !== 2024) {
    throw new Error(`Unexpected Gilder Lehrman Military History year range: ${yearRange(records)} (expected 2013-2024)`);
  }
  if (new Set(years).size !== years.length) {
    throw new Error("Gilder Lehrman Military History Prize years are expected to be unique (one winner per cycle)");
  }
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
