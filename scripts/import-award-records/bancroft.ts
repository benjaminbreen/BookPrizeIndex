import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const sourceUrl = "https://library.columbia.edu/about/awards/bancroft/previous_awards.html";

type BancroftEntry = {
  year: number;
  title: string;
  authors: string[];
  publisher?: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "bancroft-prize");
  const category = prize?.categories.find((entry) => entry.id === "bancroft-prize");
  if (!prize || !category) throw new Error("Missing bancroft-prize registry entry in sources/prizes.json");

  console.log(`Fetching Bancroft Prize records from ${sourceUrl}...`);
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`Bancroft archive request failed: ${response.status} ${response.statusText}`);

  const records = parseBancroft(prize, category, await response.text());
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("bancroft.json", records, {
    importer: "scripts/import-award-records/bancroft.ts",
    source: "Official Columbia University Libraries Bancroft previous-awards archive",
    notes: "The Bancroft archive lists annual prize recipients. Rows are imported as winners because the page does not distinguish finalist, shortlist, or longlist statuses.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Bancroft Prize records (${yearRange(records)}).`);
}

export function parseBancroft(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, html: string): RawAwardRecord[] {
  return parseEntries(html).map((entry) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: entry.year,
    status: "winner",
    title: entry.title,
    authors: entry.authors,
    publisher: entry.publisher,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
  }));
}

function parseEntries(html: string): BancroftEntry[] {
  const lines = htmlToLines(html);
  const entries: BancroftEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const yearMatch = lines[index].match(/^#\s*((?:19|20)\d{2})$/);
    if (!yearMatch) continue;

    const year = Number(yearMatch[1]);
    let cursor = index + 1;
    while (cursor < lines.length && !/^#\s*(?:19|20)\d{2}$/.test(lines[cursor])) {
      const title = lines[cursor];
      const authorLine = lines[cursor + 1] ?? "";
      const publisherLine = lines[cursor + 2] ?? "";

      if (!isLikelyTitle(title) || !/^by\b/i.test(authorLine) || !/^published by\b/i.test(publisherLine)) {
        cursor += 1;
        continue;
      }

      entries.push({
        year,
        title: normalizeKnownTitle(cleanTitle(title), normalizeAuthorList(authorLine.replace(/^by\s+/i, ""))),
        authors: normalizeAuthorList(authorLine.replace(/^by\s+/i, "")),
        publisher: cleanPublisher(publisherLine),
      });
      cursor += 3;
    }
  }

  return entries.filter((entry) => entry.title && entry.authors.length);
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n# ")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/?(?:em|span)[^>]*>/gi, "")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function cleanTitle(input: string) {
  return cleanText(input.replace(/^"(.+)"$/, "$1"));
}

function cleanPublisher(input: string) {
  const publisher = input
    .replace(/^published by\s+/i, "")
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/i, "")
    .replace(/\s*,?\s*(?:19|20)\d{2}\.?\s*$/i, "");
  return cleanText(publisher) || undefined;
}

function normalizeKnownTitle(title: string, authors: string[]) {
  if (title === "The Chinese Question: The Gold Rushes and Global Politics" && authors.includes("Mae Ngai")) {
    return "The Chinese Question: The Gold Rushes, Chinese Migration, and Global Politics";
  }
  return title;
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "\"")
    .replace(/&#8221;|&rdquo;/g, "\"")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
