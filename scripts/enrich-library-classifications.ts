import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isElectronicCallNumber,
  mainClassForCallNumber,
  parseLibraryCallNumber,
  stableFilingKey,
  subclassForCallNumber,
  type LibraryCallNumberParseResult,
} from "../lib/library-call-number";
import type { Book, LibraryShelfPlacement, SourceRef } from "../lib/types";

type CatalogData = {
  books: Book[];
};

type ProviderCache = {
  entries?: Record<string, {
    fetchedAt?: string;
    ok?: boolean;
    body?: unknown;
  }>;
};

type OpenLibraryEdition = {
  key?: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  languages?: Array<{ key?: string }>;
  physical_format?: string;
  isbn_13?: string[];
  isbn_10?: string[];
  lc_classifications?: string[];
  works?: Array<{ key?: string }>;
};

type CachedWork = {
  workKey: string;
  fetchedAt?: string;
  editions: OpenLibraryEdition[];
};

type Candidate = {
  rawCallNumber: string;
  parsed: Extract<LibraryCallNumberParseResult, { ok: true }>;
  edition: OpenLibraryEdition;
  editionKey?: string;
  workKey: string;
  isbn13?: string;
  exactIsbn: boolean;
  publishYear?: number;
  score: number;
};

type ReportRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  status: "accepted" | "classification_only" | "conflict" | "insufficient_consensus" | "not_found";
  confidence?: "high" | "medium";
  matchedBy?: LibraryShelfPlacement["matchedBy"];
  selected?: {
    callNumber: string;
    rawCallNumber: string;
    editionKey?: string;
    workKey: string;
    isbn13?: string;
  };
  candidateCount: number;
  exactCandidateCount: number;
  normalizedCandidates: string[];
  notes?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const cachePaths = [
  path.join(root, "data", "cache", "isbn-discovery-cache.json"),
  path.join(root, "data", "cache", "summary-enrichment-provider-cache.json"),
  path.join(root, "data", "cache", "imprint-edition-provider-cache.json"),
];
const generatedPath = path.join(root, "sources", "enrichment", "library-classifications.generated.json");
const attemptsPath = path.join(root, "data", "cache", "library-classification-attempts.json");
const reportPath = path.join(root, "data", "reports", "library-classification-report.json");
const reviewPath = path.join(root, "data", "reports", "library-classification-review.json");
const qualityPath = path.join(root, "data", "reports", "library-classification-quality-report.json");

