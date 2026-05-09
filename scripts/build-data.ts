import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import type {
  Award,
  AwardAppearance,
  AwardEdition,
  AwardStatus,
  Book,
  BookStats,
  Imprint,
  Person,
  PublicData,
  Publisher,
  SourceRef,
  SubjectSummary,
} from "../lib/types";

type ManifestEntry = {
  id: string;
  label: string;
  file: string;
  type: "xlsx" | "json";
  sourceSheet?: string;
  appearancesSheet?: string;
  notes?: string;
  mappings: Record<string, string>;
};

type RawAppearanceRow = {
  Imprint?: string;
  Year?: number | string;
  Author?: string;
  Title?: string;
  "Award short"?: string;
  Status?: string;
  Award?: string;
};

type CurationFile = {
  books?: Record<string, Partial<Book>>;
  awards?: Record<string, Partial<Award>>;
  imprints?: Record<string, Partial<Imprint>>;
  publishers?: Record<string, Partial<Publisher>>;
  sources?: Record<string, SourceRef>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcesDir = path.join(root, "sources");
const publicDataDir = path.join(root, "data", "public");

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function clean(input: unknown) {
  return String(input ?? "").trim().replace(/\s+/g, " ");
}

function normalizeStatus(status: string): { status: AwardStatus; rank: number; isTie: boolean } {
  const value = status.toLowerCase();
  const isTie = /\b(co-|joint|tie|tied)\b/.test(value);
  if (value.includes("winner")) return { status: isTie ? "co_winner" : "winner", rank: 1, isTie };
  if (value.includes("finalist")) return { status: "finalist", rank: 2, isTie };
  if (value.includes("shortlist") || value.includes("short-listed") || value.includes("short listed")) {
    return { status: "shortlist", rank: 3, isTie };
  }
  if (value.includes("longlist") || value.includes("long-listed") || value.includes("long listed")) {
    return { status: "longlist", rank: 4, isTie };
  }
  if (value.includes("honor") || value.includes("honour")) return { status: "honorable_mention", rank: 5, isTie };
  if (value.includes("commended")) return { status: "commended", rank: 6, isTie };
  if (value.includes("notable")) return { status: "notable", rank: 7, isTie };
  return { status: "unknown", rank: 99, isTie };
}

function splitPeople(authorText: string): Person[] {
  return authorText
    .split(/\s+(?:and|&)\s+|,\s+(?=[A-Z][^,]+$)/)
    .map(clean)
    .filter(Boolean)
    .map((name) => ({ id: `person-${slugify(name)}`, name }));
}

function inferSubjects(awardName: string, title: string): string[] {
  const text = `${awardName} ${title}`.toLowerCase();
  const subjects = new Set<string>();
  subjects.add("Nonfiction");
  if (text.includes("history") || text.includes("bancroft") || text.includes("cundill")) subjects.add("History");
  if (text.includes("biography") || text.includes("memoir")) subjects.add("Biography & memoir");
  if (text.includes("science") || text.includes("medicine") || text.includes("virology") || text.includes("vagina")) {
    subjects.add("Science & medicine");
  }
  if (text.includes("american") || text.includes("mexican") || text.includes("pulitzer")) subjects.add("American history");
  if (text.includes("global") || text.includes("world") || text.includes("empire")) subjects.add("Global history");
  if (text.includes("politic") || text.includes("society") || text.includes("social")) subjects.add("Politics & society");
  return [...subjects];
}

async function main() {
  const manifestPath = path.join(sourcesDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestEntry[];
  const curation = await readCuration();
  const enrichment = await readEnrichment();
  const generatedAt = new Date().toISOString();

  const books = new Map<string, Book>();
  const awards = new Map<string, Award>();
  const editions = new Map<string, AwardEdition>();
  const appearances = new Map<string, AwardAppearance>();
  const imprints = new Map<string, Imprint>();
  const publishers = new Map<string, Publisher>();
  const sources = new Map<string, SourceRef>();

  for (const source of manifest) {
    if (source.type !== "xlsx") continue;

    const workbook = XLSX.readFile(path.join(sourcesDir, source.file));
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[source.sourceSheet ?? "Sources"] ?? {});
    const appearanceRows = XLSX.utils.sheet_to_json<RawAppearanceRow>(
      workbook.Sheets[source.appearancesSheet ?? "Raw appearances"] ?? {},
      { defval: "" },
    );

    const manifestSourceId = `source-${source.id}`;
    sources.set(manifestSourceId, {
      id: manifestSourceId,
      label: source.label,
      url: "",
      accessedAt: generatedAt,
      confidence: "manual",
      note: source.notes,
    });

    for (const [index, row] of sourceRows.entries()) {
      const url = clean(row.URL);
      if (!url) continue;
      const id = `source-${source.id}-${index + 1}`;
      sources.set(id, {
        id,
        label: clean(row.Source) || source.label,
        url,
        accessedAt: generatedAt,
        confidence: "official",
      });
    }

    for (const row of appearanceRows) {
      const title = clean(row.Title);
      const authorText = clean(row.Author);
      const year = Number(row.Year);
      const awardName = clean(row.Award);
      const originalStatus = clean(row.Status);
      const imprintName = clean(row.Imprint);
      if (!title || !authorText || !year || !awardName) continue;

      const authorPeople = splitPeople(authorText);
      const bookSlug = slugify(`${title}-${authorText}`);
      const bookId = `book-${bookSlug}`;
      const awardSlug = slugify(awardName);
      const awardId = `award-${awardSlug}`;
      const editionId = `edition-${awardSlug}-${year}`;
      const imprintId = imprintName ? `imprint-${slugify(imprintName)}` : undefined;
      const sourceIds = [manifestSourceId];

      if (imprintId && !imprints.has(imprintId)) {
        imprints.set(imprintId, {
          id: imprintId,
          name: imprintName,
          sourceIds,
        });
      }

      if (!books.has(bookId)) {
        const subjects = inferSubjects(awardName, title);
        books.set(bookId, {
          id: bookId,
          slug: bookSlug,
          title,
          authors: authorPeople,
          publicationYear: year,
          imprintId,
          isbn13: [],
          subjects,
          centralFigures: [],
          links: {
            amazon: `https://www.amazon.com/s?k=${encodeURIComponent(`${title} ${authorText}`)}`,
            bookshop: `https://bookshop.org/search?keywords=${encodeURIComponent(`${title} ${authorText}`)}`,
            indiebound: `https://www.indiebound.org/search/book?keys=${encodeURIComponent(`${title} ${authorText}`)}`,
            worldcat: `https://search.worldcat.org/search?q=${encodeURIComponent(`${title} ${authorText}`)}`,
          },
          sourceIds,
        });
      } else {
        const book = books.get(bookId)!;
        if (!book.imprintId && imprintId) book.imprintId = imprintId;
        book.subjects = [...new Set([...book.subjects, ...inferSubjects(awardName, title)])];
      }

      if (!awards.has(awardId)) {
        const subjectAreas = inferSubjects(awardName, "").filter((subject) => subject !== "Nonfiction");
        awards.set(awardId, {
          id: awardId,
          slug: awardSlug,
          name: awardName,
          shortName: clean(row["Award short"]) || undefined,
          subjectAreas: subjectAreas.length ? subjectAreas : ["Nonfiction"],
          links: {},
          sourceIds,
        });
      }

      if (!editions.has(editionId)) {
        editions.set(editionId, {
          id: editionId,
          awardId,
          year,
          sourceIds,
        });
      }

      const normalized = normalizeStatus(originalStatus);
      const appearanceId = `appearance-${bookSlug}-${awardSlug}-${year}-${slugify(originalStatus || "listed")}`;
      appearances.set(appearanceId, {
        id: appearanceId,
        bookId,
        awardId,
        awardEditionId: editionId,
        year,
        status: normalized.status,
        originalStatus,
        statusRank: normalized.rank,
        isTie: normalized.isTie,
        sourceIds,
      });
    }
  }

  applySourcePatches(sources, enrichment.sources);
  applyCuration(books, enrichment.books);
  applyCuration(awards, enrichment.awards);
  applyCuration(imprints, enrichment.imprints);
  applyCuration(publishers, enrichment.publishers);
  applySourcePatches(sources, curation.sources);
  applyCuration(books, curation.books);
  applyCuration(awards, curation.awards);
  applyCuration(imprints, curation.imprints);
  applyCuration(publishers, curation.publishers);

  const statusWeights: Record<AwardStatus, number> = {
    winner: 5,
    co_winner: 5,
    finalist: 3,
    shortlist: 2,
    longlist: 1,
    honorable_mention: 1,
    commended: 1,
    notable: 1,
    unknown: 0,
  };

  const stats = new Map<string, BookStats>();
  for (const book of books.values()) {
    stats.set(book.id, {
      bookId: book.id,
      wins: 0,
      lists: 0,
      score: 0,
      statuses: {
        winner: 0,
        co_winner: 0,
        finalist: 0,
        shortlist: 0,
        longlist: 0,
        honorable_mention: 0,
        commended: 0,
        notable: 0,
        unknown: 0,
      },
    });
  }

  for (const appearance of appearances.values()) {
    const stat = stats.get(appearance.bookId);
    if (!stat) continue;
    stat.lists += 1;
    stat.statuses[appearance.status] += 1;
    stat.score += statusWeights[appearance.status];
    if (appearance.status === "winner" || appearance.status === "co_winner") stat.wins += 1;
  }

  const subjectCounts = new Map<string, { ids: Set<string>; topBookId?: string; topScore: number }>();
  for (const book of books.values()) {
    for (const subject of book.subjects) {
      const current = subjectCounts.get(subject) ?? { ids: new Set<string>(), topScore: -1 };
      current.ids.add(book.id);
      const score = stats.get(book.id)?.score ?? 0;
      if (score > current.topScore) {
        current.topScore = score;
        current.topBookId = book.id;
      }
      subjectCounts.set(subject, current);
    }
  }

  const subjects: SubjectSummary[] = [...subjectCounts.entries()]
    .map(([name, value]) => ({
      id: `subject-${slugify(name)}`,
      slug: slugify(name),
      name,
      bookCount: value.ids.size,
      topBookId: value.topBookId,
    }))
    .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name));

  const publicData: PublicData = {
    generatedAt,
    books: [...books.values()].sort((a, b) => a.title.localeCompare(b.title)),
    awards: [...awards.values()].sort((a, b) => a.name.localeCompare(b.name)),
    editions: [...editions.values()].sort((a, b) => b.year - a.year),
    appearances: [...appearances.values()].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank),
    publishers: [...publishers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    imprints: [...imprints.values()].sort((a, b) => a.name.localeCompare(b.name)),
    subjects,
    sources: [...sources.values()],
    stats: [...stats.values()].sort((a, b) => b.score - a.score),
  };

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(path.join(publicDataDir, "catalog.json"), `${JSON.stringify(publicData, null, 2)}\n`);

  const warnings = {
    missingPublisherCount: publicData.books.filter((book) => !book.publisherId).length,
    missingImprintCount: publicData.books.filter((book) => !book.imprintId).length,
    missingSourceUrlsForAppearances: publicData.appearances.filter((appearance) => !appearance.sourceUrl).length,
    unknownStatusCount: publicData.appearances.filter((appearance) => appearance.status === "unknown").length,
  };
  await fs.writeFile(path.join(publicDataDir, "import-report.json"), `${JSON.stringify(warnings, null, 2)}\n`);
  console.log(`Built ${publicData.books.length} books, ${publicData.appearances.length} appearances, ${publicData.awards.length} awards.`);
  console.log(`Warnings: ${JSON.stringify(warnings)}`);
}

