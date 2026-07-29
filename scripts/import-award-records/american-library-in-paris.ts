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
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  writeRawAwardRecords,
} from "./helpers";

const prizeId = "american-library-in-paris-book-award";
const categoryId = "american-library-in-paris-nonfiction";
const sourcePage = "https://americanlibraryinparis.org/bookaward/";

/**
 * The Book Award is open to every genre and its shortlists mix novels with history,
 * biography, and reportage. Both sets below are deliberately explicit: every parsed row
 * must appear in exactly one of them, so a future refresh that introduces an
 * unclassified title fails loudly instead of silently admitting or dropping a book.
 */
const nonfictionTitles = new Set([
  // 2026 longlist
  "Baldwin: A Love Story",
  "Becoming George: The Invention of George Sand",
  "First Emancipation: The Forgotten History of Abolition in Revolutionary France",
  "Fractured France: A Journey through a Divided Nation",
  "Hotel Exile: Paris in the Shadow of War",
  "The Typewriter and the Guillotine: An American Journalist, a German Serial Killer, and Paris on the Eve of WWII",
  "A Vast Horizon: Artists and Lovers, Freedom and War",
  // 2025
  "Wild Thing: A Life of Paul Gauguin",
  "A Complicated Passion: The Life and Work of Agnès Varda",
  "Gertrude Stein: An Afterlife",
  // 2024
  "The Rebel’s Clinic: The Revolutionary Lives of Frantz Fanon",
  "The Revolutionary Temper: Paris, 1748–1789",
  "House of Lilies: The Dynasty That Made Medieval France",
  "Monet: The Restless Vision",
  // 2023
  "Americans in Paris: Artists Working in Postwar France, 1946–1962",
  "The Curse of the Marquis de Sade: A Notorious Scoundrel, a Mythical Manuscript, and the Biggest Scandal in Literary History",
  "France on Trial: The Case of Marshal Pétain",
  "#You Know You’re Black in France When…: The Fact of Everyday Antiblackness",
  // 2022
  "France: An Adventure History",
  "The French Mind: 400 Years of Romance, Revolution and Renewal",
  "In the Forest of No Joy: The Congo-Océan Railroad and the Tragedy of French Colonialism",
  // 2021
  "Letters to Camondo",
  "Black Spartacus: The Epic Life of Toussaint Louverture",
  "An Infinite History: The Story of a Family in France over Three Centuries",
  // 2020
  "Dirt: Adventures in Lyon as a Chef in Training, Father, and Sleuth Looking for the Secret of French Cooking",
  "The Louvre: The Many Lives of the World’s Most Famous Museum",
  "Before Trans: Three Gender Stories from Nineteenth-Century France",
  "The Plateau",
  "The Betrayal of the Duchess: The Scandal That Unmade the Bourbon Monarchy and Made France Modern",
  // 2019
  "Diderot and the Art of Thinking Freely",
  "A Bite-Sized History of France: Gastronomic Tales of Revolution, War, and Enlightenment",
  "Hate: The Rising Tide of Anti-Semitism in France (and What it Means for Us)",
  // 2018
  "The Great Nadar: The Man Behind the Camera",
  "A Certain Idea of France: The Life of Charles de Gaulle",
  "Caesar’s Footprints: A Cultural Excursion to Ancient France: Journeys Through Roman Gaul",
  "Proust’s Duchess: How Three Celebrated Women Captured the Imagination of Fin-de-Siècle Paris",
  // 2017
  "The Novel of the Century: The Extraordinary Adventure of Les Misérables",
  "Mad Enchantment: Claude Monet and the Painting of the Water Lilies",
  "Duck Season: Eating, Drinking, and Other Misadventures in Gascony—France’s Last Best Place",
  "I’m Supposed to Protect You from All This: A memoir",
  "The Némirovsky Question: The Life, Death, and Legacy of a Jewish Writer in Twentieth-Century France",
  // 2016
  "At the Existentialist Café: Freedom, Being, and Apricot Cocktails",
  "The Bonjour Effect: The Secret Codes of French Conversation Revealed",
  "Paris at War: 1939-1944",
  "The Burdens of Brotherhood: Jews and Muslims from North Africa to France",
  "The Other Paris",
  // 2015
  "The Marquis: Lafayette Reconsidered",
  "The Other Americans in Paris: Businessmen, Countesses, Wayward Youth 1880-1941",
  "Fatal Isolation: The Devastating Paris Heat Wave of 2003",
  "In Montmartre: Picasso, Matisse, and Modernism in Paris, 1900-1910",
  "When Paris Went Dark: The City of Light Under German Occupation 1940-1944",
  // 2014
  "How to Ruin a Queen: Marie Antoinette, the Stolen Diamonds and the Scandal that Shook the French Throne",
  "The Embrace of Unreason: France 1914-1940",
  "Brave Genius: A Scientist, a Philosopher, and their Daring Adventures from the French Resistance to the Nobel Prize",
  "Citizen Emperor: Napoleon in Power 1799-1815",
  // 2013
  "Cezanne: A Life",
  "Embers of War: The Fall of an Empire and the Making of America’s Vietnam",
  "The Black Count: Glory, Revolution, Betrayal, and the Real Count of Monte Cristo",
  "How the French Invented Love: Nine Hundred Years of Passion and Romance",
].map(slugify));

