import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  fetchMediaWikiWikitext,
  htmlToLines,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  stripCellAttributes,
  slugify,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Frederick Douglass Book Prize";
const officialArchiveUrl = "https://macmillan.yale.edu/glc/past-winners";
const finalistPages = [
  [2016, "https://macmillan.yale.edu/stories/yale-announces-2016-frederick-douglass-book-prize-finalists"],
  [2017, "https://macmillan.yale.edu/stories/2017-frederick-douglass-book-prize-finalists-announced"],
  [2018, "https://macmillan.yale.edu/stories/yale-announces-2018-frederick-douglass-book-prize-finalists"],
  [2019, "https://macmillan.yale.edu/stories/yale-announces-2019-frederick-douglass-book-prize-finalists"],
  [2020, "https://macmillan.yale.edu/stories/2020-frederick-douglass-book-prize-finalists"],
  [2021, "https://macmillan.yale.edu/stories/yale-announces-2021-frederick-douglass-book-prize-finalists"],
  [2022, "https://macmillan.yale.edu/glc/stories/yale-announces-2022-frederick-douglass-book-prize-finalists"],
  [2023, "https://macmillan.yale.edu/stories/yale-announces-2023-frederick-douglass-book-prize-finalists"],
  [2024, "https://macmillan.yale.edu/glc/stories/yale-announces-2024-frederick-douglass-book-prize-finalists"],
  [2025, "https://macmillan.yale.edu/stories/yale-announces-2025-frederick-douglass-book-prize-finalists"],
] as const;

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "frederick-douglass-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "frederick-douglass-slavery-abolition");
  if (!prize || !category) throw new Error("Missing Frederick Douglass Book Prize registry entry");

  console.log(`Fetching ${pageTitle} recipients from MediaWiki...`);
  const winners = parseFrederickDouglass(prize, category, await fetchMediaWikiWikitext(pageTitle));
  console.log("Fetching official Frederick Douglass finalist archives...");
  const [archiveHtml, ...announcementHtml] = await Promise.all([
    fetchHtml(officialArchiveUrl),
    ...finalistPages.map(([, url]) => fetchHtml(url)),
  ]);
  const candidates = [
    ...parseFrederickDouglassArchiveFinalists(prize, category, archiveHtml, officialArchiveUrl),
    ...finalistPages.flatMap(([year, url], index) => parseFrederickDouglassFinalistAnnouncement(prize, category, announcementHtml[index], year, url)),
  ];
  const winnerKeys = new Set(winners.map((record) => `${record.year}:${slugify(record.title)}`));
  const finalists = candidates.filter((record) => !winnerKeys.has(`${record.year}:${slugify(record.title)}`));
  const records = [...winners, ...finalists]
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("frederick-douglass.json", records, {
    importer: "scripts/import-award-records/frederick-douglass.ts",
    source: "Wikipedia recipient table plus official Gilder Lehrman Center finalist archives",
    notes: "Imports every winner in the recipient table and every explicitly labeled finalist available in the official archive: 1999, 2004-2015, and 2016-2025. Years containing two official recipients are represented as co-winners; winners retain only winner status.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    finalists: finalists.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${winners.length} Frederick Douglass Book Prize winners and ${finalists.length} finalists (${yearRange(records)}).`);
}

export function parseFrederickDouglassArchiveFinalists(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  sourceUrl: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  const lines = htmlToLines(html);
  let year: number | undefined;
  let inFinalists = false;
  for (const line of lines) {
    if (/^(?:19|20)\d{2}$/.test(line)) {
      year = Number(line);
      inFinalists = false;
      continue;
    }
    if (/^Finalists\s*:/i.test(line)) {
      inFinalists = true;
      continue;
    }
    if (!inFinalists || !year) continue;
    if (/^More about/i.test(line)) {
      inFinalists = false;
      continue;
    }
    const comma = line.indexOf(",");
    if (comma < 1) continue;
    const author = cleanText(line.slice(0, comma));
    const title = cleanText(line.slice(comma + 1).replace(/^for\s+/i, ""));
    if (!author || !title) continue;
    records.push(makeFinalist(prize, category, year, title, normalizeAuthorList(author), sourceUrl, "Gilder Lehrman Center official past winners and finalists archive"));
  }
  return records;
}

export function parseFrederickDouglassFinalistAnnouncement(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  year: number,
  sourceUrl: string,
): RawAwardRecord[] {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => htmlToPlainText(match[1]));
  const line = paragraphs.find((item) => /finalists(?: for the \d{4} prize)? are:?\s/i.test(item))
    ?? htmlToLines(html).find((item) => /finalists(?: for the \d{4} prize)? are:?\s/i.test(item));
  if (!line) throw new Error(`Could not find ${year} Frederick Douglass finalists`);
  const list = line.replace(/^.*?finalists(?: for the \d{4} prize)? are:?\s*/i, "");
  const records: RawAwardRecord[] = [];
  for (const entry of list.split(/;\s*(?:and\s+)?/i)) {
    const match = entry.replace(/[.;]\s*$/, "").match(/^(.+?)\s+for\s+[“"](.+?)[”"](?:\s*\([^)]*\))?$/);
    if (!match) continue;
    records.push(makeFinalist(prize, category, year, cleanText(match[2]), normalizeAuthorList(match[1]), sourceUrl, `Gilder Lehrman Center official ${year} finalist announcement`));
  }
  if (records.length < 3) throw new Error(`Expected at least 3 Frederick Douglass finalists for ${year}, got ${records.length}`);
  return records;
}

