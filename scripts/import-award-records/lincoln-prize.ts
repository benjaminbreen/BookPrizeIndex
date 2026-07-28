import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
  RawAwardRecordStatus,
} from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  fetchMediaWikiWikitext,
  htmlToPlainText,
  readPrizeRegistry,
  slugify,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const archiveUrl = "https://www.gettysburg.edu/lincoln-prize/previous-winners/";
const wikipediaUrl = "https://en.wikipedia.org/wiki/Lincoln_Prize";
const wikipediaPageTitle = "Lincoln Prize";
/** The Gettysburg archive stops here; later winners come from the cited Wikipedia recipient table. */
const archiveLastYear = 2024;

type LabelHandling =
  | { kind: "skip"; reason: string }
  | { kind: "record"; status: RawAwardRecordStatus; note?: string };

const labelHandling: Record<string, LabelHandling> = {
  "first place": { kind: "record", status: "winner" },
  "second place": { kind: "record", status: "finalist", note: "Listed as Second Place on the official archive." },
  finalist: { kind: "record", status: "finalist" },
  finalists: { kind: "record", status: "finalist" },
  "honorable mention": { kind: "record", status: "honorable_mention" },
  "honorable mentions": { kind: "record", status: "honorable_mention" },
  "special achievement award": {
    kind: "record",
    status: "honorable_mention",
    note: "Special Achievement Award rather than a First Place prize.",
  },
  "lifetime achievement award": { kind: "skip", reason: "Lifetime Achievement Award citation naming no book." },
  "e-lincoln prize": { kind: "skip", reason: "E-Lincoln Prize for a website or CD-ROM, not a book." },
  "e-lincoln prize winner": { kind: "skip", reason: "E-Lincoln Prize for a website or CD-ROM, not a book." },
  "e-lincoln prize second place": { kind: "skip", reason: "E-Lincoln Prize for a website or CD-ROM, not a book." },
};

/**
 * Non-book honorees that the archive lists alongside book awards. Keyed by
 * `year|title-slug` so a layout change cannot silently re-admit them.
 */
const excludedNonBooks = new Map<string, string>([
  ["1991|the-civil-war", "Ken Burns's television miniseries The Civil War (1991 First Place) — not a book."],
  ["2014|lincoln", "Steven Spielberg's film Lincoln (2014 Special Achievement Award) — not a book."],
]);

/**
 * Two archive lines whose punctuation merges or mangles distinct entries. Each is a
 * correction of a specific observed parsing failure, keyed by the exact archive text.
 */
const lineOverrides: Record<string, Array<{ authors: string[]; title: string; note: string }>> = {
  "Fred Kaplan, “Lincoln: The Biography of a Writer and William Lee Miller,” “President Lincoln: The Duty of a Statesman”": [
    {
      authors: ["Fred Kaplan"],
      title: "Lincoln: The Biography of a Writer",
      note: "The official archive merges two 2009 honorable mentions into one line; split on the authors it names.",
    },
    {
      authors: ["William Lee Miller"],
      title: "President Lincoln: The Duty of a Statesman",
      note: "The official archive merges two 2009 honorable mentions into one line; split on the authors it names.",
    },
  ],
  "John Y. Simon for editing 26 volumes—to date—of “The Papers of Ulysses S. Grant”": [
    {
      authors: ["John Y. Simon"],
      title: "The Papers of Ulysses S. Grant",
      note: "Special Achievement Award for editing the volumes of this edition, phrased as a citation on the official archive.",
    },
  ],
};

const NAME_SUFFIX = /^(?:Jr|Sr|II|III|IV)\.?$/i;

/** The archive misspells the 2023 co-winner's surname; its own winner page reads "Meacham". */
const authorOverrides: Record<string, string> = {
  "Jon Meachem": "Jon Meacham",
};

type ParsedEntry = {
  authors: string[];
  title: string;
  note?: string;
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "lincoln-prize");
  const category = prize?.categories.find((entry) => entry.id === "lincoln-prize-civil-war-era");
  if (!prize || !category) throw new Error("Missing lincoln-prize / lincoln-prize-civil-war-era registry entry");

  console.log("Fetching the Gettysburg College Lincoln Prize archive...");
  const archiveRecords = parseLincolnPrizeArchive(prize, category, await fetchHtml(archiveUrl));

  console.log("Fetching recent winners from the cited Wikipedia recipient table...");
  const recentRecords = parseLincolnPrizeRecentWinners(
    prize,
    category,
    await fetchMediaWikiWikitext(wikipediaPageTitle),
  );

  const records = [...archiveRecords, ...recentRecords]
    .sort((a, b) => b.year - a.year || statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title));
  assertCoverage(records);

  const coWinnerYears = [...new Set(records.filter((record) => record.status === "co_winner").map((record) => record.year))]
    .sort((a, b) => a - b);

  await writeRawAwardRecords("lincoln-prize.json", records, {
    importer: "scripts/import-award-records/lincoln-prize.ts",
    source: category.sourceLabel,
    notes:
      "Parses the Gettysburg College archive (1991-2024) year sections, handling both the bulleted and the inline single-entry forms of each labelled block, and supplements the 2025-2026 winners from the cited Wikipedia recipient table because gilderlehrman.org returns HTTP 403 to automated fetches and the Gettysburg archive stops at 2024.",
    officialUrl: prize.officialUrl,
    supplementalSource: `Wikipedia: ${wikipediaUrl}`,
    records: records.length,
    winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
    finalists: records.filter((record) => record.status === "finalist").length,
    honorableMentions: records.filter((record) => record.status === "honorable_mention").length,
    yearRange: yearRange(records),
    coWinnerYears,
    coverageNotes:
      "Finalist and honorable-mention slates for 2025-2026 are not available from either source. The 1991 First Place award to Ken Burns's television miniseries The Civil War and the 2014 Special Achievement Award to Steven Spielberg's film Lincoln are excluded as non-books, so 1991 has no winner record. The 2000 Lifetime Achievement Award to Richard N. Current and the 2001/2003 E-Lincoln Prizes for websites and a CD-ROM are excluded because they honour no book. The 1993 and 1997 First Place awards are lifetime-achievement citations; the books they single out are recorded as winners with a note.",
    excludedNonBooks: [...excludedNonBooks.values()],
  });
  console.log(`Imported ${records.length} Lincoln Prize records (${yearRange(records)}); co-winner years: ${coWinnerYears.join(", ")}.`);
}

