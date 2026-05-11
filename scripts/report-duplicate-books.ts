import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Award, AwardAppearance, Book, PublicData } from "../lib/types";

type CandidateBook = {
  id: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  isbn13: string[];
  publisherId?: string;
  imprintId?: string;
  sourceCount: number;
  appearanceCount: number;
  awards: Array<{ awardId: string; awardName: string; year: number; status: string }>;
  completenessScore: number;
};

type DuplicateGroup = {
  action: "auto_merge_candidate" | "manual_review" | "ignore";
  confidence: "high" | "medium" | "low";
  reason: string;
  recommendedCanonicalBookId: string;
  score: number;
  books: CandidateBook[];
  pairSignals: Array<{
    bookIds: [string, string];
    titleSimilarity: number;
    authorSimilarity: number;
    sharedIsbn: boolean;
    sharedTitlePrefix: boolean;
    yearDelta?: number;
  }>;
};

type DuplicateReport = {
  generatedAt: string;
  totalBooks: number;
  candidateGroups: number;
  candidateBooks: number;
  actionSummary: Record<DuplicateGroup["action"], number>;
  groups: DuplicateGroup[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "public", "catalog.json");
const reportPath = path.join(root, "data", "public", "book-duplicate-review.json");

async function main() {
  const data = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const appearancesByBook = groupAppearances(data.appearances);
  const awardsById = new Map(data.awards.map((award) => [award.id, award]));
  const pairs = candidatePairs(data.books);
  const groups = buildGroups(pairs, data.books, appearancesByBook, awardsById)
    .sort((a, b) => actionRank(a.action) - actionRank(b.action) || b.score - a.score || b.books.length - a.books.length);
  const actionSummary = groups.reduce((summary, group) => {
    summary[group.action] = (summary[group.action] ?? 0) + 1;
    return summary;
  }, {} as Record<DuplicateGroup["action"], number>);

  const report: DuplicateReport = {
    generatedAt: new Date().toISOString(),
    totalBooks: data.books.length,
    candidateGroups: groups.length,
    candidateBooks: new Set(groups.flatMap((group) => group.books.map((book) => book.id))).size,
    actionSummary,
    groups,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${groups.length} duplicate candidate groups to data/public/book-duplicate-review.json.`);
}

function groupAppearances(appearances: AwardAppearance[]) {
  const grouped = new Map<string, AwardAppearance[]>();
  for (const appearance of appearances) {
    grouped.set(appearance.bookId, [...(grouped.get(appearance.bookId) ?? []), appearance]);
  }
  return grouped;
}

function candidatePairs(books: Book[]) {
  const pairMap = new Map<string, ReturnType<typeof pairSignals> & { a: Book; b: Book }>();
  for (const bucket of buildBuckets(books).values()) {
    if (bucket.length < 2 || bucket.length > 80) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        const signals = pairSignals(a, b);
        if (!isCandidate(signals)) continue;
        const key = [a.id, b.id].sort().join("\0");
        const current = pairMap.get(key);
        if (!current || pairScore(signals) > pairScore(current)) pairMap.set(key, { ...signals, a, b });
      }
    }
  }
  return [...pairMap.values()];
}

function buildBuckets(books: Book[]) {
  const buckets = new Map<string, Book[]>();
  for (const book of books) {
    const title = titleTokens(book.title);
    const authorLasts = authorLastNames(book);
    const prefix = titlePrefixTokens(book.title);
    const keys = [
      `${authorLasts.join("|")}::${title.slice(0, 6).sort().join(" ")}`,
      `${authorLasts[0] ?? ""}::${title.slice(0, 5).sort().join(" ")}`,
      `${authorLasts.join("|")}::${title.slice(0, 4).join(" ")}`,
      // Prefix key: catches different-subtitle editions of the same book
      prefix.length >= 2 ? `prefix::${authorLasts[0] ?? ""}::${prefix.join(" ")}` : "",
    ].filter((key) => key && !key.startsWith("::") && !key.endsWith("::"));
    for (const key of new Set(keys)) buckets.set(key, [...(buckets.get(key) ?? []), book]);
  }
  return buckets;
}

function pairSignals(a: Book, b: Book) {
  const titleSimilarity = tokenSimilarity(titleTokens(a.title), titleTokens(b.title));
  const authorSimilarity = tokenSimilarity(authorTokens(a), authorTokens(b));
  const sharedIsbn = Boolean(a.isbn13.length && b.isbn13.length && a.isbn13.some((isbn) => b.isbn13.includes(isbn)));
  const sharedTitlePrefix = sharedPrefix(a.title, b.title);
  const yearDelta = a.publicationYear && b.publicationYear ? Math.abs(a.publicationYear - b.publicationYear) : undefined;
  return { titleSimilarity, authorSimilarity, sharedIsbn, sharedTitlePrefix, yearDelta };
}

function isCandidate(signals: ReturnType<typeof pairSignals>) {
  if (signals.sharedIsbn && signals.titleSimilarity >= 0.55) return true;
  if (signals.titleSimilarity >= 0.92 && signals.authorSimilarity >= 0.55) return true;
  if (signals.titleSimilarity >= 0.78 && signals.authorSimilarity >= 0.78) return true;
  if (signals.titleSimilarity >= 0.72 && signals.authorSimilarity >= 0.9) return true;
  // Different-subtitle editions: same prefix before colon + same author
  if (signals.sharedTitlePrefix && signals.authorSimilarity >= 0.8) return true;
  return false;
}

function pairScore(signals: ReturnType<typeof pairSignals>) {
  return Number(((signals.titleSimilarity * 0.6) + (signals.authorSimilarity * 0.35) + (signals.sharedIsbn ? 0.15 : 0) + (signals.sharedTitlePrefix ? 0.1 : 0)).toFixed(3));
}

function buildGroups(
  pairs: Array<ReturnType<typeof pairSignals> & { a: Book; b: Book }>,
  books: Book[],
  appearancesByBook: Map<string, AwardAppearance[]>,
  awardsById: Map<string, Award>,
) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const rootId = find(current);
    parent.set(id, rootId);
    return rootId;
  };
  const union = (a: string, b: string) => {
    parent.set(a, parent.get(a) ?? a);
    parent.set(b, parent.get(b) ?? b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const pair of pairs) union(pair.a.id, pair.b.id);

  const booksById = new Map(books.map((book) => [book.id, book]));
  const groupedIds = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const rootId = find(id);
    groupedIds.set(rootId, new Set([...(groupedIds.get(rootId) ?? []), id]));
  }

  return [...groupedIds.values()].map((ids) => {
    const groupBooks = [...ids].map((id) => booksById.get(id)).filter(Boolean) as Book[];
    const groupPairs = pairs
      .filter((pair) => ids.has(pair.a.id) && ids.has(pair.b.id))
      .map((pair) => ({
        bookIds: [pair.a.id, pair.b.id] as [string, string],
        titleSimilarity: Number(pair.titleSimilarity.toFixed(3)),
        authorSimilarity: Number(pair.authorSimilarity.toFixed(3)),
        sharedIsbn: pair.sharedIsbn,
        sharedTitlePrefix: pair.sharedTitlePrefix,
        yearDelta: pair.yearDelta,
      }));
    const candidateBooks = groupBooks.map((book) => toCandidateBook(book, appearancesByBook, awardsById));
    const bestPairScore = Math.max(...groupPairs.map((pair) => pair.titleSimilarity * 0.6 + pair.authorSimilarity * 0.35 + (pair.sharedIsbn ? 0.15 : 0)));
    const action = classifyGroup(groupPairs, candidateBooks);
    return {
      ...action,
      recommendedCanonicalBookId: chooseCanonical(candidateBooks).id,
      score: Number(bestPairScore.toFixed(3)),
      books: candidateBooks.sort((a, b) => b.appearanceCount - a.appearanceCount || b.completenessScore - a.completenessScore || b.sourceCount - a.sourceCount),
      pairSignals: groupPairs.sort((a, b) => (b.titleSimilarity + b.authorSimilarity) - (a.titleSimilarity + a.authorSimilarity)),
    };
  });
}

function toCandidateBook(
  book: Book,
  appearancesByBook: Map<string, AwardAppearance[]>,
  awardsById: Map<string, Award>,
): CandidateBook {
  const appearances = appearancesByBook.get(book.id) ?? [];
  return {
    id: book.id,
    title: book.title,
    authors: book.authors.map((author) => author.name),
    publicationYear: book.publicationYear,
    isbn13: book.isbn13,
    publisherId: book.publisherId,
    imprintId: book.imprintId,
    sourceCount: book.sourceIds.length,
    appearanceCount: appearances.length,
    awards: appearances
      .map((appearance) => ({
        awardId: appearance.awardId,
        awardName: awardsById.get(appearance.awardId)?.name ?? appearance.awardId,
        year: appearance.year,
        status: appearance.status,
      }))
      .sort((a, b) => b.year - a.year || a.awardName.localeCompare(b.awardName)),
    completenessScore: completenessScore(book),
  };
}

function classifyGroup(pairSignals: DuplicateGroup["pairSignals"], books: CandidateBook[]): Pick<DuplicateGroup, "action" | "confidence" | "reason"> {
  const hasSharedIsbn = pairSignals.some((pair) => pair.sharedIsbn);
  const hasSharedPrefix = pairSignals.some((pair) => pair.sharedTitlePrefix);
  const maxYearDelta = Math.max(0, ...pairSignals.map((pair) => pair.yearDelta ?? 0));
  const strongPairs = pairSignals.filter((pair) => pair.titleSimilarity >= 0.9 && pair.authorSimilarity >= 0.75);
  const suspiciousYear = maxYearDelta > 8 && !hasSharedIsbn;
  const hasVolumeLanguage = books.some((book) => /\b(vol|volume|part)\b/i.test(book.title));
  if (hasSharedIsbn && !suspiciousYear) return { action: "auto_merge_candidate", confidence: "high", reason: "Shared ISBN and similar title." };
  if (strongPairs.length === pairSignals.length && !suspiciousYear && !hasVolumeLanguage) {
    return { action: "auto_merge_candidate", confidence: "high", reason: "Very similar title and author strings." };
  }
  if (strongPairs.length || pairSignals.some((pair) => pair.titleSimilarity >= 0.78 && pair.authorSimilarity >= 0.78)) {
    return {
      action: "manual_review",
      confidence: suspiciousYear || hasVolumeLanguage ? "medium" : "high",
      reason: suspiciousYear ? "Likely duplicate but publication years differ substantially." : hasVolumeLanguage ? "Likely duplicate or related volume; volume language requires review." : "Likely duplicate with minor title or author variation.",
    };
  }
  if (hasSharedPrefix) {
    return {
      action: "manual_review",
      confidence: "medium",
      reason: "Same title prefix (before colon) and author — likely different-edition subtitle variants.",
    };
  }
  return { action: "manual_review", confidence: "low", reason: "Loose similarity candidate; inspect before merging." };
}

function chooseCanonical(books: CandidateBook[]) {
  return [...books].sort((a, b) =>
    b.appearanceCount - a.appearanceCount ||
    bookLabelQualityScore(b) - bookLabelQualityScore(a) ||
    b.completenessScore - a.completenessScore ||
    b.sourceCount - a.sourceCount ||
    titleQualityScore(b.title) - titleQualityScore(a.title) ||
    a.id.localeCompare(b.id),
  )[0];
}

function completenessScore(book: Book) {
  return [
    book.publicationYear,
    book.publisherId,
    book.imprintId,
    book.pageCount,
    book.summary,
    book.thumbnailUrl,
    book.links.publisher,
    book.isbn13.length,
  ].filter(Boolean).length;
}

function titleQualityScore(title: string) {
  let score = title.length / 50;
  if (/^the\b/i.test(title)) score += 0.25;
  if (/:/.test(title)) score += 0.25;
  if (/\b(vol|volume)\b/i.test(title)) score -= 0.2;
  return score;
}

function bookLabelQualityScore(book: CandidateBook) {
  return titleQualityScore(book.title) + (book.authors.reduce((sum, author) => sum + authorQualityScore(author), 0) / Math.max(1, book.authors.length));
}

function authorQualityScore(author: string) {
  const tokens = author.split(/\s+/).filter(Boolean);
  const initials = tokens.filter((token) => /^[A-Z]\.?$/.test(token)).length;
  let score = tokens.length * 0.35 + author.length / 80;
  score -= initials * 0.15;
  if (/\b(illustrated|author|by|with|editor|professor|phd|md|rn)\b/i.test(author)) score -= 1;
  return score;
}

function actionRank(action: DuplicateGroup["action"]) {
  return action === "auto_merge_candidate" ? 0 : action === "manual_review" ? 1 : 2;
}

const stopwords = new Set("a an the and or of in on for to from with by at into about as is are was were be been being new revised edition editions volume vol volumes part book life biography memoir history selected collected".split(" "));

function titleTokens(input: string) {
  return normalize(input)
    .replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (match) => romanToNumber(match))
    .split(" ")
    .filter((token) => token.length > 1 && !stopwords.has(token));
}

function authorTokens(book: Book) {
  return book.authors.flatMap((author) => normalizeAuthor(author.name).split(" ").filter(Boolean));
}

function authorLastNames(book: Book) {
  return book.authors
    .map((author) => normalizeAuthor(author.name).split(" ").filter(Boolean).at(-1))
    .filter(Boolean) as string[];
}

function normalizeAuthor(input: string) {
  return normalize(input)
    .replace(/\b(illustrated|author|edited|editor|professor|prof|dr|phd|md|rn|jr|sr|ii|iii|iv|by|with)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[''"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlePrefixTokens(title: string) {
  const colonIdx = title.indexOf(":");
  const prefix = colonIdx > 0 ? title.slice(0, colonIdx) : "";
  return titleTokens(prefix);
}

function sharedPrefix(titleA: string, titleB: string) {
  const a = titlePrefixTokens(titleA);
  const b = titlePrefixTokens(titleB);
  if (a.length < 2 || b.length < 2) return false;
  // All tokens in the shorter prefix must appear in the longer one
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  return shorter.every((token) => longerSet.has(token));
}

function tokenSimilarity(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function romanToNumber(value: string) {
  const map: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return map[value] ?? value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
