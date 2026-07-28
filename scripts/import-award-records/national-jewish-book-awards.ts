import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
} from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  readPrizeRegistry,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const awardId = "national-jewish-book-awards";
const wikiPageTitle = "List of winners of the National Jewish Book Award";
const wikiPageUrl = `https://en.wikipedia.org/wiki/${wikiPageTitle.replace(/ /g, "_")}`;
const officialUrl = "https://www.jewishbookcouncil.org/awards";

const minimumRecords = 480;
const earliestYear = 1949;
const latestYear = 2026;

export type WikiSection = {
  heading: string;
  body: string;
  index: number;
};

/**
 * Rows on this page that award a publishing programme rather than a single book. These
 * are dropped because the corpus tracks individual titles; each entry is a specific
 * observed row, not a general filter.
 */
const nonBookTitles = new Set(["Jewish Lives Series"]);

/** A parsed table row before it is turned into a RawAwardRecord. */
export type ParsedNjbaRow = {
  year: number;
  title: string;
  authors: string[];
  roles: string[];
  combinedYearLabel?: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === awardId);
  if (!prize) throw new Error(`Missing ${awardId} registry entry in sources/prizes.json`);
  if (!prize.categories?.length) throw new Error(`Registry entry ${awardId} has no categories`);

  console.log(`Fetching wikitext for "${wikiPageTitle}"...`);
  const wikitext = await fetchMediaWikiWikitext(wikiPageTitle);

  const records: RawAwardRecord[] = [];
  for (const category of prize.categories) {
    const categoryRecords = parseCategoryRecords(prize, category, wikitext);
    if (!categoryRecords.length) {
      throw new Error(`No rows parsed for category ${category.id} (${category.name}).`);
    }
    records.push(...categoryRecords);
  }

  assertCoverage(prize, records);

  records.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName) ||
      a.year - b.year ||
      a.title.localeCompare(b.title),
  );

  const years = records.map((record) => record.year);
  const winners = records.filter((record) => record.status === "winner").length;
  const coWinners = records.filter((record) => record.status === "co_winner").length;

  await writeRawAwardRecords(`${awardId}.json`, records, {
    importer: `scripts/import-award-records/${awardId}.ts`,
    source: `Wikipedia: ${wikiPageTitle}`,
    sourceUrl: wikiPageUrl,
    officialUrl,
    notes:
      "Winners only, parsed from per-category section wikitables on a single Wikipedia list page. " +
      "Only the non-fiction categories listed in sources/prizes.json are imported; fiction, poetry, " +
      "children's, young-adult, anthology, cookbook, book-club and mentorship categories are skipped. " +
      "Titles wrapped in {{Sort|sortkey|display}} are resolved to the display argument so leading " +
      "articles are preserved. Combined award years written as '2002-2003' are normalized to the later " +
      "year (2003) and flagged in the record notes. Years with duplicate rows are emitted as co_winner. " +
      "Editor/translator role parentheticals are stripped from author names and recorded in notes. " +
      "The Jewish Book of the Year category deliberately overlaps subject categories. " +
      `Official award site: ${officialUrl}`,
    records: records.length,
    winners,
    coWinners,
    yearRange: `${Math.min(...years)}-${Math.max(...years)}`,
    categories: categoryReports(records),
  });

  console.log(
    `Imported ${records.length} National Jewish Book Award records across ${prize.categories.length} categories ` +
      `(${Math.min(...years)}-${Math.max(...years)}; ${winners} winner, ${coWinners} co_winner).`,
  );
}

/** Pure parse entry point: takes already-fetched wikitext, performs no network I/O. */
export function parseCategoryRecords(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const section = findCategorySection(category, wikitext);
  if (!section) return [];
  const rows = parseSectionRows(section.body);
  const yearCounts = new Map<number, number>();
  for (const row of rows) yearCounts.set(row.year, (yearCounts.get(row.year) ?? 0) + 1);

  return rows.map((row) => {
    const notes: string[] = [];
    if (row.combinedYearLabel) {
      notes.push(`Source lists a combined award year "${row.combinedYearLabel}"; normalized to ${row.year}.`);
    }
    if (row.roles.length) {
      notes.push(`Credited as ${row.roles.join(", ")} rather than author.`);
    }
    if ((yearCounts.get(row.year) ?? 0) > 1) {
      notes.push("Shared award year with another winning title.");
    }
    return {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: row.year,
      status: (yearCounts.get(row.year) ?? 0) > 1 ? "co_winner" : "winner",
      title: row.title,
      authors: row.authors,
      sourceUrl: category.sourceUrl,
      sourceLabel: category.sourceLabel,
      sourceConfidence: category.sourceConfidence,
      notes: notes.length ? notes.join(" ") : undefined,
    } satisfies RawAwardRecord;
  });
}

/**
 * Locates the level-2 section for a category. The heading text is derived from the
 * registry sourceUrl anchor. The "References" heading appears twice on the page (the
 * category table and the article's citation reflist), so candidates are filtered by
 * position: the first candidate that actually contains a wikitable wins.
 */
