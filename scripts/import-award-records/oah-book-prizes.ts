import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
  RawAwardRecordStatus,
} from "../../lib/award-records";
import {
  cleanText,
  decodeHtmlEntities,
  fetchHtml,
  isLikelyTitle,
  readPrizeRegistry,
  slugify,
  writeRawAwardRecords,
} from "./helpers";

/**
 * The seven OAH book prizes share one WordPress "toggle" layout. Every past-winner list lives
 * inside the `Past Winners` toggle, where year headings and entries are sibling `<p>` tags.
 */

type OahCategoryConfig = {
  categoryId: string;
  /** Exact expected year range, asserted before writing. */
  expectedYearRange: string;
  minimumRecords: number;
  /** Extra note applied to records at or before `renamedThrough`. */
  legacyName?: { note: string; through: number };
};

const configs: OahCategoryConfig[] = [
  { categoryId: "oah-frederick-jackson-turner-award", expectedYearRange: "1959-2025", minimumRecords: 90 },
  { categoryId: "oah-merle-curti-award", expectedYearRange: "1977-2025", minimumRecords: 78 },
  {
    categoryId: "oah-civil-war-and-reconstruction-book-award",
    expectedYearRange: "1985-2025",
    minimumRecords: 48,
    legacyName: { note: "Awarded as the Avery O. Craven Award; the prize was renamed the Civil War and Reconstruction Book Award in 2021.", through: 2020 },
  },
  { categoryId: "oah-ellis-w-hawley-prize", expectedYearRange: "1997-2025", minimumRecords: 29 },
  { categoryId: "oah-liberty-legacy-foundation-award", expectedYearRange: "2003-2025", minimumRecords: 32 },
  { categoryId: "oah-darlene-clark-hine-award", expectedYearRange: "2010-2025", minimumRecords: 30 },
  { categoryId: "oah-lawrence-w-levine-award", expectedYearRange: "2008-2025", minimumRecords: 19 },
];

const MINIMUM_TOTAL_RECORDS = 330;

/**
 * OAH publishes the Merle Curti list at two URLs whose contents are ~90% identical. The
 * intellectual-history snapshot is canonical; only these years diverge and are merged in.
 */
const CURTI_SOCIAL_HISTORY_URL =
  "https://web.archive.org/web/20251208060744id_/https://www.oah.org/awards/book-awards-and-prizes/merle-curti-social-history-award/";
const CURTI_MERGE_YEARS = new Set([2017, 2023, 2024, 2025]);

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "oah-book-prizes");
  if (!prize) throw new Error("Missing oah-book-prizes registry entry in sources/prizes.json");

  const records: RawAwardRecord[] = [];
  const categoryMetadata: Array<Record<string, unknown>> = [];

  for (const config of configs) {
    const category = findCategory(prize, config.categoryId);

    console.log(`Fetching ${category.name} from ${category.sourceUrl}...`);
    let categoryRecords = parseOahPastWinners(prize, category, await fetchHtml(category.sourceUrl), config);

    if (config.categoryId === "oah-merle-curti-award") {
      console.log(`Fetching Merle Curti social-history variant from ${CURTI_SOCIAL_HISTORY_URL}...`);
      const socialRecords = parseOahPastWinners(prize, category, await fetchHtml(CURTI_SOCIAL_HISTORY_URL), config, {
        sourceUrl: CURTI_SOCIAL_HISTORY_URL,
        sourceLabel: "OAH Merle Curti Award (social history) official page (Internet Archive snapshot)",
      });
      categoryRecords = mergeCurti(categoryRecords, socialRecords);
    }

    categoryRecords = markSharedYears(categoryRecords);
    assertCategoryCoverage(config, category, categoryRecords);

    records.push(...categoryRecords);
    categoryMetadata.push({
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: categoryRecords.length,
      ...statusCounts(categoryRecords),
      yearRange: yearRange(categoryRecords),
    });
  }

  if (records.length < MINIMUM_TOTAL_RECORDS) {
    throw new Error(`Expected at least ${MINIMUM_TOTAL_RECORDS} OAH book prize records, got ${records.length}`);
  }

  records.sort(
    (a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || a.status.localeCompare(b.status) || a.title.localeCompare(b.title),
  );

  await writeRawAwardRecords("oah-book-prizes.json", records, {
    importer: "scripts/import-award-records/oah-book-prizes.ts",
    source: "Official Organization of American Historians award pages (Internet Archive id_ snapshots)",
    notes:
      "Live oah.org returns HTTP 403 to automated clients (Cloudflare), so each category is read from the archived raw-content snapshot of its official page recorded in sources/prizes.json. Records come from the 'Past Winners' toggle: year headings and entries are sibling paragraphs. Institutional affiliations are stripped from author strings; 'Honorable Mention' rows become honorable_mention and the Liberty Legacy 2003 finalist slate becomes finalist. Merle Curti merges the four divergent years from OAH's social-history URL into the canonical intellectual-history list.",
    records: records.length,
    ...statusCounts(records),
    yearRange: yearRange(records),
    coverageNotes:
      "Snapshots stop at the 2025 prize year, so 2026 winners (announced for the Turner Award and Hawley Prize) are not included. Frederick Jackson Turner rows reading 'No award given.' (1960, 1963, 1964, 1968, 1976) are recorded as gaps rather than records.",
    categories: categoryMetadata,
  });

  console.log(`Imported ${records.length} OAH book prize records (${yearRange(records)}).`);
}

