import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Francis Parkman Prize";
const official2026Url = "https://sah.columbia.edu/content/announcing-our-2026-prize-winners";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "francis-parkman-prize");
  const category = prize?.categories.find((entry) => entry.id === "francis-parkman-prize");
  if (!prize || !category) throw new Error("Missing Francis Parkman Prize registry entry");

  console.log(`Fetching ${pageTitle} winners from MediaWiki...`);
  const historical = parseFrancisParkman(prize, category, await fetchMediaWikiWikitext(pageTitle))
    .filter((record) => record.year !== 2026);
  const records = [...historical, official2026Record(prize, category)]
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("francis-parkman.json", records, {
    importer: "scripts/import-award-records/francis-parkman.ts",
    source: category.sourceLabel,
    notes: "Imports the deterministic historical winner list, excludes the separate special-achievement prize, and replaces the current-year row with the Society of American Historians' official 2026 announcement.",
    records: records.length,
    winners: records.length,
    yearRange: yearRange(records),
    explicitNoAwardYears: [1968],
  });
  console.log(`Imported ${records.length} Francis Parkman Prize winners (${yearRange(records)}).`);
}

export function parseFrancisParkman(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = extractSection(wikitext, "== Winners ==");
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    const match = line.match(/^\*\s*((?:19|20)\d{2})\s*[–—-]\s*(.+)$/);
    if (!match) continue;
    const year = Number(match[1]);
    const winner = match[2].match(/^(.+?)\s+for\s+(.+)$/i);
    if (!winner) continue;
    const authors = [cleanText(wikiToPlainText(winner[1]))];
    const italicTitle = winner[2].match(/''((?:(?!'').)+?)''/);
    const title = cleanText(wikiToPlainText(italicTitle?.[1] ?? winner[2])).replace(/[.\s]+$/, "");
    if (!title || !authors[0]) continue;

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
      notes: category.officialUrl ? `Official prize archive: ${category.officialUrl}` : undefined,
    });
  }

  return records;
}

function official2026Record(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: 2026,
    status: "winner",
    title: "Born in Flames: The Business of Arson and the Remaking of the American City",
    authors: ["Bench Ansfield"],
    publisher: "W. W. Norton",
    sourceUrl: official2026Url,
    sourceLabel: "Society of American Historians 2026 prize announcement",
    sourceConfidence: "official",
  };
}

function extractSection(wikitext: string, heading: string) {
  const label = heading.replace(/^=+\s*|\s*=+$/g, "");
  const match = new RegExp(`^==\\s*${escapeRegExp(label)}\\s*==\\s*$`, "m").exec(wikitext);
  if (!match || match.index === undefined) throw new Error(`Could not find section ${heading}`);
  const start = match.index + match[0].length;
  const next = /^==[^=].*==\s*$/m.exec(wikitext.slice(start));
  return wikitext.slice(start, next?.index === undefined ? undefined : start + next.index);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 69) throw new Error(`Expected at least 69 Francis Parkman winners, got ${records.length}`);
  if (records.some((record) => record.year === 1968)) throw new Error("Francis Parkman 1968 must remain a no-award year");
  if (yearRange(records) !== "1957-2026") throw new Error(`Unexpected Francis Parkman range: ${yearRange(records)}`);
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
