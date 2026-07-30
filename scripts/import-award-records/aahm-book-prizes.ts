import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
} from "../../lib/award-records";
import {
  cleanText,
  decodeHtmlEntities,
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

const welchPrizeId = "william-h-welch-medal";
const welchCategoryId = "welch-medical-history";
const rosenPrizeId = "george-rosen-prize";
const rosenCategoryId = "rosen-public-health-social-medicine-book";

// The canonical AAHM pages are sometimes protected by a Cloudflare interstitial.
// This legacy hostname serves the same WordPress pages and declares the canonical
// histmed.org URLs in their metadata.
const welchFetchUrl = "https://rrc.umo.mybluehost.me/past-welch-winners/";
const rosenFetchUrl = "https://rrc.umo.mybluehost.me/george-rosen-prize/";

type ReviewedBook = {
  year: number;
  title: string;
  authors: string[];
  publisher?: string;
};

const welchMultiBookRows = new Map<number, ReviewedBook[]>([
  [1987, [
    {
      year: 1987,
      title: "American Medicine and Statistical Thinking, 1800-1860",
      authors: ["James H. Cassedy"],
      publisher: "Harvard University Press",
    },
    {
      year: 1987,
      title: "Medicine and American Growth, 1800-1860",
      authors: ["James H. Cassedy"],
      publisher: "University of Wisconsin Press",
    },
  ]],
  [1986, [
    {
      year: 1986,
      title: "The State and the Mentally Ill: A History of the Worcester State Hospital",
      authors: ["Gerald N. Grob"],
      publisher: "University of North Carolina Press",
    },
    {
      year: 1986,
      title: "Mental Institutions in America",
      authors: ["Gerald N. Grob"],
      publisher: "Free Press",
    },
    {
      year: 1986,
      title: "Mental Illness and American Society, 1897-1940",
      authors: ["Gerald N. Grob"],
      publisher: "Princeton University Press",
    },
  ]],
  [1976, [
    {
      year: 1976,
      title: "Addison and the White Corpuscles",
      authors: ["Lelland J. Rather"],
      publisher: "University of California Press",
    },
    {
      year: 1976,
      title: "Mind and Body in Eighteenth-Century Medicine",
      authors: ["Lelland J. Rather"],
      publisher: "University of California Press",
    },
  ]],
]);

const olderWelchBookYears = new Set([
  1979, 1978, 1976, 1973, 1972, 1969, 1968, 1967, 1966, 1962, 1958, 1956, 1954,
]);

const welchAuthorOverrides = new Map<number, string[]>([
  [2014, ["Julie Livingston"]],
  [2006, ["Barron H. Lerner"]],
  [1967, ["Howard B. Adelmann"]],
  [1966, ["Whitfield J. Bell, Jr."]],
]);

const rosenBookRows: ReviewedBook[] = [
  {
    year: 2026,
    title: "Starved for Light: The Long Shadow of Rickets and Vitamin D Deficiency",
    authors: ["Christian Warren"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2024,
    title: "Dangerous Medicines: The Story Behind Human Experiments with Hepatitis",
    authors: ["Sydney Halpern"],
    publisher: "Yale University Press",
  },
  {
    year: 2022,
    title: "Diabetes: A History of Race and Disease",
    authors: ["Arleen M. Tuchman"],
    publisher: "Yale University Press",
  },
  {
    year: 2021,
    title: "The Oxford Handbook of Disability History",
    authors: ["Michael Rembis", "Catherine Kudlick", "Kim E. Nielsen"],
    publisher: "Oxford University Press",
  },
  {
    year: 2020,
    title: "The Lomidine Files: The Untold Story of a Medical Disaster",
    authors: ["Guillaume Lachenal"],
    publisher: "Johns Hopkins University Press",
  },
  {
    year: 2018,
    title: "Plague and Empire in the Early Modern Mediterranean World: The Ottoman Experience, 1347-1600",
    authors: ["Nükhet Varlik"],
    publisher: "Cambridge University Press",
  },
  {
    year: 2017,
    title: "Medicine and Public Health in Latin America: A History",
    authors: ["Marcos Cueto", "Steven Palmer"],
    publisher: "Cambridge University Press",
  },
  {
    year: 2016,
    title: "Disease, War, and the Imperial State: The Welfare of the British Armed Forces during the Seven Years’ War",
    authors: ["Erica Charters"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2015,
    title: "Marrow of Tragedy: The Health Crisis of the American Civil War",
    authors: ["Margaret Humphreys"],
    publisher: "Johns Hopkins University Press",
  },
];

async function main() {
  const registry = await readPrizeRegistry();
  const welchPrize = requiredPrize(registry, welchPrizeId, welchCategoryId);
  const rosenPrize = requiredPrize(registry, rosenPrizeId, rosenCategoryId);

  console.log("Fetching the official AAHM Welch and Rosen recipient archives...");
  const [welchHtml, rosenHtml] = await Promise.all([
    fetchHtml(welchFetchUrl),
    fetchHtml(rosenFetchUrl),
  ]);

  const welchRecords = parseWelchBooks(welchPrize.prize, welchPrize.category, welchHtml);
  const rosenRecords = buildRosenBookRecords(rosenPrize.prize, rosenPrize.category);
  assertWelchCoverage(welchRecords);
  assertRosenCoverage(rosenRecords);
  assertOfficialTitlesPresent(rosenHtml, rosenRecords, "George Rosen");

  await writeRawAwardRecords("william-h-welch-medal.json", welchRecords, {
    importer: "scripts/import-award-records/aahm-book-prizes.ts",
    source: welchPrize.category.sourceLabel,
    notes:
      "Imports only explicitly named books from the official archive. Historical no-award rows " +
      "and rows recognizing general scholarly contributions are excluded. The archive's 1987, " +
      "1986, and 1976 multi-book citations are represented as separate co-winner book records.",
    records: welchRecords.length,
    yearRange: yearRange(welchRecords),
    excludedNonBookRecognition: true,
  });

  await writeRawAwardRecords("george-rosen-prize.json", rosenRecords, {
    importer: "scripts/import-award-records/aahm-book-prizes.ts",
    source: rosenPrize.category.sourceLabel,
    notes:
      "Uses an explicit reviewed nonfiction-book allowlist checked against the official recipient " +
      "page. Excludes the 2019 exhibition, 2023 Mothers of Gynecology public-history project, and " +
      "2025 Nursing Clio website. Retains the 2021 Oxford Handbook as an edited nonfiction book.",
    records: rosenRecords.length,
    yearRange: yearRange(rosenRecords),
    excludedYears: [2019, 2023, 2025],
  });

  console.log(
    `Imported ${welchRecords.length} Welch book records (${yearRange(welchRecords)}) and ` +
    `${rosenRecords.length} Rosen nonfiction books (${yearRange(rosenRecords)}).`,
  );
}

export function parseWelchBooks(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  const current = parseCurrentWelchWinner(html);
  if (current) records.push(toRecord(prize, category, current));

  // The page repeats the heading in title and social metadata; the final occurrence
  // is the visible archive heading inside the article body.
  const sectionStart = html.lastIndexOf("Past Welch Winners");
  const sectionEnd = html.indexOf("<p>Genevieve Miller,", sectionStart);
  if (sectionStart < 0 || sectionEnd <= sectionStart) {
    throw new Error("Could not find the official Past Welch Winners section");
  }

  const section = html.slice(sectionStart, sectionEnd);
  for (const match of section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const marked = markTitleTags(match[1]);
    const plain = htmlToPlainText(marked);
    const yearMatch = plain.match(/\b((?:19|20)\d{2})\b/);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    if (year === 2026 || /\bNo award\b/i.test(plain)) continue;

    const multiBooks = welchMultiBookRows.get(year);
    if (multiBooks) {
      records.push(...multiBooks.map((book) => toRecord(prize, category, book)));
      continue;
    }

    if (year < 1983 && !olderWelchBookYears.has(year)) continue;
    if (/\b(?:scholarly|significant|valuable|invaluable|extensive)\s+contributions?\b/i.test(plain)) continue;

    const book = parseWelchParagraph(year, plain);
    if (!book) throw new Error(`Could not parse Welch book row for ${year}: ${plain}`);
    records.push(toRecord(prize, category, book));
  }

  return markSharedYears(records).sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
}

export function buildRosenBookRecords(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
): RawAwardRecord[] {
  return rosenBookRows
    .map((book) => toRecord(prize, category, book))
    .sort((a, b) => b.year - a.year);
}

function parseCurrentWelchWinner(html: string): ReviewedBook | undefined {
  const headline = html.match(/<h4\b[^>]*>(Congratulations to [\s\S]*?)<\/h4>/i)?.[1];
  if (!headline) return undefined;
  const marked = htmlToPlainText(markTitleTags(headline));
  const match = marked.match(
    /^Congratulations to\s+([^,]+),\s*2026 Welch medalist[\s\S]*?\[\[TITLE\]\]([\s\S]*?)\[\[\/TITLE\]\]\s*published by\s+(.+)$/i,
  );
  if (!match) throw new Error(`Could not parse the current Welch winner: ${marked}`);
  return {
    year: 2026,
    authors: [cleanText(match[1])],
    title: cleanText(match[2]),
    publisher: normalizePublisher(cleanText(match[3]).replace(/\s+in\s+\d{4}[.\s]*$/i, "")),
  };
}

function parseWelchParagraph(year: number, plain: string): ReviewedBook | undefined {
  const withoutYear = cleanText(
    plain
      .replace(new RegExp(`^[\\s|–—-]*${year}[\\s|:–—-]*`), "")
      .replace(/\s*\|\s*/g, " "),
  );
  const markedTitle = withoutYear.match(/\[\[TITLE\]\]([\s\S]*?)\[\[\/TITLE\]\]/);
  if (markedTitle) {
    let authorText = cleanText(withoutYear.slice(0, markedTitle.index))
      .replace(/,\s*winner of the \d{4} Welch Medal for\s*$/i, "")
      .replace(/[,\s]+$/, "");
    const authors = welchAuthorOverrides.get(year) ?? normalizeAuthorList(authorText);
    if (!authors.length) return undefined;
    return {
      year,
      authors,
      title: cleanText(markedTitle[1]).replace(/[.\s]+$/, ""),
      publisher: publisherAfterTitle(withoutYear.slice((markedTitle.index ?? 0) + markedTitle[0].length)),
    };
  }

  const publisherMatch = withoutYear.match(/\(([^()]*(?:Press|Books|Publishers?|Collins|Knopf|Reichner|Free Press)[^()]*)\)\.?$/i);
  if (!publisherMatch) return undefined;
  const body = cleanText(withoutYear.slice(0, publisherMatch.index)).replace(/[,\s]+$/, "");
  const separator = body.indexOf(",");
  if (separator < 0) return undefined;

  const authors = welchAuthorOverrides.get(year)
    ?? normalizeAuthorList(body.slice(0, separator).replace(/[,\s]+$/, ""));
  const title = year === 1966
    ? "John Morgan: Continental Doctor"
    : cleanText(body.slice(separator + 1)).replace(/[.\s]+$/, "");
  if (!authors.length || !title) return undefined;
  return {
    year,
    authors,
    title,
    publisher: normalizePublisher(publisherMatch[1]),
  };
}

function markTitleTags(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<(?:em|i)\b[^>]*>/gi, " [[TITLE]]")
    .replace(/<\/(?:em|i)>/gi, "[[/TITLE]] ")
    .replace(/<br\s*\/?\s*>/gi, " | ");
}

function publisherAfterTitle(value: string) {
  const parenthetical = value.match(/\(([^()]*)\)/)?.[1];
  return parenthetical ? normalizePublisher(parenthetical) : undefined;
}

function normalizePublisher(value: string) {
  return cleanText(value)
    .replace(/^the\s+/i, "")
    .replace(/^(?:New York|NY):\s*/i, "")
    .replace(/\s*[:,]\s*(?:19|20)\d{2}\s*$/i, "")
    .replace(/(?:,\s*c?\d{4})+\s*$/i, "")
    .replace(/\s+(?:19|20)\d{2}\s*$/i, "")
    .replace(/[,\s.]+$/, "")
    .replace(/^Duke,\s+University Press$/i, "Duke University Press")
    .replace(/^The Johns Hopkins University Press$/i, "Johns Hopkins University Press")
    .replace(/^Harper Collins$/i, "HarperCollins")
    .replace(/^M\.I\.T\. Press$/i, "MIT Press");
}

function toRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  book: ReviewedBook,
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: book.year,
    status: "winner",
    title: book.title,
    authors: book.authors,
    publisher: book.publisher,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
  };
}

