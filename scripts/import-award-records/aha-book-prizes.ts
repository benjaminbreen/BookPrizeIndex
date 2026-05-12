import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

type AhaCategoryConfig = {
  categoryId: string;
  fileLabel: string;
};

type AhaRecipient = {
  year: number;
  title: string;
  authors: string[];
  publisher?: string;
};

const configs: AhaCategoryConfig[] = [
  { categoryId: "aha-beveridge-family", fileLabel: "Beveridge Family Prize" },
  { categoryId: "aha-jerry-bentley", fileLabel: "Jerry Bentley Prize" },
  { categoryId: "aha-european-international-history", fileLabel: "AHA Prize in European International History" },
  { categoryId: "aha-george-l-mosse", fileLabel: "George L. Mosse Prize" },
  { categoryId: "aha-james-a-rawley", fileLabel: "James A. Rawley Prize" },
];

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "aha-book-prizes");
  if (!prize) throw new Error("Missing aha-book-prizes registry entry in sources/prizes.json");

  const records: RawAwardRecord[] = [];
  const categoryMetadata: Array<Record<string, unknown>> = [];

  for (const config of configs) {
    const category = prize.categories.find((entry) => entry.id === config.categoryId);
    if (!category) throw new Error(`Missing ${config.categoryId} category in sources/prizes.json`);

    console.log(`Fetching AHA ${config.fileLabel} records from ${category.sourceUrl}...`);
    const response = await fetch(category.sourceUrl, {
      headers: {
        "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
      },
    });
    if (!response.ok) {
      throw new Error(`AHA archive request failed for ${category.id}: ${response.status} ${response.statusText}`);
    }

    const categoryRecords = parseAhaPastRecipients(prize, category, await response.text());
    records.push(...categoryRecords);
    categoryMetadata.push({
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: categoryRecords.length,
      winners: categoryRecords.length,
      yearRange: yearRange(categoryRecords),
    });
  }

  records.sort((a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("aha-book-prizes.json", records, {
    importer: "scripts/import-award-records/aha-book-prizes.ts",
    source: "Official American Historical Association award pages",
    notes: "Imports Past Recipients from selected AHA publication-prize pages as winners. AHA pages do not publish finalist or shortlist slates for these prizes.",
    categories: categoryMetadata,
  });

  console.log(`Imported ${records.length} selected AHA book prize records.`);
}

export function parseAhaPastRecipients(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  return parseRecipients(html).map((entry) => ({
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

function parseRecipients(html: string): AhaRecipient[] {
  const lines = htmlToLines(html);
  const start = lines.findIndex((line) => /^Past Recipients$/i.test(line));
  if (start === -1) throw new Error("Could not find AHA Past Recipients heading.");

  const recipients: AhaRecipient[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^Current Recipient$/i.test(line) || /^Join the AHA$/i.test(line)) break;

    const yearMatch = line.match(/^((?:19|20)\d{2})$/);
    if (!yearMatch) continue;

    const entryLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !/^(?:19|20)\d{2}$/.test(lines[cursor]) && !/^Current Recipient$/i.test(lines[cursor])) {
      entryLines.push(lines[cursor]);
      cursor += 1;
    }

    const entry = parseRecipientLines(Number(yearMatch[1]), entryLines);
    if (entry) {
      recipients.push(entry);
      index = cursor - 1;
    }
  }

  return recipients;
}

function parseRecipientLines(year: number, lines: string[]): AhaRecipient | undefined {
  const separatorIndex = lines.findIndex((line) => line === ",");
  if (separatorIndex > 0) {
    const authorText = cleanText(lines.slice(0, separatorIndex).join(" "));
    const titleText = cleanText(lines.slice(separatorIndex + 1).join(" "));
    return toRecipient(year, authorText, titleText);
  }

  const text = cleanText(lines.join(" "));
  const commaIndex = text.indexOf(",");
  if (commaIndex <= 0) return undefined;

  return toRecipient(year, text.slice(0, commaIndex), text.slice(commaIndex + 1));
}

function toRecipient(year: number, authorInput: string, titleInput: string): AhaRecipient | undefined {
  const authorText = cleanText(authorInput);
  const text = cleanText(titleInput);
  const publisherMatch = text.match(/\(([^()]+)\)\s*$/);
  const publisher = publisherMatch ? cleanPublisher(publisherMatch[1]) : undefined;
  const title = cleanTitle(publisherMatch ? text.slice(0, publisherMatch.index) : text);
  if (!authorText || !title) return undefined;

  return {
    year,
    title,
    authors: normalizeAuthorList(authorText),
    publisher,
  };
}

function cleanTitle(input: string) {
  return cleanText(input)
    .replace(/\s+\.$/, "")
    .replace(/^["“]|["”]$/g, "");
}

function cleanPublisher(input: string) {
  return cleanText(input)
    .replace(/\s+\.$/, "")
    .replace(/\bUniv\./g, "Univ.")
    .replace(/\bPress\.$/, "Press");
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function decodeHtml(input: string) {
  return input
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&ldquo;|&rdquo;/g, "\"")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-");
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
