import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PublicData } from "../lib/types";
import { buildPublicRelease, releaseCounts } from "../lib/public-release";

const outputDir = path.join(process.cwd(), "public", "data", "latest");
const csvFilename = "book-prize-index.csv";
const jsonFilename = "book-prize-index.json";
const fullCatalogPath = path.join(process.cwd(), "data", "cache", "catalog.full.generated.json");

const data = JSON.parse(await fs.readFile(fullCatalogPath, "utf8")) as PublicData;
const release = buildPublicRelease(data);
validateRelease();

const csv = buildAppearanceCsv();
const json = `${JSON.stringify(release)}\n`;

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, csvFilename), csv),
  fs.writeFile(path.join(outputDir, jsonFilename), json),
]);

const manifest = {
  datasetVersion: release.datasetVersion,
  schemaVersion: release.schemaVersion,
  generatedAt: release.generatedAt,
  license: release.license,
  counts: releaseCounts(release),
  files: [
    fileManifest(csvFilename, csv, "text/csv"),
    fileManifest(jsonFilename, json, "application/json"),
  ],
};

await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Public data release ${release.datasetVersion}: ${release.books.length} books, ${release.appearances.length} appearances.`);

function validateRelease() {
  const bookIds = new Set(release.books.map((book) => book.id));
  const awardIds = new Set(release.awards.map((award) => award.id));
  const sources = new Map(release.sources.map((source) => [source.id, source]));
  const invalid = release.appearances.filter((appearance) => (
    !appearance.id ||
    !bookIds.has(appearance.bookId) ||
    !awardIds.has(appearance.awardId) ||
    !appearance.year ||
    !appearance.status ||
    !(appearance.sourceUrl || appearance.sourceIds.some((sourceId) => sources.get(sourceId)?.url))
  ));
  if (invalid.length) {
    throw new Error(`Public release has ${invalid.length} invalid or unsourced appearances; first: ${invalid[0]?.id ?? "unknown"}`);
  }
}

function buildAppearanceCsv() {
  const books = new Map(release.books.map((book) => [book.id, book]));
  const awards = new Map(release.awards.map((award) => [award.id, award]));
  const programs = new Map(release.awardPrograms.map((program) => [program.id, program]));
  const publishers = new Map(release.publishers.map((publisher) => [publisher.id, publisher]));
  const imprints = new Map(release.imprints.map((imprint) => [imprint.id, imprint]));
  const sources = new Map(release.sources.map((source) => [source.id, source]));
  const columns = [
    "appearance_id", "book_id", "book_slug", "title", "authors", "publication_year", "award_id",
    "award_program", "award_category", "award_year", "status", "original_status", "is_tie",
    "primary_subject", "publisher", "imprint", "isbn13", "source_url", "source_confidence",
  ];
  const rows = [...release.appearances]
    .sort((a, b) => a.year - b.year || a.awardId.localeCompare(b.awardId) || a.bookId.localeCompare(b.bookId))
    .map((appearance) => {
      const book = books.get(appearance.bookId);
      const award = awards.get(appearance.awardId);
      const program = award?.programId ? programs.get(award.programId) : undefined;
      const source = appearance.sourceIds.map((sourceId) => sources.get(sourceId)).find(Boolean);
      return [
        appearance.id,
        appearance.bookId,
        book?.slug,
        book?.title,
        book?.authors.map((author) => author.name).join("; "),
        book?.publicationYear,
        appearance.awardId,
        program?.name ?? award?.name,
        award?.categoryName ?? award?.name,
        appearance.year,
        appearance.status,
        appearance.originalStatus,
        appearance.isTie,
        book?.primarySubject,
        book?.publisherId ? publishers.get(book.publisherId)?.name : undefined,
        book?.imprintId ? imprints.get(book.imprintId)?.name : undefined,
        book?.isbn13.join("; "),
        appearance.sourceUrl ?? source?.url,
        source?.confidence,
      ];
    });
  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function fileManifest(name: string, content: string, mediaType: string) {
  return {
    name,
    mediaType,
    bytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
