import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
  RawAwardRecordStatus,
} from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const archiveUrl = "https://kennedyhumanrights.org/awards/book-and-journalism/past-book-award-laureates/";
const correctedArchiveYears: Record<string, number> = {
  "https://kennedyhumanrights.org/person/jack-bass/": 1994,
};
const authorOverrides: Record<string, string[]> = {
  "Blair LM Kelley": ["Blair L.M. Kelley"],
  "Myles Horton and Herbert and Judith Kohl": ["Myles Horton", "Herbert Kohl", "Judith Kohl"],
};
const titleOverrides: Record<string, string> = {
  "https://kennedyhumanrights.org/person/dan-t-carter/": "The Politics of Rage: George Wallace, the Origins of the New Conservatism, and the Transformation of American Politics",
  "https://kennedyhumanrights.org/person/melissa-fay-greene/": "Praying for Sheetrock",
  "https://kennedyhumanrights.org/person/peter-s-prescott/": "The Child Savers",
  "https://kennedyhumanrights.org/person/stephen-b-oates/": "Let the Trumpet Sound: The Life of Martin Luther King, Jr.",
};
const excludedOutOfScopeUrls = new Set([
  "https://kennedyhumanrights.org/person/toni-morrison/",
]);
const recognitionOverrides: Record<string, { status: RawAwardRecordStatus; note: string }> = {
  "https://kennedyhumanrights.org/person/andrew-revkin/": {
    status: "honorable_mention",
    note: "A contemporary Washington Post report identifies this work as the 1991 honorable mention: https://www.washingtonpost.com/archive/lifestyle/1991/04/15/kennedy-awards-announced/92ba88a9-4442-43f1-9648-8d3db0f45b3d/",
  },
  "https://kennedyhumanrights.org/person/john-lewis-andrew-aydin-and-nate-powell/": {
    status: "honorable_mention",
    note: "The historical winners list identifies this work as a 2014 special recognition: https://en.wikipedia.org/wiki/Robert_F._Kennedy_Human_Rights#Book_Award",
  },
};

