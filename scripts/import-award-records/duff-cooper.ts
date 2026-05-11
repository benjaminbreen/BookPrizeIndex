import { pathToFileURL } from "node:url";
import type { RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Duff Cooper Prize";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "duff-cooper-prize");
  const category = prize?.categories.find((entry) => entry.id === "duff-cooper");
  if (!prize || !category) throw new Error("Missing duff-cooper-prize registry entry in sources/prizes.json");

  console.log(`Fetching ${pageTitle} from Wikipedia...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parse(prize.id, prize.name, category.id, category.name, category.sourceUrl, category.sourceLabel, category.sourceConfidence, category.officialUrl, wikitext);

  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  const yearRange = `${Math.min(...records.map((r) => r.year))}-${Math.max(...records.map((r) => r.year))}`;

  await writeRawAwardRecords("duff-cooper.json", records, {
    importer: "scripts/import-award-records/duff-cooper.ts",
    source: "MediaWiki wikitable for Duff Cooper Prize winners",
    notes: "Winners only — no shortlist is announced for this prize.",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((r) => r.status === "winner" || r.status === "co_winner").length,
      yearRange,
    }],
  });

  console.log(`Imported ${records.length} Duff Cooper Prize records (${yearRange}).`);
}

function parse(
  awardId: string,
  awardName: string,
  categoryId: string,
  categoryName: string,
  sourceUrl: string,
  sourceLabel: string,
  sourceConfidence: string,
  officialUrl: string | undefined,
  wikitext: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  // Track co-winners: more than one winner row for the same year → co_winner
  const winnerYearCounts = new Map<number, number>();

  const rows = extractRows(wikitext);

  for (const { year, author, title } of rows) {
    if (!isLikelyTitle(title) || !author) continue;
    const authors = normalizeAuthorList(author);
    if (!authors.length) continue;
    winnerYearCounts.set(year, (winnerYearCounts.get(year) ?? 0) + 1);
    records.push({
      awardId,
      awardName,
      categoryId,
      categoryName,
      year,
      status: "winner", // will patch co-winners below
      title: cleanText(title),
      authors,
      sourceUrl,
      sourceLabel,
      sourceConfidence: sourceConfidence as RawAwardRecord["sourceConfidence"],
      notes: officialUrl ? `Official awards URL: ${officialUrl}` : undefined,
    });
  }

  // Patch co-winners
  for (const record of records) {
    if ((winnerYearCounts.get(record.year) ?? 0) > 1) {
      record.status = "co_winner";
    }
  }

  return records;
}

type RawRow = { year: number; author: string; title: string };

function extractRows(wikitext: string): RawRow[] {
  const rows: RawRow[] = [];

  for (const chunk of wikitext.split(/\n\|-/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    // Collect cells: year cell uses ! markup, data cells use |
    const cells: string[] = [];
    for (const line of lines) {
      if (/^\{\|/.test(line) || /^\|\}/.test(line) || /^\|\+/.test(line) || /^!(?!!)[^!]/.test(line) && cells.length > 0) continue;
      if (/^[!|]/.test(line) && !/^\|-/.test(line)) {
        const stripped = wikiToPlainText(stripCellAttributes(line.replace(/^[!|]\s*/, "")));
        const cleaned = cleanText(stripped);
        if (cleaned) cells.push(cleaned);
      }
    }
    if (cells.length < 3) continue;

    const year = extractYear(cells[0]);
    if (!year) continue;

    const author = cells[1] ?? "";
    const title = cells[2] ?? "";
    rows.push({ year, author, title });
  }

  return rows;
}

function extractYear(input: string) {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
