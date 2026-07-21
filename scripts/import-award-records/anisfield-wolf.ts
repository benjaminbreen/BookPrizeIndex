import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "anisfield-wolf-book-awards");
  if (!prize) throw new Error("Missing Anisfield-Wolf Book Awards registry entry");

  const sourceUrl = prize.categories[0]?.sourceUrl;
  if (!sourceUrl) throw new Error("Missing Anisfield-Wolf source URL");
  console.log(`Fetching Anisfield-Wolf winners from ${sourceUrl}...`);
  const records = parseAnisfieldWolf(prize, await fetchHtml(sourceUrl));
  records.sort((a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("anisfield-wolf.json", records, {
    importer: "scripts/import-award-records/anisfield-wolf.ts",
    source: "Official Anisfield-Wolf winners archive",
    notes: "Imports works labeled Nonfiction or Memoir by the official archive. Years with multiple winners are normalized as co-winners.",
    categories: prize.categories.map((category) => categoryMetadata(category, records)),
  });
  console.log(`Imported ${records.length} Anisfield-Wolf nonfiction and memoir winners.`);
}

export function parseAnisfieldWolf(prize: PrizeRegistryEntry, html: string): RawAwardRecord[] {
  const starts = [...html.matchAll(/<li class="winner-list-item">/g)].map((match) => match.index);
  const parsed: RawAwardRecord[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const block = html.slice(starts[index], starts[index + 1] ?? html.length);
    const year = field(block, "winner-list-item__award-year");
    const categoryName = field(block, "winner-list-item__award-category");
    const title = field(block, "winner-list-item__title");
    const author = field(block, "winner-list-item__author");
    const category = prize.categories.find((entry) => entry.name.toLowerCase() === categoryName.toLowerCase());
    if (!category || !/^(?:19|20)\d{2}$/.test(year) || !title || !author) continue;

    parsed.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: Number(year),
      status: "winner",
      title,
      authors: normalizeAuthorList(author),
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
    });
  }

  const counts = new Map<string, number>();
  for (const record of parsed) {
    const key = `${record.categoryId}:${record.year}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return parsed.map((record) => counts.get(`${record.categoryId}:${record.year}`)! > 1
    ? { ...record, status: "co_winner" }
    : record);
}

function field(block: string, className: string) {
  const match = block.match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:span|p)>`));
  return match ? htmlToPlainText(match[1]) : "";
}

function categoryMetadata(category: PrizeCategoryRegistryEntry, records: RawAwardRecord[]) {
  const categoryRecords = records.filter((record) => record.categoryId === category.id);
  const years = categoryRecords.map((record) => record.year);
  return {
    categoryId: category.id,
    categoryName: category.name,
    sourceUrl: category.sourceUrl,
    records: categoryRecords.length,
    yearRange: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