export type RfkLaureateCandidate = {
  year: number;
  authorLabel: string;
  detailUrl: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "robert-f-kennedy-book-award");
  const category = prize?.categories.find((entry) => entry.id === "rfk-book-award");
  if (!prize || !category) throw new Error("Missing Robert F. Kennedy Book Award registry entry");

  console.log("Fetching the official RFK Book Award laureate archive...");
  const candidates = parseRfkArchive(await fetchHtml(archiveUrl));
  const peersByYear = new Map<number, string[]>();
  for (const candidate of candidates) {
    const peers = peersByYear.get(candidate.year) ?? [];
    peers.push(candidate.authorLabel);
    peersByYear.set(candidate.year, peers);
  }

  const parsed = await mapWithConcurrency(candidates, 6, async (candidate) => {
    const html = await fetchHtml(candidate.detailUrl);
    return parseRfkLaureate(prize, category, candidate, html, peersByYear.get(candidate.year) ?? []);
  });
  const records = normalizeCoWinners(parsed.filter((record) => !excludedOutOfScopeUrls.has(record.sourceUrl)))
    .sort((a, b) => b.year - a.year || a.status.localeCompare(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("rfk-book.json", records, {
    importer: "scripts/import-award-records/rfk-book.ts",
    source: category.sourceLabel,
    notes: "Imports the official archive and uses each official laureate page for work titles. Corrects the duplicated 1995 heading for Jack Bass, maps two independently documented special/honorable recognitions, repairs four malformed legacy page titles, and excludes the fiction winner Beloved.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
    honorableMentions: records.filter((record) => record.status === "honorable_mention").length,
    yearRange: yearRange(records),
    excludedOutOfScope: ["Beloved (fiction)"],
  });
  console.log(`Imported ${records.length} RFK Book Award laureate records (${yearRange(records)}).`);
}

export function parseRfkArchive(html: string): RfkLaureateCandidate[] {
  const candidates: RfkLaureateCandidate[] = [];
  const seenUrls = new Set<string>();
  const tokens = html.matchAll(
    /<h2\b[^>]*>\s*((?:19|20)\d{2})\s*<\/h2>|<a\b[^>]*href=["'](https:\/\/kennedyhumanrights\.org\/person\/[^"']+\/)["'][^>]*>\s*([^<]+?)\s*<\/a>/gi,
  );
  let currentYear: number | undefined;

  for (const token of tokens) {
    if (token[1]) {
      currentYear = Number(token[1]);
      continue;
    }
    if (!currentYear || !token[2] || seenUrls.has(token[2])) continue;
    const authorLabel = htmlToPlainText(token[3]);
    if (!authorLabel) continue;
    seenUrls.add(token[2]);
    candidates.push({
      year: correctedArchiveYears[token[2]] ?? currentYear,
      authorLabel,
      detailUrl: token[2],
    });
  }

  return candidates;
}

export function parseRfkLaureate(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  candidate: RfkLaureateCandidate,
  html: string,
  peerLabels: string[],
): RawAwardRecord {
  const paragraph = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
    .map((match) => match[0])
    .find((value) => /(?:RFK|Robert F\. Kennedy|Book)\s+Book Award|(?:RFK|Robert F\. Kennedy) Book Award|Book Award(?:\s|&nbsp;)*(?:winner|was presented)/i.test(htmlToPlainText(value)));
  if (!paragraph) throw new Error(`Could not find award paragraph on ${candidate.detailUrl}`);
  const plain = htmlToPlainText(paragraph);
  const title = titleOverrides[candidate.detailUrl]
    ?? extractRfkTitle(paragraph, plain, candidate.authorLabel, peerLabels);
  if (!title) throw new Error(`Could not parse title for ${candidate.authorLabel} from ${candidate.detailUrl}: ${plain}`);

  const recognitionOverride = recognitionOverrides[candidate.detailUrl];
  const status: RawAwardRecordStatus = recognitionOverride?.status
    ?? (/honou?rable mention/i.test(plain) ? "honorable_mention" : "winner");

  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: candidate.year,
    status,
    title,
    authors: parseRfkAuthors(candidate.authorLabel),
    sourceUrl: candidate.detailUrl,
    sourceLabel: `Robert F. Kennedy Human Rights official laureate page: ${candidate.authorLabel}`,
    sourceConfidence: "official",
    notes: [
      candidate.detailUrl in correctedArchiveYears
        ? "The official archive repeats its 1995 heading here; the official detail page identifies this as the 1994 award."
        : undefined,
      recognitionOverride?.note,
      candidate.detailUrl in titleOverrides
        ? "Title normalized from the complete work title because the legacy official page's emphasis markup truncates or duplicates it."
        : undefined,
    ].filter(Boolean).join(" ") || undefined,
  };
}

