import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

type BiographyWinner = {
  year: number;
  title: string;
  authors: string[];
  publisher?: string;
  sourceUrl?: string;
  notes?: string;
};

const latestWinner: BiographyWinner = {
  year: 2025,
  title: "The First and Last King of Haiti: The Rise and Fall of Henry Christophe",
  authors: ["Marlene L. Daut"],
  sourceUrl: "https://www.ed.ac.uk/news/tales-of-identity-and-uprising-win-book-awards",
  notes: "The official winners archive currently ends at 2024; this recipient is taken from the University of Edinburgh's official 2025 announcement.",
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "james-tait-black-prizes");
  const category = prize?.categories.find((entry) => entry.id === "james-tait-black-biography");
  if (!prize || !category) throw new Error("Missing James Tait Black biography registry entry");

  console.log(`Fetching James Tait Black biography winners from ${category.sourceUrl}...`);
  const records = parseJamesTaitBlack(prize, category, await fetchHtml(category.sourceUrl));
  if (!records.some((record) => record.year === latestWinner.year)) {
    records.push(toRecord(prize, category, latestWinner));
  }
  markJointWinners(records);
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("james-tait-black-biography.json", records, {
    importer: "scripts/import-award-records/james-tait-black-biography.ts",
    source: category.sourceLabel,
    notes: "Imports the official biography winner archive, which is organized by publication year. The latest official announcement supplements the archive when it has not yet been updated.",
    records: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} James Tait Black biography winners (${yearRange(records)}).`);
}

export function parseJamesTaitBlack(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const start = html.indexOf("Winners of the James Tait Black Prize for Biography");
  if (start < 0) throw new Error("Could not find James Tait Black biography winner list");
  const winners: BiographyWinner[] = [];

  for (const match of html.slice(start).matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const line = htmlToPlainText(match[1]);
    const yearMatch = line.match(/\s+-\s+((?:19|20)\d{2})$/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    const body = cleanText(line.slice(0, yearMatch.index));
    const parts = year === 2023 && body.includes(" and Ian Penman - ")
      ? body.split(/\s+and\s+(?=Ian Penman\s+-\s+)/)
      : [body];
    for (const part of parts) {
      const winner = parseWinnerPart(year, part);
      if (winner) winners.push(winner);
    }
  }

  return winners.map((winner) => toRecord(prize, category, winner));
}

function parseWinnerPart(year: number, input: string): BiographyWinner | undefined {
  let authorText = "";
  let titleAndPublisher = "";
  const standard = input.match(/^(.*?)\s+-\s+(.+)$/);
  if (standard) {
    authorText = cleanText(standard[1]);
    titleAndPublisher = cleanText(standard[2]);
  } else if (year === 2002 && input.startsWith("Jenny Uglow ")) {
    authorText = "Jenny Uglow";
    titleAndPublisher = input.slice(authorText.length + 1);
  } else {
    return undefined;
  }

  let notes: string | undefined;
  const translator = authorText.match(/^(.*?),\s*translated by\s+(.+)$/i);
  if (translator) {
    authorText = cleanText(translator[1]);
    notes = `Translator: ${cleanText(translator[2])}.`;
  }
  const publisherMatch = titleAndPublisher.match(/^(.*)\s+\(([^()]*)\)$/);
  const title = cleanText(publisherMatch ? publisherMatch[1] : titleAndPublisher);
  const publisher = publisherMatch ? cleanText(publisherMatch[2]) : undefined;
  if (!authorText || !title) return undefined;

  return { year, title, authors: normalizeAuthorList(authorText), publisher, notes };
}

function toRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  winner: BiographyWinner,
): RawAwardRecord {
  const notes = [winner.notes, category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined]
    .filter(Boolean)
    .join(" ");
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: winner.year,
    status: "winner",
    title: winner.title,
    authors: winner.authors,
    publisher: winner.publisher,
    sourceUrl: winner.sourceUrl ?? category.sourceUrl,
    sourceLabel: winner.sourceUrl ? "University of Edinburgh official winner announcement" : category.sourceLabel,
    sourceConfidence: "official",
    notes: notes || undefined,
  };
}

function markJointWinners(records: RawAwardRecord[]) {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  for (const record of records) {
    if ((counts.get(record.year) ?? 0) > 1) record.status = "co_winner";
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
