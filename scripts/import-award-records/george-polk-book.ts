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
  const prize = registry.find((entry) => entry.id === "george-polk-awards");
  const category = prize?.categories.find((entry) => entry.id === "george-polk-book");
  if (!prize || !category) throw new Error("Missing George Polk Book Award registry entry");

  console.log(`Fetching George Polk Award archive from ${category.sourceUrl}...`);
  const records = parseGeorgePolkBook(prize, category, await fetchHtml(category.sourceUrl));
  if (records.length < 20) throw new Error(`George Polk parser returned only ${records.length} book records`);
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("george-polk-book.json", records, {
    importer: "scripts/import-award-records/george-polk-book.ts",
    source: category.sourceLabel,
    notes: "Imports only rows explicitly labeled Book or Book Award in the official George Polk archive. The category was not awarded every year; unlisted years remain gaps rather than inferred no-award years.",
    records: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} George Polk Book Award winners (${yearRange(records)}).`);
}

export function parseGeorgePolkBook(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const headings = [...html.matchAll(/<h5[^>]*>\s*<a\s+name="((?:19|20)\d{2})"[^>]*>/gi)]
    .map((match) => ({ year: Number(match[1]), index: match.index ?? 0 }));
  const records: RawAwardRecord[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const section = html.slice(heading.index, headings[index + 1]?.index ?? html.length);
    for (const line of htmlToLines(section).filter((item) => /^(?:Book|Book Award):/i.test(item))) {
      const parsed = parseBookLine(line, heading.year);
      if (!parsed) continue;
      records.push({
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year: heading.year,
        status: "winner",
        title: parsed.title,
        authors: parsed.authors,
        sourceUrl: category.sourceUrl,
        sourceLabel: category.sourceLabel,
        sourceConfidence: category.sourceConfidence,
      });
    }
  }

  return dedupe(records);
}

function parseBookLine(line: string, year: number) {
  const body = cleanText(line.replace(/^(?:Book|Book Award):\s*/i, ""));
  const quoted = body.match(/[“"]\s*([^”"]+?)\s*[”"]/) ?? body.match(/''\s*([^']+?)\s*''/);
  if (!quoted?.[1] || quoted.index === undefined) return undefined;

  const title = cleanText(quoted[1]).replace(/[.,]$/, "");
  let authorText = cleanText(body.slice(0, quoted.index))
    .replace(/\s+(?:for|and for)\s*$/i, "")
    .replace(/,\s*(?:for)?\s*$/i, "")
    .replace(/\s*\((?:editor|ed\.)\)\s*/gi, " ");

  // This archive row inserts Schramm's institutional affiliation between the
  // author and title. It is not a co-author or publisher credit.
  if (year === 1961) authorText = "Wilbur Schramm";
  const authors = normalizeAuthorList(authorText);
  if (!authors.length || !title) return undefined;
  return { title, authors };
}

function dedupe(records: RawAwardRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.year}:${record.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
