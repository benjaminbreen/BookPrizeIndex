import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  readPrizeRegistry,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const prizeId = "james-beard-book-awards";

/**
 * jamesbeard.org's awards search is a client-side JavaScript application with no
 * server-rendered records and no discoverable JSON endpoint, so the four Wikipedia decade
 * pages are used instead. Each record keeps its own decade page as `sourceUrl`.
 */
const decadePages = [
  "James Beard Foundation Award: 1990s",
  "James Beard Foundation Award: 2000s",
  "James Beard Foundation Award: 2010s",
  "James Beard Foundation Award: 2020s",
];

export function decadePageUrl(pageTitle: string) {
  return `https://en.wikipedia.org/wiki/${pageTitle.replace(/ /g, "_")}`;
}

/**
 * The Foundation renames its Book Award categories almost every year, so the parser resolves
 * an observed category name to a registry lineage by alias table rather than exact match.
 * Keys are normalized (lowercased, "&" -> "and", collapsed whitespace, trailing punctuation
 * stripped) by `normalizeCategoryName`.
 */
const categoryAliases = new Map<string, string>([
  // beard-writing
  ["writings on food", "beard-writing"],
  ["writing on food", "beard-writing"],
  ["writing and reference", "beard-writing"],
  ["literary writing about food, wine and spirits", "beard-writing"],
  ["writing and literature", "beard-writing"],
  ["nonfiction", "beard-writing"],
  ["writing", "beard-writing"],
  ["literary writing", "beard-writing"],
  ["literacy writing", "beard-writing"], // typo in the source for 2023-2024
  // beard-reference-and-scholarship
  ["references and resources", "beard-reference-and-scholarship"],
  ["technical and reference", "beard-reference-and-scholarship"],
  ["food reference and technique", "beard-reference-and-scholarship"],
  ["reference and food guides", "beard-reference-and-scholarship"],
  ["reference and writings on food", "beard-reference-and-scholarship"],
  ["reference", "beard-reference-and-scholarship"],
  ["reference and scholarship", "beard-reference-and-scholarship"],
  ["reference, history, and scholarship", "beard-reference-and-scholarship"],
  // beard-food-issues-and-advocacy
  ["food issues and advocacy", "beard-food-issues-and-advocacy"],
]);

/**
 * Every other Book Award category observed across the four decade pages. These are cookbook,
 * beverage, photography, or lifetime-honor categories and are out of scope for a narrative
 * nonfiction index. An unrecognised name that is in neither table is a hard error: that is how
 * this importer notices the Foundation inventing yet another category name.
 */
const ignoredCategories = new Set<string>([
  "accent on flavors",
  "american cooking",
  "american regional",
  "americana",
  "asian cooking",
  "baking",
  "baking and dessert",
  "baking and desserts",
  "best food photography",
  "beverage",
  "beverage with recipes",
  "beverage without recipes",
  "beverages without recipes",
  "book awards hall of fame",
  "book of the year",
  "bread",
  "chefs and restaurants",
  "convenience",
  "cookbook hall of fame",
  "cookbook of the year",
  "cooking from a professional point of view",
  "cooking of the americas",
  "emerging voice",
  "emerging voice in books",
  "emerging voices",
  "entertaining",
  "entertaining and special occasions",
  "every day cooking",
  "focus on health",
  "food of the americas",
  "food of the mediterranean",
  "foods of americas",
  "fruits and vegetables",
  "fruits, vegetables and grains",
  "general",
  "general cooking",
  "general interest",
  "general/cooking for everyday",
  "health",
  "health and diet",
  "health and special diets",
  "healthier living",
  "healthy focus",
  "international",
  "italian",
  "kitchenaid cookbook hall of fame",
  "kitchenaid cookbook of the year",
  "light and healthy",
  "mediterranean",
  "photography",
  "professional and restaurant",
  "quick and easy",
  "regional american",
  "restaurant and professional",
  "restaurants and chefs",
  "single subject",
  "special occasions",
  "techniques",
  "tool and techniques",
  "tools and techniques",
  "u.s. foodways",
  "us foodways",
  "vegetable cooking",
  "vegetable focused and vegetarian",
  "vegetable-focused cooking",
  "vegetables and vegetarian",
  "vegetarian",
  "vegetarian/healthy focus",
  "visuals",
  "wine and spirits",
]);

/**
 * Hall-of-Fame bullets sometimes inline the honoree into the category cell (no colon, no
 * italics), so the normalized name absorbs the name. These are ignored honours, not books.
 */
const ignoredCategoryPrefixes = ["cookbook hall of fame", "book awards hall of fame", "emerging voice"];

