import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  isLikelyTitle,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "edgar-awards");
  const category = prize?.categories.find((entry) => entry.id === "edgar-best-fact-crime");
  if (!prize || !category) throw new Error("Missing Edgar Best Fact Crime registry entry");

  console.log(`Fetching Edgar Best Fact Crime records from ${category.sourceUrl}...`);
  const firstHtml = await fetchHtml(pageUrl(category.sourceUrl, 1));
  const totalMatch = firstHtml.match(/Total Records Found:\s*(\d+),\s*showing\s*(\d+)\s*per page/i);
  if (!totalMatch) throw new Error("Could not determine Edgar archive pagination");
  const pageCount = Math.ceil(Number(totalMatch[1]) / Number(totalMatch[2]));
  const remaining = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => fetchHtml(pageUrl(category.sourceUrl, index + 2))),
  );
  const records = [firstHtml, ...remaining]
    .flatMap((html, index) => parseEdgarPage(prize, category, html, pageUrl(category.sourceUrl, index + 1)));
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("edgar-best-fact-crime.json", records, {
    importer: "scripts/import-award-records/edgar-fact-crime.ts",
    source: category.sourceLabel,
    notes: "Imports the complete official category database. Rows styled as Edgar winners are winners; the remaining nominated works are normalized as finalists.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    finalists: records.filter((record) => record.status === "finalist").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Edgar Best Fact Crime records (${yearRange(records)}).`);
}

export function parseEdgarPage(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  sourceUrl = category.sourceUrl,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];

  for (const rowMatch of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = new Map<string, { value: string; winner: boolean }>();
    for (const cellMatch of rowMatch[1].matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)) {
      const className = cellMatch[1];
      const key = className.match(/\b([a-z_]+)-field\b/)?.[1];
      if (key) cells.set(key, { value: htmlToPlainText(cellMatch[2]), winner: /\bedgar-winner\b/.test(className) });
    }
    const year = Number(cells.get("award_year")?.value);
    const title = cells.get("title")?.value ?? "";
    const authorText = cells.get("authors_name")?.value ?? "";
    if (!Number.isInteger(year) || !isLikelyTitle(title) || !authorText) continue;
    const winner = [...cells.values()].some((cell) => cell.winner);
    const databaseNotes = cells.get("notes")?.value;
    const notes = [databaseNotes, category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined]
      .filter(Boolean)
      .join(" ");

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: winner ? "winner" : "finalist",
      title,
      authors: splitDatabaseAuthors(authorText),
      publisher: cells.get("publisherproducer")?.value || undefined,
      sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: notes || undefined,
    });
  }

  return records;
}

function splitDatabaseAuthors(input: string) {
  return input
    .split(/\s+(?:and|&)\s+|;\s*|,\s*(?!Jr\.?\b|Sr\.?\b|III\b|IV\b|ed\.?\b)/i)
    .map(cleanText)
    .filter(Boolean);
}

function pageUrl(sourceUrl: string, page: number) {
  const url = new URL(sourceUrl);
  url.searchParams.set("instance", "1");
  url.searchParams.set("listpage", String(page));
  return url.toString();
}

function statusSort(status: RawAwardRecord["status"]) {
  return status === "winner" ? 1 : status === "finalist" ? 2 : 9;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
