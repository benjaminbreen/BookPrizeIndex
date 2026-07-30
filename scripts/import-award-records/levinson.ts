import { pathToFileURL } from "node:url";
import type {
  PrizeCategoryRegistryEntry,
  PrizeRegistryEntry,
  RawAwardRecord,
} from "../../lib/award-records";
import { readPrizeRegistry, writeRawAwardRecords } from "./helpers";

const prizeId = "suzanne-j-levinson-prize";
const categoryId = "levinson-life-sciences-natural-history";

type LevinsonWinner = {
  year: number;
  title: string;
  authors: string[];
  publisher: string;
};

// The official HSS page is a compact ten-row archive but returns a Cloudflare 403
// to automated clients. These rows were reviewed directly against that archive.
const winners: LevinsonWinner[] = [
  {
    year: 2024,
    title: "Knowing Manchuria: Environments, the Senses, and Natural Knowledge on an Asian Borderland",
    authors: ["Ruth Rogaski"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2022,
    title: "Blood Relations: Transfusion and the Making of Human Genetics",
    authors: ["Jenny Bangham"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2020,
    title: "Creatures of Cain: The Hunt for Human Nature in Cold War America",
    authors: ["Erika Lorraine Milam"],
    publisher: "Princeton University Press",
  },
  {
    year: 2018,
    title: "Darwin and the Making of Sexual Selection",
    authors: ["Evelleen Richards"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2016,
    title: "Haeckel’s Embryos: Images, Evolution, and Fraud",
    authors: ["Nick Hopwood"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2014,
    title: "Visible Empire: Botanical Expeditions and Visual Culture in the Hispanic Enlightenment",
    authors: ["Daniela Bleichmar"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2012,
    title: "Worlds Before Adam: The Reconstruction of Geohistory in the Age of Reform",
    authors: ["Martin J. S. Rudwick"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2010,
    title: "The Simian Tongue: The Long Debate about Animal Language",
    authors: ["Gregory Radick"],
    publisher: "University of Chicago Press",
  },
  {
    year: 2008,
    title: "Culturing Life: How Cells Became Technologies",
    authors: ["Hannah Landecker"],
    publisher: "Harvard University Press",
  },
  {
    year: 2006,
    title: "Charles Darwin: Geologist",
    authors: ["Sandra Herbert"],
    publisher: "Cornell University Press",
  },
];

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === prizeId);
  const category = prize?.categories.find((entry) => entry.id === categoryId);
  if (!prize || !category) throw new Error(`Missing ${prizeId} / ${categoryId} registry entry`);

  const records = buildLevinsonRecords(prize, category);
  assertCoverage(records);
  await writeRawAwardRecords("suzanne-j-levinson-prize.json", records, {
    importer: "scripts/import-award-records/levinson.ts",
    source: category.sourceLabel,
    notes:
      "Reviewed official winner rows. The HSS archive is canonical but blocks automated command-line " +
      "retrieval with HTTP 403, so the compact biennial list is encoded directly and should be checked " +
      "against the official page when the 2026 prize is announced.",
    records: records.length,
    winners: records.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${records.length} Suzanne J. Levinson Prize winners (${yearRange(records)}).`);
}

export function buildLevinsonRecords(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
): RawAwardRecord[] {
  return winners.map((winner) => ({
    awardId: prize.id,
    awardName: prize.name,
    categoryId: category.id,
    categoryName: category.name,
    year: winner.year,
    status: "winner",
    title: winner.title,
    authors: winner.authors,
    publisher: winner.publisher,
    sourceUrl: category.sourceUrl,
    sourceLabel: category.sourceLabel,
    sourceConfidence: category.sourceConfidence,
  }));
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length !== 10) throw new Error(`Expected 10 Levinson winners, got ${records.length}`);
  if (yearRange(records) !== "2006-2024") throw new Error(`Unexpected Levinson range: ${yearRange(records)}`);
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].year - records[index].year !== 2) {
      throw new Error(`Unexpected Levinson year sequence around ${records[index - 1].year}`);
    }
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