function makeFinalist(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  title: string,
  authors: string[],
  sourceUrl: string,
  sourceLabel: string,
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status: "finalist",
    title,
    authors,
    sourceUrl,
    sourceLabel,
    sourceConfidence: "official",
  };
}

export function parseFrederickDouglass(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "List of recipients", "See also")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref\b[^/>]*\/>/gi, "");
  const records: RawAwardRecord[] = [];
  let currentYear: number | undefined;

  for (const rawRow of section.split(/\n\|-/)) {
    const cells = rawRow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[!|]/.test(line) && !/^\|-/.test(line) && !/^\|}/.test(line))
      .map((cell) => stripCellAttributes(cell.replace(/^[!|]\s*/, "")))
      .filter((cell) => cell && !/^\{\|/.test(cell));
    if (cells.length < 2) continue;

    let cursor = 0;
    const yearMatch = wikiToPlainText(cells[0]).match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch) {
      currentYear = Number(yearMatch[1]);
      cursor = 1;
    }
    if (!currentYear || cells.length - cursor < 2) continue;

    const authors = normalizeAuthorList(cleanText(wikiToPlainText(cells[cursor])));
    const title = cleanText(wikiToPlainText(cells[cursor + 1]).replace(/^''|''$/g, "").replace(/''/g, ""));
    if (!authors.length || !title || /^(?:Author|Title)$/i.test(title)) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: currentYear,
      status: "winner",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official archive: ${category.officialUrl}` : undefined,
    });
  }

  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  return records.map((record) => ({
    ...record,
    status: counts.get(record.year)! > 1 ? "co_winner" as const : "winner" as const,
  }));
}

function sectionBetween(wikitext: string, startLabel: string, endLabel: string) {
  const start = wikitext.search(new RegExp(`^==\\s*${startLabel}\\s*==\\s*$`, "mi"));
  const end = wikitext.search(new RegExp(`^==\\s*${endLabel}\\s*==\\s*$`, "mi"));
  if (start < 0 || end <= start) throw new Error(`Could not find ${startLabel} section`);
  return wikitext.slice(start, end);
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 36) throw new Error(`Expected at least 36 Frederick Douglass winners, got ${records.length}`);
  if (yearRange(records) !== "1999-2025") throw new Error(`Unexpected Frederick Douglass range: ${yearRange(records)}`);
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