/**
 * Reviewed fiction, excluded from the corpus. A few need a note beyond the title:
 *  - "Riverwork" is Lisa Robertson's second novel (Coach House Books, 2026).
 *  - "Rousseau's Lost Children" is a time-slip novel about a Rousseau scholar, not the
 *    author's earlier memoir.
 *  - "City of Incurable Women" is a set of fictional monologues for Charcot's patients.
 *  - "Voices: The Final Hours of Joan of Arc" is a verse novel.
 *  - "Joan: A Novel" and "An Officer and a Spy" won in 2023 and 2014, which is why those
 *    two years contribute shortlist rows but no winner.
 */
const fictionTitles = new Set([
  "My Year in Paris with Gertrude Stein: A Fiction",
  "Riverwork",
  "Rousseau’s Lost Children",
  "Creation Lake",
  "This Strange Eventful History: A Novel",
  "Joan: A Novel",
  "The Caretakers: A Novel",
  "City of Incurable Women",
  "Leonora in the Morning Light",
  "Perestroika in Paris",
  "The Vexations: A Novel",
  "Little: A Novel",
  "Voices: The Final Hours of Joan of Arc",
  "The Flight Portfolio: A Novel",
  "Never Anyone But You",
  "The Inquisitor’s Tale: Or, The Three Magical Children and Their Holy Dog",
  "A Country Road, A Tree: A Novel",
  "An Officer and a Spy",
  "Lovers at the Chameleon Club, Paris 1932",
  "The Illusion of Separateness: A Novel",
].map(slugify));

/**
 * The 2024 shortlist entry truncates the winner's subtitle; the year's own winner
 * heading, the press coverage, and the book itself all carry the full title.
 */
const titleOverrides = new Map<string, string>([
  ["The Rebel’s Clinic: The Revolutionary Lives", "The Rebel’s Clinic: The Revolutionary Lives of Frantz Fanon"],
]);

type ParsedEntry = { title: string; authors: string[]; publisher?: string };

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);

  console.log(`Fetching ${sourcePage}...`);
  const records = parseAmericanLibraryInParis(prize, category, await fetchHtml(sourcePage));
  assertCoverage(records);

  const byStatus = countByStatus(records);
  await writeRawAwardRecords("american-library-in-paris.json", records, {
    importer: "scripts/import-award-records/american-library-in-paris.ts",
    source: category.sourceLabel,
    notes:
      "The official Book Award page carries every year in one document: a longlist block for the " +
      "year in progress and an accordion of past years, each holding a winner heading plus the full " +
      "shortlist. The prize is open to all genres, so the importer keeps only titles in an explicit " +
      "reviewed nonfiction set; every parsed row must be classified as nonfiction or fiction, and an " +
      "unclassified title aborts the import.",
    records: records.length,
    winners: byStatus.winner ?? 0,
    shortlisted: byStatus.shortlist ?? 0,
    longlisted: byStatus.longlist ?? 0,
    yearRange: yearRange(records),
    coverageNotes:
      "2023 (Katherine J. Chen, Joan) and 2014 (Robert Harris, An Officer and a Spy) went to novels, " +
      "so those years carry shortlist rows but no winner. The most recent year is longlist-only until " +
      "the shortlist is announced each September.",
  });
  console.log(`Imported ${records.length} nonfiction American Library in Paris records (${yearRange(records)}).`);
}

export function parseAmericanLibraryInParis(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const lines = toBlockLines(html);
  const records: RawAwardRecord[] = [];

  for (const { year, status, entry } of readLonglist(lines)) {
    const record = classify(prize, category, year, status, entry);
    if (record) records.push(record);
  }
  for (const section of readPastYearSections(lines)) {
    records.push(...parseSection(prize, category, section));
  }

  return records.sort(
    (a, b) => b.year - a.year || statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title),
  );
}

