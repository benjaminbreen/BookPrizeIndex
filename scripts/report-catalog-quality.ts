import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Book, PublicData } from "../lib/types";
import { isTrustedWikipediaBookEvidence } from "./build/curation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const curationPath = path.join(root, "sources", "curation.json");
const duplicateReviewPath = path.join(root, "data", "reports", "book-duplicate-review.json");
const reportPath = path.join(root, "data", "reports", "catalog-quality-report.json");

type DuplicateReviewReport = {
  generatedAt: string;
  unresolvedGroups: number;
  unresolvedBooks: number;
  groups: Array<{
    action: "auto_merge_candidate" | "manual_review" | "ignore";
    confidence: "high" | "medium" | "low";
    reason: string;
    recommendedCanonicalBookId: string;
    books: Array<{ id: string; title: string; authors: string[] }>;
  }>;
};

async function main() {
  const data = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const curation = JSON.parse(await fs.readFile(curationPath, "utf8")) as { books?: Record<string, { publicationYear?: number }> };
  const duplicateReview = JSON.parse(await fs.readFile(duplicateReviewPath, "utf8")) as DuplicateReviewReport;
  const curatedPublicationYears = new Set(
    Object.entries(curation.books ?? {}).filter(([, patch]) => typeof patch.publicationYear === "number").map(([bookId]) => bookId),
  );
  const appearances = groupBy(data.appearances, (appearance) => appearance.bookId);
  const sharedIsbn = sharedIsbnGroups(data.books);
  const duplicateIdentities = duplicateIdentityGroups(data.books);
  const implausibleYears = data.books.flatMap((book) => {
    if (curatedPublicationYears.has(book.id)) return [];
    const years = (appearances.get(book.id) ?? []).map((appearance) => appearance.year);
    const firstRecognitionYear = years.length ? Math.min(...years) : undefined;
    if (!book.publicationYear || !firstRecognitionYear) return [];
    if (book.publicationYear <= firstRecognitionYear + 3 && book.publicationYear >= firstRecognitionYear - 30) return [];
    return [{ bookId: book.id, title: book.title, publicationYear: book.publicationYear, firstRecognitionYear }];
  });
  const untrustedWikipediaEvidence = (data.wikipediaEvidence ?? [])
    .filter((evidence) => !isTrustedWikipediaBookEvidence(evidence))
    .map((evidence) => ({ bookId: evidence.bookId, pageTitle: evidence.pageTitle, confidence: evidence.confidence, matchedBy: evidence.matchedBy }));
  const truncatedSummaries = data.books
    .filter((book) => looksTruncated(book.summary))
    .map((book) => ({ bookId: book.id, title: book.title, length: book.summary?.length ?? 0 }));
  const unresolvedDuplicateGroups = duplicateReview.groups
    .filter((group) => group.action !== "ignore")
    .map((group) => ({
      confidence: group.confidence,
      reason: group.reason,
      recommendedCanonicalBookId: group.recommendedCanonicalBookId,
      books: group.books.map((book) => ({ bookId: book.id, title: book.title, authors: book.authors })),
    }));
  const hardIssueCount = sharedIsbn.length
    + duplicateIdentities.length
    + unresolvedDuplicateGroups.length
    + implausibleYears.length
    + untrustedWikipediaEvidence.length;
  const report = {
    generatedAt: new Date().toISOString(),
    totalBooks: data.books.length,
    hardIssueCount,
    duplicateReviewGeneratedAt: duplicateReview.generatedAt,
    totals: {
      sharedIsbnGroups: sharedIsbn.length,
      duplicateIdentityGroups: duplicateIdentities.length,
      unresolvedDuplicateGroups: unresolvedDuplicateGroups.length,
      unresolvedDuplicateBooks: duplicateReview.unresolvedBooks,
      implausiblePublicationYears: implausibleYears.length,
      untrustedWikipediaEvidence: untrustedWikipediaEvidence.length,
      possiblyTruncatedSummaries: truncatedSummaries.length,
    },
    sharedIsbn,
    duplicateIdentities,
    unresolvedDuplicateGroups,
    implausibleYears,
    untrustedWikipediaEvidence,
    truncatedSummaries,
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Catalog quality: ${hardIssueCount} hard issues; ${truncatedSummaries.length} summaries need truncation review.`);
  if (hardIssueCount) process.exitCode = 1;
}

function sharedIsbnGroups(books: Book[]) {
  const grouped = new Map<string, Book[]>();
  for (const book of books) {
    for (const isbn of book.isbn13) grouped.set(isbn, [...(grouped.get(isbn) ?? []), book]);
  }
  return [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([isbn13, rows]) => ({ isbn13, books: rows.map(bookLabel) }));
}

function duplicateIdentityGroups(books: Book[]) {
  const grouped = new Map<string, Book[]>();
  for (const book of books) {
    const key = `${normalize(book.title)}\0${book.authors.map((author) => normalize(author.name)).sort().join("|")}`;
    grouped.set(key, [...(grouped.get(key) ?? []), book]);
  }
  return [...grouped.values()].filter((rows) => rows.length > 1).map((rows) => rows.map(bookLabel));
}

function bookLabel(book: Book) {
  return { bookId: book.id, title: book.title, authors: book.authors.map((author) => author.name), publicationYear: book.publicationYear };
}

function looksTruncated(summary: string | undefined) {
  if (!summary || summary.length < 880) return false;
  if (/[.!?…]["'’”)]?$/.test(summary)) return false;
  return summary.length === 900 || summary.length === 1400 || !/[.!?…]["'’”)]?$/.test(summary);
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
