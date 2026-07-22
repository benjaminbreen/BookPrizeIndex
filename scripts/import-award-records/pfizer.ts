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

const pageTitle = "Pfizer Award";
const official2025Url = "https://hssonline.org/page/pfizeraward";

const titleOverrides = new Map<string, string>([
  ["1978:Merritt Roe Smith", "Harpers Ferry Armory and the New Technology: The Challenge of Change"],
  ["1991:John W. Servos", "Physical Chemistry from Ostwald to Pauling: The Making of a Science in America"],
  ["1999:Lorraine Daston and Katharine Park", "Wonders and the Order of Nature, 1150-1750"],
  ["2002:James A. Secord", "Victorian Sensation: The Extraordinary Publication, Reception, and Secret Authorship of Vestiges of the Natural History of Creation"],
]);

const authorOverrides = new Map<string, string[]>([
  ["1991:Servos, John W.", ["John W. Servos"]],
  ["2012:Dagmar Schaefer", ["Dagmar Schäfer"]],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "pfizer-award");
  const category = prize?.categories.find((entry) => entry.id === "pfizer-history-of-science");
  if (!prize || !category) throw new Error("Missing Pfizer Award registry entry");

  console.log(`Fetching ${pageTitle} recipients from MediaWiki...`);
  const historical = parsePfizer(prize, category, await fetchMediaWikiWikitext(pageTitle))
    .filter((record) => record.year !== 2025);
  const records = markSharedYears([...historical, official2025Record(prize, category)])
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  assertCoverage(records);

  await writeRawAwardRecords("pfizer.json", records, {
    importer: "scripts/import-award-records/pfizer.ts",
    source: category.sourceLabel,
    notes: "Imports the historical recipient list and replaces the latest winner with the History of Science Society's official archive row.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Pfizer Award winners (${yearRange(records)}).`);
}

export function parsePfizer(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = sectionBetween(wikitext, "Recipients", "References");
  const records: RawAwardRecord[] = [];

  for (const line of section.split("\n").map((item) => item.trim())) {
    const row = line.match(/^\*\s*((?:19|20)\d{2})\s+(.+)$/);
    if (!row) continue;
    const year = Number(row[1]);
    const body = prepareWikiText(row[2]).replace(/<ref[\s\S]*?<\/ref>/gi, "");
    const italicStart = body.indexOf("''");
    const authorPart = italicStart >= 0 ? body.slice(0, italicStart) : body.slice(0, body.indexOf(","));
    const authorText = cleanText(wikiToPlainText(authorPart.replace(/,\s*\[https?:[\s\S]*$/, "")).replace(/[,\s]+$/, ""));
    const authors = authorOverrides.get(`${year}:${authorText}`) ?? normalizeAuthorList(authorText);
    if (!authors.length) continue;

    const override = titleOverrides.get(`${year}:${authors.join(" and ")}`);
    const italicTitle = italicStart >= 0 ? body.slice(italicStart + 2).match(/^([\s\S]*?)''/)?.[1] : undefined;
    const title = normalizeTitle(cleanText(override ?? wikiToPlainText(italicTitle ?? "")).replace(/[.\s]+$/, ""));
    if (!title) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "winner",
      title,
      authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: category.officialUrl ? `Official archive: ${category.officialUrl}` : undefined,
    });
  }

  return markSharedYears(records);
}

function official2025Record(prize: PrizeRegistryEntry, category: PrizeCategoryRegistryEntry): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: 2025,
    status: "winner",
    title: "The Science of Reading: Information, Media, and Mind in Modern America",
    authors: ["Adrian Johns"],
    publisher: "University of Chicago Press",
    sourceUrl: official2025Url,
    sourceLabel: "History of Science Society official Pfizer Award archive",
    sourceConfidence: "official",
  };
}

function prepareWikiText(value: string) {
  return value.replace(/\{\{ill\|([^|{}]+)(?:\|[^{}]*)?\}\}/gi, "$1");
}

function normalizeTitle(value: string) {
  return value
    .replace(/\bofChemistry\b/, "of Chemistry")
    .replace(/^Picturing the book of nature:/, "Picturing the Book of Nature:")
    .replace(/^Observing by Hand\. Sketching/, "Observing by Hand: Sketching")
    .replace(/^Ritual Geology\. Gold/, "Ritual Geology: Gold");
}

function markSharedYears(records: RawAwardRecord[]) {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  return records.map((record) => ({
    ...record,
    status: counts.get(record.year)! > 1 ? "co_winner" as const : "winner" as const,
  }));
}

function sectionBetween(wikitext: string, startLabel: string, endLabel: string) {
  const start = wikitext.search(new RegExp(`^==\\s*${startLabel}\\s*==\\s*$`, "mi"));
  const end = wikitext.search(new RegExp(`^==\\s*${endLabel}\\s*==\\s*$`, "mi"));
  if (start < 0 || end <= start) throw new Error(`Could not find ${startLabel} section`);
  return wikitext.slice(start, end);
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 69) throw new Error(`Expected at least 69 Pfizer winners, got ${records.length}`);
  if (yearRange(records) !== "1959-2025") throw new Error(`Unexpected Pfizer range: ${yearRange(records)}`);
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
