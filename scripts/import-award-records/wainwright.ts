import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  fetchMediaWikiWikitext,
  htmlToLines,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const official2024Url = "https://wainwrightprize.com/news/2024-winners-announced/";
const official2025Url = "https://wainwrightprize.com/news/the-2025-wainwright-prize-winners/";
const wikipediaSourceUrl = "https://en.wikipedia.org/wiki/Wainwright_Prize";
const longlistPages = [
  { year: 2021, url: "https://wainwrightprize.com/news/longlist-2021-announced/" },
  { year: 2022, url: "https://wainwrightprize.com/news/james-cropper-wainwright-prize-2022-longlists-announced/" },
  { year: 2023, categoryId: "wainwright-nature-writing", url: "https://wainwrightprize.com/news/nature-writing-longlist/" },
  { year: 2023, categoryId: "wainwright-conservation-writing", url: "https://wainwrightprize.com/news/writing-on-conservation-longlist/" },
  { year: 2024, url: "https://wainwrightprize.com/news/the-wainwright-prize-longlists-announcement/" },
  { year: 2025, url: "https://wainwrightprize.com/news/longlists-and-judging-panels-announced-for-2025-wainwright-prizes/" },
] as const;

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "wainwright-prize");
  const nature = prize?.categories.find((entry) => entry.id === "wainwright-nature-writing");
  const conservation = prize?.categories.find((entry) => entry.id === "wainwright-conservation-writing");
  if (!prize || !nature || !conservation) throw new Error("Missing Wainwright Prize registry entries");

  console.log("Fetching Wainwright Prize adult winner archives...");
  const [natureHtml, conservationHtml] = await Promise.all([
    fetchHtml(nature.sourceUrl),
    fetchHtml(conservation.sourceUrl),
  ]);
  const winners = [
    ...parseWainwrightArchive(prize, nature, natureHtml),
    ...parseWainwrightArchive(prize, conservation, conservationHtml),
  ].filter((record) => record.year < 2024).concat(recentOfficialRecords(prize, nature, conservation));
  assertWinnerCoverage(winners);

  console.log("Fetching Wainwright adult shortlists and official longlists...");
  const shortlistCandidates = parseWainwrightShortlists(prize, nature, conservation, await fetchMediaWikiWikitext("Wainwright Prize"));
  const longlistHtml = await Promise.all(longlistPages.map((page) => fetchHtml(page.url)));
  const categoryById = new Map([nature, conservation].map((category) => [category.id, category]));
  const longlistCandidates = longlistPages.flatMap((page, index) => {
    const categories = "categoryId" in page ? [categoryById.get(page.categoryId)!] : [nature, conservation];
    return categories.flatMap((category) => parseWainwrightLonglist(prize, category, longlistHtml[index], page.year, page.url));
  });

  const winnerKeys = new Set(winners.map(statusKey));
  const shortlists = shortlistCandidates.filter((record) => !winnerKeys.has(statusKey(record)));
  const higherStatusRecords = [...winners, ...shortlists];
  const longlists = longlistCandidates.filter((record) => !higherStatusRecords.some((higher) => sameWork(record, higher)));
  const records = [...winners, ...shortlists, ...longlists]
    .sort((a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("wainwright.json", records, {
    importer: "scripts/import-award-records/wainwright.ts",
    source: "Official Wainwright Prize archives and announcements, plus the cited Wikipedia shortlist table",
    notes: "Imports adult Nature Writing and Conservation Writing winners, 2014-2025 shortlists, and official 2021-2025 longlists. Each book retains only its highest status. Children's and illustrated-book prizes are excluded.",
    records: records.length,
    winners: winners.length,
    shortlisted: shortlists.length,
    longlisted: longlists.length,
    categories: [nature, conservation].map((category) => {
      const categoryRecords = records.filter((record) => record.categoryId === category.id);
      return {
        categoryId: category.id,
        records: categoryRecords.length,
        yearRange: yearRange(categoryRecords),
      };
    }),
  });
  console.log(`Imported ${winners.length} Wainwright winners, ${shortlists.length} shortlist-only books, and ${longlists.length} longlist-only books.`);
}

export function parseWainwrightArchive(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  const pattern = /<h5\b[^>]*>\s*<span>((?:19|20)\d{2})<\/span>\s*Winner\s*<\/h5>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<h5\b[^>]*>([\s\S]*?)<\/h5>/gi;

  for (const match of html.matchAll(pattern)) {
    const authors = normalizeAuthorList(htmlToPlainText(match[2]));
    const year = Number(match[1]);
    const title = canonicalWinnerTitle(year, category.id, htmlToPlainText(match[3]));
    if (!authors.length || !title) continue;
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
    });
  }

  return records;
}

