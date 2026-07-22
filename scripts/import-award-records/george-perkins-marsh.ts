import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "george-perkins-marsh-prize");
  const category = prize?.categories.find((entry) => entry.id === "george-perkins-marsh-environmental-history");
  if (!prize || !category) throw new Error("Missing George Perkins Marsh Prize registry entry");

  console.log(`Fetching George Perkins Marsh Prize winners from ${category.sourceUrl}...`);
  const records = parseGeorgePerkinsMarsh(prize, category, await fetchHtml(category.sourceUrl))
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("george-perkins-marsh.json", records, {
    importer: "scripts/import-award-records/george-perkins-marsh.ts",
    source: category.sourceLabel,
    notes: "Imports only year-prefixed winner rows from the official George Perkins Marsh Prize section; recent finalists and all other ASEH awards are excluded.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} George Perkins Marsh Prize winners (${yearRange(records)}).`);
}

export function parseGeorgePerkinsMarsh(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const start = html.indexOf("George Perkins Marsh Prize");
  const end = html.indexOf("Alice Hamilton Prize", start);
  if (start < 0 || end <= start) throw new Error("Could not isolate George Perkins Marsh Prize section");

  const records: RawAwardRecord[] = [];
  const section = html.slice(start, end);
  for (const match of section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const block = match[1];
    const plain = htmlToPlainText(block);
    const yearMatch = plain.match(/^((?:19|20)\d{2})\s+(.+)$/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);

    let authorText: string;
    let title: string;
    if (year === 2025) {
      authorText = "Meredith McKittrick";
      title = "Green Lands for White Men: Desert Dystopias and the Environmental Origins of Apartheid";
    } else {
      const anchor = block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor || anchor.index === undefined) continue;
      authorText = htmlToPlainText(block.slice(0, anchor.index))
        .replace(/^\d{4}\s+/, "")
        .replace(/,\s*$/, "");
      title = htmlToPlainText(anchor[1])
        .replace(/^([A-Z])\s+([a-z])/, "$1$2")
        .replace(/\bI Industrial\b/, "Industrial")
        .replace(/Nineteenth- Century/, "Nineteenth-Century")
        .replace(/[.\s]+$/, "");
      if (year === 2017) title = `${title}, 1048–1128`;
    }
    const authors = normalizeAuthorList(cleanText(authorText));
    if (!authors.length || !title) continue;

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
    });
  }

  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  return records.map((record) => ({
    ...record,
    status: counts.get(record.year)! > 1 ? "co_winner" as const : "winner" as const,
  }));
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 36) throw new Error(`Expected at least 36 George Perkins Marsh winners, got ${records.length}`);
  if (yearRange(records) !== "1989-2025") throw new Error(`Unexpected George Perkins Marsh range: ${yearRange(records)}`);
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
