import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data } from "./build/pipeline-data";
import type { Book, Imprint, Publisher, PublisherEvidence, SourceRef } from "../lib/types";

type MappingConfidence = "high" | "medium" | "low";

type NormalizationMapping = {
  raw: string;
  imprint: string;
  publisher: string;
  confidence: MappingConfidence;
  sourceUrl?: string;
  note?: string;
};

type MappingFile = {
  generatedAt: string | null;
  notes: string;
  mappings: NormalizationMapping[];
};

type NormalizedPatch = {
  generatedAt: string;
  notes: string;
  books: Record<string, Partial<Book>>;
  imprints: Record<string, Partial<Imprint>>;
  publishers: Record<string, Partial<Publisher>>;
  sources: Record<string, SourceRef>;
};

type BookMetadataPatch = {
  books?: Record<string, Partial<Book>>;
  publishers?: Record<string, Partial<Publisher>>;
};

type PublisherEvidenceFile = {
  publisherEvidence?: Record<string, PublisherEvidence[]>;
};

type ReviewRow = {
  publisherId: string;
  publisherName: string;
  bookCount: number;
  sampleBooks: Array<{ bookId: string; title: string; author: string; year?: number }>;
  recommendedAction: "add_imprint_mapping" | "parent_only" | "institutional_publisher" | "manual_book_review" | "ignore";
  reason: string;
};