export function findCategorySection(
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): WikiSection | undefined {
  const heading = headingFromSourceUrl(category.sourceUrl);
  if (!heading) throw new Error(`Category ${category.id} has no section anchor in its sourceUrl`);
  const candidates = splitLevelTwoSections(wikitext).filter(
    (section) => normalizeHeading(section.heading) === normalizeHeading(heading),
  );
  if (!candidates.length) return undefined;
  return candidates.find((section) => /\{\|\s*class="[^"]*wikitable/.test(section.body));
}

export function headingFromSourceUrl(sourceUrl: string) {
  const hashIndex = sourceUrl.indexOf("#");
  if (hashIndex === -1) return undefined;
  const anchor = sourceUrl.slice(hashIndex + 1);
  try {
    return decodeURIComponent(anchor).replace(/_/g, " ").trim();
  } catch {
    return anchor.replace(/_/g, " ").trim();
  }
}

function normalizeHeading(heading: string) {
  return cleanText(heading).toLowerCase();
}

export function splitLevelTwoSections(wikitext: string): WikiSection[] {
  const lines = wikitext.split("\n");
  const sections: WikiSection[] = [];
  let current: WikiSection | undefined;
  for (const line of lines) {
    const match = line.match(/^==\s*([^=].*?)\s*==\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1], body: "", index: sections.length };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

/** Parses the first wikitable in a category section into rows. */
export function parseSectionRows(sectionBody: string): ParsedNjbaRow[] {
  const table = extractFirstTable(sectionBody);
  if (!table) return [];

  const headerCells = parseHeaderCells(table);
  const columns = resolveColumns(headerCells);
  const rows: ParsedNjbaRow[] = [];

  for (const rawRow of table.split(/\n\|-/).slice(1)) {
    const cells = parseRowCells(rawRow);
    if (cells.length < 2) continue;
    const yearCell = cells[columns.year];
    const titleCell = cells[columns.title];
    const authorCell = cells[columns.author];
    if (yearCell === undefined || titleCell === undefined || authorCell === undefined) continue;

    const year = parseAwardYear(yearCell);
    if (!year) continue;
    const title = resolveTitleCell(titleCell);
    if (!title || !isLikelyTitle(title) || nonBookTitles.has(title)) continue;
    const { authors, roles } = resolveAuthorCell(authorCell);
    if (!authors.length) continue;

    rows.push({
      year: year.year,
      title,
      authors,
      roles,
      combinedYearLabel: year.combinedLabel,
    });
  }

  return rows;
}

function extractFirstTable(sectionBody: string) {
  const start = sectionBody.search(/\{\|\s*class="[^"]*wikitable/);
  if (start === -1) return undefined;
  const end = sectionBody.indexOf("\n|}", start);
  return end === -1 ? sectionBody.slice(start) : sectionBody.slice(start, end);
}

function parseHeaderCells(table: string) {
  return table
    .split("\n")
    .filter((line) => /^!/.test(line.trim()))
    .flatMap((line) =>
      line
        .trim()
        .replace(/^!\s*/, "")
        .split("!!")
        .map((cell) => cleanText(stripCellAttributes(cell))),
    );
}

/**
 * Column layout is Year | Title | Author | Ref, but a few excluded categories add an
 * Illustrator or Translator column, and one category writes the year header as "date".
 * Resolve by header text and fall back to positional defaults.
 */
function resolveColumns(headerCells: string[]) {
  const find = (pattern: RegExp, fallback: number) => {
    const index = headerCells.findIndex((cell) => pattern.test(cell));
    return index === -1 ? fallback : index;
  };
  return {
    year: find(/^(year|date)$/i, 0),
    title: find(/^title$/i, 1),
    author: find(/^authors?$/i, 2),
  };
}

function parseRowCells(rawRow: string) {
  const cells: string[] = [];
  for (const line of rawRow.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\{\|/.test(trimmed) || /^\|\}/.test(trimmed) || /^\|\+/.test(trimmed) || /^!/.test(trimmed)) {
      continue;
    }
    if (trimmed.startsWith("|")) {
      cells.push(stripCellAttributes(trimmed.replace(/^\|\s*/, "")));
      continue;
    }
    // Continuation of a multi-line cell (e.g. a citation spilling onto the next line).
    if (cells.length) cells[cells.length - 1] += ` ${trimmed}`;
  }
  return cells;
}

/**
 * Award years are plain integers except for the combined "2002-2003" / "2002 - 2003"
 * cells that appear in eight categories. Those are normalized to the later year, which
 * is the year the combined cycle was announced.
 */
export function parseAwardYear(cell: string) {
  const text = wikiToPlainText(cell);
  const matches = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (!matches.length) return undefined;
  if (matches.length === 1) return { year: matches[0] };
  return { year: Math.max(...matches), combinedLabel: cleanText(text) };
}

