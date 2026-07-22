import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  stripCellAttributes,
  wikiToPlainText,
  writeRawAwardRecords,
} from "./helpers";

const pageTitle = "Wellcome Book Prize";

// The Wellcome prize accepted both fiction and nonfiction. This reviewed set is
// deliberately explicit so later source refreshes cannot silently admit novels.
const nonfictionTitles = new Set([
  "Amateur: A true story about what makes a man", "Heart: A History", "Mind on Fire: A memoir of madness and recovery", "The Trauma Cleaner: One woman’s extraordinary life in death, decay and disaster",
  "To Be a Machine: Adventures Among Cyborgs, Utopians, Hackers, and the Futurists Solving the Modest Problem of Death", "The Butchering Art: Joseph Lister's Quest to Transform the Grisly World of Victorian Medicine", "With the End in Mind: Dying, Death, and Wisdom in an Age of Denial", "Mayhem: A Memoir", "The Vaccine Race: Science, Politics, and the Human Costs of Defeating Disease",
  "I Contain Multitudes: The Microbes Within Us and a Grander View of Life", "The Gene: An Intimate History", "How to Survive a Plague: The Inside Story of How Citizens and Science Tamed AIDS", "When Breath Becomes Air",
  "It's All in Your Head: True Stories of Imaginary Illness", "The Outrun", "The Last Act of Love: The Story of My Brother and His Sister", "NeuroTribes: The Legacy of Autism and the Future of Neurodiversity",
  "The Iceberg: A Memoir", "Do No Harm: Stories of Life, Death and Brain Surgery", "The Incredible Unlikeliness of Being: Evolution and the Making of Us", "My Age of Anxiety: Fear, Hope, Dread, and the Search for Peace of Mind",
  "Far from the Tree: Parents, Children, and the Search for Identity", "Wounded: From Battlefield to Blighty", "Creation: The Origin of Life", "Hallucinations", "Inconvenient People",
  "Circulation: William Harvey, a Man in Motion", "The Hour Between Dog and Wolf: Risk-taking, Gut Feelings and the Biology of Boom and Bust", "The Train in the Night: A Story of Music and Loss",
  "The Emperor of All Maladies: A Biography of Cancer", "The Two Kinds of Decay",
  "The Immortal Life of Henrietta Lacks", "Angel of Death: The Story of Smallpox", "Medic: Saving Lives – from Dunkirk to Afghanistan", "Teach Us to Sit Still: A Sceptic's Search for Health and Healing",
  "Keeper: Living with Nancy – A Journey into Alzheimer's", "The Hypochondriacs: Nine Tormented Lives", "Illness (Art of Living)", "Sizwe's Test: A Young Man's Journey Through Africa's AIDS Epidemic",
].map(slugify));

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "wellcome-book-prize");
  const category = prize?.categories.find((entry) => entry.id === "wellcome-nonfiction");
  if (!prize || !category) throw new Error("Missing Wellcome Book Prize registry entry");

  console.log(`Fetching ${pageTitle} table from MediaWiki...`);
  const records = parseWellcomeNonfiction(prize, category, await fetchMediaWikiWikitext(pageTitle));
  if (records.length < 35) throw new Error(`Wellcome nonfiction parser returned only ${records.length} records`);
  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("wellcome-book-prize.json", records, {
    importer: "scripts/import-award-records/wellcome-book-prize.ts",
    source: category.sourceLabel,
    notes: "The historical prize accepted fiction and nonfiction. This importer uses an explicit reviewed nonfiction title set and excludes every novel in the mixed winner/shortlist table. The prize paused after 2019.",
    records: records.length,
    winners: records.filter((record) => record.status === "winner").length,
    shortlisted: records.filter((record) => record.status === "shortlist").length,
    awardYears: [...new Set(records.map((record) => record.year))].sort(),
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} nonfiction Wellcome records (${yearRange(records)}).`);
}

export function parseWellcomeNonfiction(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  wikitext: string,
): RawAwardRecord[] {
  const start = wikitext.indexOf("==Winners and shortlisted nominees==");
  const end = wikitext.indexOf("==References==", start);
  if (start < 0 || end < 0) throw new Error("Could not locate Wellcome winner table");
  const records: RawAwardRecord[] = [];

  for (const chunk of wikitext.slice(start, end).split(/\n\|-/).slice(2)) {
    const cells = parseRowCells(chunk);
    const year = Number(wikiToPlainText(cells[0] ?? "").match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!year || year === 2013 || cells.length < 4) continue;
    const winner = parseAuthorTitle(`${cells[1]}, ${cells[2]}`);
    if (winner && nonfictionTitles.has(slugify(winner.title))) {
      records.push(makeRecord(prize, category, year, "winner", winner));
    }
    for (const item of parseBulletedList(cells[3])) {
      const parsed = parseAuthorTitle(item);
      if (parsed && nonfictionTitles.has(slugify(parsed.title))) {
        records.push(makeRecord(prize, category, year, "shortlist", parsed));
      }
    }
  }
  return records;
}

function makeRecord(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  year: number,
  status: "winner" | "shortlist",
  item: { title: string; authors: string[] },
): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year,
    status,
    title: item.title,
    authors: item.authors,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
    notes: category.officialUrl ? `Official prize archive: ${category.officialUrl}` : undefined,
  };
}

function parseRowCells(row: string) {
  return row.split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[!|]/.test(line) && !/^\|}$/.test(line))
    .map((line) => stripCellAttributes(line.replace(/^[!|]\s*/, "")))
    .filter(Boolean);
}

function parseBulletedList(input: string) {
  const body = input.match(/\{\{\s*bulleted list\s*\|([\s\S]+)\}\}/i)?.[1];
  return body ? splitTopLevel(body).map((item) => item.trim()).filter(Boolean) : [];
}

function splitTopLevel(input: string) {
  const output: string[] = [];
  let current = "";
  let templateDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index, index + 2);
    if (pair === "{{") templateDepth += 1;
    if (pair === "}}") templateDepth = Math.max(0, templateDepth - 1);
    if (pair === "[[") linkDepth += 1;
    if (pair === "]]" ) linkDepth = Math.max(0, linkDepth - 1);
    if (input[index] === "|" && templateDepth === 0 && linkDepth === 0) {
      output.push(current);
      current = "";
    } else {
      current += input[index];
    }
  }
  output.push(current);
  return output;
}

function parseAuthorTitle(input: string) {
  const titleMatch = input.match(/''([\s\S]+?)''/);
  if (!titleMatch?.[1] || titleMatch.index === undefined) return undefined;
  const authorText = wikiToPlainText(input.slice(0, titleMatch.index).replace(/,\s*$/, ""));
  const authors = normalizeAuthorList(authorText);
  const title = cleanText(wikiToPlainText(titleMatch[1]));
  if (!authors.length || !title) return undefined;
  return { authors, title };
}

function statusSort(status: RawAwardRecord["status"]) {
  return status === "winner" ? 1 : 2;
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