/** Corrections for specific observed source defects. */
const authorOverrides = new Map<string, string[]>([
  // 2019 writing: the source link is [[Edward Lee (chef)]], whose display text keeps the
  // disambiguator.
  ["2019:beard-writing", ["Edward Lee"]],
]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  if (!prize) throw new Error(`Missing ${prizeId} registry entry`);
  const categories = new Map<string, PrizeCategoryRegistryEntry>();
  for (const id of ["beard-writing", "beard-reference-and-scholarship", "beard-food-issues-and-advocacy"]) {
    const category = prize.categories.find((entry) => entry.id === id);
    if (!category) throw new Error(`Missing ${prizeId} category ${id}`);
    categories.set(id, category);
  }

  const records: RawAwardRecord[] = [];
  for (const pageTitle of decadePages) {
    console.log(`Fetching ${pageTitle} from MediaWiki...`);
    const wikitext = await fetchMediaWikiWikitext(pageTitle);
    records.push(...parseJamesBeardDecade(prize, categories, wikitext, decadePageUrl(pageTitle)));
  }

  records.sort((a, b) => b.year - a.year || a.categoryId.localeCompare(b.categoryId));
  assertCoverage(records);

  await writeRawAwardRecords("james-beard-book-awards.json", records, {
    importer: "scripts/import-award-records/james-beard-book-awards.ts",
    source: "Wikipedia: James Beard Foundation Award decade pages (1990s-2020s)",
    notes:
      "jamesbeard.org's awards search is a client-side JavaScript application with no " +
      "server-rendered records and no discoverable JSON endpoint, so the four Wikipedia decade " +
      "pages are used as a deterministic secondary source. Only the three narrative-prose " +
      "lineages are kept; the cookbook, beverage, photography, and lifetime-honor categories are " +
      "explicitly ignored. Category names are resolved through an alias table, and an unknown " +
      "Book Awards category name is a hard error. Winners only — the decade pages publish no " +
      "finalists. Official archive: https://www.jamesbeard.org/awards/media-awards/book-awards",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    yearRange: yearRange(records),
    byCategory: Object.fromEntries(
      [...categories.keys()].map((id) => [id, records.filter((record) => record.categoryId === id).length]),
    ),
    coverageNotes:
      "The 2021 Book Awards were cancelled because of COVID-19, so 2021 is a genuine gap. " +
      "Several individual lineage/year combinations are also absent because the Foundation did " +
      "not run that category that year.",
  });
  console.log(`Imported ${records.length} James Beard book award winners (${yearRange(records)}).`);
}

export function parseJamesBeardDecade(
  prize: PrizeRegistryEntry,
  categories: Map<string, PrizeCategoryRegistryEntry>,
  wikitext: string,
  sourceUrl: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];

  for (const match of wikitext.matchAll(/^==\s*((?:19|20)\d{2}) awards\s*==\s*$/gm)) {
    const year = Number(match[1]);
    const start = match.index! + match[0].length;
    const rest = wikitext.slice(start);
    const nextTop = rest.search(/^==[^=]/m);
    const section = nextTop < 0 ? rest : rest.slice(0, nextTop);

    const heading = section.match(/^===+\s*Book Awards\s*===+\s*$/m);
    if (!heading) continue;
    const afterHeading = section.slice(heading.index! + heading[0].length);
    const nextSub = afterHeading.search(/^===?[^=]/m);
    const body = nextSub < 0 ? afterHeading : afterHeading.slice(0, nextSub);

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("*")) continue;
      const bullet = stripRefs(line.replace(/^\*+\s*/, "")).trim();
      if (!bullet) continue;

      const split = splitCategory(bullet);
      if (!split) continue;
      const key = normalizeCategoryName(split.name);
      if (!key) continue;

      const categoryId = categoryAliases.get(key);
      if (!categoryId) {
        if (ignoredCategories.has(key)) continue;
        if (ignoredCategoryPrefixes.some((prefix) => key.startsWith(prefix))) continue;
        throw new Error(
          `Unknown James Beard Book Awards category "${split.name}" (normalized "${key}") in ${year}. ` +
          "Add it to the alias table or the ignore list.",
        );
      }
      const category = categories.get(categoryId);
      if (!category) throw new Error(`Alias table points at missing category ${categoryId}`);

      const parsed = parseBookRow(year, categoryId, split.rest);
      if (!parsed) continue;

      records.push({
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year,
        status: "winner",
        title: parsed.title,
        authors: parsed.authors,
        publisher: parsed.publisher,
        sourceUrl,
        sourceLabel: category.sourceLabel,
        sourceConfidence: category.sourceConfidence,
        notes: `Source category label: ${split.name}`,
      });
    }
  }

  return records;
}