type SourceOverride = { sourceUrl: string; sourceLabel: string };

/**
 * Pure parser: takes already-fetched HTML for a single OAH award page and returns raw records.
 */
export function parseOahPastWinners(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
  config?: Pick<OahCategoryConfig, "legacyName">,
  sourceOverride?: SourceOverride,
): RawAwardRecord[] {
  const block = extractPastWinnersBlock(html);
  const records: RawAwardRecord[] = [];
  let year: number | undefined;
  let finalistMode = false;

  for (const paragraph of paragraphsOf(block)) {
    let rest = paragraph.replace(/^(?:<br\s*\/?>\s*)+/i, "");
    const heading = rest.match(/^(?:<strong>\s*)?((?:19|20)\d{2})\s*(?:<\/strong>)?\s*(?:<br\s*\/?>\s*)?/i);
    if (heading && !stripTags(rest.slice(0, heading[0].length)).replace(heading[1], "").trim()) {
      year = Number(heading[1]);
      finalistMode = false;
      rest = rest.slice(heading[0].length);
    }

    for (const segment of rest.split(/(?:<br\s*\/?>\s*){2,}/i)) {
      const text = stripTags(segment);
      if (!text) continue;
      if (/^No award given\.?$/i.test(text)) continue;
      // Editorial bracket notes belong to the record above them (e.g. the 2002 Curti double award).
      if (text.startsWith("[") && !/<em/i.test(segment)) {
        const previous = records[records.length - 1];
        if (previous) previous.notes = [previous.notes, cleanText(text.replace(/^\[|\]$/g, ""))].filter(Boolean).join(" ");
        continue;
      }
      if (/^Finalists?\b/i.test(text)) {
        finalistMode = true;
        continue;
      }
      if (year === undefined) continue;

      const record = toRecord(prize, category, year, segment, finalistMode, config, sourceOverride);
      if (record) records.push(record);
    }
  }

  return records;
}

function toRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  segment: string,
  finalistMode: boolean,
  config?: Pick<OahCategoryConfig, "legacyName">,
  sourceOverride?: SourceOverride,
): RawAwardRecord | undefined {
  const emphases = [...segment.matchAll(/<em[^>]*>([\s\S]*?)<\/em>/gi)];
  if (!emphases.length) return undefined;

  const title = cleanTitle(emphases.map((match) => stripTags(match[1])).join(" "));
  if (!isLikelyTitle(title)) return undefined;

  let lead = stripTags(segment.slice(0, emphases[0].index ?? 0));
  let status: RawAwardRecordStatus = finalistMode ? "finalist" : "winner";
  const notes: string[] = [];

  const honorable = lead.match(/^Honorable Mentions?\s*:?\s*/i);
  if (honorable) {
    status = "honorable_mention";
    lead = lead.slice(honorable[0].length);
  }

  // Merle Curti splits its award into two tracks from 2004 onward.
  const track = lead.match(/^(Intellectual History|Social History)\s*:\s*/i);
  if (track) {
    notes.push(`${cleanText(track[1])} award.`);
    lead = lead.slice(track[0].length);
  }
  if (config?.legacyName && year <= config.legacyName.through) notes.push(config.legacyName.note);

  const authors = parseAuthors(lead);
  if (!authors.length) return undefined;

  const tailIndex = (emphases[emphases.length - 1].index ?? 0) + emphases[emphases.length - 1][0].length;
  const publisher = parsePublisher(stripTags(segment.slice(tailIndex)));

  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title,
    authors,
    publisher,
    sourceUrl: sourceOverride?.sourceUrl ?? category.sourceUrl,
    sourceLabel: sourceOverride?.sourceLabel ?? category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: notes.length ? notes.join(" ") : undefined,
  };
}

function extractPastWinnersBlock(html: string) {
  const headingIndex = html.search(/<div class="ep_toggle_item_title"><span><strong>\s*Past Winners\s*<\/strong>/i);
  if (headingIndex === -1) throw new Error("Could not find the OAH 'Past Winners' toggle heading.");
  const contentIndex = html.indexOf("ep_toggle_item_content", headingIndex);
  if (contentIndex === -1) throw new Error("Could not find the OAH 'Past Winners' toggle content.");
  const end = html.indexOf("</div></div></div>", contentIndex);
  return html.slice(contentIndex, end === -1 ? html.length : end);
}

function paragraphsOf(block: string) {
  // Older snapshots emit class=" eplus-wrapper" with a leading space, so match loosely.
  return [...block.matchAll(/<p class="[^"]*eplus-wrapper"[^>]*>([\s\S]*?)<\/p>/gi)].map((match) =>
    match[1].replace(/ /g, " "),
  );
}

function stripTags(input: string) {
  return cleanText(decodeHtmlEntities(input.replace(/<[^>]+>/g, " ")));
}

function cleanTitle(input: string) {
  return cleanText(input)
    .replace(/[.,;:]+$/, "")
    // Only unwrap quotes that enclose the whole title; several titles quote a phrase internally.
    .replace(/^["“](.+)["”]$/, "$1")
    .trim();
}

function parsePublisher(tail: string) {
  const trimmed = tail.replace(/^[\s,.;:]+/, "");
  const closed = trimmed.match(/\(([^()]+)\)\s*\.?\s*$/);
  if (closed) return cleanPublisher(closed[1]);
  // One Craven row ships an unclosed paren: "(Oxford University Press".
  const unclosed = trimmed.match(/\(([^()]+)$/);
  if (unclosed) return cleanPublisher(unclosed[1]);
  const openless = trimmed.match(/^([^()]+)\)\s*\.?\s*$/);
  if (openless) return cleanPublisher(openless[1]);
  return undefined;
}

function cleanPublisher(input: string) {
  const value = cleanText(input).replace(/[.,;:]+$/, "");
  return value || undefined;
}

const AFFILIATION_KEYWORD =
  /\b(?:Universit|College|Institute|Academy|School|Museum|Societ|Center|Centre|Library|Association|Univ\.|CUNY|SUNY|Foundation|Seminary|Archives|Collection|Scholar|Independent|Press|Historical|Service|Nurses|Company|Institution|Emerit|Department)/i;
const NAME_SUFFIX = /^(?:Jr\.?|Sr\.?|I{2,3}|IV|Ph\.?D\.?|M\.?D\.?)$/i;
const NAME_PARTICLE = new Set(["van", "von", "de", "del", "della", "da", "di", "la", "le", "der", "den"]);

