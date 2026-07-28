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

const wikipediaPageTitle = "Nero Book Awards";
const wikipediaSourceUrl = "https://en.wikipedia.org/wiki/Nero_Book_Awards";
const expectedRecords = 12;
const expectedPerYear = 4;
const expectedYears = [2023, 2024, 2025];

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "nero-book-awards");
  const category = prize?.categories.find((entry) => entry.id === "nero-nonfiction");
  if (!prize || !category) throw new Error("Missing Nero Book Awards registry entries");

  console.log("Fetching the Wikipedia Nero Book Awards shortlists-and-winners table...");
  const records = parseNeroNonfiction(prize, category, await fetchMediaWikiWikitext(wikipediaPageTitle));
  assertCoverage(records);

  const winners = records.filter((record) => record.status === "winner");
  await writeRawAwardRecords("nero-book-awards.json", records, {
    importer: "scripts/import-award-records/nero-book-awards.ts",
    source: "Wikipedia: Nero Book Awards combined shortlists-and-winners table",
    notes:
      "Imports only the Non-fiction category; fiction, debut fiction and children's fiction rows are dropped. The overall Golden Nero Book of the Year is recorded as a note on the category winner rather than as a separate record. Year header rowspans differ between the 2023 and the 2024/2025 layouts, so the parser tracks the year and the rowspan Result cell independently and the import asserts four records and one winner per year.",
    records: records.length,
    winners: winners.length,
    shortlisted: records.filter((record) => record.status === "shortlist").length,
    yearRange: yearRange(records),
    overallWinners: winners.filter((record) => record.notes?.includes("Golden Nero")).map((record) => `${record.year}: ${record.title}`),
  });
  console.log(`Imported ${records.length} Nero Book Awards non-fiction records (${winners.length} winners).`);
}

/**
 * Parses the single Nero wikitable (Year / Author / Title / Publisher / Result / Ref).
 *
 * The Result cell is the category selector and is shared across a rowgroup via `rowspan`, so it is
 * tracked as sticky state. The year header uses `rowspan="16"` in 2023 (sharing the overall-winner
 * row) but `rowspan="17"` on a standalone row in 2024 and 2025; both layouts are handled by
 * treating the year header as an optional leading cell that may be the row's only cell.
 */
export function parseNeroNonfiction(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const tableStart = wikitext.indexOf("{| class=\"wikitable sortable\"");
  const tableEnd = wikitext.indexOf("\n|}", tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error("Could not find the Nero Book Awards wikitable");

  const records: RawAwardRecord[] = [];
  let year: number | undefined;
  let result = "";
  for (const rawRow of wikitext.slice(tableStart, tableEnd).split(/\n\|-/)) {
    const cells = parseWikiRowCells(rawRow);
    let cursor = 0;
    const headerYear = cells[0]?.header ? cells[0].text.match(/\b(20\d{2})\b/) : undefined;
    if (headerYear) {
      year = Number(headerYear[1]);
      cursor = 1;
    }
    const body = cells.slice(cursor).map((cell) => cell.text).filter(Boolean);
    if (!year || body.length < 3) continue;

    const explicit = body[3];
    if (explicit && /winner|shortlist/i.test(explicit)) result = explicit;
    const status = nonFictionStatus(result);
    if (!status) continue;

    const authors = normalizeAuthorList(body[0]);
    const title = cleanTitle(body[1]);
    const publisher = cleanText(body[2]);
    if (!authors.length || !isLikelyTitle(title)) continue;

    const overall = status === "winner" && /\boverall winner\b/i.test(result);
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status,
      title,
      authors,
      publisher: publisher || undefined,
      sourceUrl: wikipediaSourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: "secondary",
      notes: overall
        ? `Also named the overall Golden Nero Book of the Year for ${year}.`
        : undefined,
    });
  }
  return records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));
}

function nonFictionStatus(result: string): RawAwardRecord["status"] | undefined {
  if (/\bnon-fiction winner\b/i.test(result)) return "winner";
  if (/\bnon-fiction shortlist\b/i.test(result)) return "shortlist";
  return undefined;
}

function cleanTitle(value: string) {
  return cleanText(
    wikiToPlainText(value)
      .replace(/^''+|''+$/g, "")
      .replace(/\s*\((?:novel|book)\)$/i, ""),
  );
}

function parseWikiRowCells(rowBody: string) {
  const cells: Array<{ header: boolean; text: string }> = [];
  let current: string[] = [];
  let header = false;
  const flush = () => {
    if (!current.length) return;
    const raw = current.join("\n").trim();
    cells.push({ header, text: cleanText(wikiToPlainText(stripCellAttributes(raw))) });
    current = [];
  };
  for (const rawLine of rowBody.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^\{\||^\|\}|^\|-|^\|\+/.test(line.trim())) {
      flush();
      continue;
    }
    if (!/^[!|]/.test(line)) {
      if (current.length) current.push(line);
      continue;
    }
    flush();
    header = line.startsWith("!");
    current = [line.replace(/^[!|]+\s*/, "")];
  }
  flush();
  return cells;
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

export function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== expectedRecords) {
    throw new Error(`Expected ${expectedRecords} Nero Book Awards non-fiction records, got ${records.length}`);
  }
  const range = `${expectedYears[0]}-${expectedYears[expectedYears.length - 1]}`;
  if (yearRange(records) !== range) {
    throw new Error(`Expected Nero Book Awards year range ${range}, got ${yearRange(records)}`);
  }
  for (const year of expectedYears) {
    const yearRecords = records.filter((record) => record.year === year);
    if (yearRecords.length !== expectedPerYear) {
      throw new Error(`Expected ${expectedPerYear} Nero non-fiction records for ${year}, got ${yearRecords.length}`);
    }
    if (yearRecords.filter((record) => record.status === "winner").length !== 1) {
      throw new Error(`Expected exactly 1 Nero non-fiction winner for ${year}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