/**
 * Renders the page to one logical line per paragraph or list row. Only block-level tags
 * become newlines: the shortlist rows wrap their titles in nested <strong>/<em>/<a> runs
 * whose boundaries fall mid-word ("<strong>Fran</strong>ce: An Adventure History"), so
 * turning every tag into a break would shred the titles.
 */
export function toBlockLines(html: string) {
  const text = decodeHtmlEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|h[1-6]|div|li|ul|ol|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
}

/** The in-progress year appears above the accordion as "The YYYY Book Award Longlist". */
function readLonglist(lines: string[]) {
  const results: Array<{ year: number; status: RawAwardRecordStatus; entry: ParsedEntry }> = [];
  const headingIndex = lines.findIndex((line) => /^The ((?:19|20)\d{2}) Book Award Longlist$/.test(line));
  if (headingIndex < 0) return results;
  const year = Number(lines[headingIndex].match(/(?:19|20)\d{2}/)?.[0]);

  for (const line of lines.slice(headingIndex + 1)) {
    const entry = parseEntryLine(line);
    if (!entry) break; // the list ends at the "Download the press release" note
    results.push({ year, status: "longlist", entry });
  }
  if (!results.length) throw new Error(`Parsed no entries for the ${year} longlist`);
  return results;
}

/**
 * Past years live in an accordion under "Past Winners". Its tab strip repeats every year
 * as a bare line before the panels do, so a bare year only starts a section when the line
 * after it is not itself a bare year.
 */
function readPastYearSections(lines: string[]) {
  const start = lines.indexOf("Past Winners");
  if (start < 0) throw new Error("Could not find the Past Winners heading");

  const isBareYear = (line?: string) => Boolean(line && /^(?:19|20)\d{2}$/.test(line));
  const starts: Array<{ year: number; index: number }> = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isBareYear(lines[index]) && !isBareYear(lines[index + 1])) {
      starts.push({ year: Number(lines[index]), index });
    }
  }
  if (!starts.length) throw new Error("Could not find any past-year sections");

  return starts.map(({ year, index }, position) => ({
    year,
    lines: lines.slice(index + 1, starts[position + 1]?.index ?? lines.length),
  }));
}

function parseSection(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  section: { year: number; lines: string[] },
): RawAwardRecord[] {
  const { year, lines } = section;
  const winnerSurname = readWinnerSurname(year, lines);

  const listStart = lines.findIndex((line) => /^The shortlist was announced\b/i.test(line));
  if (listStart < 0) throw new Error(`Could not find the ${year} shortlist announcement`);

  const records: RawAwardRecord[] = [];
  let matchedWinner = 0;
  for (const line of lines.slice(listStart + 1)) {
    if (/^(?:All\b|Here is\b|Read the\b)/.test(line)) break;
    const entry = parseEntryLine(line);
    if (!entry) throw new Error(`Unparsed ${year} shortlist row: ${line}`);

    const isWinner = entry.authors.some((author) => surname(author) === winnerSurname);
    if (isWinner) matchedWinner += 1;
    const record = classify(prize, category, year, isWinner ? "winner" : "shortlist", entry);
    if (record) records.push(record);
  }

  if (!records.length) throw new Error(`Parsed no ${year} shortlist rows`);
  if (matchedWinner > 1) throw new Error(`Matched ${matchedWinner} winners in the ${year} shortlist`);
  if (matchedWinner === 0 && !fictionTitles.has(slugify(readWinnerTitle(year, lines)))) {
    // A winner missing from the year's own shortlist is only expected when the winning
    // book is fiction and therefore out of scope (2023's Joan is listed this way).
    throw new Error(`The ${year} winner is absent from the shortlist and is not reviewed fiction`);
  }
  return records;
}

/** e.g. "The Book Award 2025: Sue Prideaux and Wild Thing: A Life of Paul Gauguin". */
const winnerHeading = /^The (?:Book Award (?:19|20)\d{2}|(?:19|20)\d{2} Book Award): (.+?) and (.+)$/;

function readWinnerHeading(year: number, lines: string[]) {
  const match = lines.map((line) => line.match(winnerHeading)).find(Boolean);
  if (!match) throw new Error(`Could not find the ${year} winner heading`);
  return { author: cleanText(match[1]), title: cleanText(match[2]) };
}

