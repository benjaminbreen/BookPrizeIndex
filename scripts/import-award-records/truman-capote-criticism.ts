import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToLines,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "truman-capote-award-criticism");
  const category = prize?.categories.find((entry) => entry.id === "truman-capote-literary-criticism");
  if (!prize || !category) throw new Error("Missing Truman Capote Award registry entry");

  console.log(`Fetching Truman Capote Award winners from ${category.sourceUrl}...`);
  const records = parseTrumanCapote(prize, category, await fetchHtml(category.sourceUrl));
  if (records.length < 30) throw new Error(`Truman Capote parser returned only ${records.length} records`);
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("truman-capote-criticism.json", records, {
    importer: "scripts/import-award-records/truman-capote-criticism.ts",
    source: category.sourceLabel,
    notes: "Winner-only official archive. The official 2000 entry names two recipients and two books; they are represented as co-winners.",
    records: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Truman Capote Award records (${yearRange(records)}).`);
}

export function parseTrumanCapote(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const lines = htmlToLines(html);
  const headings = lines.map((line, index) => ({ line, index }))
    .map(({ line, index }) => ({ match: line.match(/^(?:for\s+)?((?:19|20)\d{2})\s+-\s+(.+)$/i), index }))
    .filter((item): item is { match: RegExpMatchArray; index: number } => Boolean(item.match));
  const records: RawAwardRecord[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const year = Number(heading.match[1]);
    if (year < 1995) continue;
    const authorText = cleanText(heading.match[2]);
    const section = lines.slice(heading.index + 1, headings[index + 1]?.index ?? lines.length)
      .filter((line) => !/^(?:Read the Press Release|Previous Winners)$/i.test(line));

    if (year === 2000) {
      const authors = normalizeAuthorList(authorText);
      const titles = section.slice(0, 2).map(cleanCapoteTitle).filter(Boolean);
      if (authors.length === 2 && titles.length === 2) {
        records.push(makeRecord(prize, category, year, "co_winner", titles[0], [authors[0]]));
        records.push(makeRecord(prize, category, year, "co_winner", titles[1], [authors[1]]));
      }
      continue;
    }

    const titleLine = section.find((line) => /^for\s+/i.test(line)) ?? section[0];
    const title = cleanCapoteTitle(titleLine ?? "");
    const authors = normalizeAuthorList(authorText);
    if (!title || !authors.length) continue;
    records.push(makeRecord(prize, category, year, "winner", title, authors));
  }
  return records;
}

function makeRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  status: "winner" | "co_winner",
  title: string,
  authors: string[],
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title,
    authors,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
  };
}

function cleanCapoteTitle(input: string) {
  return cleanText(input.replace(/^for\s+/i, ""));
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