/**
 * Bullets read `* Category: ''Title'' by Author (Publisher)`, but 2017-2019 drop the colon
 * after the category name, so fall back to a lookahead on the opening italics.
 */
function splitCategory(bullet: string) {
  const colon = bullet.indexOf(":");
  const italic = bullet.indexOf("''");
  if (italic >= 0 && (colon < 0 || italic < colon)) {
    return { name: bullet.slice(0, italic).trim(), rest: bullet.slice(italic).trim() };
  }
  if (colon >= 0) return { name: bullet.slice(0, colon).trim(), rest: bullet.slice(colon + 1).trim() };
  return undefined;
}

export function normalizeCategoryName(name: string) {
  return cleanText(name.replace(/&/g, " and ").replace(/'{2,}/g, " "))
    .toLowerCase()
    .replace(/[.,:;]+$/, "")
    .trim();
}

function parseBookRow(year: number, categoryId: string, rest: string) {
  // 2025 Literary Writing renders the category separator as bold-italic markup: ''':''' ''Title''
  let body = rest.replace(/^\s*'{3}\s*:?\s*'{3}\s*/, "").replace(/^[\s:,]+/, "").trim();
  if (!body) return undefined;

  let title: string;
  let remainder: string;
  if (body.startsWith("''")) {
    const inner = body.slice(2).match(/^([\s\S]*?)''/);
    if (!inner) throw new Error(`Unterminated italics in ${year} ${categoryId}: ${rest}`);
    title = cleanText(wikiToPlainText(inner[1]));
    remainder = body.slice(2 + inner[1].length + 2);
  } else {
    // 2004 and 2008 bullets omit the italics entirely.
    const byIndex = findByIndex(body);
    if (byIndex < 0) throw new Error(`Could not split title/author in ${year} ${categoryId}: ${rest}`);
    title = cleanText(wikiToPlainText(body.slice(0, byIndex)));
    remainder = body.slice(byIndex);
  }

  // 2013 Writing and Literature italicises the author along with the title
  // ("''Yes, Chef: A Memoir by [[Marcus Samuelsson]]''").
  if (findByIndex(remainder) < 0) {
    const inTitle = findByIndex(title);
    if (inTitle > 0) {
      remainder = title.slice(inTitle);
      title = cleanText(title.slice(0, inTitle));
    }
  }

  title = title.replace(/[.,\s]+$/, "");
  if (!title) throw new Error(`No title parsed in ${year} ${categoryId}: ${rest}`);

  let authorText = remainder.replace(/^[\s,]+/, "");
  const byIndex = findByIndex(authorText);
  if (byIndex !== 0) {
    if (byIndex < 0) throw new Error(`No author segment in ${year} ${categoryId}: ${rest}`);
    authorText = authorText.slice(byIndex);
  }
  authorText = authorText.replace(/^b\s*y\b\s*/i, "");

  let publisher: string | undefined;
  const paren = authorText.match(/\(([^()]+)\)\s*$/);
  if (paren) {
    publisher = cleanText(wikiToPlainText(paren[1])) || undefined;
    authorText = authorText.slice(0, paren.index).trim();
  }

  const authors = authorOverrides.get(`${year}:${categoryId}`)
    ?? cleanText(wikiToPlainText(authorText))
      .split(/,\s*|\s+and\s+|\s*&\s*|\s+with\s+/)
      .map((item) => cleanText(item))
      .filter(Boolean);
  if (!authors.length) throw new Error(`No authors parsed in ${year} ${categoryId}: ${rest}`);

  return { title, authors, publisher };
}

/** Index of the " by " author separator, tolerating the "b y" typo on the 2023 row. */
function findByIndex(value: string) {
  const match = value.match(/(?:^|\s)b\s*y\s+/i);
  return match ? match.index! + (match[0].startsWith(" ") ? 1 : 0) : -1;
}

function stripRefs(value: string) {
  return value.replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<ref[^>]*\/>/gi, "");
}

export function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 60) throw new Error(`Expected at least 60 James Beard book records, got ${records.length}`);
  if (yearRange(records) !== "1991-2026") throw new Error(`Unexpected James Beard range: ${yearRange(records)}`);
  const cancelled = records.filter((record) => record.year === 2021);
  if (cancelled.length) throw new Error(`2021 James Beard Book Awards were cancelled, got ${cancelled.length} records`);
  for (const id of ["beard-writing", "beard-reference-and-scholarship", "beard-food-issues-and-advocacy"]) {
    if (!records.some((record) => record.categoryId === id)) throw new Error(`No James Beard records for ${id}`);
  }
  if (records.some((record) => record.status !== "winner")) throw new Error("James Beard import should be winners only");
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