function canonicalWinnerTitle(year: number, categoryId: string, title: string) {
  if (title === "Diary of A Young Naturalist") return "Diary of a Young Naturalist";
  const corrections: Record<string, string> = {
    "2014:wainwright-nature-writing": "The Green Road into the Trees: A Walk Through England",
    "2020:wainwright-nature-writing": "Diary of a Young Naturalist",
    "2020:wainwright-conservation-writing": "Rebirding: Restoring Britain's Wildlife",
    "2021:wainwright-nature-writing": "English Pastoral: An Inheritance",
    "2022:wainwright-nature-writing": "Goshawk Summer: A New Forest Season Unlike Any Other",
    "2022:wainwright-conservation-writing": "Eating to Extinction: The World's Rarest Foods and Why We Need to Save Them",
    "2023:wainwright-nature-writing": "The Flow: Rivers, Water and Wildness",
  };
  return corrections[`${year}:${categoryId}`] ?? title;
}

export function parseWainwrightShortlists(
  prize: PrizeRegistryEntry,
  nature: PrizeCategoryRegistryEntry,
  conservation: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const sectionStart = wikitext.indexOf("==Winners and shortlisted titles==");
  const sectionEnd = wikitext.indexOf("==References==", sectionStart);
  if (sectionStart < 0 || sectionEnd < 0) throw new Error("Could not find Wainwright shortlist tables");

  const records: RawAwardRecord[] = [];
  let year: number | undefined;
  let category: PrizeCategoryRegistryEntry | undefined;
  for (const rawRow of wikitext.slice(sectionStart, sectionEnd).split(/\n\|-/).slice(1)) {
    const rawCells = parseWikiCells(rawRow);
    if (rawCells.length < 3) continue;
    const cells = rawCells.map((cell) => wikiToPlainText(stripCellAttributes(cell)));
    const firstYear = cells[0].match(/\b(20\d{2})\b/);
    let cursor = 0;
    if (firstYear) {
      year = Number(firstYear[1]);
      cursor = 1;
      const label = cells[0].toLowerCase();
      if (/children|illustrative|picture|fiction/.test(label)) category = undefined;
      else if (/conservation/.test(label)) category = conservation;
      else category = nature;
    }
    if (!year || year > 2025 || !category || rawCells.length - cursor < 2) continue;
    const authorCell = rawCells[cursor]
      .replace(/<small\b[^>]*>[\s\S]*?<\/small>/gi, "")
      .replace(/<br\s*\/?\s*>/gi, " ");
    const authors = normalizeAuthorList(cleanText(wikiToPlainText(stripCellAttributes(authorCell)).replace(/\s*\*\s*$/, "")));
    const title = cleanText(cells[cursor + 1].replace(/\s+\(book\)$/i, ""));
    if (!authors.length || !title || /^(?:author|book)$/i.test(title)) continue;
    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "shortlist",
      title,
      authors,
      sourceUrl: wikipediaSourceUrl,
      sourceLabel: "Wikipedia Wainwright Prize shortlist table, citing annual official announcements",
      sourceConfidence: "secondary",
      notes: "The table row cites the corresponding official Wainwright Prize shortlist announcement.",
    });
  }
  return uniqueByStatusKey(records);
}

