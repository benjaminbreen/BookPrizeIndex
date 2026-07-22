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

const currentYearUrl = "https://www.ire.org/2026/05/05/announcing-the-2025-ire-awards/";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "ire-awards");
  const category = prize?.categories.find((entry) => entry.id === "ire-books");
  if (!prize || !category) throw new Error("Missing IRE Books registry entry");

  console.log(`Fetching IRE award archive from ${category.sourceUrl}...`);
  const archive = await fetchHtml(category.sourceUrl);
  const yearPages = parseIreYearLinks(archive);
  yearPages.set(2025, currentYearUrl);
  const selected = [...yearPages.entries()].filter(([year]) => year >= 2015 && year <= 2025).sort((a, b) => a[0] - b[0]);
  const records: RawAwardRecord[] = [];
  for (const [year, url] of selected) {
    console.log(`Fetching IRE ${year} awards...`);
    records.push(...parseIreBookPage(prize, category, await fetchHtml(url), url, year));
  }
  if (new Set(records.map((record) => record.year)).size < 10) {
    throw new Error(`IRE parser covered only ${new Set(records.map((record) => record.year)).size} award years`);
  }
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("ire-books.json", records, {
    importer: "scripts/import-award-records/ire-books.ts",
    source: category.sourceLabel,
    notes: "Imports the official Books/Book category from the currently exposed 2015-2025 IRE archive. Older pages often present the winner first and subsequent finalists without labels; that documented page order is normalized into winner/finalist statuses.",
    records: records.length,
    awardYears: [...new Set(records.map((record) => record.year))].sort(),
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} IRE Books records (${yearRange(records)}).`);
}

export function parseIreYearLinks(html: string) {
  const links = new Map<number, string>();
  for (const match of html.matchAll(/<a\s+href="([^"]+)"[^>]*>\s*((?:19|20)\d{2})(?:\s+IRE Award)?\s*<\/a>/gi)) {
    const year = Number(match[2]);
    const url = new URL(match[1], "https://www.ire.org/").href;
    if (/award-winners|ire-award/i.test(url)) links.set(year, url);
  }
  return links;
}

export function parseIreBookPage(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  sourceUrl: string,
  year: number,
): RawAwardRecord[] {
  const lines = htmlToLines(html);
  const start = lines.findIndex((line) => /^(?:Book|Books)(?:\s+Expand)?$/i.test(line));
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 2; index < lines.length; index += 1) {
    if (isNextCategory(lines[index])) {
      end = index;
      break;
    }
  }

  const block = lines.slice(start + 1, end);
  const records: RawAwardRecord[] = [];
  let explicitStatus: "winner" | "finalist" | undefined;
  for (let index = 0; index < block.length; index += 1) {
    let line = block[index];
    const prefixedStatus = line.match(/^(Winner|Finalist)s?:\s*(.+)$/i);
    if (prefixedStatus) {
      explicitStatus = /^winner$/i.test(prefixedStatus[1]) ? "winner" : "finalist";
      line = prefixedStatus[2];
    }
    if (/^Winners?:?$/i.test(line)) {
      explicitStatus = "winner";
      continue;
    }
    if (/^Finalists?:?$/i.test(line)) {
      explicitStatus = "finalist";
      continue;
    }
    const parsed = parseQuotedBook(line, block[index + 1]);
    if (!parsed) continue;
    if (parsed.consumedNextLine) index += 1;
    const status = explicitStatus ?? (records.length === 0 ? "winner" : "finalist");
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status,
      title: parsed.title,
      authors: parsed.authors,
      sourceUrl,
      sourceLabel: `${category.sourceLabel}: ${year}`,
      sourceConfidence: category.sourceConfidence,
    });
    if (status === "winner") explicitStatus = "finalist";
  }
  return records;
}

function parseQuotedBook(line: string, nextLine?: string) {
  const match = line.match(/^[“"]\s*(.+?)\s*[”"](?:,?\s*(.*))?$/);
  if (!match?.[1]) return undefined;
  let title = cleanText(match[1]).replace(/\s*[.,]$/, "");
  if (title === "Bottle of Lies: The Inside Story of the Generic Drug Book") {
    title = "Bottle of Lies: The Inside Story of the Generic Drug Boom";
  }
  if (title === "Shots on the Bridge: Police violence and cover-Up in the wake of Katrina") {
    title = "Shots on the Bridge: Police Violence and Cover-Up in the Wake of Katrina";
  }
  if (title === "Code of Silence - Sexual Misconduct by Federal Judges, the Secret System that Protects Them, and the Women who Blew the Whistle") {
    title = "Code of Silence: Sexual Misconduct by Federal Judges, the Secret System that Protects Them, and the Women Who Blew the Whistle";
  }
  let authorText = cleanText(match[2] ?? "");
  let consumedNextLine = false;
  if ((!authorText || /^[—–-]\s*/.test(authorText)) && nextLine && /^by\s+/i.test(nextLine)) {
    authorText = cleanText(nextLine.replace(/^by\s+/i, ""));
    consumedNextLine = true;
  }
  authorText = authorText
    .replace(/^by\s+/i, "")
    .replace(/\s+with contributing author\/editor\s+/i, " and ")
    .replace(/\s*\(published by[^)]+\)\s*$/i, "")
    .replace(/\s*\([^)]*press[^)]*\)\s*$/i, "");
  const authors = normalizeAuthorList(authorText);
  if (!title || !authors.length) return undefined;
  return { title, authors, consumedNextLine };
}

function isNextCategory(line: string) {
  return /Expand$/i.test(line)
    || /^(?:Tom Renner Award|FOI Award|Gannett Award|Longform Journalism|Print\/Online|Video|Audio|Student|IRE Medals|Broadcast|Multiplatform|Innovation)\b/i.test(line);
}

function statusSort(status: RawAwardRecord["status"]) {
  return status === "winner" ? 1 : 2;
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