async function readCuration(): Promise<CurationFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "curation.json"), "utf8")) as CurationFile;
  } catch {
    return {};
  }
}

async function readEnrichment(): Promise<CurationFile> {
  const enrichmentDir = path.join(sourcesDir, "enrichment");
  const merged: CurationFile = { books: {}, awards: {}, imprints: {}, publishers: {}, sources: {} };
  try {
    const files = await fs.readdir(enrichmentDir);
    for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
      const parsed = JSON.parse(await fs.readFile(path.join(enrichmentDir, file), "utf8")) as CurationFile;
      Object.assign(merged.books!, parsed.books);
      Object.assign(merged.awards!, parsed.awards);
      Object.assign(merged.imprints!, parsed.imprints);
      Object.assign(merged.publishers!, parsed.publishers);
      Object.assign(merged.sources!, parsed.sources);
    }
  } catch {
    return {};
  }
  return merged;
}

function applySourcePatches(sources: Map<string, SourceRef>, patches?: Record<string, SourceRef>) {
  if (!patches) return;
  for (const [id, source] of Object.entries(patches)) {
    sources.set(id, source);
  }
}

function applyCuration<T extends { id: string }>(items: Map<string, T>, patches?: Record<string, Partial<T>>) {
  if (!patches) return;
  for (const [id, patch] of Object.entries(patches)) {
    const current = items.get(id);
    if (!current) {
      items.set(id, { id, ...patch } as T);
      continue;
    }
    items.set(id, mergeObject(current, patch));
  }
}

function mergeObject<T>(current: T, patch: Partial<T>): T {
  const output = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = { ...((output[key] as object | undefined) ?? {}), ...value };
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