export function parseWainwrightLonglist(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  year: number,
  sourceUrl: string,
): RawAwardRecord[] {
  const parsed = year === 2023
    ? parse2023LonglistBlocks(html)
    : parseLonglistLines(htmlToLines(html), category, year);
  const expected = new Map([
    ["2021:wainwright-nature-writing", 13],
    ["2021:wainwright-conservation-writing", 12],
    ["2022:wainwright-nature-writing", 12],
    ["2022:wainwright-conservation-writing", 13],
    ["2023:wainwright-nature-writing", 12],
    ["2023:wainwright-conservation-writing", 12],
    ["2024:wainwright-nature-writing", 12],
    ["2024:wainwright-conservation-writing", 11],
    ["2025:wainwright-nature-writing", 12],
    ["2025:wainwright-conservation-writing", 12],
  ]).get(`${year}:${category.id}`);
  const normalized = expected === undefined ? parsed : parsed.slice(0, expected);
  if (expected !== undefined && normalized.length !== expected) {
    throw new Error(`Expected ${expected} Wainwright ${category.name} longlist books for ${year}, got ${normalized.length}`);
  }
  return normalized.map(({ title, authors, publisher }) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status: "longlist",
    title,
    authors,
    publisher,
    sourceUrl,
    sourceLabel: `Wainwright Prize official ${year} ${category.name} longlist`,
    sourceConfidence: "official",
  }));
}

function parseLonglistLines(lines: string[], category: PrizeCategoryRegistryEntry, year: number) {
  const isNature = category.id === "wainwright-nature-writing";
  const heading = (line: string) => {
    const lower = line.toLowerCase();
    if (year === 2025) return isNature ? lower === "the wainwright prize for nature writing" : lower === "the wainwright prize for conservation writing";
    if (!lower.includes(String(year))) return false;
    return isNature
      ? /(?:uk )?nature writing.*longlist/.test(lower)
      : /writing on (?:global )?conservation.*(?:longlist| is:)/.test(lower);
  };
  const otherHeading = (line: string) => {
    const lower = line.toLowerCase();
    return isNature ? /prize for (?:writing on )?(?:global )?conservation/.test(lower) : /children|illustrative/.test(lower);
  };
  const records: Array<{ title: string; authors: string[]; publisher?: string }> = [];
  let active = false;
  for (const line of lines) {
    if (heading(line)) {
      active = true;
      continue;
    }
    if (active && otherHeading(line)) active = false;
    if (!active) continue;
    if (year !== 2021 && !/\([^()]+\)\s*$/.test(line)) continue;
    if (year === 2021 && (line.match(/,/g)?.length ?? 0) < 2) continue;
    const parsed = parseBookLine(line, year === 2021);
    if (parsed) records.push(parsed);
  }
  return uniqueParsed(records);
}

function parse2023LonglistBlocks(html: string) {
  const records: Array<{ title: string; authors: string[]; publisher?: string }> = [];
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (!/<b\b/i.test(match[1])) continue;
    const parsed = parseBookLine(htmlToPlainText(match[1]), false);
    if (parsed) records.push(parsed);
  }
  return uniqueParsed(records);
}

function parseBookLine(line: string, commaPublisher: boolean) {
  let body = cleanText(line);
  let publisher: string | undefined;
  const publisherMatch = body.match(/\s*\(([^()]*)\)\s*$/);
  if (publisherMatch) {
    publisher = cleanText(publisherMatch[1]);
    body = cleanText(body.slice(0, publisherMatch.index));
  } else if (commaPublisher) {
    const publisherComma = body.lastIndexOf(",");
    if (publisherComma < 0) return undefined;
    publisher = cleanText(body.slice(publisherComma + 1));
    body = cleanText(body.slice(0, publisherComma));
  }
  body = body.replace(/,\s*(?:translated|illustrated)\s+by\b[\s\S]*$/i, "");
  const comma = body.lastIndexOf(",");
  if (comma < 1) return undefined;
  const title = cleanText(body.slice(0, comma));
  const authorText = cleanText(body.slice(comma + 1).replace(/^written by\s+/i, "").replace(/\s*&\s*translated by\b[\s\S]*$/i, "").replace(/Patrick B\s+arkham/i, "Patrick Barkham"));
  const authors = normalizeAuthorList(authorText.replace(/^Dr\s+/i, ""));
  if (!title || !authors.length || title.length > 180) return undefined;
  return { title, authors, publisher };
}