function looksLikePersonName(value: string) {
  if (!value) return false;
  if (value.includes("&")) return false;
  if (value.startsWith("The ")) return false;
  if (AFFILIATION_KEYWORD.test(value)) return false;
  const tokens = value.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 6) return false;
  return tokens.every((token) => /^[A-ZÀ-Ü]/.test(token) || NAME_PARTICLE.has(token));
}

/**
 * OAH writes "Author Name, Institutional Affiliation," and affiliations may themselves contain
 * commas ("University of California, San Diego"). Walk comma-separated chunks and keep the
 * person-shaped ones, dropping affiliation chunks and their continuations.
 */
export function parseAuthors(input: string) {
  const segment = cleanText(input).replace(/[\s,.;:]+$/, "");
  const authors: string[] = [];
  let sawAffiliation = false;

  for (const rawChunk of segment.split(",")) {
    const chunk = cleanText(rawChunk);
    if (!chunk) continue;
    if (NAME_SUFFIX.test(chunk) && authors.length) {
      // The segment-level trailing-punctuation strip can eat the abbreviating period.
      const suffix = /^(?:Jr|Sr|Ph\.?D|M\.?D)$/i.test(chunk) ? `${chunk}.` : chunk;
      authors[authors.length - 1] = `${authors[authors.length - 1]}, ${suffix}`;
      continue;
    }
    const conjoined = /^and\s+/i.test(chunk);
    const body = chunk.replace(/^and\s+/i, "");
    const parts = body.split(/\s+and\s+/).map((part) => cleanText(part)).filter(Boolean);
    let isAuthorChunk = parts.length > 0 && parts.every(looksLikePersonName);
    // After an affiliation, only a clearly person-shaped chunk resumes the author list; this keeps
    // campus continuations ("San Diego", "Chapel Hill") out while allowing a third co-author.
    if (isAuthorChunk && sawAffiliation && !conjoined) {
      isAuthorChunk = parts.every((part) => part.split(/\s+/).length >= 3 || /\./.test(part));
    }
    if (isAuthorChunk) authors.push(...parts);
    else sawAffiliation = true;
  }

  return authors;
}

function mergeCurti(canonical: RawAwardRecord[], variant: RawAwardRecord[]) {
  const seen = new Set(canonical.map(dedupeKey));
  const merged = [...canonical];
  for (const record of variant) {
    if (!CURTI_MERGE_YEARS.has(record.year)) continue;
    const key = dedupeKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(record);
  }
  return merged;
}

function dedupeKey(record: RawAwardRecord) {
  return `${record.year}:${slugify(record.title)}`;
}

/** Co-winners are routine here, so promote shared years — but only within the same status. */
export function markSharedYears(records: RawAwardRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.year}:${record.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return records.map((record) =>
    record.status === "winner" && (counts.get(`${record.year}:winner`) ?? 0) > 1
      ? { ...record, status: "co_winner" as const }
      : record,
  );
}

function assertCategoryCoverage(config: OahCategoryConfig, category: PrizeCategoryRegistryEntry, records: RawAwardRecord[]) {
  if (records.length < config.minimumRecords) {
    throw new Error(`Expected at least ${config.minimumRecords} ${category.name} records, got ${records.length}`);
  }
  const range = yearRange(records);
  if (range !== config.expectedYearRange) {
    throw new Error(`Unexpected ${category.name} year range: expected ${config.expectedYearRange}, got ${range}`);
  }
}

function statusCounts(records: RawAwardRecord[]) {
  return {
    winners: records.filter((record) => record.status === "winner").length,
    coWinners: records.filter((record) => record.status === "co_winner").length,
    finalists: records.filter((record) => record.status === "finalist").length,
    honorableMentions: records.filter((record) => record.status === "honorable_mention").length,
  };
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

function findCategory(prize: PrizeRegistryEntry, categoryId: string) {
  const category = prize.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error(`Missing ${categoryId} category in sources/prizes.json`);
  return category;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
