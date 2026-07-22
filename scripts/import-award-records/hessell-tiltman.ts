import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "PEN Hessell-Tiltman Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "pen-hessell-tiltman-prize");
  const category = prize?.categories.find((entry) => entry.id === "hessell-tiltman-history");
  if (!prize || !category) throw new Error("Missing PEN Hessell-Tiltman registry entry");

  console.log(`Fetching ${pageTitle} winner and shortlist sections from MediaWiki...`);
  const records = parseHessellTiltman(prize, category, await fetchMediaWikiWikitext(pageTitle));
  if (records.length < 80) throw new Error(`Hessell-Tiltman parser returned only ${records.length} records`);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("hessell-tiltman.json", records, {
    importer: "scripts/import-award-records/hessell-tiltman.ts",
    source: category.sourceLabel,
    notes: "Imports winners and every historical shortlist exposed by the deterministic table. Years for which only a winner is listed remain winner-only rather than receiving inferred finalists.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
    shortlisted: records.filter((record) => record.status === "shortlist").length,
    honorableMentions: records.filter((record) => record.status === "honorable_mention").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} PEN Hessell-Tiltman records (${yearRange(records)}).`);
}

export function parseHessellTiltman(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const start = wikitext.indexOf("==Winners and shortlist==");
  const end = wikitext.indexOf("==See also", start);
  const body = wikitext.slice(start >= 0 ? start : 0, end >= 0 ? end : wikitext.length);
  const headings = [...body.matchAll(/====\s*((?:19|20)\d{2})\s*====/g)]
    .map((match) => ({ year: Number(match[1]), index: (match.index ?? 0) + match[0].length }));
  const records: RawAwardRecord[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const section = body.slice(heading.index, headings[index + 1]?.index ?? body.length);
    const yearRecords: RawAwardRecord[] = [];
    for (const line of section.split("\n").map((item) => item.trim()).filter((item) => item.startsWith("*"))) {
      const parsed = parseHessellBullet(line);
      if (!parsed) continue;
      yearRecords.push({
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year: heading.year,
        status: parsed.status,
        title: parsed.title,
        authors: parsed.authors,
        publisher: parsed.publisher,
        sourceUrl: category.sourceUrl,
        sourceLabel: category.sourceLabel,
        sourceConfidence: category.sourceConfidence,
        notes: category.officialUrl ? `Official awards URL: ${category.officialUrl}` : undefined,
      });
    }
    const winnerCount = yearRecords.filter((record) => record.status === "winner").length;
    for (const record of yearRecords) {
      if (record.status === "winner" && winnerCount > 1) record.status = "co_winner";
      records.push(record);
    }
  }
  return records;
}

function parseHessellBullet(line: string) {
  const titleMatch = line.match(/''([\s\S]+?)''/);
  if (!titleMatch?.[1] || titleMatch.index === undefined) return undefined;
  const authorRaw = line.slice(1, titleMatch.index).replace(/\{\{\s*blue ribbon\s*\}\}/i, "").replace(/,\s*$/, "");
  const authors = normalizeAuthorList(wikiToPlainText(authorRaw));
  const title = cleanText(wikiToPlainText(titleMatch[1]));
  if (!authors.length || !title) return undefined;
  const publisher = line.match(/''[\s\S]+?''\s*\(([^()]+)\)/)?.[1];
  return {
    authors,
    title,
    publisher: publisher ? cleanText(publisher) : undefined,
    status: /honou?rable mention/i.test(line)
      ? "honorable_mention" as const
      : /\{\{\s*blue ribbon\s*\}\}/i.test(line)
        ? "winner" as const
        : "shortlist" as const,
  };
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "honorable_mention") return 2;
  return 3;
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