function extractRfkTitle(paragraphHtml: string, plain: string, authorLabel: string, peerLabels: string[]) {
  const escapedAuthor = escapeRegExp(authorLabel);
  const quotedBeforeAuthor = plain.match(new RegExp(`[“\"]([^”\"]+)[”\"]\\s+by\\s+(?:(?:historian|journalist|author)\\s+)?${escapedAuthor}`, "i"));
  if (quotedBeforeAuthor) return cleanTitle(quotedBeforeAuthor[1]);
  const surname = authorLabel.split(/\s+/).at(-1)?.replace(/[^\p{L}'’-]/gu, "");
  if (surname) {
    const quotedPairs = [...plain.matchAll(/[“\"]([^”\"]+)[”\"]\s+by\s+(?:(?:historian|journalist|author)\s+)?([^.;]+?)(?=\s+and\s+[“\"]|[.;]|$)/gi)];
    const surnameMatch = quotedPairs.find((item) => new RegExp(`\\b${escapeRegExp(surname)}\\b`, "i").test(item[2]));
    if (surnameMatch) return cleanTitle(surnameMatch[1]);
  }

  const emphasizedTitles: string[] = [];
  const markedHtml = paragraphHtml.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_match, value: string) => {
    const index = emphasizedTitles.push(htmlToPlainText(value)) - 1;
    return ` RFK_TITLE_${index} `;
  });
  const marked = htmlToPlainText(markedHtml);
  const authorIndex = marked.toLocaleLowerCase().indexOf(authorLabel.toLocaleLowerCase());
  if (authorIndex >= 0) {
    const authorEnd = authorIndex + authorLabel.length;
    const following = [...marked.matchAll(/RFK_TITLE_(\d+)/g)]
      .map((match) => ({ index: match.index ?? 0, title: emphasizedTitles[Number(match[1])] }))
      .find((item) => item.index > authorEnd && item.index - authorEnd < 220 && /\bfor\b/i.test(marked.slice(authorEnd, item.index)));
    if (following?.title) return cleanTitle(following.title);

    const preceding = [...marked.matchAll(/RFK_TITLE_(\d+)/g)]
      .map((match) => ({ index: match.index ?? 0, title: emphasizedTitles[Number(match[1])] }))
      .filter((item) => item.index < authorIndex && authorIndex - item.index < 220)
      .at(-1);
    if (preceding?.title && /\bby\s*$/i.test(marked.slice(preceding.index + 11, authorIndex))) {
      return cleanTitle(preceding.title);
    }
  }

  if (authorIndex >= 0) {
    const afterAuthor = plain.slice(authorIndex + authorLabel.length);
    const forMatch = afterAuthor.match(/\bfor\s+(.+)$/i);
    if (forMatch) {
      let value = forMatch[1];
      for (const peer of peerLabels.filter((item) => item !== authorLabel)) {
        const delimiter = new RegExp(`\\s+and\\s+${escapeRegExp(peer)}\\s+for\\s+`, "i");
        const peerIndex = value.search(delimiter);
        if (peerIndex >= 0) value = value.slice(0, peerIndex);
      }
      value = value.split(/\.\s+(?=[A-Z])/)[0];
      return cleanTitle(value);
    }
  }

  if (emphasizedTitles.length === 1) return cleanTitle(emphasizedTitles[0]);
  return undefined;
}

function parseRfkAuthors(authorLabel: string) {
  if (authorOverrides[authorLabel]) return authorOverrides[authorLabel];
  return authorLabel
    .replace(/,\s+and\s+/i, " and ")
    .split(/,\s+|\s+and\s+/i)
    .map(cleanText)
    .filter(Boolean);
}

function cleanTitle(value: string) {
  const title = cleanText(value)
    .replace(/^[:;,\s“”"']+/, "")
    .replace(/[“”"']?[;\s]+$/, "");
  return /(?:Jr|Sr)\.$/.test(title) ? title : title.replace(/\.$/, "");
}

function normalizeCoWinners(records: RawAwardRecord[]): RawAwardRecord[] {
  const winnerCounts = new Map<number, number>();
  for (const record of records) {
    if (record.status === "winner") winnerCounts.set(record.year, (winnerCounts.get(record.year) ?? 0) + 1);
  }
  return records.map((record) => record.status === "winner" && (winnerCounts.get(record.year) ?? 0) > 1
    ? { ...record, status: "co_winner" as RawAwardRecordStatus }
    : record);
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 66) throw new Error(`Expected at least 66 in-scope RFK laureate records, got ${records.length}`);
  if (yearRange(records) !== "1981-2025") throw new Error(`Unexpected RFK year range: ${yearRange(records)}`);
  const years = new Set(records.map((record) => record.year));
  for (let year = 1981; year <= 2025; year += 1) {
    if (!years.has(year)) throw new Error(`Missing RFK award year ${year}`);
  }
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>) {
  const results = new Array<U>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
