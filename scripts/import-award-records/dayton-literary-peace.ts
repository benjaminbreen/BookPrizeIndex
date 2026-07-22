import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Dayton Literary Peace Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "dayton-literary-peace-prize");
  const category = prize?.categories.find((entry) => entry.id === "dayton-nonfiction");
  if (!prize || !category) throw new Error("Missing Dayton Literary Peace Prize registry entry");

  console.log(`Fetching ${pageTitle} nonfiction table from MediaWiki...`);
  const records = parseDaytonNonfiction(prize, category, await fetchMediaWikiWikitext(pageTitle));
  if (records.length < 80) throw new Error(`Dayton parser returned only ${records.length} nonfiction records`);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("dayton-literary-peace.json", records, {
    importer: "scripts/import-award-records/dayton-literary-peace.ts",
    source: category.sourceLabel,
    notes: "Imports the nonfiction winner, runner-up, and published finalist slates. Runner-up is represented by the public model's finalist status and preserved verbatim in notes.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    runnersUp: records.filter((record) => record.notes?.includes("Runner-up")).length,
    finalists: records.filter((record) => record.status === "finalist" && !record.notes?.includes("Runner-up")).length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Dayton nonfiction records (${yearRange(records)}).`);
}

export function parseDaytonNonfiction(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const start = wikitext.indexOf("=== Nonfiction ===");
  const end = wikitext.indexOf("=== Lifetime Achievement Award ===", start);
  if (start < 0 || end < 0) throw new Error("Could not locate Dayton nonfiction table");

  const records: RawAwardRecord[] = [];
  let currentYear: number | undefined;
  for (const chunk of wikitext.slice(start, end).split(/\n\|-/).slice(1)) {
    const rawCells = parseRowCells(chunk);
    const cells = rawCells.map((cell) => wikiToPlainText(stripCellAttributes(cell)));
    const firstCellYear = cells[0]?.match(/^(?:19|20)\d{2}$/)?.[0];
    const yearIndex = firstCellYear ? 0 : -1;
    if (firstCellYear) currentYear = Number(firstCellYear);
    if (!currentYear) continue;

    const statusIndex = cells.findIndex((cell) => /^(?:Winner|Runner-up|Finalist)$/i.test(cell));
    if (statusIndex < 2) continue;
    const authorIndex = yearIndex >= 0 && yearIndex < statusIndex ? yearIndex + 1 : 0;
    const titleIndex = statusIndex - 1;
    const authors = normalizeAuthorList(cells[authorIndex] ?? "");
    const title = cleanDaytonTitle(cells[titleIndex] ?? "");
    const result = cells[statusIndex];
    if (!authors.length || !title) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: /^winner$/i.test(result) ? "winner" : "finalist",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: [
        /^runner-up$/i.test(result) ? "Official result: Runner-up." : undefined,
        category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      ].filter(Boolean).join(" ") || undefined,
    });
  }
  return records;
}

function parseRowCells(row: string) {
  return row.split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[!|]/.test(line) && !/^\|}$/.test(line))
    .map((line) => line.replace(/^[!|]\s*/, ""))
    .filter(Boolean);
}

function cleanDaytonTitle(input: string) {
  const candidates = input.split("|").map(cleanText).filter(Boolean);
  let title = candidates.at(-1) ?? "";
  title = title.replace(/^[:|\s]+/, "");
  const duplicated = title.match(/^(.{12,}?)\s*:\s*\1$/i);
  if (duplicated) title = duplicated[1];
  if (title === "The Prosecutor: One Man’s Battle to Bring Nazis to Justice: The Prosecutor: One Man’s Battle to Bring Nazis to Justice") {
    return "The Prosecutor: One Man’s Battle to Bring Nazis to Justice";
  }
  return cleanText(title);
}

function statusSort(status: RawAwardRecord["status"]) {
  return status === "winner" ? 1 : 2;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