function readWinnerSurname(year: number, lines: string[]) {
  return surname(readWinnerHeading(year, lines).author);
}

function readWinnerTitle(year: number, lines: string[]) {
  return readWinnerHeading(year, lines).title;
}

/**
 * The winner heading and the shortlist row can spell the author differently
 * ("Ethan Katz" vs "Ethan B. Katz"), so the two are matched on surname. Surnames are
 * unique within every year's shortlist.
 */
function surname(author: string) {
  return slugify(author.split(/\s+/).filter(Boolean).at(-1) ?? "");
}

/**
 * Two row grammars appear on the page, both ending in a publisher parenthetical:
 *   2013-2021:  "Author. Title (Publisher)"
 *   2022-:      "Title by Author (Publisher)"
 * The publisher is taken from the final parenthetical because a title may carry one of
 * its own ("Hate: The Rising Tide of Anti-Semitism in France (and What it Means for Us)").
 */
export function parseEntryLine(line: string): ParsedEntry | undefined {
  const publisherMatch = line.match(/\s*\(([^()]+)\)$/);
  if (!publisherMatch) return undefined;
  const publisher = cleanText(publisherMatch[1]) || undefined;
  const body = cleanText(line.slice(0, publisherMatch.index));
  if (!body) return undefined;

  // The lookbehind keeps "Sean B. Carroll" and "J.P. Daughton" from splitting on an initial.
  const authorFirst = body.match(/^([^:]{2,60}?)(?<!\b[A-Z])\.\s+(.+)$/);
  if (authorFirst && !/\sby\s/.test(authorFirst[1])) {
    return finishEntry(authorFirst[2], authorFirst[1], publisher);
  }

  const byIndex = body.lastIndexOf(" by ");
  if (byIndex < 0) return undefined;
  return finishEntry(body.slice(0, byIndex), body.slice(byIndex + 4), publisher);
}

function finishEntry(rawTitle: string, rawAuthors: string, publisher?: string): ParsedEntry | undefined {
  const title = cleanText(rawTitle);
  // "Lynn Gumpert and Debra Bricker Balken, eds." carries an editor marker, not a name.
  const authors = normalizeAuthorList(cleanText(rawAuthors).replace(/,?\s*eds?\.$/i, ""));
  if (!title || !authors.length) return undefined;
  return { title: titleOverrides.get(title) ?? title, authors, publisher };
}

/** Keeps reviewed nonfiction and rejects anything not reviewed at all. */
function classify(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  status: RawAwardRecordStatus,
  entry: ParsedEntry,
): RawAwardRecord | undefined {
  const key = slugify(entry.title);
  if (fictionTitles.has(key)) return undefined;
  if (!nonfictionTitles.has(key)) {
    throw new Error(
      `Unclassified ${year} title ${JSON.stringify(entry.title)}. Review it and add it to ` +
      "nonfictionTitles or fictionTitles in scripts/import-award-records/american-library-in-paris.ts.",
    );
  }
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title: entry.title,
    authors: entry.authors,
    publisher: entry.publisher,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official prize archive: ${category.officialUrl}` : undefined,
  };
}

export function assertCoverage(records: RawAwardRecord[]) {
  const winners = records.filter((record) => record.status === "winner");
  const years = new Set(records.map((record) => record.year));
  for (let year = 2013; year <= Math.max(...years); year += 1) {
    if (!years.has(year)) throw new Error(`Missing American Library in Paris records for ${year}`);
  }

  // 2023 and 2014 went to novels, so every other year through 2025 must carry one winner.
  const fictionWinnerYears = new Set([2014, 2023]);
  for (let year = 2013; year <= 2025; year += 1) {
    const count = winners.filter((record) => record.year === year).length;
    const expected = fictionWinnerYears.has(year) ? 0 : 1;
    if (count !== expected) {
      throw new Error(`Expected ${expected} American Library in Paris winner(s) in ${year}, got ${count}`);
    }
  }
  if (records.length < 55) throw new Error(`Expected at least 55 records, got ${records.length}`);
}

function countByStatus(records: RawAwardRecord[]) {
  const counts: Partial<Record<RawAwardRecordStatus, number>> = {};
  for (const record of records) counts[record.status] = (counts[record.status] ?? 0) + 1;
  return counts;
}

function statusRank(status: RawAwardRecordStatus) {
  if (status === "winner") return 0;
  return status === "shortlist" ? 1 : 2;
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
