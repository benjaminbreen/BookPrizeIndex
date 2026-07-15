import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";
import { mergeOfficialAwardRows, rachelCarsonOfficialRows } from "./official-recent-records";

const indexUrl = "https://www.sej.org/library/books/rachel-carson-environment-book-award-winners";

type PrizeBook = {
  year: number;
  status: RawAwardRecordStatus;
  title: string;
  authors: string[];
  publisher?: string;
  sourceUrl: string;
};

const fallbackWinners = new Map<number, Omit<PrizeBook, "year" | "status" | "sourceUrl">>([
  [2024, { title: "To Dye For: How Toxic Fashion Is Making Us Sick — and How We Can Fight Back", authors: ["Alden Wicker"], publisher: "G.P. Putnam's Sons" }],
  [2023, { title: "Wild New World: The Epic Story of Animals and People in America", authors: ["Dan Flores"], publisher: "W. W. Norton & Company" }],
  [2022, { title: "Wild Souls: Freedom and Flourishing in the Non-Human World", authors: ["Emma Marris"], publisher: "Bloomsbury" }],
  [2021, { title: "Mill Town: Reckoning with What Remains", authors: ["Kerri Arsenault"], publisher: "St. Martin's Press" }],
  [2020, { title: "Inconspicuous Consumption: The Environmental Impact You Don't Know You Have", authors: ["Tatiana Schlossberg"], publisher: "Grand Central Publishing" }],
  [2019, { title: "The Poisoned City: Flint's Water and the American Urban Tragedy", authors: ["Anna Clark"], publisher: "Metropolitan Books / Henry Holt and Company" }],
  [2018, { title: "White Wash: The Story of a Weed Killer, Cancer and the Corruption of Science", authors: ["Carey Gillam"], publisher: "Island Press" }],
  [2017, { title: "Unlatched: The Evolution of Breastfeeding and the Making of a Controversy", authors: ["Jennifer Grayson"], publisher: "HarperCollins" }],
  [2016, { title: "The Narrow Edge: A Tiny Bird, an Ancient Crab, and an Epic Journey", authors: ["Deborah Cramer"], publisher: "Yale University Press" }],
  [2015, { title: "Untamed: The Wildest Woman in America and the Fight for Cumberland Island", authors: ["Will Harlan"], publisher: "Grove Press" }],
  [2014, { title: "Toms River: A Story of Science and Salvation", authors: ["Dan Fagin"], publisher: "Bantam Dell/Random House" }],
  [2013, { title: "The Dilbit Disaster: Inside the Biggest Oil Spill You've Never Heard Of", authors: ["Lisa Song", "Elizabeth McGowan"], publisher: "InsideClimate News" }],
  [2012, { title: "Listed: Dispatches from America's Endangered Species Act", authors: ["Joe Roman"], publisher: "Harvard University Press" }],
  [2011, { title: "Shell Games: Rogues, Smugglers, and the Hunt for Nature's Bounty", authors: ["Craig Welch"], publisher: "William Morrow" }],
  [2010, { title: "Heart of Dryness: How the Last Bushmen Can Help Us Endure the Coming Age of Permanent Drought", authors: ["James G. Workman"], publisher: "Walker & Co" }],
  [2009, { title: "Tar Sands: Dirty Oil and the Future of a Continent", authors: ["Andrew Nikiforuk"], publisher: "Greystone Books / David Suzuki Foundation" }],
  [2008, { title: "The Unnatural History of the Sea", authors: ["Callum Roberts"], publisher: "Island Press" }],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "rachel-carson-environment-book-award");
  const category = prize?.categories.find((entry) => entry.id === "rachel-carson-environment-book");
  if (!prize || !category) throw new Error("Missing rachel-carson-environment-book-award registry entry in sources/prizes.json");

  console.log(`Fetching Rachel Carson winners index from ${indexUrl}...`);
  const indexHtml = await fetchHtml(indexUrl);
  const yearUrls = extractYearUrls(indexHtml);
  if (yearUrls.length < 10) throw new Error(`Expected at least 10 Rachel Carson annual URLs, got ${yearUrls.length}`);

  const books: PrizeBook[] = [];
  for (const [year, sourceUrl] of yearUrls) {
    const fallbackWinner = fallbackWinners.get(year);
    if (fallbackWinner) {
      books.push({
        year,
        status: "winner",
        title: fallbackWinner.title,
        authors: fallbackWinner.authors,
        publisher: fallbackWinner.publisher,
        sourceUrl,
      });
      continue;
    }
    const markdown = await fetchRenderedMarkdown(sourceUrl);
    const parsed = parseAnnualPage(year, sourceUrl, markdown);
    if (!parsed) {
      throw new Error(`No first-place Rachel Carson winner parsed for ${year}: ${sourceUrl}`);
    }
    books.push(parsed);
  }

  const records = mergeOfficialAwardRows(toRecords(prize, category, books), prize, rachelCarsonOfficialRows);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("rachel-carson.json", records, {
    importer: "scripts/import-award-records/rachel-carson.ts",
    source: "Official SEJ Rachel Carson Environment Book Award annual pages",
    notes: "Imports first-place winners from official annual pages linked by the SEJ winners index. Winner rows are encoded explicitly because annual page layouts vary substantially across years; other placements are deferred.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} Rachel Carson Environment Book Award records (${yearRange(records)}).`);
}

export function parseAnnualPage(year: number, sourceUrl: string, markdown: string): PrizeBook | undefined {
  const allLines = markdown.split("\n").map((line) => cleanText(line)).filter(Boolean);
  const lines = scopeToRachelCarsonSection(allLines);
  const winnerIndex = lines.findIndex((line) => statusFromHeading(line) === "winner");
  if (winnerIndex < 0) return undefined;
  const blockStart = winnerIndex > 0 && /Rachel Carson Environment Book Award/i.test(stripMarkdown(lines[0]))
    ? 0
    : winnerIndex;

  const nextBoundary = lines.findIndex((line, index) => {
    if (index <= winnerIndex) return false;
    if (/^\* ?\* ?\*+$/.test(line)) return true;
    if (statusFromHeading(line)) return true;
    if (/^##(?!#)/.test(line) && !/Rachel Carson Environment Book Award/i.test(stripMarkdown(line))) return true;
    return false;
  });
  const block = lines.slice(blockStart, nextBoundary < 0 ? winnerIndex + 12 : nextBoundary);
  const parsed = parseWinnerBlock(block);
  if (!parsed) return undefined;

  return {
    year,
    status: "winner",
    title: parsed.title,
    authors: parsed.authors,
    publisher: parsed.publisher,
    sourceUrl,
  };
}

function scopeToRachelCarsonSection(lines: string[]) {
  const start = lines.findIndex((line) => /^#{2,}\s*/.test(line) && /Rachel Carson Environment Book Award/i.test(stripMarkdown(line)));
  if (start < 0) return lines;

  const end = lines.findIndex((line, index) => {
    if (index <= start) return false;
    if (/^\* ?\* ?\*+$/.test(line)) return true;
    if (!/^##(?!#)/.test(line)) return false;
    const text = stripMarkdown(line);
    return !/Rachel Carson Environment Book Award/i.test(text) && !statusFromHeading(text);
  });

  return lines.slice(start, end < 0 ? undefined : end);
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`SEJ request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchRenderedMarkdown(url: string) {
  const renderedUrl = `https://r.jina.ai/http://r.jina.ai/http://${url}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(renderedUrl, {
      headers: {
        "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
      },
    });
    if (response.ok) return response.text();
    if (response.status !== 429 || attempt === 4) {
      throw new Error(`Rendered SEJ request failed for ${url}: ${response.status} ${response.statusText}`);
    }
    await sleep(attempt * 2500);
  }
  throw new Error(`Rendered SEJ request failed for ${url}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractYearUrls(html: string) {
  const urls = new Map<number, string>();
  const linkPattern = /<a\b[^>]*href="([^"]+)"[^>]*>(20\d{2})<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html))) {
    const href = decodeHtml(match[1]);
    const year = Number(match[2]);
    if (year < 2008 || year > new Date().getFullYear() + 1) continue;
    urls.set(year, new URL(href, indexUrl).toString());
  }

  return Array.from(urls.entries()).sort((a, b) => a[0] - b[0]);
}

function statusFromHeading(line: string): RawAwardRecordStatus | undefined {
  if (/(?:1st|First)[-\s]+Place|FIRST PLACE/i.test(line)) return "winner";
  if (/(?:2nd|3rd|Second|Third)[-\s]+Place|SECOND PLACE|THIRD PLACE/i.test(line)) return "finalist";
  if (/(?:(?:1st|2nd|3rd|First|Second|Third)\s+)?Honou?rable Mention|HONOU?RABLE MENTION/i.test(line)) return "honorable_mention";
  const text = stripMarkdown(line.replace(/^#+\s*/, ""));
  if (/^(?:1st|First)[-\s]+Place\b/i.test(text)) return "winner";
  if (/^(?:2nd|3rd|Second|Third)[-\s]+Place\b/i.test(text)) return "finalist";
  if (/^(?:(?:1st|2nd|3rd|First|Second|Third)\s+)?Honou?rable Mention\b/i.test(text)) return "honorable_mention";
  return undefined;
}

function parseWinnerBlock(block: string[]) {
  const contentBlock = block.slice(0, block.findIndex((line, index) => index > 0 && isNonBookLine(line)) < 0
    ? undefined
    : block.findIndex((line, index) => index > 0 && isNonBookLine(line)));
  const bookLine = contentBlock.find((line) => isDecoratedBookLine(line) && parseBookLine(line));
  const parsedBookLine = bookLine ? parseBookLine(bookLine) : undefined;
  if (bookLine && parsedBookLine) {
    return {
      ...parsedBookLine,
      publisher: publisherFromFollowingLines(block, block.indexOf(bookLine)),
    };
  }

  const titleIndex = contentBlock.findIndex((line, index) => index > 0 && isTitleLine(line));
  if (titleIndex < 0) return undefined;

  const title = cleanTitle(stripMarkdown(contentBlock[titleIndex]));
  const authorLine = extractAuthorFromStatusHeading(contentBlock[0])
    ?? contentBlock.slice(titleIndex + 1).map(stripMarkdown).find((line) => line && !isPublisherLine(line) && !isNonBookLine(line))
    ?? contentBlock.slice(1, titleIndex).map(stripMarkdown).find((line) => line && !isPublisherLine(line) && !isNonBookLine(line));
  const authors = authorLine ? splitAuthors(authorLine) : [];
  const publisher = contentBlock.map(stripMarkdown).find((line) => isPublisherLine(line));

  if (!isLikelyTitle(title) || !authors.length) return undefined;
  return {
    title,
    authors,
    publisher,
  };
}

function parseBookLine(line: string) {
  let text = line
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/_+/g, "")
    .replace(/^#+\s*/, "");

  text = cleanText(text);
  const match = text.match(/^["“]?(.+?)["”]?\s*by\s+(.+)$/i);
  if (!match) return undefined;

  const title = cleanText(match[1].replace(/^["“”]+|["“”]+$/g, ""));
  const authors = splitAuthors(match[2]);
  if (!authors.length) return undefined;
  return { title, authors };
}

function isDecoratedBookLine(line: string) {
  return /\[[^\]]+]\([^)]+\)/.test(line) || /^#{2,}\s+[_*]/.test(line) || /^[_*]/.test(line);
}

function splitAuthors(input: string) {
  return cleanText(input)
    .replace(/\*+/g, "")
    .replace(/_+/g, "")
    .replace(/\s*,?\s+with\s+/i, ", ")
    .split(/\s+(?:and|&)\s+|,\s*/)
    .map((author) => cleanText(author))
    .filter(Boolean);
}

function stripMarkdown(input: string) {
  return cleanText(input
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/_+/g, "")
    .replace(/^#+\s*/, ""));
}

function publisherFromFollowingLines(lines: string[], start: number) {
  for (let offset = 1; offset <= 6; offset += 1) {
    const line = lines[start + offset] ?? "";
    const match = line.match(/^Published by\s+(.+)$/i);
    if (match) return cleanText(match[1]);
  }
  return undefined;
}

function isTitleLine(line: string) {
  if (isNonBookLine(line)) return false;
  return /\[[^\]]+]\([^)]+\)/.test(line) || /_[^_]+_/.test(line) || /^#{2,}\s+/.test(line);
}

function cleanTitle(input: string) {
  return cleanText(input
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/^#+\s*/, ""));
}

function extractAuthorFromStatusHeading(line: string) {
  const text = stripMarkdown(line);
  const match = text.match(/^(?:1st|First)[-\s]+Place:\s*(.+)$/i);
  const value = cleanText(match?.[1] ?? "");
  if (!value || /Rachel Carson Environment Book Award/i.test(value)) return undefined;
  return value;
}

function isPublisherLine(line: string) {
  const text = cleanText(line.replace(/^Published by\s+/i, ""));
  if (statusFromHeading(text) || /Rachel Carson Environment Book Award/i.test(text)) return false;
  if (!text || isNonBookLine(text)) return false;
  return /\b(?:Press|Books?|Publishers?|University|Morrow|Norton|Putnam|Random House|Houghton|Island|Company|Co\.?|HarperCollins|Farrar|Straus|Giroux|Grove|Bloomsbury|Little, Brown|Milkweed|Haymarket|MIT|Pantheon|PublicAffairs|Beacon|Knopf|Dutton|Simon & Schuster|St\. Martin's|Twelve|Scribner)\b/i.test(text);
}

function isNonBookLine(line: string) {
  const text = stripMarkdown(line);
  return !text
    || /^https?:\/\//i.test(text)
    || /^(?:From the judges|Judges(?:['’] comments|\b)|Back to|SEJ's \d{4}|The Society of Environmental Journalists)/i.test(text)
    || /^!\[/.test(line);
}

function toRecords(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry, books: PrizeBook[]): RawAwardRecord[] {
  return books.map((book) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: book.year,
    status: book.status,
    title: book.title,
    authors: book.authors,
    publisher: book.publisher,
    sourceUrl: book.sourceUrl,
    sourceLabel: `${category.sourceLabel}: ${book.year}`,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
  }));
}

function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ");
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 17) throw new Error(`Expected at least 17 Rachel Carson rows, got ${records.length}`);
  if (records.length !== new Set(records.map((record) => record.year)).size) {
    throw new Error("Expected exactly one Rachel Carson winner per year");
  }
  const winners = records.filter((record) => record.status === "winner");
  if (winners.length < 17) throw new Error(`Expected at least 17 Rachel Carson winners, got ${winners.length}`);
}

function statusSort(status: RawAwardRecordStatus): number {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "finalist") return 2;
  if (status === "honorable_mention") return 3;
  return 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  if (!years.length) return "none";
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