async function main() {
  const generatedAt = new Date().toISOString();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as CatalogData;
  const works = await readCachedWorks();
  const worksByIsbn = indexWorksByIsbn(works);
  const books: Record<string, Partial<Book>> = {};
  const sources: Record<string, SourceRef> = {};
  const report: ReportRow[] = [];
  const attempts: Record<string, {
    attemptedAt: string;
    inputSignature: string;
    status: ReportRow["status"];
    selectedCallNumber?: string;
  }> = {};

  for (const book of catalog.books) {
    const row = classifyBook(book, works, worksByIsbn);
    report.push(row);
    attempts[book.id] = {
      attemptedAt: generatedAt,
      inputSignature: inputSignature(book),
      status: row.status,
      selectedCallNumber: row.selected?.callNumber,
    };
    if (row.status !== "accepted" || !row.selected || !row.confidence || !row.matchedBy) continue;

    const candidate = candidateForSelected(book, row.selected, works, worksByIsbn);
    if (!candidate) continue;
    const sourceId = `source-open-library-lcc-${book.slug}`;
    const sourceUrl = candidate.editionKey
      ? `https://openlibrary.org${normalizeOpenLibraryKey(candidate.editionKey)}`
      : `https://openlibrary.org${candidate.workKey}`;
    const placement: LibraryShelfPlacement = {
      scheme: "lcc",
      callNumber: candidate.parsed.normalized,
      rawCallNumber: candidate.rawCallNumber,
      mainClass: mainClassForCallNumber(candidate.parsed.parts),
      subclass: subclassForCallNumber(candidate.parsed.parts),
      completeness: candidate.parsed.completeness,
      confidence: row.confidence,
      matchedBy: row.matchedBy,
      sourceId,
      sourceEditionId: candidate.editionKey,
      sourceWorkId: candidate.workKey,
      sourceIsbn13: candidate.isbn13,
      sort: candidate.parsed.parts,
    };
    books[book.id] = {
      libraryShelf: placement,
      sourceIds: [sourceId],
    };
    sources[sourceId] = {
      id: sourceId,
      label: `Open Library catalog classification for ${book.title}`,
      url: sourceUrl,
      accessedAt: generatedAt,
      confidence: "catalog",
      field: "library_classification",
      note: `${row.matchedBy}; raw call number: ${candidate.rawCallNumber}`,
    };
  }

  const accepted = report.filter((row) => row.status === "accepted");
  const review = report.filter((row) => row.status === "conflict" || row.status === "insufficient_consensus");
  const quality = buildQualityReport(generatedAt, catalog.books, report);

  await Promise.all([
    fs.mkdir(path.dirname(generatedPath), { recursive: true }),
    fs.mkdir(path.dirname(reportPath), { recursive: true }),
    fs.mkdir(path.dirname(attemptsPath), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(generatedPath, `${JSON.stringify({
      generatedAt,
      notes: "Cache-first Library of Congress Classification enrichment from exact-ISBN Open Library editions and conservative work-family consensus. Manual curation overrides this file.",
      books,
      sources,
    }, null, 2)}\n`),
    fs.writeFile(attemptsPath, `${JSON.stringify({ generatedAt, attempts }, null, 2)}\n`),
    fs.writeFile(reportPath, `${JSON.stringify({
      generatedAt,
      policy: "Publish parseable full call numbers only. Prefer exact accepted ISBN editions; accept work-family evidence only when plausible print editions agree on one classification/Cutter structure.",
      cacheOnly: true,
      summary: summarize(report),
      accepted: accepted.slice(0, 100),
    }, null, 2)}\n`),
    fs.writeFile(reviewPath, `${JSON.stringify({ generatedAt, count: review.length, review }, null, 2)}\n`),
    fs.writeFile(qualityPath, `${JSON.stringify(quality, null, 2)}\n`),
  ]);

  console.log(`Library shelf cache extraction accepted ${accepted.length}/${catalog.books.length} books.`);
  console.log(`High confidence: ${accepted.filter((row) => row.confidence === "high").length}; medium confidence: ${accepted.filter((row) => row.confidence === "medium").length}.`);
  console.log(`Review queue: ${review.length}.`);
}

function classifyBook(book: Book, works: CachedWork[], worksByIsbn: Map<string, number[]>): ReportRow {
  const author = book.authors.map((item) => item.name).join(", ");
  const base: Omit<ReportRow, "status" | "candidateCount" | "exactCandidateCount" | "normalizedCandidates"> = {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author,
    publicationYear: book.publicationYear,
  };
  const workIndexes = new Set<number>();
  for (const isbn of book.isbn13.map(normalizeIsbn).filter(Boolean)) {
    for (const index of worksByIsbn.get(isbn) ?? []) workIndexes.add(index);
  }
  if (!workIndexes.size) {
    return { ...base, status: "not_found", candidateCount: 0, exactCandidateCount: 0, normalizedCandidates: [] };
  }

  const bookIsbns = new Set(book.isbn13.map(normalizeIsbn).filter(Boolean));
  const candidates: Candidate[] = [];
  let partialCount = 0;
  for (const index of workIndexes) {
    const work = works[index];
    for (const edition of work.editions) {
      const editionIsbns = editionIsbnValues(edition);
      const exactIsbn = editionIsbns.some((isbn) => bookIsbns.has(isbn));
      const isbn13 = edition.isbn_13?.map(normalizeIsbn).find((isbn) => bookIsbns.has(isbn))
        ?? edition.isbn_13?.map(normalizeIsbn).find(Boolean);
      for (const rawCallNumber of edition.lc_classifications ?? []) {
        const parsed = parseLibraryCallNumber(rawCallNumber);
        if (!parsed.ok) continue;
        if (parsed.completeness === "classification_only") {
          partialCount += 1;
          continue;
        }
        if (isElectronicCallNumber(parsed) || isDisallowedEdition(edition)) continue;
        const publishYear = yearFromDate(edition.publish_date);
        if (!exactIsbn && !isPlausibleWorkEdition(book, edition, publishYear)) continue;
        candidates.push({
          rawCallNumber,
          parsed,
          edition,
          editionKey: edition.key,
          workKey: work.workKey,
          isbn13,
          exactIsbn,
          publishYear,
          score: candidateScore(book, edition, parsed, exactIsbn, publishYear),
        });
      }
    }
  }

  const deduped = dedupeCandidates(candidates);
  const exact = deduped.filter((candidate) => candidate.exactIsbn);
  const normalizedCandidates = [...new Set(deduped.map((candidate) => candidate.parsed.normalized))].sort();
  if (!deduped.length) {
    return {
      ...base,
      status: partialCount ? "classification_only" : "not_found",
      candidateCount: 0,
      exactCandidateCount: 0,
      normalizedCandidates: [],
      notes: partialCount ? `${partialCount} partial classification values found.` : undefined,
    };
  }

  if (exact.length) {
    const exactBases = groupBy(exact, callStructureKey);
    if (exactBases.size === 1) {
      const selected = bestCandidate(exact);
      const distinct = new Set(exact.map((candidate) => candidate.parsed.normalized));
      return {
        ...base,
        status: "accepted",
        confidence: distinct.size === 1 ? "high" : "medium",
        matchedBy: "open_library_exact_isbn",
        selected: selectedReport(selected),
        candidateCount: deduped.length,
        exactCandidateCount: exact.length,
        normalizedCandidates,
        notes: distinct.size > 1 ? "Exact-ISBN values share one classification/Cutter structure but vary by edition date." : undefined,
      };
    }
    return {
      ...base,
      status: "conflict",
      candidateCount: deduped.length,
      exactCandidateCount: exact.length,
      normalizedCandidates,
      notes: "Exact-ISBN edition evidence contains materially different call-number structures.",
    };
  }

  const plausibleByStructure = groupBy(deduped, callStructureKey);
  const supportedGroups = [...plausibleByStructure.values()]
    .map((group) => ({ group, editions: new Set(group.map((candidate) => candidate.editionKey ?? candidate.rawCallNumber)).size }))
    .filter((entry) => entry.editions >= 2)
    .sort((a, b) => b.editions - a.editions || bestCandidate(b.group).score - bestCandidate(a.group).score);
  if (supportedGroups.length === 1 && plausibleByStructure.size === 1) {
    const selected = bestCandidate(supportedGroups[0].group);
    return {
      ...base,
      status: "accepted",
      confidence: "medium",
      matchedBy: "open_library_work_consensus",
      selected: selectedReport(selected),
      candidateCount: deduped.length,
      exactCandidateCount: 0,
      normalizedCandidates,
      notes: `${supportedGroups[0].editions} plausible editions agree on one classification/Cutter structure.`,
    };
  }

  return {
    ...base,
    status: plausibleByStructure.size > 1 ? "conflict" : "insufficient_consensus",
    candidateCount: deduped.length,
    exactCandidateCount: 0,
    normalizedCandidates,
    notes: plausibleByStructure.size > 1
      ? "Work-family editions contain materially different call-number structures."
      : "Only one plausible edition supports this work-family placement.",
  };
}

function candidateForSelected(
  book: Book,
  selected: NonNullable<ReportRow["selected"]>,
  works: CachedWork[],
  worksByIsbn: Map<string, number[]>,
) {
  const indexes = new Set<number>();
  for (const isbn of book.isbn13.map(normalizeIsbn).filter(Boolean)) {
    for (const index of worksByIsbn.get(isbn) ?? []) indexes.add(index);
  }
  const bookIsbns = new Set(book.isbn13.map(normalizeIsbn).filter(Boolean));
  for (const index of indexes) {
    const work = works[index];
    for (const edition of work.editions) {
      if (edition.key !== selected.editionKey) continue;
      const exactIsbn = editionIsbnValues(edition).some((isbn) => bookIsbns.has(isbn));
      for (const rawCallNumber of edition.lc_classifications ?? []) {
        const parsed = parseLibraryCallNumber(rawCallNumber);
        if (!parsed.ok || parsed.normalized !== selected.callNumber) continue;
        return {
          rawCallNumber,
          parsed,
          edition,
          editionKey: edition.key,
          workKey: work.workKey,
          isbn13: selected.isbn13,
          exactIsbn,
          publishYear: yearFromDate(edition.publish_date),
          score: 0,
        } satisfies Candidate;
      }
    }
  }
  return undefined;
}

async function readCachedWorks() {
  const byWork = new Map<string, CachedWork>();
  for (const cachePath of cachePaths) {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as ProviderCache;
    for (const [url, entry] of Object.entries(parsed.entries ?? {})) {
      const body = entry.body as { entries?: OpenLibraryEdition[] } | undefined;
      if (!Array.isArray(body?.entries) || !body.entries.length) continue;
      const workKey = workKeyFromUrl(url) ?? body.entries.flatMap((edition) => edition.works ?? []).map((work) => work.key).find(Boolean);
      if (!workKey) continue;
      const normalizedWorkKey = normalizeOpenLibraryKey(workKey);
      const current = byWork.get(normalizedWorkKey) ?? { workKey: normalizedWorkKey, fetchedAt: entry.fetchedAt, editions: [] };
      current.editions.push(...body.entries);
      byWork.set(normalizedWorkKey, current);
    }
  }
  return [...byWork.values()].map((work) => ({
    ...work,
    editions: dedupeEditions(work.editions),
  }));
}

function indexWorksByIsbn(works: CachedWork[]) {
  const index = new Map<string, number[]>();
  works.forEach((work, workIndex) => {
    const isbns = new Set(work.editions.flatMap(editionIsbnValues));
    for (const isbn of isbns) {
      const current = index.get(isbn) ?? [];
      current.push(workIndex);
      index.set(isbn, current);
    }
  });
  return index;
}

function editionIsbnValues(edition: OpenLibraryEdition) {
  return [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn).filter(Boolean);
}

function normalizeIsbn(value: string) {
  return String(value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function normalizeOpenLibraryKey(value: string) {
  const normalized = value.startsWith("http") ? new URL(value).pathname : value;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function workKeyFromUrl(url: string) {
  try {
    const match = new URL(url).pathname.match(/(\/works\/[^/]+)\/editions\.json$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function dedupeEditions(editions: OpenLibraryEdition[]) {
  const rows = new Map<string, OpenLibraryEdition>();
  for (const edition of editions) {
    const key = edition.key ?? JSON.stringify([
      edition.title,
      edition.publish_date,
      edition.isbn_13,
      edition.lc_classifications,
    ]);
    const current = rows.get(key);
    if (!current) {
      rows.set(key, edition);
      continue;
    }
    rows.set(key, {
      ...current,
      ...edition,
      isbn_10: [...new Set([...(current.isbn_10 ?? []), ...(edition.isbn_10 ?? [])])],
      isbn_13: [...new Set([...(current.isbn_13 ?? []), ...(edition.isbn_13 ?? [])])],
      lc_classifications: [...new Set([...(current.lc_classifications ?? []), ...(edition.lc_classifications ?? [])])],
    });
  }
  return [...rows.values()];
}

function dedupeCandidates(candidates: Candidate[]) {
  const rows = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.editionKey ?? ""}|${candidate.parsed.normalized}`;
    const current = rows.get(key);
    if (!current || candidate.score > current.score) rows.set(key, candidate);
  }
  return [...rows.values()];
}

function isDisallowedEdition(edition: OpenLibraryEdition) {
  const text = [
    edition.physical_format,
    edition.title,
    edition.subtitle,
    ...(edition.publishers ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(?:ebook|e-book|kindle|audiobook|audio cd|large print|large type|school edition|teacher(?:'s)? edition|study guide|summary)\b/.test(text);
}

function isPlausibleWorkEdition(book: Book, edition: OpenLibraryEdition, publishYear: number | undefined) {
  const languages = edition.languages?.map((language) => language.key?.split("/").at(-1)).filter(Boolean) ?? [];
  if (languages.length && !languages.some((language) => language === "eng")) return false;
  if (book.publicationYear && publishYear) {
    if (publishYear < book.publicationYear - 10 || publishYear > book.publicationYear + 25) return false;
  }
  return true;
}

function candidateScore(
  book: Book,
  edition: OpenLibraryEdition,
  parsed: Extract<LibraryCallNumberParseResult, { ok: true }>,
  exactIsbn: boolean,
  publishYear: number | undefined,
) {
  let score = exactIsbn ? 100 : 0;
  if (edition.languages?.some((language) => language.key?.endsWith("/eng"))) score += 10;
  if (parsed.parts.year && publishYear && parsed.parts.year === publishYear) score += 8;
  if (book.publicationYear && publishYear) score += Math.max(0, 8 - Math.abs(book.publicationYear - publishYear));
  if (edition.physical_format && /\b(?:hardcover|hardback|paperback|trade)\b/i.test(edition.physical_format)) score += 3;
  if (!parsed.parts.suffix) score += 2;
  return score;
}

function callStructureKey(candidate: Candidate) {
  const { year: _year, suffix: _suffix, trailingTokens: _trailingTokens, ...structure } = candidate.parsed.parts;
  return JSON.stringify(structure);
}

function bestCandidate(candidates: Candidate[]) {
  return [...candidates].sort((a, b) =>
    b.score - a.score ||
    compareOptionalDistance(a.publishYear, b.publishYear) ||
    stableFilingKey(a.editionKey ?? a.rawCallNumber).localeCompare(stableFilingKey(b.editionKey ?? b.rawCallNumber))
  )[0];
}

function compareOptionalDistance(a: number | undefined, b: number | undefined) {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function selectedReport(candidate: Candidate): NonNullable<ReportRow["selected"]> {
  return {
    callNumber: candidate.parsed.normalized,
    rawCallNumber: candidate.rawCallNumber,
    editionKey: candidate.editionKey,
    workKey: candidate.workKey,
    isbn13: candidate.isbn13,
  };
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }
  return grouped;
}

function yearFromDate(value: string | undefined) {
  const match = value?.match(/\b(1[45-9]\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function inputSignature(book: Book) {
  return [
    stableFilingKey(book.title),
    stableFilingKey(book.authors.map((author) => author.name).join(" ")),
    book.publicationYear ?? "",
    [...book.isbn13].sort().join(","),
  ].join("|");
}

function summarize(report: ReportRow[]) {
  return Object.fromEntries(
    [...new Set(report.map((row) => row.status))]
      .sort()
      .map((status) => [status, report.filter((row) => row.status === status).length]),
  );
}

function buildQualityReport(generatedAt: string, books: Book[], report: ReportRow[]) {
  const booksById = new Map(books.map((book) => [book.id, book]));
  const accepted = report.filter((row) => row.status === "accepted");
  const byMainClass = new Map<string, number>();
  const bySubject = new Map<string, number>();
  const byDecade = new Map<string, number>();
  const byMethod = new Map<string, number>();
  for (const row of accepted) {
    const callNumber = row.selected?.callNumber;
    const parsed = callNumber ? parseLibraryCallNumber(callNumber) : undefined;
    if (parsed?.ok) {
      const mainClass = mainClassForCallNumber(parsed.parts);
      byMainClass.set(mainClass, (byMainClass.get(mainClass) ?? 0) + 1);
    }
    const book = booksById.get(row.bookId);
    const subject = book?.primarySubject ?? book?.subjects[0] ?? "Unknown";
    bySubject.set(subject, (bySubject.get(subject) ?? 0) + 1);
    const decade = book?.publicationYear ? `${Math.floor(book.publicationYear / 10) * 10}s` : "Unknown";
    byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
    const method = row.matchedBy ?? "unknown";
    byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
  }
  return {
    generatedAt,
    catalogBooks: books.length,
    booksWithIsbn: books.filter((book) => book.isbn13.length).length,
    accepted: accepted.length,
    coveragePercent: Number(((accepted.length / Math.max(books.length, 1)) * 100).toFixed(1)),
    highConfidence: accepted.filter((row) => row.confidence === "high").length,
    mediumConfidence: accepted.filter((row) => row.confidence === "medium").length,
    status: summarize(report),
    byMethod: sortedCounts(byMethod),
    byMainClass: sortedCounts(byMainClass),
    bySubject: sortedCounts(bySubject),
    byDecade: sortedCounts(byDecade),
    notes: [
      "Counts are cache-first and exclude classification-only, electronic-suffix, disallowed-format, unparseable, and materially conflicting evidence.",
      "Coverage is not expected to be uniform across publication periods, regions, or languages.",
    ],
  };
}

function sortedCounts(counts: Map<string, number>) {
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
