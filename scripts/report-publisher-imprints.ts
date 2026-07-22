import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Book, Imprint, PublicData, Publisher } from "../lib/types";

type NormalizationMapping = {
  raw: string;
  imprint: string;
  publisher: string;
  confidence: "high" | "medium" | "low";
  note?: string;
};

type MappingFile = {
  mappings?: NormalizationMapping[];
};

type BookSample = {
  bookId: string;
  title: string;
  author: string;
  year?: number;
  publisherId?: string;
  imprintId?: string;
};

type PublisherIssue = {
  publisherId: string;
  publisherName: string;
  issue: "mapped_raw_publisher_still_present" | "possible_duplicate_of_imprint" | "retailer_or_edition_noise" | "parent_without_imprint" | "zero_book_publisher";
  severity: "high" | "medium" | "low";
  reason: string;
  bookCount: number;
  suggestedImprintId?: string;
  suggestedImprintName?: string;
  suggestedPublisherId?: string;
  suggestedPublisherName?: string;
  mappedRawNames?: string[];
  sampleBooks: BookSample[];
};

type ImprintDuplicateGroup = {
  canonicalImprintId: string;
  canonicalImprintName: string;
  publisherId?: string;
  publisherName?: string;
  variantPublisherIds: string[];
  variantPublisherNames: string[];
  bookCount: number;
  sampleBooks: BookSample[];
};

