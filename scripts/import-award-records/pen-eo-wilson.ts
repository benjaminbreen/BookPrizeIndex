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

type PenStatus = Extract<RawAwardRecordStatus, "winner" | "finalist">;
type PartialRecord = Omit<RawAwardRecord, "status"> & { status: PenStatus };

const pageTitle = "PEN/E. O. Wilson Literary Science Writing Award";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "pen-eo-wilson-award");
  const category = prize?.categories.find((entry) => entry.id === "pen-eo-wilson");
  if (!prize || !category) throw new Error("Missing pen-eo-wilson-award entry in sources/prizes.json");

  console.log(`Fetching PEN/E.O. Wilson table from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parsePenEoWilson(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("pen-eo-wilson.json", records, {
    importer: "scripts/import-award-records/pen-eo-wilson.ts",
    source: `MediaWiki wikitable for "${pageTitle}"`,
    notes: "Winners from 2011 onward. Runner-up data for 2011-2012; shortlist data from 2016 onward.",
    categories: [
      {
        categoryId: category.id,
        categoryName: category.name,
        sourceUrl: category.sourceUrl,
        records: records.length,
        winners: records.filter((r) => r.status === "winner").length,
        finalists: records.filter((r) => r.status === "finalist").length,
        yearRange: yearRange(records),
      },
    ],
  });

  console.log(`Imported ${records.length} PEN/E.O. Wilson Literary Science Writing Award records.`);
  console.log(`  Winners:     ${records.filter((r) => r.status === "winner").length}`);
  console.log(`  Shortlisted: ${records.filter((r) => r.status === "finalist").length}`);
  console.log(`  Year range:  ${yearRange(records)}`);
}

export function parsePenEoWilson(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  // Table columns: Year | Author | Title | Result | Ref
  const table = extractWikitable(wikitext);
  if (!table) throw new Error("Could not find PEN/E.O. Wilson wikitable");

  const records: PartialRecord[] = [];
  let currentYear: number | undefined;

  for (const chunk of table.split(/\n\|-/)) {
    const rowStyle = extractRowStyle(chunk);
    const cells = parseRowCells(chunk);
    if (cells.length < 2) continue;

    let cursor = 0;

    // Year cell — absent when previous year's rowspan covers it
    const maybeYear = extractYear(wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")));
    if (maybeYear) {
      currentYear = maybeYear;
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

    // Result cell
    const resultText = wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")).toLowerCase();
    let status: PenStatus | undefined;
    if (resultText.includes("winner")) {
      status = "winner";
    } else if (resultText.includes("shortlist") || resultText.includes("runner")) {
      // "Runner-up" (2011-2012) and "Shortlist" (2016+) both map to finalist
      status = "finalist";
    } else if (/background\s*:\s*#cddeff/i.test(rowStyle)) {
      // Winner rows have blue background — use as fallback when result cell is absent
      status = "winner";
    }

    if (!authors.length || !isLikelyTitle(title) || !status) continue;

    const key = `${currentYear}:${slugify(title)}`;
    const existing = records.find((r) => `${r.year}:${slugify(r.title)}` === key);
    if (existing) {
      existing.authors = [...new Set([...existing.authors, ...authors])];
    } else {
      records.push({
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year: currentYear,
        status,
        title,
        authors,
        sourceUrl: category.sourceUrl,
        sourceLabel: category.sourceLabel,
        sourceConfidence: category.sourceConfidence,
        notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      });
    }
  }

  return records;
}

function extractWikitable(wikitext: string): string | undefined {
  const pattern = /\{\|\s*class="?wikitable/g;
  for (const match of wikitext.matchAll(pattern)) {
    const start = match.index;
    const end = wikitext.indexOf("\n|}", start);
    if (end !== -1) return wikitext.slice(start, end);
  }
  return undefined;
}

function parseRowCells(chunk: string): string[] {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[!|]/.test(line) && !/^\|\}/.test(line) && !/^\|\-/.test(line))
    .map((line) => line.replace(/^[!|]\s*/, ""));
  // No filter(Boolean) — empty cells must be preserved to keep column positions stable
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
  value = wikiToPlainText(value);
  value = value.replace(/^[''"]+|[''"]+$/g, "").replace(/''/g, "");
  return cleanText(value);
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
