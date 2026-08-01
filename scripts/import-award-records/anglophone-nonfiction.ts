import fs from "node:fs/promises";
import path from "node:path";
import type { RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";
import { readPrizeRegistry, writeRawAwardRecords } from "./helpers";

/**
 * Imports nonfiction prizes from anglophone countries outside the US/UK/Canada.
 *
 * Extraction lives in scripts/staging/extract-anglophone-awards.py (re-runnable
 * with --fetch). These works are English originals, so unlike the international
 * importer there is no English-edition resolution step.
 */

const STAGING = path.join(process.cwd(), "sources", "anglophone-awards.staging.json");

type StagingEntry = {
  year: number;
  status: "winner" | "finalist" | "longlist";
  originalTitle: string;
  authors: string[];
  publisher?: string | null;
};

type StagingCategory = { name: string; entries: StagingEntry[] };

type StagingAward = {
  id: string;
  name: string;
  organization: string;
  geography: string;
  sourceUrl: string;
  category?: string;
  entries?: StagingEntry[];
  categories?: StagingCategory[];
};

const FILES: Record<string, string> = {
  "kamaladevi-chattopadhyay-nif-book-prize": "kamaladevi-chattopadhyay-nif-book-prize.json",
  "australian-pm-literary-awards": "australian-pm-literary-awards.json",
  "ockham-new-zealand-book-awards": "ockham-new-zealand-book-awards.json",
  "alan-paton-award": "alan-paton-award.json",
  "irish-book-awards": "irish-book-awards.json",
};

async function main() {
  const registry = await readPrizeRegistry();
  const staging = JSON.parse(await fs.readFile(STAGING, "utf8")) as { awards: StagingAward[] };

  for (const award of staging.awards) {
    const prize = registry.find((entry) => entry.id === award.id);
    if (!prize) throw new Error(`Missing registry entry for ${award.id}`);
    const categories: StagingCategory[] =
      award.categories ?? [{ name: award.category ?? "Nonfiction", entries: award.entries ?? [] }];

    const records: RawAwardRecord[] = [];
    for (const category of categories) {
      if (!category.entries.length) continue;
      const registryCategory = prize.categories.find((entry) => entry.name === category.name);
      if (!registryCategory) throw new Error(`Missing category ${award.id}/${category.name}`);

      // Years with more than one winner are genuine ties, not parse errors.
      const winnersPerYear = new Map<number, number>();
      for (const entry of category.entries) {
        if (entry.status === "winner") {
          winnersPerYear.set(entry.year, (winnersPerYear.get(entry.year) ?? 0) + 1);
        }
      }

      for (const entry of category.entries) {
        const status: RawAwardRecordStatus =
          entry.status === "winner"
            ? ((winnersPerYear.get(entry.year) ?? 0) > 1 ? "co_winner" : "winner")
            : entry.status;
        records.push({
          awardId: award.id,
          awardName: award.name,
          categoryId: registryCategory.id,
          categoryName: category.name,
          year: entry.year,
          status,
          title: entry.originalTitle,
          authors: entry.authors,
          ...(entry.publisher ? { publisher: entry.publisher } : {}),
          sourceUrl: award.sourceUrl,
          sourceLabel: registryCategory.sourceLabel,
          sourceConfidence: "secondary" as const,
        });
      }
    }

    records.sort((a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || a.title.localeCompare(b.title));
    const years = records.map((record) => record.year);
    await writeRawAwardRecords(FILES[award.id], records, {
      importer: "scripts/import-award-records/anglophone-nonfiction.ts",
      source: `Wikipedia: ${award.name}`,
      notes: `Anglophone nonfiction prize (${award.geography}). Extracted by scripts/staging/extract-anglophone-awards.py.`,
      records: records.length,
      winners: records.filter((record) => record.status === "winner" || record.status === "co_winner").length,
      categories: categories.filter((category) => category.entries.length).map((category) => category.name),
      yearRange: `${Math.min(...years)}-${Math.max(...years)}`,
    });
    console.log(`${award.id}: ${records.length} records (${Math.min(...years)}-${Math.max(...years)}).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
