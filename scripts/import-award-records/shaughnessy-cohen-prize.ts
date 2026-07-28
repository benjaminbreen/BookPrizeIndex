import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";

const pageTitle = "Shaughnessy Cohen Prize for Political Writing";

const firstYear = 2001;
const lastYear = 2026;
const expectedRecordCount = 128;
const expectedWinnerCount = 26;

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "shaughnessy-cohen-prize");
  const category = prize?.categories.find((entry) => entry.id === "shaughnessy-cohen-political-writing");
  if (!prize || !category) throw new Error("Missing Shaughnessy Cohen Prize registry entry");

  console.log(`Fetching ${pageTitle} records from MediaWiki...`);
  const records = parseShaughnessyCohen(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  assertCoverage(records);

  await writeRawAwardRecords("shaughnessy-cohen-prize.json", records, {
    importer: "scripts/import-award-records/shaughnessy-cohen-prize.ts",
    source: category.sourceLabel,
    notes:
      "Imports winners and shortlists from the deterministic secondary table because the official Writers' Trust archive rate-limits command-line retrieval (HTTP 429). The source tables carry an extra jury column, which is stripped before row parsing: left in place it shifts every cell one position and silently mislabels every winner as a shortlist entry.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    shortlist: records.filter((record) => record.status === "shortlist").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Shaughnessy Cohen Prize records (${yearRange(records)}).`);
}

export function parseShaughnessyCohen(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "==Winners and nominees==", "==References==");
  return parseAwardRowsFromWikitable(stripJuryColumn(section))
    .filter((row) => isLikelyTitle(row.title))
    .map((row) => {
      const { authors, translator } = parseAuthorCell(row.author);
      const notes = [
        translator ? `Translator: ${translator}.` : undefined,
        category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
      ].filter(Boolean).join(" ");
      return {
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year: row.year,
        status: statusFromResult(row.result),
        title: row.title,
        authors,
        sourceUrl: category.sourceUrl,
        sourceLabel: category.sourceLabel,
        sourceConfidence: category.sourceConfidence,
        notes: notes || undefined,
      };
    })
    .filter((record) => record.status !== "unknown" && record.authors.length > 0);
}

/**
 * The source tables have six columns (Year | Jury | Author | Book | Result | Ref.), one more
 * than the shared wikitable parser assumes. Both the year and the jury cell are `!` header
 * cells carrying a rowspan, so on a year-opening row the parser would read the jury as the
 * author, the author as the title and the title as the result — quietly relabelling every
 * winner. Dropping every header cell after the first one in each row block removes the jury
 * column (and the redundant column headings) before the shared parser ever sees it.
 */
export function stripJuryColumn(section: string) {
  return section
    .split(/\n(?=\|-)/)
    .map((block) => {
      let headerCellsSeen = 0;
      return block
        .split("\n")
        .filter((line) => {
          if (!/^\s*!/.test(line)) return true;
          headerCellsSeen += 1;
          return headerCellsSeen === 1;
        })
        .join("\n");
    })
    .join("\n");
}

/** Splits comma-joined co-authors and lifts a `(tr. Name)` parenthetical out into notes. */
export function parseAuthorCell(input: string) {
  const translatorMatch = input.match(/\(\s*(?:tr\.|trans\.|translated by)\s*([^)]+)\)/i);
  const translator = translatorMatch ? cleanText(translatorMatch[1]) : undefined;
  const withoutTranslator = cleanText(input.replace(/\s*\([^)]*\b(?:tr\.|trans\.|translated by|translator)[^)]*\)\s*/gi, " "));
  const authors = normalizeAuthorList(withoutTranslator)
    // `\s*` must live inside the lookahead: outside it, the engine backtracks the space away
    // and the suffix guard never sees "Jr.", splitting "Sammy Davis, Jr." into two authors.
    .flatMap((author) => author.split(/,(?!\s*(?:Jr|Sr|II|III|IV)\.?(?:\s|,|$))\s*/i))
    .map(cleanText)
    .filter(Boolean);
  return { authors, translator };
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== expectedRecordCount) {
    throw new Error(`Shaughnessy Cohen import expected ${expectedRecordCount} records but parsed ${records.length}.`);
  }

  const winners = records.filter((record) => record.status === "winner");
  if (winners.length !== expectedWinnerCount) {
    throw new Error(`Shaughnessy Cohen import expected ${expectedWinnerCount} winners but parsed ${winners.length}.`);
  }

  const years = records.map((record) => record.year);
  if (Math.min(...years) !== firstYear || Math.max(...years) !== lastYear) {
    throw new Error(
      `Shaughnessy Cohen import expected year range ${firstYear}-${lastYear} but parsed ${Math.min(...years)}-${Math.max(...years)}.`,
    );
  }

  const badYears: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    if (winners.filter((record) => record.year === year).length !== 1) badYears.push(year);
  }
  if (badYears.length) {
    throw new Error(
      `Shaughnessy Cohen import expected exactly one winner per year; wrong for ${badYears.join(", ")}. ` +
        "This usually means the jury column was not stripped and winners were mislabelled.",
    );
  }
}

function sectionBetween(input: string, startMarker: string, endMarker: string) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start: ${startMarker}`);
  const end = input.indexOf(endMarker, start);
  return input.slice(start, end > start ? end : undefined);
}

function statusFromResult(result: string): RawAwardRecordStatus {
  if (/winner/i.test(result)) return "winner";
  if (/shortlist/i.test(result)) return "shortlist";
  if (/finalist/i.test(result)) return "finalist";
  return "unknown";
}

function statusSort(status: RawAwardRecordStatus) {
  if (status === "winner") return 1;
  if (status === "finalist" || status === "shortlist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
