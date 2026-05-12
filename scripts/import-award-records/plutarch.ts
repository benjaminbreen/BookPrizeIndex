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

type PlutarchStatus = Extract<RawAwardRecordStatus, "winner" | "finalist">;
type PartialRecord = Omit<RawAwardRecord, "status"> & { status: PlutarchStatus };

const pageTitle = "Plutarch Award";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "plutarch-award");
  const category = prize?.categories.find((entry) => entry.id === "plutarch-biography");
  if (!prize || !category) throw new Error("Missing plutarch-award entry in sources/prizes.json");

  console.log(`Fetching Plutarch Award table from "${pageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parsePlutarchTable(prize, category, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("plutarch.json", records, {
    importer: "scripts/import-award-records/plutarch.ts",
    source: `MediaWiki wikitable for "${pageTitle}"`,
    notes: "Initial importer uses Wikipedia as a deterministic secondary source. Nominee rows are normalized to finalist status.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      finalists: records.filter((record) => record.status === "finalist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Plutarch Award records (${yearRange(records)}).`);
}

export function parsePlutarchTable(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const table = extractWikitable(wikitext);
  if (!table) throw new Error(`Could not find wikitable for ${prize.name}`);

  const records: PartialRecord[] = [];
  let currentYear: number | undefined;

  for (const chunk of table.split(/\n\|-/).slice(1)) {
    const cells = parseRowCells(chunk);
    if (cells.length < 3) continue;

    let cursor = 0;
    const maybeYear = extractYear(wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")));
    if (maybeYear) {
      currentYear = maybeYear;
      cursor += 1;
    }
    if (!currentYear) continue;

    const authors = normalizeAuthorList(wikiToPlainText(stripCellAttributes(cells[cursor] ?? "")));
    cursor += 1;

    const title = parseTitle(cells[cursor] ?? "");
    cursor += 1;

    const status = getRowStatus(cells[cursor] ?? "");
    if (!authors.length || !isLikelyTitle(title) || !status) continue;

    addOrMerge(records, {
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

  return normalizeCoWinners(records);
}

function extractWikitable(wikitext: string): string | undefined {
  const match = wikitext.match(/\{\|\s*class="?wikitable[\s\S]*?\n\|}/);
  return match?.[0];
}

function parseRowCells(chunk: string): string[] {
  const cells: string[] = [];
  let current: string[] = [];

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trimEnd();
    if (!/^[!|]/.test(line) || /^\|\-/.test(line) || /^\|\}/.test(line)) {
      if (current.length) current.push(line);
      continue;
    }

    if (current.length) cells.push(current.join("\n"));
    current = [];

    const marker = line.startsWith("!") ? "!" : "|";
    const delimiter = marker === "!" ? "!!" : "||";
    const content = line.replace(/^[!|]\s*/, "");
    const inlineCells = splitTableCells(content, delimiter).map((cell) => cell.trim());
    current = [inlineCells.shift() ?? ""];
    for (const cell of inlineCells) {
      cells.push(current.join("\n"));
      current = [cell];
    }
  }
  if (current.length) cells.push(current.join("\n"));

  return cells.map((cell) => cell.trim());
}

function splitTableCells(input: string, delimiter: string) {
  const cells: string[] = [];
  let depth = 0;
  let current = "";

  for (let index = 0; index < input.length; index += 1) {
    const nextTwo = input.slice(index, index + 2);
    if (nextTwo === "{{") {
      depth += 1;
      current += nextTwo;
      index += 1;
      continue;
    }
    if (nextTwo === "}}" && depth > 0) {
      depth -= 1;
      current += nextTwo;
      index += 1;
      continue;
    }
    if (depth === 0 && input.startsWith(delimiter, index)) {
      cells.push(current);
      current = "";
      index += delimiter.length - 1;
      continue;
    }
    current += input[index];
  }

  cells.push(current);
  return cells;
}

function extractYear(text: string): number | undefined {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function getRowStatus(cell: string): PlutarchStatus | undefined {
  const text = wikiToPlainText(stripCellAttributes(cell)).toLowerCase();
  if (text.includes("winner")) return "winner";
  if (text.includes("nominee") || text.includes("finalist")) return "finalist";
  return undefined;
}

function parseTitle(cell: string) {
  return cleanText(wikiToPlainText(stripCellAttributes(cell)).replace(/^['" ]+|['" ]+$/g, "").replace(/''/g, ""));
}

function addOrMerge(records: PartialRecord[], record: PartialRecord) {
  const existing = records.find((item) => recordKey(item) === recordKey(record));
  if (!existing) {
    records.push(record);
    return;
  }
  existing.authors = [...new Set([...existing.authors, ...record.authors])];
}

function normalizeCoWinners(records: PartialRecord[]): RawAwardRecord[] {
  const winnersByYear = new Map<string, PartialRecord[]>();
  for (const record of records.filter((item) => item.status === "winner")) {
    const key = `${record.categoryId}:${record.year}`;
    winnersByYear.set(key, [...(winnersByYear.get(key) ?? []), record]);
  }

  return records.map((record) => {
    if (record.status !== "winner") return record;
    const winners = winnersByYear.get(`${record.categoryId}:${record.year}`) ?? [];
    const distinctTitles = new Set(winners.map((item) => slugify(item.title)));
    return { ...record, status: distinctTitles.size > 1 ? "co_winner" : "winner" };
  });
}

function recordKey(record: Pick<RawAwardRecord, "categoryId" | "year" | "title">) {
  return `${record.categoryId}:${record.year}:${slugify(record.title)}`;
}

function statusSort(status: RawAwardRecordStatus): number {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist") return 2;
  return 9;
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 40) throw new Error(`Expected at least 40 Plutarch rows, got ${records.length}`);
  const years = records.map((record) => record.year);
  if (Math.min(...years) > 2013 || Math.max(...years) < 2024) {
    throw new Error(`Unexpected Plutarch year range: ${yearRange(records)}`);
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