type ValidationReport = {
  duplicateNormalizedRawNames: Array<{ normalizedRaw: string; mappings: NormalizationMapping[] }>;
  nonHighMappingsApplied: Array<NormalizationMapping & { matchedBookCount: number }>;
  zeroMatchMappings: NormalizationMapping[];
  parentPublisherMappings: Array<NormalizationMapping & { matchedBookCount: number }>;
  publisherEvidenceConflicts: Array<{
    bookId: string;
    title: string;
    author: string;
    currentPublisher?: string;
    currentImprint?: string;
    evidenceRawName: string;
    evidenceSource: PublisherEvidence["source"];
    evidenceSourceUrl?: string;
    mappedPublisher: string;
    mappedImprint: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mappingPath = path.join(root, "sources", "imprint-normalization.json");
const outputPath = path.join(root, "sources", "enrichment", "imprints.normalized.json");
const reviewPath = path.join(root, "data", "reports", "imprint-review-queue.json");
const bookMetadataPath = path.join(root, "sources", "enrichment", "books.generated.json");
const enrichmentDir = path.join(root, "sources", "enrichment");
const sourceId = "source-imprint-normalization";

async function main() {
  const generatedAt = new Date().toISOString();
  const mappingFile = JSON.parse(await fs.readFile(mappingPath, "utf8")) as MappingFile;
  const bookMetadata = await readBookMetadataPatch();
  const publisherEvidenceByBook = await readPublisherEvidence();
  const { mappingsByRawName, validation } = validateMappings(mappingFile.mappings);
  const publishersById = new Map<string, Partial<Publisher>>([
    ...data.publishers.map((publisher) => [publisher.id, publisher] as const),
    ...Object.entries(bookMetadata.publishers ?? {}),
  ]);
  const imprintsById = new Map(data.imprints.map((imprint) => [imprint.id, imprint]));
  const booksByRawString = new Map<string, { rawName: string; books: Book[] }>();

  for (const book of data.books) {
    const evidence = bestPublisherEvidence(publisherEvidenceByBook.get(book.id));
    if (evidence && (!book.imprintId || book.sourceIds.includes(sourceId))) {
      addRawStringBook(booksByRawString, `publisher-evidence:${normalizeName(evidence.rawName)}`, evidence.rawName, book);
      continue;
    }
    if (evidence && book.imprintId && !book.sourceIds.includes(sourceId)) {
      const mapping = mappingsByRawName.get(normalizeName(evidence.rawName));
      const currentImprintName = imprintsById.get(book.imprintId)?.name;
      const currentPublisherName = book.publisherId ? publishersById.get(book.publisherId)?.name : undefined;
      if (
        mapping &&
        (normalizeName(mapping.imprint) !== normalizeName(currentImprintName ?? "") ||
          normalizeName(mapping.publisher) !== normalizeName(currentPublisherName ?? ""))
      ) {
        validation.publisherEvidenceConflicts.push({
          bookId: book.id,
          title: book.title,
          author: book.authors.map((author) => author.name).join(", "),
          currentPublisher: currentPublisherName,
          currentImprint: currentImprintName,
          evidenceRawName: evidence.rawName,
          evidenceSource: evidence.source,
          evidenceSourceUrl: evidence.sourceUrl,
          mappedPublisher: mapping.publisher,
          mappedImprint: mapping.imprint,
        });
      }
    }

    const currentImprintName = book.imprintId ? imprintsById.get(book.imprintId)?.name : undefined;
    if (currentImprintName && mappingsByRawName.has(normalizeName(currentImprintName))) {
      addRawStringBook(booksByRawString, `imprint:${book.imprintId}`, currentImprintName, book);
      continue;
    }
    if (book.imprintId && !book.sourceIds.includes(sourceId)) continue;
    const rawPublisherId = bookMetadata.books?.[book.id]?.publisherId ?? book.publisherId;
    const rawPublisherName = rawPublisherId ? publishersById.get(rawPublisherId)?.name : undefined;
    if (!rawPublisherId || !rawPublisherName) continue;
    addRawStringBook(booksByRawString, rawPublisherId, rawPublisherName, book);
  }

  const patch: NormalizedPatch = {
    generatedAt,
    notes: "Generated by scripts/normalize-imprints.ts from sources/imprint-normalization.json. This promotes curated raw catalog publisher strings into explicit imprints and parent publishers.",
    books: {},
    imprints: {},
    publishers: {},
    sources: {
      [sourceId]: {
        id: sourceId,
        label: "Curated raw-publisher to imprint normalization",
        url: "",
        accessedAt: generatedAt,
        confidence: "manual",
        field: "publisher",
        note: mappingFile.notes,
      },
    },
  };
  const reviewRows: ReviewRow[] = [];
  const matchedRawNames = new Set<string>();
  const appliedMappings = new Map<string, { mapping: NormalizationMapping; bookCount: number }>();

  for (const [rawId, { rawName, books }] of booksByRawString) {
    const mapping = mappingsByRawName.get(normalizeName(rawName));
    if (!mapping) {
      reviewRows.push(toReviewRow(rawId, rawName, books));
      continue;
    }
    matchedRawNames.add(normalizeName(mapping.raw));
    appliedMappings.set(normalizeName(mapping.raw), { mapping, bookCount: books.length });

    const normalizedPublisherId = `publisher-${slugify(mapping.publisher)}`;
    const normalizedImprintId = `imprint-${slugify(mapping.imprint)}`;
    patch.publishers[normalizedPublisherId] = {
      id: normalizedPublisherId,
      name: mapping.publisher,
      sourceIds: [sourceId],
    };
    patch.imprints[normalizedImprintId] = {
      id: normalizedImprintId,
      name: mapping.imprint,
      publisherId: normalizedPublisherId,
      sourceIds: [sourceId],
    };
    for (const book of books) {
      patch.books[book.id] = {
        publisherId: normalizedPublisherId,
        imprintId: normalizedImprintId,
        sourceIds: [...new Set([...book.sourceIds, sourceId])],
      };
    }
  }

  validation.zeroMatchMappings = mappingFile.mappings.filter((mapping) => !matchedRawNames.has(normalizeName(mapping.raw)));
  validation.nonHighMappingsApplied = [...appliedMappings.values()]
    .filter(({ mapping }) => mapping.confidence !== "high")
    .map(({ mapping, bookCount }) => ({ ...mapping, matchedBookCount: bookCount }));
  validation.parentPublisherMappings = [...appliedMappings.values()]
    .filter(({ mapping }) => normalizeName(mapping.imprint) === normalizeName(mapping.publisher))
    .map(({ mapping, bookCount }) => ({ ...mapping, matchedBookCount: bookCount }));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(reviewPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(sortPatch(patch), null, 2)}\n`);
  await fs.writeFile(
    reviewPath,
    `${JSON.stringify({
      generatedAt,
      mappedBooks: Object.keys(patch.books).length,
      mappedImprints: Object.keys(patch.imprints).length,
      unresolvedPublisherStrings: reviewRows.length,
      validation,
      review: reviewRows.sort((a, b) => b.bookCount - a.bookCount || a.publisherName.localeCompare(b.publisherName)).slice(0, 250),
    }, null, 2)}\n`,
  );

  console.log(`Normalized imprints for ${Object.keys(patch.books).length} books. Review queue has ${reviewRows.length} unresolved publisher strings.`);
}

function addRawStringBook(target: Map<string, { rawName: string; books: Book[] }>, rawId: string, rawName: string, book: Book) {
  const current = target.get(rawId) ?? { rawName, books: [] };
  current.books.push(book);
  target.set(rawId, current);
}

async function readBookMetadataPatch(): Promise<BookMetadataPatch> {
  try {
    return JSON.parse(await fs.readFile(bookMetadataPath, "utf8")) as BookMetadataPatch;
  } catch {
    return {};
  }
}

async function readPublisherEvidence(): Promise<Map<string, PublisherEvidence[]>> {
  const byBook = new Map<string, PublisherEvidence[]>();
  try {
    const files = (await fs.readdir(enrichmentDir)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const parsed = JSON.parse(await fs.readFile(path.join(enrichmentDir, file), "utf8")) as PublisherEvidenceFile;
      for (const [bookId, rows] of Object.entries(parsed.publisherEvidence ?? {})) {
        byBook.set(bookId, [...(byBook.get(bookId) ?? []), ...rows]);
      }
    }
  } catch {
    return byBook;
  }
  return byBook;
}

function bestPublisherEvidence(rows: PublisherEvidence[] | undefined) {
  return rows
    ?.filter((row) => row.rawName && row.confidence !== "low")
    .sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence) || sourceRank(a.source) - sourceRank(b.source))[0];
}

function confidenceRank(confidence: PublisherEvidence["confidence"]) {
  return confidence === "high" ? 0 : confidence === "medium" ? 1 : 2;
}

function sourceRank(source: PublisherEvidence["source"]) {
  if (source === "manual") return 0;
  if (source === "wikipedia_infobox") return 1;
  if (source === "award_record") return 2;
  return 3;
}

function toReviewRow(publisherId: string, publisherName: string, books: Book[]): ReviewRow {
  const action = recommendedAction(publisherName, books);
  return {
    publisherId,
    publisherName,
    bookCount: books.length,
    sampleBooks: books.slice(0, 5).map((book) => ({
      bookId: book.id,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      year: book.publicationYear,
    })),
    recommendedAction: action.recommendedAction,
    reason: action.reason,
  };
}

function recommendedAction(publisherName: string, books: Book[]): Pick<ReviewRow, "recommendedAction" | "reason"> {
  const normalized = normalizeName(publisherName);
  if (books.length < 2) return { recommendedAction: "manual_book_review", reason: "Only one book currently uses this publisher string." };
  if (isLikelyAudioPublisher(normalized)) return { recommendedAction: "ignore", reason: "Publisher string appears to be an audiobook edition; do not use it as the canonical print imprint." };
  if (isLikelyInstitutionalPublisher(normalized)) return { recommendedAction: "institutional_publisher", reason: "Publisher appears to be an institutional or university press; imprint may equal publisher after review." };
  if (isLikelyParentPublisher(normalized)) return { recommendedAction: "parent_only", reason: "Publisher string is a broad parent or group; do not assign one imprint without book-level evidence." };
  return { recommendedAction: "add_imprint_mapping", reason: "Repeated specific publisher/imprint string." };
}

function validateMappings(mappings: NormalizationMapping[]) {
  const grouped = new Map<string, NormalizationMapping[]>();
  for (const mapping of mappings) {
    const key = normalizeName(mapping.raw);
    grouped.set(key, [...(grouped.get(key) ?? []), mapping]);
  }
  const duplicateNormalizedRawNames = [...grouped.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([normalizedRaw, values]) => ({ normalizedRaw, mappings: values }));
  const validation: ValidationReport = {
    duplicateNormalizedRawNames,
    nonHighMappingsApplied: [],
    zeroMatchMappings: [],
    parentPublisherMappings: [],
    publisherEvidenceConflicts: [],
  };
  return {
    mappingsByRawName: new Map([...grouped.entries()].map(([key, values]) => [key, values.at(-1)!])),
    validation,
  };
}

function sortPatch(patch: NormalizedPatch): NormalizedPatch {
  return {
    ...patch,
    books: sortObject(patch.books),
    imprints: sortObject(patch.imprints),
    publishers: sortObject(patch.publishers),
    sources: sortObject(patch.sources),
  };
}

function sortObject<T>(value: Record<string, T>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|and|inc|incorporated|llc|ltd|limited|company|co|publishing|publishers?|press)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLikelyParentPublisher(normalized: string) {
  return /\b(group|publishing group|random house|penguin random house|macmillan|hachette|harpercollins|simon and schuster|springer|wiley)\b/.test(normalized);
}

function isLikelyInstitutionalPublisher(normalized: string) {
  return /\b(university press|museum|institute|association|society|college press|academy|foundation)\b/.test(normalized);
}

function isLikelyAudioPublisher(normalized: string) {
  return /\b(audio|audiobook|spoken word|recorded books|blackstone|tantor)\b/.test(normalized);
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
