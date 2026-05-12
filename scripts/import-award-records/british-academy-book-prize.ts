import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import {
  cleanText,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const archiveUrl = "https://www.thebritishacademy.ac.uk/british-academy-book-prize/past-winners/";

type PrizeBook = {
  year: number;
  status: RawAwardRecordStatus;
  title: string;
  authors: string[];
  sourceUrl: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "british-academy-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "british-academy-book-prize");
  if (!prize || !category) throw new Error("Missing british-academy-book-prize registry entry in sources/prizes.json");

  console.log(`Fetching British Academy Book Prize archive from ${archiveUrl}...`);
  const archiveHtml = await fetchHtml(archiveUrl);
  let yearUrls = extractYearUrls(archiveHtml);
  if (yearUrls.length < 10) {
    yearUrls = extractYearUrls(await fetchRenderedText(archiveUrl));
  }
  if (!yearUrls.length) throw new Error("Could not find British Academy Book Prize year pages.");

  const books: PrizeBook[] = [];
  for (const [year, sourceUrl] of yearUrls) {
    let html: string;
    try {
      html = await fetchHtml(sourceUrl);
    } catch (error) {
      if (year >= 2018) throw error;
      console.warn(`Warning: skipping ${year} British Academy page: ${(error as Error).message}`);
      continue;
    }
    let yearBooks = parseYearPage(year, sourceUrl, html);
    if (year >= 2018 && yearBooks.length < 5) {
      try {
        const renderedBooks = parseYearPage(year, sourceUrl, await fetchRenderedText(sourceUrl));
        if (renderedBooks.length > yearBooks.length) yearBooks = renderedBooks;
      } catch (error) {
        console.warn(`Warning: falling back to direct British Academy HTML for ${year}: ${(error as Error).message}`);
      }
    }
    books.push(...yearBooks);
  }

  const records = toRecords(prize, category, books);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("british-academy-book-prize.json", records, {
    importer: "scripts/import-award-records/british-academy-book-prize.ts",
    source: "Official British Academy Book Prize past-winners archive",
    notes: "The prize launched in 2013 and was formerly known as the British Academy Book Prize for Global Cultural Understanding / Nayef Al-Rodhan Prize. The importer records official winner and shortlist status from modern annual archive pages for 2018 onward; 2013-2017 pages require separate QA.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((record) => record.status === "winner").length,
      shortlisted: records.filter((record) => record.status === "shortlist").length,
      yearRange: yearRange(records),
    }],
  });

  console.log(`Imported ${records.length} British Academy Book Prize records (${yearRange(records)}).`);
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok && (response.status === 403 || response.status === 429)) return fetchRenderedText(url);
  if (!response.ok) throw new Error(`British Academy request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchRenderedText(url: string) {
  const renderedUrl = `https://r.jina.ai/http://r.jina.ai/http://${url}`;
  let renderedResponse: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt);
    renderedResponse = await fetch(renderedUrl, {
      headers: {
        "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
      },
    });
    if (renderedResponse.ok || renderedResponse.status !== 429) break;
  }
  if (!renderedResponse) {
    throw new Error(`British Academy rendered request failed for ${url}: no response`);
  }
  if (!renderedResponse.ok) {
    throw new Error(`British Academy rendered request failed for ${url}: ${renderedResponse.status} ${renderedResponse.statusText}`);
  }
  return renderedResponse.text();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractYearUrls(html: string) {
  const urls = new Map<number, string>();
  const linkPattern = /(https:\/\/www\.thebritishacademy\.ac\.uk\/british-academy-book-prize\/[^")\s]*\b20\d{2}[^")\s]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html))) {
    const href = decodeHtml(match[1]);
    const yearMatch = href.match(/\b(20\d{2})\b/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    if (year < 2013 || year > new Date().getFullYear() + 1) continue;
    urls.set(year, new URL(href, archiveUrl).toString());
  }

  return Array.from(urls.entries()).sort((a, b) => a[0] - b[0]);
}