export function parseLincolnPrizeArchive(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const headings = [...html.matchAll(/<h2\b[^>]*id=["']prize-((?:19|20)\d{2})["'][^>]*>/gi)];
  if (!headings.length) throw new Error("No <h2 id=\"prize-YYYY\"> year headings found in the Lincoln Prize archive");

  const records: RawAwardRecord[] = [];
  for (const [index, heading] of headings.entries()) {
    const year = Number(heading[1]);
    const start = (heading.index ?? 0) + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index ?? html.length : html.length;
    records.push(...parseYearBlock(prize, category, year, html.slice(start, end)));
  }

  return markSharedFirstPlaceYears(records);
}

function parseYearBlock(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  block: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  let handling: LabelHandling | undefined;

  // Several list items and paragraphs in the archive are never closed, so each token
  // runs until its own closing tag or the start of the next block-level element.
  const tokenPattern = /<p\b[^>]*>([\s\S]*?)(?=<\/p>|<p\b|<ul\b|<h2\b|$)|<li\b[^>]*>([\s\S]*?)(?=<\/li>|<li\b|<\/ul>|$)/gi;
  for (const token of block.matchAll(tokenPattern)) {
    const isParagraph = token[1] !== undefined;
    const text = htmlToPlainText(token[1] ?? token[2] ?? "");
    if (!text) continue;

    let value = text;
    if (isParagraph) {
      const labelled = text.match(/^([A-Za-z][A-Za-z\s-]*?)\s*:\s*([\s\S]*)$/);
      if (!labelled) continue;
      const label = labelled[1].trim().toLowerCase();
      const next = labelHandling[label];
      if (!next) throw new Error(`Unrecognised Lincoln Prize label in ${year}: ${JSON.stringify(labelled[1])}`);
      handling = next;
      value = labelled[2].trim();
      if (!value) continue;
    }

    if (!handling || handling.kind === "skip") continue;
    for (const entry of parseEntries(value)) {
      const key = `${year}|${slugify(entry.title)}`;
      if (excludedNonBooks.has(key)) continue;
      records.push({
        awardId: prize.id,
        awardName: prize.name,
        categoryId: category.id,
        categoryName: category.name,
        year,
        status: handling.status,
        title: entry.title,
        authors: entry.authors,
        sourceUrl: `${category.sourceUrl}#prize-${year}`,
        sourceLabel: `${category.sourceLabel} (${year})`,
        sourceConfidence: "official",
        notes: [handling.note, entry.note].filter(Boolean).join(" ") || undefined,
      });
    }
  }

  return records;
}

/** Splits one archive line into its `Author, “Title”` pairs; a line may hold two of them. */
export function parseEntries(value: string): ParsedEntry[] {
  const line = cleanText(value);
  if (lineOverrides[line]) return lineOverrides[line];

  const entries: ParsedEntry[] = [];
  for (const match of line.matchAll(/([^“”"]+?)\s*,?\s*[“"]\s*([^“”"]+?)\s*[”"]/g)) {
    const title = cleanTitle(match[2]);
    if (!title) continue;
    const previous = entries.at(-1);
    // A citation naming several books ("... recognition of “A” and “B”") repeats no author.
    if (/^(?:and|&|,|\s)*$/i.test(match[1]) && previous) {
      entries.push({ authors: previous.authors, title, note: previous.note });
      continue;
    }
    const parsed = parseAuthorSegment(match[1]);
    if (!parsed) continue;
    entries.push({ authors: parsed.authors, title, note: parsed.note });
  }
  return entries;
}

function parseAuthorSegment(segment: string): { authors: string[]; note?: string } | undefined {
  let value = cleanText(segment).replace(/^(?:and|&|,)\s+/i, "").replace(/[,;]\s*$/, "");
  let note: string | undefined;

  // "Name, Lifetime Achievement with special recognition of ..." citations (1993, 1997).
  const lifetime = value.match(/^(.*?),\s*Lifetime Achievement\b/i);
  if (lifetime) {
    value = lifetime[1];
    note = "The official archive records this as a Lifetime Achievement citation singling out this book.";
  }

  value = value
    .replace(/,?\s*(?:et al\.?|eds?\.)\s*$/i, "")
    .replace(/[,;]\s*$/, "")
    .trim();
  if (!value || /\d/.test(value) || value.length > 90 || /\b(?:for|of|the)\s*$/i.test(value)) return undefined;

  const authors = splitAuthors(value);
  return authors.length ? { authors, note } : undefined;
}

/**
 * The archive sometimes drops a stray comma inside a single name ("Ron, Chernow",
 * "William W., Freehling"), so a comma only separates two authors when both sides
 * read as full names; single-token fragments are re-joined with their neighbour.
 */
function splitAuthors(value: string): string[] {
  return value
    .split(/\s+and\s+/i)
    .flatMap((chunk) => {
      const parts = chunk.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
      const merged: string[] = [];
      for (const part of parts) {
        const previous = merged.at(-1);
        if (previous && NAME_SUFFIX.test(part)) {
          merged[merged.length - 1] = `${previous}, ${part}`;
          continue;
        }
        if (previous && (tokenCount(part) < 2 || tokenCount(previous) < 2)) {
          merged[merged.length - 1] = `${previous} ${part}`;
          continue;
        }
        merged.push(part);
      }
      return merged;
    })
    .map((author) => cleanText(author))
    .map((author) => authorOverrides[author] ?? author)
    .filter(Boolean);
}

function tokenCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function cleanTitle(value: string) {
  return cleanText(value)
    .replace(/\s*\([^()]*(?:Press|Books|Publishing|Publishers)\)\s*$/i, "")
    .replace(/[,;]\s*$/, "")
    .trim();
}

/** First Place blocks listing two different authors are shared prizes. */
function markSharedFirstPlaceYears(records: RawAwardRecord[]): RawAwardRecord[] {
  const authorsByYear = new Map<number, Set<string>>();
  for (const record of records) {
    if (record.status !== "winner") continue;
    const set = authorsByYear.get(record.year) ?? new Set<string>();
    set.add(record.authors.map(slugify).sort().join("+"));
    authorsByYear.set(record.year, set);
  }
  return records.map((record) => record.status === "winner" && (authorsByYear.get(record.year)?.size ?? 0) > 1
    ? { ...record, status: "co_winner" as RawAwardRecordStatus }
    : record);
}

/** Winners after the Gettysburg archive's last covered year, from the cited Wikipedia table. */
export function parseLincolnPrizeRecentWinners(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
  minYear = archiveLastYear + 1,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];
  for (const row of wikitext.split(/\n\|-\s*\n/)) {
    const rowBody = row.split(/\n\|\}/)[0];
    const cells = rowBody
      .split(/\n\s*\|(?!\})/)
      .map((cell) => cell.replace(/^\s*\|/, "").trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    const year = Number(wikiToPlainText(cells[0]));
    if (!Number.isInteger(year) || year < minYear) continue;
    const authors = splitAuthors(wikiToPlainText(cells[1]));
    const title = cleanTitle(wikiToPlainText(cells[2]));
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
      sourceUrl: wikipediaUrl,
      sourceLabel: "Wikipedia: Lincoln Prize recipients",
      sourceConfidence: "secondary",
      notes: `The Gettysburg College archive stops at ${archiveLastYear} and gilderlehrman.org blocks automated fetching, so this winner comes from the cited Wikipedia recipient table; the ${year} finalist slate is not covered.`,
    });
  }
  return records;
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 130) throw new Error(`Expected at least 130 Lincoln Prize records, got ${records.length}`);
  if (yearRange(records) !== "1991-2026") throw new Error(`Unexpected Lincoln Prize year range: ${yearRange(records)}`);

  const coWinnerYears = new Set(records.filter((record) => record.status === "co_winner").map((record) => record.year));
  if (coWinnerYears.size !== 8) {
    throw new Error(`Expected 8 shared First Place years, got ${coWinnerYears.size}: ${[...coWinnerYears].sort().join(", ")}`);
  }

  const winnerYears = new Set(
    records.filter((record) => record.status === "winner" || record.status === "co_winner").map((record) => record.year),
  );
  // 1991 is intentionally absent: its only First Place honoree was a television miniseries.
  for (let year = 1992; year <= 2026; year += 1) {
    if (!winnerYears.has(year)) throw new Error(`Missing Lincoln Prize winner for ${year}`);
  }
  const years = new Set(records.map((record) => record.year));
  for (let year = 1991; year <= 2026; year += 1) {
    if (!years.has(year)) throw new Error(`Missing Lincoln Prize year ${year}`);
  }
}

function statusRank(status: RawAwardRecordStatus) {
  const order: RawAwardRecordStatus[] = ["winner", "co_winner", "finalist", "honorable_mention"];
  const index = order.indexOf(status);
  return index === -1 ? order.length : index;
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
