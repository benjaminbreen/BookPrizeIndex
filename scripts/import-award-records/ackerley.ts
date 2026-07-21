import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToLines,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "ackerley-prize");
  const category = prize?.categories.find((entry) => entry.id === "ackerley-autobiography");
  if (!prize || !category) throw new Error("Missing Ackerley Prize registry entry");

  console.log(`Fetching Ackerley Prize winners from ${category.sourceUrl}...`);
  const records = parseAckerley(prize, category, await fetchHtml(category.sourceUrl));
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("ackerley.json", records, {
    importer: "scripts/import-award-records/ackerley.ts",
    source: category.sourceLabel,
    notes: "Imports every winner card in the official archive. The two works marked Joint winner in 1983 are normalized as co-winners.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Ackerley Prize winners (${yearRange(records)}).`);
}

export function parseAckerley(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const starts = [...html.matchAll(/<div role="listitem"/g)].map((match) => match.index);
  const records: RawAwardRecord[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const block = html.slice(starts[index], starts[index + 1] ?? html.length);
    const titleArea = block.slice(block.indexOf("comp-jw7q6dfx"));
    const titleMatch = titleArea.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const detailStart = block.indexOf("comp-jw7q6dmi");
    if (!titleMatch || detailStart < 0) continue;

    const title = htmlToPlainText(titleMatch[1]);
    const detailElementStart = block.lastIndexOf("<div", detailStart);
    const detailLines = htmlToLines(block.slice(detailElementStart >= 0 ? detailElementStart : detailStart))
      .filter((line) => !/^(?:Joint winner|\u200b)$/i.test(line));
    const publicationLineIndex = detailLines.findIndex((line) => /\b(?:19|20)\d{2}$/.test(line));
    if (!title || publicationLineIndex < 1) continue;

    const publicationLine = detailLines[publicationLineIndex];
    const yearMatch = publicationLine.match(/\b((?:19|20)\d{2})$/);
    if (!yearMatch) continue;
    const authors = normalizeAuthorList(cleanText(detailLines.slice(0, publicationLineIndex).join(" ")));
    const publisher = cleanText(publicationLine.slice(0, yearMatch.index)).replace(/\s+$/, "");
    if (!authors.length) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: Number(yearMatch[1]),
      status: /Joint winner/i.test(block) ? "co_winner" : "winner",
      title,
      authors,
      publisher: publisher || undefined,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
    });
  }

  return records;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