function parseYearPage(year: number, sourceUrl: string, html: string): PrizeBook[] {
  const books: PrizeBook[] = [];
  const seen = new Set<string>();
  const lines = htmlToLines(html);
  let currentStatus: RawAwardRecordStatus | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+Sign up to our email newsletters\b/i.test(line) || /^##\s+Site map\b/i.test(line)) break;

    const explicitStatus = statusFromLine(line);
    if (explicitStatus) currentStatus = explicitStatus;
    const status = explicitStatus ?? currentStatus;
    if (!status) continue;

    const isBookHeading = /^#{2,}\s/.test(line);
    const parsed = (explicitStatus || isBookHeading ? parseBookLine(line) : undefined)
      ?? (explicitStatus && /^#{2,}\s/.test(lines[index + 1] ?? "") ? parseBookLine(lines[index + 1] ?? "") : undefined);
    if (!parsed || !isLikelyTitle(parsed.title) || !parsed.authors.length) continue;

    const key = `${status}:${parsed.title}:${parsed.authors.join(";")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    books.push({
      year,
      status,
      title: parsed.title,
      authors: parsed.authors,
      sourceUrl,
    });
  }

  if (!books.some((book) => book.status === "winner") && books.length) {
    books[0].status = "winner";
  }

  return books;
}

function statusFromLine(line: string): RawAwardRecordStatus | undefined {
  if (/^(?:#+\s*)?(?:The\s+\d{4}\s+)?winner\b/i.test(line)) return "winner";
  if (/^(?:#+\s*)?Shortlisted\b/i.test(line) || /^(?:#+\s*)?The shortlist\b/i.test(line)) return "shortlist";
  return undefined;
}

function parseBookLine(line: string) {
  let text = cleanText(line)
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/\*+/g, "")
    .replace(/_+/g, "")
    .replace(/^Winner\s*/i, "")
    .replace(/^Shortlisted\s*/i, "")
    .replace(/^#+\s*/, "")
    .replace(/^The\s+\d{4}\s+winner\s*/i, "")
    .replace(/^The\s+\d{4}\s+shortlist(?:ed book)?\s*/i, "");

  text = text.replace(/^['"]|['"]$/g, "");
  const byMatch = text.match(/^['"]?(.+?)['"]?\s*by\s+(.+)$/i);
  if (!byMatch) return undefined;

  const title = cleanText(byMatch[1].replace(/^'|'$/g, ""));
  const authorText = cleanText(byMatch[2].replace(/\s*\([^)]*\)\s*$/g, ""));
  const authors = normalizeAuthorList(authorText);
  return { title, authors };
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
    sourceUrl: book.sourceUrl,
    sourceLabel: `${category.sourceLabel}: ${book.year}`,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
  }));
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n### ")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n")
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

function statusSort(status: RawAwardRecordStatus) {
  if (status === "winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

function assertCoverage(records: RawAwardRecord[]) {
  const coveredYears = new Set(records.map((record) => record.year));
  const missingRecentYears = [];
  for (let year = 2018; year <= Math.min(new Date().getFullYear(), 2025); year += 1) {
    if (!coveredYears.has(year)) missingRecentYears.push(year);
  }
  if (missingRecentYears.length) {
    throw new Error(`British Academy import is incomplete; missing parsed records for ${missingRecentYears.join(", ")}.`);
  }

  const expectedMinimumByYear = new Map([
    [2018, 6],
    [2019, 5],
    [2020, 5],
    [2021, 4],
    [2022, 6],
    [2023, 6],
    [2024, 6],
    [2025, 6],
  ]);
  const sparseYears = Array.from(expectedMinimumByYear.entries())
    .filter(([year, expectedMinimum]) => coveredYears.has(year) && records.filter((record) => record.year === year).length < expectedMinimum)
    .map(([year]) => year)
    .sort((a, b) => a - b);
  if (sparseYears.length) {
    throw new Error(`British Academy import is incomplete; too few parsed records for ${sparseYears.join(", ")}.`);
  }
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
