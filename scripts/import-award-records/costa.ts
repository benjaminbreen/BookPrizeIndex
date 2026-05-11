import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

type CostaStatus = Extract<RawAwardRecordStatus, "winner" | "finalist">;
type PartialRecord = Omit<RawAwardRecord, "status"> & { status: CostaStatus };

const pageTitle = "Costa Book Award for Biography";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "costa-book-awards");
  const category = prize?.categories.find((entry) => entry.id === "costa-biography");
  if (!prize || !category) throw new Error("Missing costa-book-awards entry in sources/prizes.json");

  console.log(`Fetching Costa Biography table from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parseCostaBiography(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("costa.json", records, {
    importer: "scripts/import-award-records/costa.ts",
    source: `MediaWiki wikitable for "${pageTitle}"`,
    notes: "Winners from 1971 onward; shortlists from 1995 onward. Includes the Whitbread Biography Award era (1971–2005).",
    categories: [
      {
        categoryId: category.id,
        categoryName: category.name,
        sourceUrl: category.sourceUrl,
        records: records.length,
        winners: records.filter((r) => r.status === "winner" || r.status === "co_winner").length,
        finalists: records.filter((r) => r.status === "finalist").length,
        yearRange: yearRange(records),
      },
    ],
  });

  console.log(`Imported ${records.length} Costa Book Award for Biography records.`);
  console.log(`  Winners:     ${records.filter((r) => r.status === "winner" || r.status === "co_winner").length}`);
  console.log(`  Shortlisted: ${records.filter((r) => r.status === "finalist").length}`);
  console.log(`  Year range:  ${yearRange(records)}`);
}

export function parseCostaBiography(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  // The dedicated biography page has columns: Year | Author | Title | Subject | Result | Ref
  const table = extractWikitables(wikitext).find((t) => /Year[\s\S]+Author[\s\S]+Title[\s\S]+Result/i.test(t));
  if (!table) throw new Error("Could not find Costa Biography wikitable");

  const partials: PartialRecord[] = [];
  let currentYear: number | undefined;
  let currentStatus: CostaStatus | undefined;

  for (const chunk of table.split(/\n\|-/)) {
    const rowStyle = extractRowStyle(chunk);
    const cells = parseRowCells(chunk);
    if (cells.length < 2) continue;

    let cursor = 0;

    // Year cell — absent in rows where the previous year's rowspan covers it
    const maybeYear = extractYear(wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")));
    if (maybeYear) {
      currentYear = maybeYear;
      currentStatus = undefined; // reset for each new year
      cursor += 1;
    }
    if (!currentYear) continue;

    // Author cell
    const authorText = cleanText(wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")));
    const authors = normalizeAuthorList(authorText);
    cursor += 1;

    // Title cell
    const title = parseTitle(cells[cursor] ?? "");
    cursor += 1;

    // Subject cell — skip (bio subject description, not needed)
    cursor += 1;

    // Result cell — may be absent due to rowspan; currentStatus carries over when missing
    const resultText = wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")).toLowerCase();
    if (resultText.includes("winner")) {
      currentStatus = "winner";
    } else if (resultText.includes("shortlist")) {
      currentStatus = "finalist";
    } else if (/background\s*:\s*lightyellow/i.test(rowStyle)) {
      // Fallback: row background color signals winner when result cell is absent or unclear
      currentStatus = "winner";
    }
    // Empty result cell with no background: status carries over from previous row (rowspan behavior)

    if (!authors.length || !isLikelyTitle(title) || !currentStatus) continue;

    addOrMerge(partials, {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: currentStatus,
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  return normalizeCoWinners(partials);
}

function extractWikitables(wikitext: string): string[] {
  const tables: string[] = [];
  const pattern = /\{\|\s*class="?wikitable/g;
  for (const match of wikitext.matchAll(pattern)) {
    const start = match.index;
    const end = wikitext.indexOf("\n|}", start);
    if (end !== -1) tables.push(wikitext.slice(start, end));
  }
  if (!tables.length) throw new Error("No wikitable found");
  return tables;
}

function parseRowCells(chunk: string): string[] {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[!|]/.test(line) && !/^\|\}/.test(line) && !/^\|\-/.test(line))
    .map((line) => line.replace(/^[!|]\s*/, ""));
  // Do NOT filter(Boolean) here — empty cells (e.g. blank subject) must be preserved
  // so that column positions remain stable across rows.
}

function extractRowStyle(chunk: string): string {
  return chunk.split("\n").find((line) => line.trim() && !/^[!|]/.test(line.trim()))?.trim() ?? "";
}

function extractYear(text: string): number | undefined {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function parseTitle(cell: string): string {
  let value = stripCellAttributes(cell);
  value = wikiToPlainText(value); // handles {{blue ribbon}}, wiki links, italics markers
  value = value.replace(/^[''"]+|[''"]+$/g, "").replace(/''/g, "");
  return cleanText(value);
}

function addOrMerge(records: PartialRecord[], record: PartialRecord) {
  const key = `${record.categoryId}:${record.year}:${record.status}:${slugify(record.title)}`;
  const existing = records.find((item) => `${item.categoryId}:${item.year}:${item.status}:${slugify(item.title)}` === key);
  if (!existing) {
    records.push(record);
    return;
  }
  existing.authors = [...new Set([...existing.authors, ...record.authors])];
}

function normalizeCoWinners(records: PartialRecord[]): RawAwardRecord[] {
  const winnersByYear = new Map<number, PartialRecord[]>();
  for (const record of records.filter((r) => r.status === "winner")) {
    winnersByYear.set(record.year, [...(winnersByYear.get(record.year) ?? []), record]);
  }
  return records.map((record) => {
    if (record.status !== "winner") return record;
    const winners = winnersByYear.get(record.year) ?? [];
    const distinctTitles = new Set(winners.map((r) => slugify(r.title)));
    return { ...record, status: distinctTitles.size > 1 ? "co_winner" : "winner" };
  });
}

function statusSort(status: RawAwardRecordStatus): number {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]): string {
  const years = records.map((r) => r.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