function markSharedYears(records: RawAwardRecord[]) {
  const counts = new Map<number, number>();
  for (const record of records) counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
  return records.map((record) => ({
    ...record,
    status: counts.get(record.year)! > 1 ? "co_winner" as const : "winner" as const,
  }));
}

function assertOfficialTitlesPresent(html: string, records: RawAwardRecord[], label: string) {
  const sourceText = slugComparable(htmlToPlainText(html));
  const missing = records.filter((record) => !sourceText.includes(slugComparable(record.title)));
  if (missing.length) {
    throw new Error(`${label} official page is missing reviewed titles: ${missing.map((row) => row.title).join("; ")}`);
  }
}

function slugComparable(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function assertWelchCoverage(records: RawAwardRecord[]) {
  if (records.length !== 61) throw new Error(`Expected exactly 61 Welch book records, got ${records.length}`);
  if (yearRange(records) !== "1954-2026") throw new Error(`Unexpected Welch range: ${yearRange(records)}`);
  const forbiddenYears = new Set([1950, 1951, 1952, 1953, 1955, 1957, 1959, 1960, 1961, 1963, 1964, 1965, 1970, 1971, 1974, 1975, 1977, 1980, 1981, 1982]);
  const forbidden = records.filter((record) => forbiddenYears.has(record.year));
  if (forbidden.length) throw new Error(`Welch importer retained non-book/no-award years: ${forbidden.map((row) => row.year).join(", ")}`);
}

function assertRosenCoverage(records: RawAwardRecord[]) {
  if (records.length !== 9) throw new Error(`Expected exactly 9 Rosen nonfiction books, got ${records.length}`);
  const years = records.map((record) => record.year);
  for (const excluded of [2019, 2023, 2025]) {
    if (years.includes(excluded)) throw new Error(`Rosen non-book year ${excluded} was retained`);
  }
}

function requiredPrize(registry: PrizeRegistryEntry[], prizeId: string, categoryId: string) {
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);
  return { prize, category };
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