type Report = {
  generatedAt: string;
  summary: {
    publisherIssues: number;
    highSeverityPublisherIssues: number;
    imprintDuplicateGroups: number;
    zeroBookPublishers: number;
  };
  notes: string[];
  publisherIssues: PublisherIssue[];
  imprintDuplicateGroups: ImprintDuplicateGroup[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const mappingPath = path.join(root, "sources", "imprint-normalization.json");
const reportPath = path.join(root, "data", "reports", "publisher-imprint-qa-report.json");

async function main() {
  const data = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const mappingFile = JSON.parse(await fs.readFile(mappingPath, "utf8")) as MappingFile;
  const mappings = mappingFile.mappings ?? [];
  const publishersById = new Map(data.publishers.map((publisher) => [publisher.id, publisher]));
  const imprintsById = new Map(data.imprints.map((imprint) => [imprint.id, imprint]));
  const booksByPublisher = groupBooksByPublisher(data.books);
  const mappedRawByName = groupMappedRawByName(mappings);
  const imprintsByNormalizedName = groupImprintsByNormalizedName(data.imprints);

  const publisherIssues = data.publishers
    .flatMap((publisher) =>
      publisherIssuesFor({
        publisher,
        books: booksByPublisher.get(publisher.id) ?? [],
        mappedRawByName,
        imprintsByNormalizedName,
        publishersById,
        imprintsById,
      }),
    )
    .sort(comparePublisherIssues);

  const imprintDuplicateGroups = duplicateGroupsForImprints({
    data,
    publisherIssues,
    publishersById,
    imprintsById,
  });

  const report: Report = {
    generatedAt: new Date().toISOString(),
    summary: {
      publisherIssues: publisherIssues.length,
      highSeverityPublisherIssues: publisherIssues.filter((issue) => issue.severity === "high").length,
      imprintDuplicateGroups: imprintDuplicateGroups.length,
      zeroBookPublishers: publisherIssues.filter((issue) => issue.issue === "zero_book_publisher").length,
    },
    notes: [
      "This report preserves imprint-level granularity. Fix mapped raw publisher strings by adding or refining sources/imprint-normalization.json entries, then run npm run data:imprints.",
      "Fix retailer, reprint, and wrong-edition publisher strings with source-backed book curation in sources/curation.json.",
      "Zero-book publishers are often stale generated records left after imprint normalization; they should not drive public filtering.",
    ],
    publisherIssues,
    imprintDuplicateGroups,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${publisherIssues.length} publisher/imprint QA issues to data/reports/publisher-imprint-qa-report.json.`);
}

function publisherIssuesFor({
  publisher,
  books,
  mappedRawByName,
  imprintsByNormalizedName,
  publishersById,
  imprintsById,
}: {
  publisher: Publisher;
  books: Book[];
  mappedRawByName: Map<string, NormalizationMapping[]>;
  imprintsByNormalizedName: Map<string, Imprint[]>;
  publishersById: Map<string, Publisher>;
  imprintsById: Map<string, Imprint>;
}) {
  const issues: PublisherIssue[] = [];
  const normalized = normalizeName(publisher.name);
  const mappedRawNames = mappedRawByName.get(normalized) ?? [];
  const sameNameImprints = imprintsByNormalizedName.get(normalized) ?? [];

  if (mappedRawNames.length) {
    const preferred = bestMapping(mappedRawNames);
    const suggestedImprint = findImprintByName(imprintsByNormalizedName, preferred.imprint);
    const suggestedPublisher = suggestedImprint?.publisherId ? publishersById.get(suggestedImprint.publisherId) : findPublisherByName(publishersById, preferred.publisher);
    const canonicalSameAsCurrentPublisher = suggestedPublisher?.id === publisher.id && suggestedImprint?.publisherId === publisher.id;
    const selfNamedPublisherImprint = canonicalSameAsCurrentPublisher && normalizeName(preferred.imprint) === normalizeName(preferred.publisher);
    const unmatchedBooks = suggestedImprint
      ? books.filter((book) => (selfNamedPublisherImprint ? !book.imprintId : book.imprintId !== suggestedImprint.id))
      : books;
    if (unmatchedBooks.length || !canonicalSameAsCurrentPublisher) {
      issues.push({
        publisherId: publisher.id,
        publisherName: publisher.name,
        issue: "mapped_raw_publisher_still_present",
        severity: unmatchedBooks.length ? "high" : "low",
        reason: unmatchedBooks.length
          ? "Publisher name already has a raw-string to imprint mapping, but some books still lack the canonical imprint."
          : "Publisher name has a raw-string to imprint mapping that points at a different canonical imprint or parent.",
        bookCount: unmatchedBooks.length,
        suggestedImprintId: suggestedImprint?.id,
        suggestedImprintName: preferred.imprint,
        suggestedPublisherId: suggestedPublisher?.id,
        suggestedPublisherName: preferred.publisher,
        mappedRawNames: mappedRawNames.map((mapping) => mapping.raw),
        sampleBooks: sampleBooks(unmatchedBooks),
      });
    }
  }

  if (!mappedRawNames.length && sameNameImprints.length) {
    const suggestedImprint = sameNameImprints[0];
    const suggestedPublisher = suggestedImprint.publisherId ? publishersById.get(suggestedImprint.publisherId) : undefined;
    const unmatchedBooks = books.filter((book) => book.imprintId !== suggestedImprint.id);
    const canonicalSameAsCurrentPublisher = suggestedPublisher?.id === publisher.id && suggestedImprint.publisherId === publisher.id;
    if (unmatchedBooks.length || !canonicalSameAsCurrentPublisher) {
      issues.push({
        publisherId: publisher.id,
        publisherName: publisher.name,
        issue: "possible_duplicate_of_imprint",
        severity: unmatchedBooks.length ? "medium" : "low",
        reason: "Publisher name matches an existing imprint. If this string came from catalog metadata, map it to the canonical imprint rather than keeping a separate publisher row.",
        bookCount: unmatchedBooks.length,
        suggestedImprintId: suggestedImprint.id,
        suggestedImprintName: suggestedImprint.name,
        suggestedPublisherId: suggestedPublisher?.id,
        suggestedPublisherName: suggestedPublisher?.name,
        sampleBooks: sampleBooks(unmatchedBooks),
      });
    }
  }

  if (books.length && isLikelyRetailerOrEditionNoise(normalized)) {
    issues.push({
      publisherId: publisher.id,
      publisherName: publisher.name,
      issue: "retailer_or_edition_noise",
      severity: "high",
      reason: "Publisher string looks like a retailer, school/library binding, audiobook, large-print, or reprint edition source. Review the affected books and curate the original or award-relevant imprint.",
      bookCount: books.length,
      sampleBooks: sampleBooks(books),
    });
  }

  if (books.length && isLikelyParentPublisher(normalized) && books.some((book) => !book.imprintId)) {
    issues.push({
      publisherId: publisher.id,
      publisherName: publisher.name,
      issue: "parent_without_imprint",
      severity: "medium",
      reason: "Book is attached to a broad parent publisher without a specific imprint. Imprint-level curation should fill these where source evidence supports it.",
      bookCount: books.length,
      sampleBooks: sampleBooks(books.filter((book) => !book.imprintId)),
    });
  }

  if (!books.length) {
    issues.push({
      publisherId: publisher.id,
      publisherName: publisher.name,
      issue: "zero_book_publisher",
      severity: mappedRawNames.length || sameNameImprints.length ? "low" : "medium",
      reason: "Publisher entity has no books in the built catalog. It may be a stale raw catalog string after normalization or an unused generated record.",
      bookCount: 0,
      sampleBooks: [],
    });
  }

  return issues;
}

function duplicateGroupsForImprints({
  data,
  publisherIssues,
  publishersById,
  imprintsById,
}: {
  data: PublicData;
  publisherIssues: PublisherIssue[];
  publishersById: Map<string, Publisher>;
  imprintsById: Map<string, Imprint>;
}) {
  const booksByPublisher = groupBooksByPublisher(data.books);
  const byImprint = new Map<string, PublisherIssue[]>();
  for (const issue of publisherIssues) {
    if (!issue.suggestedImprintId || issue.issue === "zero_book_publisher") continue;
    byImprint.set(issue.suggestedImprintId, [...(byImprint.get(issue.suggestedImprintId) ?? []), issue]);
  }

  return [...byImprint.entries()]
    .map(([imprintId, issues]) => {
      const imprint = imprintsById.get(imprintId);
      const publisher = imprint?.publisherId ? publishersById.get(imprint.publisherId) : undefined;
      const books = issues.flatMap((issue) => booksByPublisher.get(issue.publisherId) ?? []);
      return {
        canonicalImprintId: imprintId,
        canonicalImprintName: imprint?.name ?? issues[0].suggestedImprintName ?? imprintId,
        publisherId: publisher?.id,
        publisherName: publisher?.name,
        variantPublisherIds: issues.map((issue) => issue.publisherId),
        variantPublisherNames: issues.map((issue) => issue.publisherName),
        bookCount: books.length,
        sampleBooks: sampleBooks(books),
      };
    })
    .filter((group) => group.variantPublisherIds.some((publisherId) => publisherId !== group.publisherId) || group.bookCount > 0)
    .sort((a, b) => b.bookCount - a.bookCount || a.canonicalImprintName.localeCompare(b.canonicalImprintName));
}

function groupBooksByPublisher(books: Book[]) {
  const grouped = new Map<string, Book[]>();
  for (const book of books) {
    if (!book.publisherId) continue;
    grouped.set(book.publisherId, [...(grouped.get(book.publisherId) ?? []), book]);
  }
  return grouped;
}

function groupMappedRawByName(mappings: NormalizationMapping[]) {
  const grouped = new Map<string, NormalizationMapping[]>();
  for (const mapping of mappings) {
    const key = normalizeName(mapping.raw);
    grouped.set(key, [...(grouped.get(key) ?? []), mapping]);
  }
  return grouped;
}

function groupImprintsByNormalizedName(imprints: Imprint[]) {
  const grouped = new Map<string, Imprint[]>();
  for (const imprint of imprints) {
    for (const name of [imprint.name, imprint.shortName].filter(Boolean) as string[]) {
      const key = normalizeName(name);
      grouped.set(key, [...(grouped.get(key) ?? []), imprint]);
    }
  }
  return grouped;
}

function bestMapping(mappings: NormalizationMapping[]) {
  return [...mappings].sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence))[0];
}

function findImprintByName(imprintsByNormalizedName: Map<string, Imprint[]>, name: string) {
  return imprintsByNormalizedName.get(normalizeName(name))?.[0];
}

function findPublisherByName(publishersById: Map<string, Publisher>, name: string) {
  const normalized = normalizeName(name);
  return [...publishersById.values()].find((publisher) => normalizeName(publisher.name) === normalized);
}

function sampleBooks(books: Book[]) {
  return books.slice(0, 8).map((book) => ({
    bookId: book.id,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    year: book.publicationYear,
    publisherId: book.publisherId,
    imprintId: book.imprintId,
  }));
}

function comparePublisherIssues(a: PublisherIssue, b: PublisherIssue) {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    issueRank(a.issue) - issueRank(b.issue) ||
    b.bookCount - a.bookCount ||
    a.publisherName.localeCompare(b.publisherName)
  );
}

function severityRank(severity: PublisherIssue["severity"]) {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function issueRank(issue: PublisherIssue["issue"]) {
  if (issue === "retailer_or_edition_noise") return 0;
  if (issue === "mapped_raw_publisher_still_present") return 1;
  if (issue === "parent_without_imprint") return 2;
  if (issue === "possible_duplicate_of_imprint") return 3;
  return 4;
}

function confidenceRank(confidence: NormalizationMapping["confidence"]) {
  if (confidence === "high") return 0;
  if (confidence === "medium") return 1;
  return 2;
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
  return /\b(penguin random house|random house|hachette|harpercollins|simon schuster|macmillan|knopf doubleday publishing group|orion publishing group|pan macmillan)\b/.test(normalized);
}

function isLikelyRetailerOrEditionNoise(normalized: string) {
  return /\b(barnes noble|turtleback|perfection learning|large print|library binding|school library|audio|audiobook|recorded books|tantor|blackstone|kessinger|createspace|print on demand)\b/.test(normalized);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
