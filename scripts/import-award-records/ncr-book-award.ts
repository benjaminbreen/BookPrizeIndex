import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "NCR Book Award";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "ncr-book-award");
  const category = prize?.categories.find((entry) => entry.id === "ncr-book-award-nonfiction");
  if (!prize || !category) throw new Error("Missing NCR Book Award registry entry");

  console.log(`Fetching ${pageTitle} winners from MediaWiki...`);
  const records = parseNcrBookAward(prize, category, await fetchMediaWikiWikitext(pageTitle))
    .sort((a, b) => b.year - a.year);
  assertCoverage(records);

  await writeRawAwardRecords("ncr-book-award.json", records, {
    importer: "scripts/import-award-records/ncr-book-award.ts",
    source: category.sourceLabel,
    notes: "Imports the complete winner-only list for the defunct NCR Book Award. No surviving official archive is available.",
    records: records.length,
    winners: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} NCR Book Award winners (${yearRange(records)}).`);
}

export function parseNcrBookAward(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "Winners", "References");
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    const match = line.match(/^\*\s*((?:19|20)\d{2})\s+(.+?),\s*''(.+?)''\s*(?:\(([^)]+)\))?/);
    if (!match) continue;
    const authors = [cleanText(wikiToPlainText(match[2]))].filter(Boolean);
    const title = cleanText(wikiToPlainText(match[3]));
    if (!authors.length || !title) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: Number(match[1]),
      status: "winner",
      title,
      authors,
      publisher: match[4] ? cleanText(wikiToPlainText(match[4])) : undefined,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
    });
  }

  return records;
}

function sectionBetween(wikitext: string, startLabel: string, endLabel: string) {
  const start = wikitext.search(new RegExp(`^==\\s*${startLabel}\\s*==\\s*$`, "m"));
  const end = wikitext.search(new RegExp(`^==\\s*${endLabel}\\s*==\\s*$`, "m"));
  if (start < 0 || end <= start) throw new Error(`Could not find ${startLabel} section`);
  return wikitext.slice(start, end);
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== 10) throw new Error(`Expected 10 NCR winners, got ${records.length}`);
  if (yearRange(records) !== "1988-1997") throw new Error(`Unexpected NCR range: ${yearRange(records)}`);
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