function parseWikiCells(rowBody: string) {
  const cells: string[] = [];
  let current: string[] = [];
  for (const rawLine of rowBody.split("\n")) {
    const line = rawLine.trimEnd();
    if (!/^[!|]/.test(line)) {
      if (current.length) current.push(line);
      continue;
    }
    if (current.length) cells.push(current.join("\n"));
    current = [];
    const marker = line.startsWith("!") ? "!" : "|";
    const delimiter = marker === "!" ? "!!" : "||";
    const inline = line.replace(/^[!|]\s*/, "").split(delimiter).map((cell) => cell.trim()).filter(Boolean);
    current = [inline.shift() ?? ""];
    for (const cell of inline) {
      cells.push(current.join("\n"));
      current = [cell];
    }
  }
  if (current.length) cells.push(current.join("\n"));
  return cells.map((cell) => cell.trim()).filter(Boolean);
}

function uniqueParsed<T extends { title: string }>(records: T[]) {
  return [...new Map(records.map((record) => [slugify(record.title), record])).values()];
}

function uniqueByStatusKey(records: RawAwardRecord[]) {
  return [...new Map(records.map((record) => [statusKey(record), record])).values()];
}

function statusKey(record: Pick<RawAwardRecord, "categoryId" | "year" | "title">) {
  return `${record.categoryId}:${record.year}:${slugify(record.title)}`;
}

function sameWork(left: RawAwardRecord, right: RawAwardRecord) {
  if (left.categoryId !== right.categoryId || left.year !== right.year) return false;
  const leftTitle = slugify(left.title);
  const rightTitle = slugify(right.title);
  if (leftTitle === rightTitle) return true;
  const sameAuthors = left.authors.map(slugify).sort().join("|") === right.authors.map(slugify).sort().join("|");
  return sameAuthors && (leftTitle.startsWith(`${rightTitle}-`) || rightTitle.startsWith(`${leftTitle}-`));
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  if (status === "longlist") return 3;
  return 9;
}

function recentOfficialRecords(
  prize: PrizeRegistryEntry,
  nature: PrizeCategoryRegistryEntry,
  conservation: PrizeCategoryRegistryEntry,
): RawAwardRecord[] {
  const rows = [
    { category: nature, year: 2024, title: "Late Light: The Secret Wonders of a Disappearing World", authors: ["Michael Malay"], sourceUrl: official2024Url },
    { category: conservation, year: 2024, title: "Blue Machine: How the Ocean Shapes Our World", authors: ["Helen Czerski"], sourceUrl: official2024Url },
    { category: nature, year: 2025, title: "Raising Hare", authors: ["Chloe Dalton"], sourceUrl: official2025Url },
    { category: conservation, year: 2025, title: "The Lie of the Land", authors: ["Guy Shrubsole"], sourceUrl: official2025Url },
  ];
  return rows.map(({ category, year, title, authors, sourceUrl }) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status: "winner",
    title,
    authors,
    sourceUrl,
    sourceLabel: `Wainwright Prize official ${year} winners announcement`,
    sourceConfidence: "official",
  }));
}

function assertWinnerCoverage(records: RawAwardRecord[]) {
  const nature = records.filter((record) => record.categoryId === "wainwright-nature-writing");
  const conservation = records.filter((record) => record.categoryId === "wainwright-conservation-writing");
  if (nature.length !== 12 || yearRange(nature) !== "2014-2025") {
    throw new Error(`Unexpected Wainwright Nature Writing coverage: ${nature.length} (${yearRange(nature)})`);
  }
  if (conservation.length !== 6 || yearRange(conservation) !== "2020-2025") {
    throw new Error(`Unexpected Wainwright Conservation coverage: ${conservation.length} (${yearRange(conservation)})`);
  }
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