/**
 * Resolves a title cell. Roughly a third of title cells are wrapped in
 * {{Sort|sortkey|display}} where the sortkey is a truncated, article-stripped variant of
 * the real title. We must take argument 2, then resolve any piped [[link|display]], then
 * strip italic markup. Handles all three observed shapes:
 *   {{Sort|key|Plain Title}}
 *   {{Sort|key|[[Article|''Title'']]}}
 *   ''{{Sort|key|Title}}''
 */
export function resolveTitleCell(cell: string) {
  const resolved = unwrapSortTemplates(normalizeTemplateSpacing(cell));
  const text = wikiToPlainText(resolved);
  return cleanText(text.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*\(\s*\)\s*/g, " "));
}

/** MediaWiki template names are case-insensitive and tolerate spaces: {{sort |a|b}}. */
export function normalizeTemplateSpacing(input: string) {
  return input
    .replace(/\{\{\s*[Ss]ortname\s*\|/g, "{{Sortname|")
    .replace(/\{\{\s*[Ss]ort\s*\|/g, "{{Sort|");
}

/** Replaces every {{Sort|sortkey|display}} with its SECOND argument. */
export function unwrapSortTemplates(input: string) {
  return input.replace(/\{\{Sort\|([^{}]+)\}\}/g, (_match, body: string) => {
    const parts = splitTemplateParameters(body);
    const positional: string[] = [];
    const named = new Map<string, string>();
    for (const part of parts) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq > 0 && /^[\w\s]+$/.test(trimmed.slice(0, eq))) {
        named.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
      } else {
        positional.push(trimmed);
      }
    }
    return named.get("2") ?? positional[1] ?? named.get("1") ?? positional[0] ?? "";
  });
}

const rolePattern = /\(\s*(?:[a-z.\- ]*\b(?:ed|eds|trans|comp|adapt)\b[a-z.\- ]*)\s*\)/gi;

/**
 * Author cells credit editors and translators with plain-text role suffixes such as
 * "(ed.)", "(eds.)", "(ed.-in-chief)", "(consulting ed.)" and "(trans.)", joined with
 * "and" or "with". Strip the parentheticals, keep the names, and report the roles.
 */
export function resolveAuthorCell(cell: string) {
  const text = wikiToPlainText(normalizeTemplateSpacing(cell));
  const roles = new Set<string>();
  const withoutRoles = text.replace(rolePattern, (match) => {
    roles.add(cleanText(match.replace(/^\(|\)$/g, "")).toLowerCase());
    return " ";
  });
  const authors = withoutRoles
    .split(/\s+(?:and|with)\s+|\s*[;,]\s+(?=[A-Z\p{Lu}])/u)
    .map((part) => cleanText(part).replace(/[,;]+$/, "").trim())
    .filter((part) => part.length > 1 && /\p{L}/u.test(part));
  return { authors, roles: [...roles] };
}

function splitTemplateParameters(body: string) {
  const parts: string[] = [];
  let start = 0;
  let linkDepth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === "[[") {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "]]" && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (body[index] === "|" && linkDepth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function assertCoverage(prize: PrizeRegistryEntry, records: RawAwardRecord[]) {
  if (records.length < minimumRecords) {
    throw new Error(
      `Coverage check failed: parsed ${records.length} records, expected at least ${minimumRecords}.`,
    );
  }
  const byCategory = new Map<string, number>();
  for (const record of records) byCategory.set(record.categoryId, (byCategory.get(record.categoryId) ?? 0) + 1);
  const missing = prize.categories.filter((category) => !byCategory.get(category.id));
  if (missing.length) {
    throw new Error(
      `Coverage check failed: no records for ${missing.length} categor(y/ies): ${missing.map((c) => c.id).join(", ")}.`,
    );
  }
  if (byCategory.size !== prize.categories.length) {
    throw new Error(
      `Coverage check failed: parsed ${byCategory.size} categories, expected ${prize.categories.length}.`,
    );
  }
  const outOfRange = records.filter(
    (record) => !Number.isInteger(record.year) || record.year < earliestYear || record.year > latestYear,
  );
  if (outOfRange.length) {
    throw new Error(
      `Coverage check failed: ${outOfRange.length} record(s) outside ${earliestYear}-${latestYear}: ` +
        outOfRange.slice(0, 5).map((record) => `${record.year} ${record.title}`).join("; "),
    );
  }
}

function categoryReports(records: RawAwardRecord[]) {
  const reports = new Map<string, { categoryId: string; categoryName: string; sourceUrl: string; records: number; years: number[] }>();
  for (const record of records) {
    const current = reports.get(record.categoryId) ?? {
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      sourceUrl: record.sourceUrl,
      records: 0,
      years: [],
    };
    current.records += 1;
    current.years.push(record.year);
    reports.set(record.categoryId, current);
  }
  return [...reports.values()]
    .map((report) => ({
      categoryId: report.categoryId,
      categoryName: report.categoryName,
      sourceUrl: report.sourceUrl,
      records: report.records,
      yearRange: `${Math.min(...report.years)}-${Math.max(...report.years)}`,
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

const isDirectRun = process.argv[1]?.includes("national-jewish-book-awards.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
