import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const sourceUrl = "https://www.wolfsonhistoryprize.org.uk/past-winners/all-winners/";

type WolfsonEntry = {
  year: number;
  status: RawAwardRecordStatus;
  title: string;
  authors: string[];
  publisher?: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "wolfson-history-prize");
  const category = prize?.categories.find((entry) => entry.id === "wolfson-history");
  if (!prize || !category) throw new Error("Missing wolfson-history-prize registry entry in sources/prizes.json");

  console.log(`Fetching Wolfson History Prize records from ${sourceUrl}...`);
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`Wolfson winners request failed: ${response.status} ${response.statusText}`);

  const records = parseWolfson(prize, category, await response.text());
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("wolfson.json", records, {
    importer: "scripts/import-award-records/wolfson.ts",
    source: "Official Wolfson History Prize all-winners archive",
    notes: "The official archive states that until 2016 up to three awards were made each year; since 2017 one overall winner has been selected from a shortlist.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      shortlisted: records.filter((record) => record.status === "shortlist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Wolfson History Prize records (${yearRange(records)}).`);
}

export function parseWolfson(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, html: string): RawAwardRecord[] {
  return parseEntries(html).map((entry) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: entry.year,
    status: entry.status,
    title: entry.title,
    authors: entry.authors,
    publisher: entry.publisher,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
  }));
}

function parseEntries(html: string): WolfsonEntry[] {
  const lines = htmlToLines(html);
  const entries: WolfsonEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const yearMatch = lines[index].match(/^#\s*(\d{4})$/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    let cursor = index + 1;
    let status: RawAwardRecordStatus = "winner";

    while (cursor < lines.length && !/^#\s*\d{4}$/.test(lines[cursor])) {
      const line = lines[cursor];
      if (isIgnorable(line)) {
        cursor += 1;
        continue;
      }
      if (/^(?:\d{4}\s+)?Shortlist:$/i.test(line)) {
        status = "shortlist";
        cursor += 1;
        continue;
      }

      const title = line;
      const author = lines[cursor + 1];
      const publisherLine = lines[cursor + 2];
      if (!author || !publisherLine || !isLikelyTitle(title) || !/^\(.+\)$/.test(publisherLine)) {
        cursor += 1;
        continue;
      }

      entries.push({
        year,
        status,
        title,
        authors: normalizeAuthorList(author),
        publisher: publisherLine.replace(/^\(|\)$/g, ""),
      });
      cursor += 3;
    }
  }

  return entries;
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n# ")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
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

function isIgnorable(line: string) {
  return line === " " || line === "\u00a0" || /^Awarded by the Wolfson Foundation$/i.test(line);
}

function statusSort(status: RawAwardRecordStatus) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
