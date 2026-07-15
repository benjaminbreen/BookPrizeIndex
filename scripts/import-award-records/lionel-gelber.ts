import { pathToFileURL } from "node:url";
import type { RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { parseAwardRowsFromWikitable } from "./wikitable";
import { lionelGelberOfficialRows, mergeOfficialAwardRows } from "./official-recent-records";

const pageTitle = "Lionel Gelber Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "lionel-gelber-prize");
  const category = prize?.categories.find((entry) => entry.id === "lionel-gelber");
  if (!prize || !category) throw new Error("Missing lionel-gelber-prize registry entry in sources/prizes.json");

  console.log(`Fetching ${pageTitle} from Wikipedia...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const parsed = parseAwardRowsFromWikitable(wikitext);

  const parsedRecords: RawAwardRecord[] = [];
  for (const row of parsed) {
    const status = toStatus(row.result);
    if (!status) continue;
    const authors = normalizeAuthorList(cleanText(row.author));
    const title = cleanText(row.title);
    if (!authors.length || !isLikelyTitle(title)) continue;
    parsedRecords.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: row.year,
      status,
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
    });
  }

  const records = mergeOfficialAwardRows(parsedRecords, prize, lionelGelberOfficialRows);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  const yearRange = `${Math.min(...records.map((r) => r.year))}-${Math.max(...records.map((r) => r.year))}`;

  await writeRawAwardRecords("lionel-gelber.json", records, {
    importer: "scripts/import-award-records/lionel-gelber.ts",
    source: "MediaWiki historical table plus official Munk School recent results",
    notes: "Winners from 1990 onward (no entry for 2005). Shortlist data is available from 2011; the complete 2026 shortlist and winner are replaced with the official Munk School result.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((r) => r.status === "winner" || r.status === "co_winner").length,
      shortlisted: records.filter((r) => r.status === "shortlist").length,
      yearRange,
    }],
  });

  console.log(`Imported ${records.length} Lionel Gelber Prize records (${yearRange}).`);
}

function toStatus(result: string): RawAwardRecordStatus | undefined {
  const lower = result.toLowerCase();
  if (lower.includes("winner")) return "winner";
  if (lower.includes("shortlist")) return "shortlist";
  return undefined;
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
