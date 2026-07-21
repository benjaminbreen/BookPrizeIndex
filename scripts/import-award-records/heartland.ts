import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Chicago Tribune Heartland Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "chicago-tribune-heartland-prize");
  const category = prize?.categories.find((entry) => entry.id === "heartland-nonfiction");
  if (!prize || !category) throw new Error("Missing Chicago Tribune Heartland Prize registry entry");

  console.log(`Fetching ${pageTitle} nonfiction winners from MediaWiki...`);
  const records = parseHeartland(prize, category, await fetchMediaWikiWikitext(pageTitle));
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("heartland.json", records, {
    importer: "scripts/import-award-records/heartland.ts",
    source: category.sourceLabel,
    notes: "Imports the complete nonfiction winner list. The two books named together for Garry Wills in 2008 are retained as separate winning works.",
    records: records.length,
    winners: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Heartland Prize nonfiction winners (${yearRange(records)}).`);
}

export function parseHeartland(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(
    wikitext,
    "== Chicago Tribune Heartland Prize — Nonfiction ==",
    "== References ==",
  );
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n")) {
    const match = line.match(/^\*\s*((?:19|20)\d{2}):\s*(.*?)\s+for\s+(.+)$/);
    if (!match) continue;
    const year = Number(match[1]);
    const authors = normalizeAuthorList(wikiToPlainText(match[2]));
    const titles = [...match[3].matchAll(/''([\s\S]*?)''/g)]
      .map((titleMatch) => wikiToPlainText(titleMatch[1]))
      .filter(Boolean);
    if (!authors.length || !titles.length) continue;

    for (const title of titles) {
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
        notes: category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
      });
    }
  }

  return records;
}

function sectionBetween(input: string, startMarker: string, endMarker: string) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start: ${startMarker}`);
  const end = input.indexOf(endMarker, start);
  return input.slice(start, end > start ? end : undefined);
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
