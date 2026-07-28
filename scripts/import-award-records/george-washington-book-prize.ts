import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "George Washington Book Prize";
const prizeId = "george-washington-book-prize";
const categoryId = "george-washington-founding-era";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} entry in sources/prizes.json`);

  console.log(`Fetching George Washington Prize finalists from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseGeorgeWashingtonBookPrize(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusRank(a) - statusRank(b) || a.title.localeCompare(b.title));
  assertCoverage(records);

  const winners = records.filter((record) => record.status === "winner").length;
  const finalists = records.filter((record) => record.status === "finalist").length;

  await writeRawAwardRecords("george-washington-book-prize.json", records, {
    importer: "scripts/import-award-records/george-washington-book-prize.ts",
    source: `MediaWiki "Past finalists" wikitable for "${pageTitle}"`,
    notes: [
      "Official Gilder Lehrman and Mount Vernon award pages return HTTP 403 to automated fetches (Cloudflare), so the cited Wikipedia table is used as a secondary source.",
      "Rows flagged with the {{blue ribbon}} template are recorded as winners; every other row in the year block is a finalist.",
      "The year cell is blank on continuation rows and is carried forward from the preceding row.",
      "The 2015 Special Achievement Award to the musical Hamilton is excluded because it is not a book.",
      `Official awards URL: ${category.officialUrl ?? prize.officialUrl}`,
    ].join(" "),
    records: records.length,
    winners,
    finalists,
    yearRange: yearRange(records),
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners,
      finalists,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} George Washington Prize records (${yearRange(records)}); ${winners} winners, ${finalists} finalists.`);
}

export function parseGeorgeWashingtonBookPrize(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const table = extractFinalistsTable(wikitext);
  const records: RawAwardRecord[] = [];
  let currentYear: number | undefined;

  for (const rawRow of table.split(/\n\|-/)) {
    const cells = parseRowCells(rawRow);
    if (!cells.length) continue;

    let cursor = 0;
    const maybeYear = parseYear(cells[0] ?? "");
    if (maybeYear) {
      currentYear = maybeYear;
      cursor = 1;
    }
    if (!currentYear) continue;
    if (cells.length - cursor < 2) continue;

    const authorCell = cells[cursor] ?? "";
    const titleCell = cells[cursor + 1] ?? "";
    const isWinner = hasBlueRibbon(titleCell);

    const authors = normalizeAuthorList(wikiToPlainText(authorCell));
    const title = stripBalancedQuotes(cleanText(wikiToPlainText(titleCell)));
    if (!authors.length || !isLikelyTitle(title)) continue;
    if (isExcludedRow(title)) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: isWinner ? "winner" : "finalist",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: [
        "Winner rows are flagged with the blue ribbon marker in the source table; all other rows in the year block are finalists.",
        category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      ].filter(Boolean).join(" "),
    });
  }

  return records;
}

// Only strip wrapping quotes when they are balanced; several titles legitimately
// contain an internal quoted phrase (e.g. '"Most Blessed of the Patriarchs": ...').
function stripBalancedQuotes(value: string) {
  const pairs: Array<[string, string]> = [["\"", "\""], ["“", "”"], ["'", "'"], ["‘", "’"]];
  let output = value.trim();
  for (const [open, close] of pairs) {
    if (output.length > 2 && output.startsWith(open) && output.endsWith(close)) {
      const inner = output.slice(open.length, output.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) output = inner.trim();
    }
  }
  return output;
}

// The 2015 Special Achievement Award went to the musical Hamilton, not a book.
function isExcludedRow(title: string) {
  return /^hamilton$/i.test(title) || /special achievement award/i.test(title);
}

function hasBlueRibbon(cell: string) {
  return /\{\{\s*blue ribbon\s*\}\}/i.test(cell);
}

function extractFinalistsTable(wikitext: string) {
  const sectionStart = wikitext.search(/^==\s*Past finalists\s*==/m);
  if (sectionStart < 0) throw new Error("Could not find the George Washington Prize \"Past finalists\" section");
  const sectionEnd = wikitext.slice(sectionStart + 1).search(/^==[^=]/m);
  const section = sectionEnd < 0 ? wikitext.slice(sectionStart) : wikitext.slice(sectionStart, sectionStart + 1 + sectionEnd);

  const tableStart = section.indexOf("{| class=\"wikitable\"");
  if (tableStart < 0) throw new Error("Could not find the George Washington Prize finalists wikitable");
  const tableEnd = section.indexOf("\n|}", tableStart);
  return tableEnd < 0 ? section.slice(tableStart) : section.slice(tableStart, tableEnd);
}

// Keeps raw cell text (templates intact) so the {{blue ribbon}} winner flag survives.
function parseRowCells(row: string) {
  return row
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|/.test(line) && !/^\|-/.test(line) && !/^\|\}/.test(line) && !/^\{\|/.test(line))
    .map((cell) => stripCellAttributes(cell.replace(/^\|\s*/, "")))
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function parseYear(cell: string) {
  const match = wikiToPlainText(cell).match(/^\s*((?:19|20)\d{2})\s*$/);
  return match ? Number(match[1]) : undefined;
}

function statusRank(record: RawAwardRecord) {
  return record.status === "winner" ? 0 : 1;
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 90) {
    throw new Error(`Expected at least 90 George Washington Prize rows, got ${records.length}`);
  }
  const years = records.map((record) => record.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (min !== 2005 || max !== 2025) {
    throw new Error(`Unexpected George Washington Prize year range: ${yearRange(records)} (expected 2005-2025)`);
  }
  for (let year = 2005; year <= 2025; year += 1) {
    const winners = records.filter((record) => record.year === year && record.status === "winner");
    if (winners.length !== 1) {
      throw new Error(`Expected exactly one George Washington Prize winner for ${year}, got ${winners.length}`);
    }
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
