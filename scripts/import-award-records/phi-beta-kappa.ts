import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

type WinnerEntry = {
  year: number;
  title: string;
  authors: string[];
  publisher?: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "phi-beta-kappa-book-awards");
  if (!prize) throw new Error("Missing phi-beta-kappa-book-awards registry entry in sources/prizes.json");

  const records: RawAwardRecord[] = [];
  const reports: Array<Record<string, unknown>> = [];

  for (const category of prize.categories) {
    console.log(`Fetching ${category.name} winners from ${category.sourceUrl}...`);
    const response = await fetch(category.sourceUrl, {
      headers: {
        "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
      },
    });
    if (!response.ok) throw new Error(`PBK request failed for ${category.sourceUrl}: ${response.status} ${response.statusText}`);

    const categoryRecords = parseCategory(prize, category, await response.text());
    records.push(...categoryRecords);
    reports.push({
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: categoryRecords.length,
      winners: categoryRecords.length,
      yearRange: yearRange(categoryRecords),
    });
  }

  records.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("phi-beta-kappa.json", records, {
    importer: "scripts/import-award-records/phi-beta-kappa.ts",
    source: "Official Phi Beta Kappa Book Awards past-winner pages",
    notes: "Imports winners only from the official PBK past-winner pages for the Christian Gauss Award, Phi Beta Kappa Award in Science, and Ralph Waldo Emerson Award.",
    categories: reports,
  });

  console.log(`Imported ${records.length} Phi Beta Kappa Book Awards records.`);
}

export function parseCategory(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, html: string): RawAwardRecord[] {
  return parseWinnerEntries(html).map((entry) => ({
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

function parseWinnerEntries(html: string): WinnerEntry[] {
  const lines = htmlToLines(html);
  const entries: WinnerEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const yearMatch = lines[index].match(/^(\d{4}):?$/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    const titleParts: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !/^by\b/i.test(lines[cursor]) && !/^(\d{4}):?$/.test(lines[cursor])) {
      titleParts.push(lines[cursor]);
      cursor += 1;
    }
    const authorLine = lines[cursor];
    if (!authorLine || !/^by\b/i.test(authorLine)) continue;

    const title = cleanText(titleParts.join(" "));
    const parsed = parseAuthorPublisher(authorLine);
    if (!isLikelyTitle(title) || !parsed.authors.length) continue;
    entries.push({
      year,
      title,
      authors: parsed.authors,
      publisher: parsed.publisher,
    });
  }

  return entries;
}

function parseAuthorPublisher(line: string) {
  const cleaned = cleanText(line.replace(/^by\s+/i, ""));
  const publisherMatch = cleaned.match(/\(([^()]*)\)\s*$/);
  const authorText = publisherMatch ? cleaned.slice(0, publisherMatch.index).trim() : cleaned;
  return {
    authors: normalizeAuthorList(authorText),
    publisher: publisherMatch?.[1] ? cleanText(publisherMatch[1]) : undefined,
  };
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
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#x27;|&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "\"")
    .replace(/&#8221;|&rdquo;/g, "\"")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#038;|&amp;/g, "&")
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
