import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "overseas-press-club-awards");
  const category = prize?.categories.find((entry) => entry.id === "cornelius-ryan-award");
  if (!prize || !category) throw new Error("Missing Cornelius Ryan Award registry entry");

  console.log(`Fetching Cornelius Ryan Award archive from ${category.sourceUrl}...`);
  const archivePages = await Promise.all(
    Array.from({ length: 5 }, (_, index) => fetchHtml(archivePageUrl(category.sourceUrl, index + 1))),
  );
  const detailUrls = [...new Set(archivePages.flatMap(parseCorneliusRyanLinks))];
  const detailPages = await fetchInBatches(detailUrls, 4);
  const records = detailPages
    .map(({ url, html }) => parseCorneliusRyanPage(prize, category, html, url))
    .filter((record): record is RawAwardRecord => Boolean(record));
  if (records.length < 20) throw new Error(`Cornelius Ryan parser returned only ${records.length} records`);
  records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  await writeRawAwardRecords("cornelius-ryan.json", records, {
    importer: "scripts/import-award-records/cornelius-ryan.ts",
    source: category.sourceLabel,
    notes: "Imports winners from official archive entries explicitly titled Cornelius Ryan Award. Earlier Best Book on Foreign Affairs records are a predecessor category and are not folded into this program.",
    archiveEntries: detailUrls.length,
    records: records.length,
    skippedEmptyOrUnstructuredEntries: detailUrls.length - records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Cornelius Ryan Award winners (${yearRange(records)}).`);
}

export function parseCorneliusRyanLinks(html: string) {
  const urls: string[] = [];
  for (const match of html.matchAll(/<h3 class="h2 entry-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = htmlToPlainText(match[2]);
    if (/Cornelius Ryan Award/i.test(title)) urls.push(match[1]);
  }
  return urls;
}

export function parseCorneliusRyanPage(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  sourceUrl: string,
): RawAwardRecord | undefined {
  const start = html.indexOf('<section class="entry-content');
  const end = html.indexOf("</section>", start);
  if (start < 0 || end < 0) return undefined;
  const text = htmlToPlainText(html.slice(start, end));
  const year = text.match(/(?:AWARD )?(?:YEAR|DATE):\s*((?:19|20)\d{2})/i)?.[1];
  const author = text.match(/(?:AWARD )?RECIPIENT:\s*(.*?)\s+(?:AWARD RECIPIENT AFFILIATION|AFFILIATION):/i)?.[1];
  const publisher = text.match(/(?:AWARD RECIPIENT AFFILIATION|AFFILIATION):\s*(.*?)\s+(?:AWARD )?HONORED WORK:/i)?.[1];
  const title = text.match(/(?:AWARD )?HONORED WORK:\s*[“"]([^”"]+)[”"]/i)?.[1]
    ?? text.match(/(?:AWARD )?HONORED WORK:\s*(.*?)\s+AWARD SPONSOR:/i)?.[1];
  if (!year || !author || !title) return undefined;

  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: Number(year),
    status: "winner",
    title: cleanText(title),
    authors: splitCorneliusAuthors(author),
    publisher: publisher ? cleanText(publisher) : undefined,
    sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official award URL: ${category.officialUrl}` : undefined,
  };
}

function splitCorneliusAuthors(input: string) {
  return normalizeAuthorList(input)
    .flatMap((author) => author.split(/,\s*(?!Jr\.?\b|Sr\.?\b|III\b|IV\b)/i))
    .map(cleanText)
    .filter(Boolean);
}

async function fetchInBatches(urls: string[], batchSize: number) {
  const output: Array<{ url: string; html: string }> = [];
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    output.push(...await Promise.all(batch.map(async (url) => ({ url, html: await fetchHtml(url) }))));
  }
  return output;
}

function archivePageUrl(sourceUrl: string, page: number) {
  return page === 1 ? sourceUrl : `${sourceUrl.replace(/\/$/, "")}/page/${page}/`;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "unknown";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
