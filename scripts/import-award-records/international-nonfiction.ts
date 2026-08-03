import fs from "node:fs/promises";
import path from "node:path";
import type {
  PrizeRegistryEntry,
  RawAwardRecord,
  RawAwardRecordStatus,
  RawEnglishEdition,
} from "../../lib/award-records";
import { readPrizeRegistry, writeRawAwardRecords } from "./helpers";

/**
 * Imports the seven non-anglophone nonfiction prizes.
 *
 * Unlike the other importers, this one does not fetch: the source wikitext is in
 * six languages with per-award table shapes, so extraction lives in
 * scripts/staging/extract-international-awards.py (re-runnable with --fetch) and
 * English-edition resolution in scripts/staging/resolve-english-editions.py.
 * This importer maps that resolved staging file onto RawAwardRecord so the usual
 * quality gates and historical-regression guard apply.
 */

const STAGING = path.join(process.cwd(), "sources", "international-awards.english-editions.json");

type StagingEntry = {
  year: number;
  status: "winner" | "finalist" | "longlist";
  originalTitle: string;
  authors: string[];
  publisher?: string | null;
  originalLanguage?: string | null;
  polishTitle?: string | null;
  englishEdition?: {
    status: string;
    englishTitle?: string;
    englishYear?: number;
    publisher?: string;
    isbn13?: string;
  };
};

type StagingAward = {
  id: string;
  name: string;
  originalName: string;
  primaryLanguage: string;
  sourceUrl: string;
  entries: StagingEntry[];
};

const CATEGORY: Record<string, { categoryId: string; file: string }> = {
  "leipzig-book-fair-prize-nonfiction": { categoryId: "leipzig-nonfiction", file: "leipzig-book-fair-nonfiction.json" },
  "deutscher-sachbuchpreis": { categoryId: "deutscher-sachbuchpreis-nonfiction", file: "deutscher-sachbuchpreis.json" },
  "libris-geschiedenis-prijs": { categoryId: "libris-geschiedenis-history", file: "libris-geschiedenis-prijs.json" },
  "augustpriset-fackbok": { categoryId: "augustpriset-nonfiction", file: "augustpriset-fackbok.json" },
  "ryszard-kapuscinski-award": { categoryId: "kapuscinski-reportage", file: "ryszard-kapuscinski-award.json" },
  "prix-goncourt-de-la-biographie": { categoryId: "goncourt-biographie", file: "prix-goncourt-de-la-biographie.json" },
  "brageprisen-sakprosa": { categoryId: "brageprisen-nonfiction", file: "brageprisen-sakprosa.json" },
  "sheikh-zayed-book-award": { categoryId: "sheikh-zayed-nonfiction", file: "sheikh-zayed-book-award.json" },
  "premio-strega-saggistica": { categoryId: "strega-saggistica", file: "premio-strega-saggistica.json" },
};

async function main() {
  const registry = await readPrizeRegistry();
  const staging = JSON.parse(await fs.readFile(STAGING, "utf8")) as { awards: StagingAward[] };

  for (const award of staging.awards) {
    const mapping = CATEGORY[award.id];
    if (!mapping) throw new Error(`No category mapping for ${award.id}`);
    const prize = registry.find((entry) => entry.id === award.id);
    const category = prize?.categories.find((entry) => entry.id === mapping.categoryId);
    if (!prize || !category) throw new Error(`Missing registry entry for ${award.id}/${mapping.categoryId}`);

    const records = toRecords(award, prize, mapping.categoryId, category.name, category.sourceLabel);
    records.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

    const withEnglish = award.entries.filter(
      (entry) => entry.englishEdition?.status === "confirmed" || entry.englishEdition?.status === "native-english",
    ).length;

    await writeRawAwardRecords(mapping.file, records, {
      importer: "scripts/import-award-records/international-nonfiction.ts",
      source: category.sourceLabel,
      notes:
        `Non-anglophone nonfiction prize (${award.primaryLanguage}). Extracted by ` +
        `scripts/staging/extract-international-awards.py; English editions resolved by ` +
        `scripts/staging/resolve-english-editions.py.`,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      withConfirmedEnglishEdition: withEnglish,
      yearRange: yearRange(records),
    });
    console.log(`${award.id}: ${records.length} records (${yearRange(records)}), ${withEnglish} with English editions.`);
  }
}

export function toRecords(
  award: StagingAward,
  prize: PrizeRegistryEntry,
  categoryId: string,
  categoryName: string,
  sourceLabel: string,
): RawAwardRecord[] {
  // Years with more than one winner are genuine ties, not parse errors.
  const winnersPerYear = new Map<number, number>();
  for (const entry of award.entries) {
    if (entry.status === "winner") winnersPerYear.set(entry.year, (winnersPerYear.get(entry.year) ?? 0) + 1);
  }

  return award.entries.map((entry) => {
    const status: RawAwardRecordStatus =
      entry.status === "winner" ? ((winnersPerYear.get(entry.year) ?? 0) > 1 ? "co_winner" : "winner") : entry.status;

    const notes: string[] = [];
    if (entry.originalLanguage && entry.originalLanguage !== "en") {
      notes.push(`Original language: ${entry.originalLanguage}.`);
    }
    if (entry.polishTitle) notes.push(`Polish edition title: ${entry.polishTitle}.`);
    const english = entry.englishEdition;
    if (english?.status === "confirmed" && english.englishTitle) {
      notes.push(
        `English edition: ${english.englishTitle}` +
          (english.englishYear ? ` (${english.publisher ?? "unknown publisher"}, ${english.englishYear})` : ""),
      );
    } else if (english?.status === "native-english") {
      notes.push("English-language original.");
    } else if (english?.status === "no-english-found") {
      notes.push("No English edition found.");
    } else {
      notes.push("English edition status unresolved.");
    }

    return {
      awardId: award.id,
      awardName: award.name,
      categoryId,
      categoryName,
      year: entry.year,
      status,
      title: entry.originalTitle,
      authors: entry.authors,
      ...(entry.publisher ? { publisher: entry.publisher } : {}),
      sourceUrl: award.sourceUrl,
      sourceLabel,
      sourceConfidence: "secondary" as const,
      notes: notes.join(" "),
      originalLanguage: entry.originalLanguage ?? award.primaryLanguage,
      englishEdition: toEnglishEdition(english),
    };
  });
}

function toEnglishEdition(english: StagingEntry["englishEdition"]): RawEnglishEdition {
  if (!english) return { status: "unresolved" };
  if (english.status === "native-english") return { status: "native-english" };
  if (english.status === "confirmed") {
    return {
      status: "confirmed",
      ...(english.englishTitle ? { title: english.englishTitle } : {}),
      ...(english.englishYear ? { year: english.englishYear } : {}),
      ...(english.publisher ? { publisher: english.publisher } : {}),
      ...(english.isbn13 ? { isbn13: english.isbn13 } : {}),
    };
  }
  if (english.status === "no-english-found") return { status: "no-english-found" };
  return { status: "unresolved" };
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return `${Math.min(...years)}-${Math.max(...years)}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
