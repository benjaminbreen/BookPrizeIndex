import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import type { RawAwardRecord, RawAwardRecordSourceConfidence, RawAwardRecordStatus } from "../lib/award-records";
import {
  applyAwardProgramMetadata,
  buildAwardPrograms,
  findPrizeRegistryEntry,
  findPrizeRegistryCategory,
  mergeDuplicateAwardCategories,
  type PrizeRegistryFileEntry,
} from "./build/award-programs";
import { buildBrowseData } from "./build/browse-data";
import { applyCuration, applySourcePatches, mergeObject, readCuration, readEnrichment, type CurationFile } from "./build/curation";
import { publicDataDir, rawAwardRecordsDir, sourcesDir } from "./build/paths";
import { buildCanonicalTitleResolver, type CanonicalTitleResolver, type TitleCandidate } from "./build/title-resolver";
import { clean, slugify } from "./build/text";
import type {
  Award,
  AwardAppearance,
  AwardEdition,
  AwardProgram,
  AwardStatus,
  Book,
  BookStats,
  Imprint,
  Person,
  PublicData,
  Publisher,
  SubjectDecision,
  SourceRef,
  SubjectEvidence,
  SubjectDefinition,
  SubjectSummary,
  TopicDefinition,
  WikipediaBookEvidence,
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

type SubjectClassificationReportEntry = {
  bookId: string;
  title: string;
  author: string;
  subjects: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
  reviewReason?: string;
  candidates?: Array<{ subject: string; score: number }>;
};

type TopicClassificationReportEntry = {
  bookId: string;
  title: string;
  author: string;
  primarySubject?: string;
  primaryTopic?: string;
  topics: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
  reviewReason?: string;
};

type BookTopicClassification = {
  primaryTopic?: string;
  topics: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
  reviewReason?: string;
};

type GeneratedTopicClassification = {
  primaryTopic?: string;
  topics?: string[];
  confidence?: "high" | "medium" | "low";
  method?: string;
  reviewStatus?: "generated" | "reviewed" | "rejected";
  rationale?: string;
};

type GeneratedTopicsFile = {
  generatedAt?: string;
  notes?: string;
  books?: Record<string, GeneratedTopicClassification>;
};

type WikipediaGeneratedFile = CurationFile & {
  wikipediaEvidence?: Record<string, WikipediaBookEvidence>;
};

type BookAliasFile = {
  generatedAt?: string | null;
  notes?: string;
  aliases?: Array<{
    canonicalBookId: string;
    duplicateBookIds: string[];
    reason?: string;
  }>;
};

type TaxonomyValidationReport = {
  subjectErrors: string[];
  topicErrors: string[];
  totals: {
    books: number;
    subjectErrors: number;
    topicErrors: number;
  };
};

type TopicSummary = {
  generatedAt: string;
  topics: { topic: string; bookCount: number; appearanceCount: number }[];
  byYear: { year: number; topic: string; appearanceCount: number; bookCount: number }[];
  byAward: { awardId: string; awardName: string; topic: string; appearanceCount: number; bookCount: number }[];
  byAwardYear: { awardId: string; awardName: string; year: number; topic: string; appearanceCount: number; bookCount: number }[];
};

type SuspiciousSubjectTopicReportEntry = {
  bookId: string;
  title: string;
  author: string;
  primarySubject?: string;
  primaryTopic?: string;
  topics: string[];
  reason: string;
  suggestedSubject?: string;
};

type SubjectMapEntry = {
  match: string;
  subject: string;
  weight: number;
  confidence: "high" | "medium" | "low";
};

type SubjectMapFile = {
  notes?: string;
  entries: SubjectMapEntry[];
};

type SubjectMapRule = SubjectMapEntry & {
  pattern: RegExp;
};

type BookSubjectClassification = {
  subjects: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
  reviewReason?: string;
  candidates: Array<{ subject: string; score: number }>;
};

type SubjectReviewReportEntry = {
  bookId: string;
  title: string;
  author: string;
  primarySubject?: string;
  confidence?: "high" | "medium" | "low";
  reasons: string[];
  candidates: SubjectDecision["candidates"];
  evidence: SubjectEvidence[];
};

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

function normalizeRawStatus(status: RawAwardRecordStatus): { status: AwardStatus; rank: number; isTie: boolean } {
  if (status === "co_winner") return { status, rank: 1, isTie: true };
  if (status === "winner") return { status, rank: 1, isTie: false };
  if (status === "finalist") return { status, rank: 2, isTie: false };
  if (status === "shortlist") return { status, rank: 3, isTie: false };
  if (status === "longlist") return { status, rank: 4, isTie: false };
  if (status === "honorable_mention") return { status, rank: 5, isTie: false };
  if (status === "commended") return { status, rank: 6, isTie: false };
  return { status: "unknown", rank: 99, isTie: false };
}

function awardRecognitionWeight(status: AwardStatus, isMajorAward: boolean) {
  if (status === "winner" || status === "co_winner") return isMajorAward ? 10 : 4;
  if (status === "finalist" || status === "shortlist") return isMajorAward ? 4 : 2;
  if (status === "longlist") return isMajorAward ? 2 : 1;
  return 0;
}

function compareBookStats(a: BookStats, b: BookStats) {
  return (
    b.score - a.score ||
    b.majorWins - a.majorWins ||
    b.wins - a.wins ||
    b.majorShortlists - a.majorShortlists ||
    b.normalShortlists - a.normalShortlists ||
    b.majorLonglists - a.majorLonglists ||
    b.normalLonglists - a.normalLonglists ||
    a.bookId.localeCompare(b.bookId)
  );
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
  if (text.includes("history") || text.includes("bancroft") || text.includes("cundill")) subjects.add("History");
  if (text.includes("biography")) subjects.add("Biography");
  if (text.includes("memoir")) subjects.add("Memoir & Autobiography");
  if (text.includes("science")) subjects.add("Science");
  if (text.includes("medicine") || text.includes("virology") || text.includes("vagina")) subjects.add("Medicine & Public Health");
  if (text.includes("american") || text.includes("mexican")) subjects.add("American History");
  if (text.includes("global") || text.includes("world") || text.includes("empire")) subjects.add("World History");
  if (text.includes("politic") || text.includes("government")) subjects.add("Politics & Government");
  if (text.includes("society") || text.includes("social")) subjects.add("Society & Culture");
  return [...subjects];
}

function cleanDisplaySummary(summary?: string) {
  const normalized = clean(summary);
  if (!normalized) return undefined;

  const embeddedStart = findEmbeddedSummaryStart(normalized);
  if (embeddedStart) return removePromotionalSummaryBlocks(embeddedStart);

  const sentences = splitSummarySentences(normalized);
  const startIndex = findSummaryStartIndex(sentences);
  const cleaned = removePromotionalSummaryBlocks(sentences.slice(startIndex).join(" "));
  return cleaned || normalized;
}

function findEmbeddedSummaryStart(summary: string) {
  const candidatePattern = /(?:^|[•|]\s*|[.!?]\s+|\b\d{4}\s+)(the|a|an|in|on|from|when|as|this|with|at|for)\b/gi;
  for (const match of summary.matchAll(candidatePattern)) {
    const start = (match.index ?? 0) + match[0].length - match[1].length;
    const candidate = summary.slice(start).trim();
    const firstSentence = splitSummarySentences(candidate)[0] ?? candidate.slice(0, 260);
    if (isDescriptiveSummarySentence(firstSentence)) return candidate;
  }
  return undefined;
}

function removePromotionalSummaryBlocks(summary: string) {
  return clean(summary)
    .replace(
      /\s+(?:winner|finalist|shortlisted|longlisted|recipient|one of the|a new york times|new york times bestseller|national book award winner)\b[\s\S]*?(?=\b(?:in|on)\s+(?:\d{3,4}|[A-Z]))/gi,
      " ",
    )
    .replace(/\s+[“"][^”"]{12,260}[”"]\s*[—-]\s*[^.?!]+[.?!]?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSummarySentences(summary: string) {
  const protectedSummary = summary
    .replace(/\bMr\./g, "Mr<prd>")
    .replace(/\bMrs\./g, "Mrs<prd>")
    .replace(/\bMs\./g, "Ms<prd>")
    .replace(/\bDr\./g, "Dr<prd>")
    .replace(/\bProf\./g, "Prof<prd>")
    .replace(/\bSt\./g, "St<prd>")
    .replace(/\bU\.S\./g, "U<prd>S<prd>")
    .replace(/\bU\.K\./g, "U<prd>K<prd>")
    .replace(/\be\.g\./g, "e<prd>g<prd>")
    .replace(/\bi\.e\./g, "i<prd>e<prd>");
  return protectedSummary
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘])/)
    .map((sentence) => sentence.replace(/<prd>/g, ".").trim())
    .filter(Boolean);
}

function findSummaryStartIndex(sentences: string[]) {
  const firstDescriptive = sentences.findIndex(isDescriptiveSummarySentence);
  if (firstDescriptive >= 0) return firstDescriptive;
  const firstNonPromo = sentences.findIndex((sentence) => !isPromotionalSummarySentence(sentence));
  return firstNonPromo >= 0 ? firstNonPromo : 0;
}

function isDescriptiveSummarySentence(sentence: string) {
  const text = sentence.trim();
  const lower = text.toLowerCase();
  if (!text || isPromotionalSummarySentence(text)) return false;
  if (/[“”"]\s*[—-]\s*[A-Z]/.test(text)) return false;
  return (
    lower.startsWith("the ") ||
    lower.startsWith("a ") ||
    lower.startsWith("an ") ||
    lower.startsWith("in ") ||
    lower.startsWith("on ") ||
    lower.startsWith("from ") ||
    lower.startsWith("when ") ||
    lower.startsWith("as ") ||
    lower.startsWith("this ") ||
    lower.startsWith("with ") ||
    lower.startsWith("at ") ||
    lower.startsWith("for ")
  );
}

function isPromotionalSummarySentence(sentence: string) {
  const text = sentence.trim();
  const lower = text.toLowerCase();
  if (!text) return true;
  if (/^[“"‘']/.test(text)) return true;
  if (/[”"']\s*[—-]\s*[A-Z]/.test(text)) return true;
  if (/^(winner|finalist|shortlisted|longlisted|nominated|recipient)\b/i.test(text)) return true;
  if (/^(national book award|new york times|usa today|washington post|wall street journal|publishers weekly|kirkus reviews|library journal)\b/i.test(text)) return true;
  if (/^(a|an|one of)\s+(.{0,80})\b(best|notable|editors['’]? choice|favorite|most anticipated|top)\b/i.test(text)) return true;
  if (/^(named|selected|chosen)\s+(.{0,60})\b(best|notable|favorite)\b/i.test(text)) return true;
  if (/^(praise for|acclaim for|advance praise|reviews for)\b/i.test(text)) return true;
  if (/^(new york times|international|national|instant)?\s*bestseller\b/i.test(text)) return true;
  if (/^\*?\s*(?:winner|finalist|shortlisted|longlisted)\b/i.test(text)) return true;
  if (lower.includes("best book of") || lower.includes("best books of") || lower.includes("editors' choice") || lower.includes("editors’ choice")) return true;
  return false;
}

async function importRawAwardRecords({
  books,
  awards,
  editions,
  appearances,
  imprints,
  publishers,
  sources,
  generatedAt,
  titleResolver,
  prizeRegistry,
}: {
  books: Map<string, Book>;
  awards: Map<string, Award>;
  editions: Map<string, AwardEdition>;
  appearances: Map<string, AwardAppearance>;
  imprints: Map<string, Imprint>;
  publishers: Map<string, Publisher>;
  sources: Map<string, SourceRef>;
  generatedAt: string;
  titleResolver: CanonicalTitleResolver;
  prizeRegistry: PrizeRegistryFileEntry[];
}) {
  let files: string[] = [];
  try {
    files = (await fs.readdir(rawAwardRecordsDir)).filter((file) => file.endsWith(".json") && file !== "import-report.json").sort();
  } catch {
    return;
  }

  for (const file of files) {
    const parsed = JSON.parse(await fs.readFile(path.join(rawAwardRecordsDir, file), "utf8")) as { records?: RawAwardRecord[] };
    for (const record of parsed.records ?? []) {
      const authors = record.authors.map(clean).filter(Boolean);
      const title = titleResolver.resolve(record.title, authors);
      if (!title || isInvalidRawBookTitle(title) || !authors.length || !record.year || !record.categoryName) continue;

      const authorText = authors.join(" and ");
      const authorPeople = authors.map((name) => ({ id: `person-${slugify(name)}`, name }));
      const bookSlug = slugify(`${title}-${authorText}`);
      const bookId = `book-${bookSlug}`;
      const awardName = displayAwardName(record);
      const awardSlug = slugify(awardName);
      const awardId = `award-${awardSlug}`;
      const editionId = `edition-${awardSlug}-${record.year}`;
      const sourceId = sourceIdForRawRecord(record);
      const sourceIds = [sourceId];

      if (!sources.has(sourceId)) {
        sources.set(sourceId, {
          id: sourceId,
          label: record.sourceLabel || `${awardName} source`,
          url: record.sourceUrl,
          accessedAt: generatedAt,
          confidence: mapRawSourceConfidence(record.sourceConfidence),
          field: "award",
          note: record.notes,
        });
      }

      const publisherId = record.publisher ? `publisher-${slugify(record.publisher)}` : undefined;
      if (publisherId && !publishers.has(publisherId)) {
        publishers.set(publisherId, {
          id: publisherId,
          name: record.publisher!,
          sourceIds,
        });
      }

      const imprintId = record.imprint ? `imprint-${slugify(record.imprint)}` : undefined;
      if (imprintId && !imprints.has(imprintId)) {
        imprints.set(imprintId, {
          id: imprintId,
          name: record.imprint!,
          publisherId,
          sourceIds,
        });
      }

      if (!books.has(bookId)) {
        books.set(bookId, {
          id: bookId,
          slug: bookSlug,
          title,
          authors: authorPeople,
          publisherId,
          imprintId,
          isbn13: [],
          subjects: inferSubjects(awardName, title),
          topics: [],
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
        if (!book.publisherId && publisherId) book.publisherId = publisherId;
        if (!book.imprintId && imprintId) book.imprintId = imprintId;
        book.sourceIds = [...new Set([...book.sourceIds, sourceId])];
        book.subjects = [...new Set([...book.subjects, ...inferSubjects(awardName, title)])];
      }

      if (!awards.has(awardId)) {
        const subjectAreas = inferSubjects(awardName, "").filter((subject) => subject !== "Nonfiction");
        const registryPrize = findPrizeRegistryEntry(prizeRegistry, record.awardId);
        const registryCategory = findPrizeRegistryCategory(prizeRegistry, record.awardId, record.categoryId);
        awards.set(awardId, {
          id: awardId,
          slug: awardSlug,
          name: awardName,
          programId: record.awardId,
          categoryName: displayCategoryName(record.categoryName),
          categoryYears: registryCategory?.activeYears,
          shortName: shortAwardName(record),
          organization: organizationForRawAward(record),
          awardType: registryCategory?.awardType ?? registryPrize?.awardType ?? "award",
          subjectAreas: subjectAreas.length ? subjectAreas : ["Nonfiction"],
          links: {
            official: record.notes?.match(/https?:\/\/\S+/)?.[0],
          },
          sourceIds,
        });
      } else {
        const award = awards.get(awardId)!;
        award.sourceIds = [...new Set([...award.sourceIds, sourceId])];
      }

      if (!editions.has(editionId)) {
        editions.set(editionId, {
          id: editionId,
          awardId,
          year: record.year,
          category: record.categoryName,
          announcementUrl: record.sourceUrl,
          sourceIds,
        });
      }

      const normalized = normalizeRawStatus(record.status);
      const appearanceId = `appearance-${bookSlug}-${awardSlug}-${record.year}-${slugify(record.status)}`;
      appearances.set(appearanceId, {
        id: appearanceId,
        bookId,
        awardId,
        awardEditionId: editionId,
        year: record.year,
        status: normalized.status,
        originalStatus: record.status,
        statusRank: normalized.rank,
        isTie: normalized.isTie,
        sourceUrl: record.sourceUrl,
        sourceIds,
      });
    }
  }
}

function isInvalidRawBookTitle(title: string) {
  return /^(winner|co[-\s]?winner|finalist|shortlist|shortlisted|longlist|longlisted|honou?rable mention|notable)$/i.test(clean(title));
}

function displayAwardName(record: RawAwardRecord) {
  const category = displayCategoryName(record.categoryName);
  if (/^pulitzer prize$/i.test(record.awardName)) return `Pulitzer Prize in ${category}`;
  if (/^national book awards$/i.test(record.awardName)) return `National Book Award for ${category}`;
  if (/^national book critics circle awards$/i.test(record.awardName)) return `National Book Critics Circle Award for ${category}`;
  if (/^los angeles times book prize$/i.test(record.awardName)) return `Los Angeles Times Book Prize for ${category}`;
  if (/^prose awards$/i.test(record.awardName)) return `PROSE Award for ${category}`;
  return category && !record.awardName.toLowerCase().includes(category.toLowerCase()) ? `${record.awardName}: ${category}` : record.awardName;
}

function displayCategoryName(input: string) {
  return clean(input).replace(/\b(nonfiction|reference|biography)\b/gi, (match) => {
    if (/^and$/i.test(match)) return "and";
    return match.slice(0, 1).toUpperCase() + match.slice(1).toLowerCase();
  });
}

function shortAwardName(record: RawAwardRecord) {
  if (/^pulitzer prize$/i.test(record.awardName)) return `Pulitzer ${record.categoryName}`;
  if (/^national book awards$/i.test(record.awardName)) return `NBA ${record.categoryName}`;
  if (/^national book critics circle awards$/i.test(record.awardName)) return `NBCC ${record.categoryName}`;
  return undefined;
}

function organizationForRawAward(record: RawAwardRecord) {
  if (/^pulitzer prize$/i.test(record.awardName)) return "Columbia University";
  if (/^national book awards$/i.test(record.awardName)) return "National Book Foundation";
  if (/^national book critics circle awards$/i.test(record.awardName)) return "National Book Critics Circle";
  return undefined;
}

function sourceIdForRawRecord(record: RawAwardRecord) {
  return `source-award-record-${slugify(`${record.categoryId}-${record.sourceLabel || record.sourceUrl}`)}`;
}

function mapRawSourceConfidence(confidence: RawAwardRecordSourceConfidence): SourceRef["confidence"] {
  if (confidence === "official") return "official";
  if (confidence === "manual") return "manual";
  if (confidence === "secondary") return "catalog";
  return "unknown";
}

async function buildTitleResolver(manifest: ManifestEntry[]) {
  const candidates: TitleCandidate[] = [];

  for (const source of manifest) {
    if (source.type !== "xlsx") continue;
    const workbook = XLSX.readFile(path.join(sourcesDir, source.file));
    const appearanceRows = XLSX.utils.sheet_to_json<RawAppearanceRow>(
      workbook.Sheets[source.appearancesSheet ?? "Raw appearances"] ?? {},
      { defval: "" },
    );
    for (const row of appearanceRows) {
      const title = clean(row.Title);
      const authorText = clean(row.Author);
      if (!title || !authorText) continue;
      candidates.push({
        title,
        authors: splitPeople(authorText).map((author) => author.name),
      });
    }
  }

  try {
    const files = (await fs.readdir(rawAwardRecordsDir)).filter((file) => file.endsWith(".json") && file !== "import-report.json").sort();
    for (const file of files) {
      const parsed = JSON.parse(await fs.readFile(path.join(rawAwardRecordsDir, file), "utf8")) as { records?: RawAwardRecord[] };
      for (const record of parsed.records ?? []) {
        const title = clean(record.title);
        const authors = record.authors.map(clean).filter(Boolean);
        if (!title || isInvalidRawBookTitle(title) || !authors.length) continue;
        candidates.push({ title, authors });
      }
    }
  } catch {
    // Raw award records are optional while bootstrapping a new installation.
  }

  return buildCanonicalTitleResolver(candidates);
}

async function main() {
  const manifestPath = path.join(sourcesDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestEntry[];
  const subjectDefinitions = await readSubjectDefinitions();
  const topicDefinitions = await readTopicDefinitions();
  const subjectMapRules = await readSubjectMapRules(subjectDefinitions);
  const curation = await readCuration();
  const enrichment = await readEnrichment();
  const wikipediaEvidence = await readWikipediaEvidence();
  const bookAliases = await readBookAliases();
  const generatedTopics = await readGeneratedTopics();
  const prizeRegistry = await readPrizeRegistry();
  const curatedBookSubjectIds = new Set(
    Object.entries(curation.books ?? {})
      .filter(([, patch]) => Array.isArray(patch.subjects))
      .map(([id]) => id),
  );
  const curatedBookTopicIds = new Set(
    Object.entries(curation.books ?? {})
      .filter(([, patch]) => Array.isArray(patch.topics) || patch.primaryTopic)
      .map(([id]) => id),
  );
  const generatedAt = new Date().toISOString();
  const titleResolver = await buildTitleResolver(manifest);

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
      const authorText = clean(row.Author);
      const title = titleResolver.resolve(row.Title ?? "", splitPeople(authorText).map((author) => author.name));
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
          topics: [],
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

  await importRawAwardRecords({ books, awards, editions, appearances, imprints, publishers, sources, generatedAt, titleResolver, prizeRegistry });

  applySourcePatches(sources, enrichment.sources);
  applyBookCuration(books, enrichment.books, titleResolver, { allowCreate: false });
  applyCuration(awards, enrichment.awards);
  applyCuration(imprints, enrichment.imprints);
  applyCuration(publishers, enrichment.publishers);
  applySourcePatches(sources, curation.sources);
  applyBookCuration(books, curation.books, titleResolver);
  applyCuration(awards, curation.awards);
  applyCuration(imprints, curation.imprints);
  applyCuration(publishers, curation.publishers);
  applyBookAliases(books, appearances, bookAliases);
  if (process.env.DEBUG_AWARD_MERGE === "1") console.log(`Awards before program metadata: ${awards.size}`);
  applyAwardProgramMetadata(awards, prizeRegistry);
  if (process.env.DEBUG_AWARD_MERGE === "1") console.log(`Awards before duplicate merge: ${awards.size}; appearances: ${appearances.size}`);
  mergeDuplicateAwardCategories(awards, editions, appearances);
  if (process.env.DEBUG_AWARD_MERGE === "1") console.log(`Awards after duplicate merge: ${awards.size}; appearances: ${appearances.size}`);

  for (const book of books.values()) {
    const imprint = book.imprintId ? imprints.get(book.imprintId) : undefined;
    if (imprint?.publisherId) {
      book.publisherId = imprint.publisherId;
    }
    book.displaySummary = cleanDisplaySummary(book.summary);
  }

  const { report: subjectClassificationReport, classifications: subjectClassifications } = classifyBooksBySubject({
    books,
    awards,
    appearances,
    subjectDefinitions,
    curatedBookSubjectIds,
  });
  const { report: topicClassificationReport, classifications: topicClassifications } = classifyBooksByTopic({
    books,
    topicDefinitions,
    generatedTopics,
    curatedBookTopicIds,
  });
  const subjectEvidenceReport = applySubjectEvidenceDecisions({
    books,
    awards,
    appearances,
    subjectDefinitions,
    curatedBookSubjectIds,
    topicClassifications,
    subjectClassifications,
    subjectMapRules,
  });
  const subjectReviewReport = buildSubjectReviewReport(books);
  const suspiciousSubjectTopicReport = buildSuspiciousSubjectTopicReport(books);
  const taxonomyValidationReport = validateTaxonomy({
    books,
    subjectDefinitions,
    topicDefinitions,
  });
  if (taxonomyValidationReport.totals.subjectErrors || taxonomyValidationReport.totals.topicErrors) {
    await fs.mkdir(publicDataDir, { recursive: true });
    await fs.writeFile(
      path.join(publicDataDir, "taxonomy-validation-report.json"),
      `${JSON.stringify(taxonomyValidationReport, null, 2)}\n`,
    );
    throw new Error(
      `Taxonomy validation failed: ${taxonomyValidationReport.totals.subjectErrors} subject errors, ${taxonomyValidationReport.totals.topicErrors} topic errors.`,
    );
  }

  const stats = new Map<string, BookStats>();
  for (const book of books.values()) {
    stats.set(book.id, {
      bookId: book.id,
      wins: 0,
      lists: 0,
      score: 0,
      majorWins: 0,
      normalWins: 0,
      majorShortlists: 0,
      normalShortlists: 0,
      majorLonglists: 0,
      normalLonglists: 0,
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
    const award = awards.get(appearance.awardId);
    const isMajorAward = award?.awardType === "major_award";
    stat.lists += 1;
    stat.statuses[appearance.status] += 1;
    stat.score += awardRecognitionWeight(appearance.status, isMajorAward);
    if (appearance.status === "winner" || appearance.status === "co_winner") {
      stat.wins += 1;
      if (isMajorAward) stat.majorWins += 1;
      else stat.normalWins += 1;
    } else if (appearance.status === "finalist" || appearance.status === "shortlist") {
      if (isMajorAward) stat.majorShortlists += 1;
      else stat.normalShortlists += 1;
    } else if (appearance.status === "longlist") {
      if (isMajorAward) stat.majorLonglists += 1;
      else stat.normalLonglists += 1;
    }
  }

  const subjectDefinitionsByName = new Map(subjectDefinitions.map((subject) => [subject.name, subject]));
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
      description: subjectDefinitionsByName.get(name)?.description,
      sortOrder: subjectDefinitionsByName.get(name)?.sortOrder,
      fallback: subjectDefinitionsByName.get(name)?.fallback,
      bookCount: value.ids.size,
      topBookId: value.topBookId,
    }))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || b.bookCount - a.bookCount || a.name.localeCompare(b.name));

  applyRelatedBookIds({
    books,
    appearances,
    stats,
  });

  const publicData: PublicData = {
    generatedAt,
    books: [...books.values()].sort((a, b) => a.title.localeCompare(b.title)),
    awardPrograms: buildAwardPrograms(prizeRegistry, awards, appearances),
    awards: [...awards.values()].sort((a, b) => a.name.localeCompare(b.name)),
    editions: [...editions.values()].sort((a, b) => b.year - a.year),
    appearances: [...appearances.values()].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank),
    publishers: [...publishers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    imprints: [...imprints.values()].sort((a, b) => a.name.localeCompare(b.name)),
    subjects,
    sources: [...sources.values()],
    stats: [...stats.values()].sort(compareBookStats),
    wikipediaEvidence: wikipediaEvidence
      .filter((item) => books.has(item.bookId))
      .sort((a, b) => a.pageTitle.localeCompare(b.pageTitle)),
  };
  const topicSummary = buildTopicSummary({
    generatedAt,
    books,
    awards,
    appearances,
    topicDefinitions,
  });

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(path.join(publicDataDir, "catalog.json"), `${JSON.stringify(publicData, null, 2)}\n`);
  await fs.writeFile(path.join(publicDataDir, "browse.json"), `${JSON.stringify(buildBrowseData(publicData))}\n`);
  await fs.writeFile(
    path.join(publicDataDir, "taxonomy-validation-report.json"),
    `${JSON.stringify(taxonomyValidationReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(publicDataDir, "subject-classification-report.json"),
    `${JSON.stringify(subjectClassificationReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(publicDataDir, "topic-classification-report.json"),
    `${JSON.stringify(topicClassificationReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(publicDataDir, "subject-evidence-report.json"),
    `${JSON.stringify(subjectEvidenceReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(publicDataDir, "subject-review-report.json"),
    `${JSON.stringify(subjectReviewReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(publicDataDir, "suspicious-subject-topic-report.json"),
    `${JSON.stringify(suspiciousSubjectTopicReport, null, 2)}\n`,
  );
  await fs.writeFile(path.join(publicDataDir, "topic-summary.json"), `${JSON.stringify(topicSummary, null, 2)}\n`);

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

function applyRelatedBookIds({
  books,
  appearances,
  stats,
}: {
  books: Map<string, Book>;
  appearances: Map<string, AwardAppearance>;
  stats: Map<string, BookStats>;
}) {
  const booksBySubject = new Map<string, Set<string>>();
  const booksByTopic = new Map<string, Set<string>>();
  const booksByAward = new Map<string, Set<string>>();
  const booksByImprint = new Map<string, Set<string>>();
  const awardsByBook = new Map<string, Set<string>>();

  for (const book of books.values()) {
    for (const subject of book.subjects) addToSetMap(booksBySubject, subject, book.id);
    for (const topic of book.topics) addToSetMap(booksByTopic, topic, book.id);
    if (book.imprintId) addToSetMap(booksByImprint, book.imprintId, book.id);
  }

  for (const appearance of appearances.values()) {
    addToSetMap(booksByAward, appearance.awardId, appearance.bookId);
    addToSetMap(awardsByBook, appearance.bookId, appearance.awardId);
  }

  for (const book of books.values()) {
    const scores = new Map<string, number>();

    for (const topic of book.topics) {
      addRelatedScores(scores, booksByTopic.get(topic), book.id, topic === book.primaryTopic ? 12 : 4);
    }
    for (const subject of book.subjects) {
      addRelatedScores(scores, booksBySubject.get(subject), book.id, subject === book.primarySubject ? 4 : 2);
    }
    for (const awardId of awardsByBook.get(book.id) ?? []) {
      addRelatedScores(scores, booksByAward.get(awardId), book.id, 2);
    }
    if (book.imprintId) {
      addRelatedScores(scores, booksByImprint.get(book.imprintId), book.id, 1);
    }

    book.relatedBookIds = [...scores.entries()]
      .map(([bookId, score]) => ({
        bookId,
        score: score + (stats.get(bookId)?.score ?? 0) / 50,
      }))
      .filter((item) => item.score >= 4)
      .sort((a, b) => {
        const bookA = books.get(a.bookId);
        const bookB = books.get(b.bookId);
        return b.score - a.score || (bookA?.title ?? "").localeCompare(bookB?.title ?? "");
      })
      .slice(0, 12)
      .map((item) => item.bookId);
  }
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const current = map.get(key) ?? new Set<string>();
  current.add(value);
  map.set(key, current);
}

function addRelatedScores(scores: Map<string, number>, candidates: Set<string> | undefined, currentBookId: string, weight: number) {
  if (!candidates) return;
  for (const candidateId of candidates) {
    if (candidateId === currentBookId) continue;
    scores.set(candidateId, (scores.get(candidateId) ?? 0) + weight);
  }
}

async function readSubjectDefinitions(): Promise<SubjectDefinition[]> {
  const subjects = JSON.parse(await fs.readFile(path.join(sourcesDir, "subjects.json"), "utf8")) as SubjectDefinition[];
  const seen = new Set<string>();
  for (const subject of subjects) {
    if (seen.has(subject.name)) throw new Error(`Duplicate subject name in sources/subjects.json: ${subject.name}`);
    seen.add(subject.name);
    const expectedId = slugify(subject.name);
    if (subject.id !== expectedId) {
      throw new Error(`Subject "${subject.name}" has id "${subject.id}", expected "${expectedId}"`);
    }
  }
  return subjects;
}

async function readTopicDefinitions(): Promise<TopicDefinition[]> {
  const topics = JSON.parse(await fs.readFile(path.join(sourcesDir, "topics.json"), "utf8")) as TopicDefinition[];
  const seen = new Set<string>();
  for (const topic of topics) {
    if (seen.has(topic.name)) throw new Error(`Duplicate topic name in sources/topics.json: ${topic.name}`);
    seen.add(topic.name);
    const expectedId = slugify(topic.name);
    if (topic.id !== expectedId) {
      throw new Error(`Topic "${topic.name}" has id "${topic.id}", expected "${expectedId}"`);
    }
  }
  return topics;
}

async function readSubjectMapRules(subjectDefinitions: SubjectDefinition[]): Promise<SubjectMapRule[]> {
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const parsed = JSON.parse(await fs.readFile(path.join(sourcesDir, "subject-map.json"), "utf8")) as SubjectMapFile;
  return parsed.entries.map((entry) => {
    if (!allowedSubjects.has(entry.subject)) {
      throw new Error(`Subject map entry references unknown subject: ${entry.subject}`);
    }
    return {
      ...entry,
      pattern: new RegExp(entry.match, "i"),
    };
  });
}

function classifyBooksByTopic({
  books,
  topicDefinitions,
  generatedTopics,
  curatedBookTopicIds,
}: {
  books: Map<string, Book>;
  topicDefinitions: TopicDefinition[];
  generatedTopics: GeneratedTopicsFile;
  curatedBookTopicIds: Set<string>;
}): { report: TopicClassificationReportEntry[]; classifications: Map<string, BookTopicClassification> } {
  const allowedTopics = new Set(topicDefinitions.map((topic) => topic.name));
  const report: TopicClassificationReportEntry[] = [];
  const classifications = new Map<string, BookTopicClassification>();

  for (const book of books.values()) {
    const classification = classifyBookTopic(book, allowedTopics, generatedTopics.books?.[book.id], curatedBookTopicIds.has(book.id));
    classifications.set(book.id, classification);
    book.primaryTopic = classification.primaryTopic;
    book.topics = classification.topics;
    if (classification.confidence !== "high" || classification.topics.length > 1) {
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        primarySubject: book.primarySubject,
        primaryTopic: classification.primaryTopic,
        topics: classification.topics,
        confidence: classification.confidence,
        reasons: classification.reasons,
        reviewReason: classification.reviewReason,
      });
    }
  }

  return {
    report: report.sort(
      (a, b) =>
        confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
        (a.primaryTopic ?? "").localeCompare(b.primaryTopic ?? "") ||
        a.title.localeCompare(b.title),
    ),
    classifications,
  };
}

function classifyBookTopic(
  book: Book,
  allowedTopics: Set<string>,
  generated?: GeneratedTopicClassification,
  isCurated = false,
): { primaryTopic?: string; topics: string[]; confidence: "high" | "medium" | "low"; reasons: string[]; reviewReason?: string } {
  const curatedTopics = normalizeTopicPatch(book.primaryTopic, book.topics, allowedTopics);
  if (isCurated && curatedTopics.topics.length) {
    return {
      primaryTopic: curatedTopics.primaryTopic,
      topics: curatedTopics.topics,
      confidence: "high",
      reasons: ["manual topic curation"],
    };
  }

  const generatedTopics = normalizeTopicPatch(generated?.primaryTopic, generated?.topics, allowedTopics);
  if (generatedTopics.topics.length && generated?.reviewStatus !== "rejected") {
    return {
      primaryTopic: generatedTopics.primaryTopic,
      topics: generatedTopics.topics,
      confidence: generated?.confidence ?? "medium",
      reasons: [generated?.method ? `generated topic enrichment: ${generated.method}` : "generated topic enrichment"],
      reviewReason: generated?.confidence === "low" ? generated.rationale ?? "Generated topic classification is low confidence." : undefined,
    };
  }

  const title = `${book.title} ${book.subtitle ?? ""}`.toLowerCase();
  const summary = (book.summary ?? "").toLowerCase();
  const text = `${title} ${summary} ${(book.primarySubject ?? "").toLowerCase()}`;
  const matched = new Map<string, number>();
  const reasons: string[] = [];
  const add = (topic: string, reason: string, weight = 1) => {
    if (!allowedTopics.has(topic)) return;
    matched.set(topic, Math.max(matched.get(topic) ?? 0, weight));
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  const overrides = getTitleTopicOverrides().get(slugify(book.title));
  if (overrides) overrides.forEach((topic, index) => add(topic, "title-level topic override", 8 - index / 10));

  if (/\b(watergate|president|presidency|executive|obama|fbi|hoover)\b/.test(text)) add("Presidency & Executive Power", "presidency/executive keyword", 5);
  if (/\b(president|presidency|lincoln|washington|jefferson|adams|roosevelt|truman|kennedy|johnson|nixon|reagan|clinton|obama)\b/.test(text) && book.primarySubject === "Biography") add("Presidential Biography", "presidential biography keyword", 8);
  if (/\b(politician|senator|governor|mayor|statesman|diplomat|cabinet|secretary of state|public office)\b/.test(text) && book.primarySubject === "Biography") add("Political Biography", "political biography keyword", 8);
  if (/\b(election|vote|voting|democracy|democratic|franchise|one person no vote)\b/.test(text)) add("Democracy & Elections", "democracy/elections keyword", 5);
  if (/\b(constitution|constitutional|founding|madison)\b/.test(text)) add("Constitutional History", "constitutional keyword", 5);
  if (/\b(law|legal|rights|deportation|border law|citizenship)\b/.test(text)) add("Law & Legal Change", "law/legal keyword", 4);
  if (/\b(trial|court|judgment|judge|justice be done|sewing girl)\b/.test(text)) add("Courts & Trials", "court/trial keyword", 5);
  if (/\b(crime|police|violence|murder|flower moon|bruises)\b/.test(text)) add("Crime, Policing & Violence", "crime/policing keyword", 5);
  if (/\b(prison|incarceration|solitary|halfway home|attica)\b/.test(text)) add("Prisons & Incarceration", "prison/incarceration keyword", 6);
  if (/\b(war|military|battle|soldier|veteran|vietnam|tokyo|iraq|afghanistan|hitler|nazi)\b/.test(text)) add("War & Military Strategy", "war/military keyword", 5);
  if (/\b(civil war|confederacy|confederate|union army|appomattox|gettysburg)\b/.test(text)) add("American Civil War", "Civil War keyword", 7);
  if (/\b(world war i|first world war|great war|1914|1918)\b/.test(text)) add("World War I", "World War I keyword", 7);
  if (/\b(world war ii|second world war|wwii|pearl harbor|d-day|nazi|hitler|third reich|tokyo|manhattan project|oppenheimer)\b/.test(text)) add("World War II", "World War II keyword", 7);
  if (/\b(vietnam|viet nam|john paul vann|hanoi|saigon|hue 1968)\b/.test(text)) add("Vietnam War", "Vietnam War keyword", 7);
  if (book.primarySubject === "Biography" && /\b(war|military|battle|soldier|general|veteran|vietnam|iraq|afghanistan)\b/.test(text)) add("Military Biography", "military biography keyword", 8);
  if (/\b(veteran|combat|marching home|soldiers)\b/.test(text)) add("Soldiers, Veterans & Combat Experience", "combat/veteran keyword", 5);
  if (/\b(cold war|nuclear|doomsday|soviet|chernobyl)\b/.test(text)) add("Cold War & Nuclear Politics", "cold war/nuclear keyword", 5);
  if (/\b(intelligence|surveillance|secrecy|classified|directorate|pentagon|machine|spy)\b/.test(text)) add("Intelligence, Secrecy & Surveillance", "intelligence/secrecy keyword", 5);
  if (/\b(genocide|atrocity|pogrom|massacre|torture|holocaust|katyn|kl)\b/.test(text)) add("Genocide, Atrocity & Political Violence", "atrocity keyword", 6);
  if (/\b(holocaust|shoah|auschwitz|nazi genocide)\b/.test(text)) add("Holocaust", "Holocaust keyword", 7);
  if (/\b(empire|colonial|imperial|anarchy|colonialism)\b/.test(text)) add("Empire & Colonialism", "empire/colonial keyword", 5);
  if (/\b(slavery|slave|emancipation|plantation|abolition)\b/.test(text)) add("Slavery & Emancipation", "slavery/emancipation keyword", 6);
  if (/\b(reconstruction|freedmen|freedpeople)\b/.test(text)) add("Reconstruction", "Reconstruction keyword", 6);
  if (/\b(indigenous|native|lakota|tribe|tribal|wounded knee|settler|nations)\b/.test(text)) add("Indigenous History", "Indigenous history keyword", 6);
  if (/\b(civil rights|racial justice|segregation|jim crow|white supremacy)\b/.test(text)) add("Civil Rights & Racial Justice", "civil rights/racial justice keyword", 6);
  if (book.primarySubject === "Biography" && /\b(activist|movement|civil rights|abolitionist|organizer|reformer|malcolm|douglass|martin luther king)\b/.test(text)) add("Activist Biography", "activist biography keyword", 8);
  if (/\b(black|african american|douglass|baldwin|malcolm|black-owned|black folk|black in blues)\b/.test(text)) add("Black History & Culture", "Black history/culture keyword", 5);
  if (/\b(immigration|immigrant|refugee|border|deport|undocumented|migrant|asylum)\b/.test(text)) add("Immigration, Refugees & Borderlands", "immigration/border keyword", 6);
  if (/\b(cuba|haiti|mexico|mexican|latin america|caribbean|el norte|america america)\b/.test(text)) add("Latin America & the Caribbean", "Latin America/Caribbean keyword", 5);
  if (/\b(europe|russia|soviet|spain|scots|catalans|third reich|stalin|hitler)\b/.test(text)) add("Europe & Russia", "Europe/Russia keyword", 4);
  if (/\b(china|chinese|asia|pacific|india|tokyo|mao|bamboo grove)\b/.test(text)) add("Asia & the Pacific", "Asia/Pacific keyword", 4);
  if (/\b(middle east|iraq|afghanistan|iran|palestine|syria|ottoman)\b/.test(text)) add("Middle East & North Africa", "Middle East/North Africa keyword", 4);
  if (/\b(africa|african|ghana|anansi|combee|diaspora)\b/.test(text)) add("Africa & the African Diaspora", "Africa/diaspora keyword", 4);
  if (/\b(religion|religious|church|god|evangelical|faith|christian|jewish|jews|priest)\b/.test(text)) add("Religion & Religious Movements", "religion keyword", 5);
  if (/\b(evangelical|christian nationalism|christian nationalist)\b/.test(text)) add("Evangelicalism & Christian Nationalism", "evangelicalism keyword", 6);
  if (/\b(gender|women|woman|feminism|firebrand|first lady|property)\b/.test(text)) add("Gender & Feminism", "gender/feminism keyword", 5);
  if (/\b(lgbtq|queer|gay|transgender|trans(?![-a-z])|sexuality|deviant|darkroom|other olympians)\b/.test(text)) add("LGBTQ History & Life", "LGBTQ keyword", 6);
  if (/\b(abortion|reproductive|roe|adoption|relinquished|family policy|undue burden)\b/.test(text)) add("Reproductive Rights & Family Policy", "reproductive/family policy keyword", 6);
  if (/\b(family|childhood|children|adoption|child|father|mother|daughter|son)\b/.test(text)) add("Family, Childhood & Adoption", "family/childhood keyword", 4);
  if (book.primarySubject === "Biography" && /\b(family|families|father|mother|daughter|son|sister|brother|hemingses|kin)\b/.test(text)) add("Family Biography", "family biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(group biography|collective biography|lives of|circle of|generation of)\b/.test(text)) add("Group Biography", "group biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(scientist|science|physicist|chemist|biology|mathematician|oppenheimer|einstein|darwin)\b/.test(text)) add("Scientific Biography", "scientific biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(writer|writers|novelist|poet|literary|orwell|shakespeare|baldwin|woolf|mccarthy)\b/.test(text)) add("Literary Biography", "literary biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(artist|painter|composer|musician|singer|performer|actor|art|music|picasso|dolly)\b/.test(text)) add("Artistic Biography", "artistic biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(businessman|businesswoman|entrepreneur|capitalist|corporation|financier|industrialist)\b/.test(text)) add("Business Biography", "business biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(religious|religion|church|priest|pastor|minister|rabbi|faith|theologian)\b/.test(text)) add("Religious Biography", "religious biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(athlete|sport|sports|olympian|boxing|baseball|football|ali)\b/.test(text)) add("Sports Biography", "sports biography keyword", 8);
  if (book.primarySubject === "Biography" && /\b(intellectual|thinker|philosopher|ideas|journalist|lippmann|public intellectual)\b/.test(text)) add("Intellectual Biography", "intellectual biography keyword", 8);
  if (book.primarySubject === "Biography") add("Biography & Public Lives", "biography fallback", 1);
  if (book.primarySubject === "Memoir & Autobiography") add("Memoir & Personal History", "memoir subject", 4);
  if (/\b(grief|trauma|recovery|death takes|memorial|survivors)\b/.test(text)) add("Grief, Trauma & Recovery", "grief/trauma keyword", 5);
  if (/\b(ideas|intellectual|existentialist|choice|upper air|method)\b/.test(text)) add("Intellectual History & Ideas", "intellectual history keyword", 4);
  if (/\b(literature|writer|writers|orwell|shakespeare|baldwin|rushdie|carson mccullers)\b/.test(text)) add("Literature & Writers", "literature/writers keyword", 5);
  if (/\b(art|music|performance|blues|picasso|dolly|rain|method)\b/.test(text)) add("Art, Music & Performance", "art/music/performance keyword", 5);
  if (/\b(film|television|tv|popular culture|cue the sun|freaks)\b/.test(text)) add("Film, Television & Popular Culture", "film/television/pop culture keyword", 5);
  if (/\b(journalism|media|news|public opinion|bad news|outrage machine)\b/.test(text)) add("Media, Journalism & Public Opinion", "media/journalism keyword", 5);
  if (/\b(movement|activism|activist|protest|unite|let the record show)\b/.test(text)) add("Social Movements & Activism", "social movements keyword", 5);
  if (/\b(class|poverty|inequality|evicted|invisible child|heartland|white trash)\b/.test(text)) add("Class, Poverty & Inequality", "class/poverty keyword", 5);
  if (/\b(housing|cities|city|urban|palo alto|new york|katrina|address book)\b/.test(text)) add("Housing, Cities & Urban Life", "housing/cities keyword", 5);
  if (/\b(labor|work|workers|workplace|organizing|honest living|day's work|great escape)\b/.test(text)) add("Labor, Work & Organizing", "labor/work keyword", 5);
  if (/\b(business|capitalism|corporation|corporations|black-owned|profit|cobalt|empire of pain)\b/.test(text)) add("Business, Capitalism & Corporations", "business/capitalism keyword", 5);
  if (/\b(money|markets|economic|economy|tax|finance|savings|trust|dark money)\b/.test(text)) add("Money, Markets & Economic Policy", "money/markets keyword", 5);
  if (/\b(food|agriculture|land|plantation|cooking gene|crops|farm)\b/.test(text)) add("Food, Agriculture & Land", "food/agriculture/land keyword", 5);
  if (/\b(infrastructure|engineering|built|machine to move|address book|challenger)\b/.test(text)) add("Infrastructure, Engineering & Built Environment", "infrastructure/engineering keyword", 5);
  if (/\b(technology|computing|ai|algorithm|digital|internet|empire of ai|deportation machine)\b/.test(text)) add("Technology, Computing & AI", "technology/computing keyword", 6);
  if (/\b(science|discovery|genetic|evolution|seeds of life|invention of science)\b/.test(text)) add("Science & Discovery", "science/discovery keyword", 6);
  if (/\b(medicine|medical|health|body|vagina|facemaker|patient|hospital)\b/.test(text)) add("Medicine, Health & the Body", "medicine/health keyword", 5);
  if (/\b(disease|epidemic|pandemic|virus|virology|dopesick|dreamland|opioid|drugs|addiction)\b/.test(text)) add("Disease, Epidemics & Drugs", "disease/drugs keyword", 6);
  if (/\b(mental health|psychology|psychiatry|suicide|nervous system|kill yourself)\b/.test(text)) add("Mental Health & Psychology", "mental health/psychology keyword", 6);
  if (/\b(disability|disabled|asperger|difference|deaf|miracles)\b/.test(text)) add("Disability & Difference", "disability/difference keyword", 5);
  if (/\b(climate|weather|disaster|fire|hurricane|katrina|furious sky|fire weather)\b/.test(text)) add("Climate, Weather & Disaster", "climate/weather/disaster keyword", 6);
  if (/\b(environment|conservation|pollution|ecology|cobalt|running out|great displacement)\b/.test(text)) add("Environment, Conservation & Pollution", "environment keyword", 5);
  if (/\b(natural history|animals|animal|species|hawk|world of wonders|immense world)\b/.test(text)) add("Natural History & Animals", "natural history/animals keyword", 6);
  if (/\b(ocean|river|water|sea|gulf|lakes|fathoms|saltwater|bog|swamp)\b/.test(text)) add("Oceans, Rivers & Water", "water keyword", 6);
  if (/\b(energy|extraction|resources|oil|cobalt|mining|industrial)\b/.test(text)) add("Energy, Extraction & Resources", "energy/extraction keyword", 5);
  if (/\b(travel|exploration|journey|walk|park|border|place|horizontal vertigo|south to america)\b/.test(text)) add("Travel, Exploration & Place", "travel/place keyword", 5);
  if (/\b(texas|california|new england|southern|st louis|regional|local|gulf)\b/.test(text)) add("Regional & Local History", "regional/local keyword", 4);
  if (/\b(education|school|students|universit|coddling|teaching)\b/.test(text)) add("Education & Universities", "education keyword", 5);
  if (/\b(sport|athlete|olympian|ali|boxing|baseball|football)\b/.test(text)) add("Sports & Athletes", "sports keyword", 6);
  if (/\b(death|memory|commemoration|memorial|dead|forget|work of the dead)\b/.test(text)) add("Death, Memory & Commemoration", "death/memory keyword", 5);
  if (/\b(archive|museum|historical method|record|address book|word is passed)\b/.test(text)) add("Archives, Museums & Historical Method", "archives/museums/method keyword", 4);
  if (/\b(settler|settler colonial|colonialism|indigenous continent)\b/.test(text)) add("Settler Colonialism", "settler colonialism keyword", 6);
  if (/\b(diaspora|migration|migrant|exile|refugee|ungrateful refugee)\b/.test(text)) add("Migration & Diaspora", "migration/diaspora keyword", 5);
  if (/\b(nationalism|authoritarian|fascism|dictator|unfreedom|future is history)\b/.test(text)) add("Nationalism & Authoritarianism", "nationalism/authoritarianism keyword", 5);
  if (/\b(human rights|international law|tribunal|tokyo|justice)\b/.test(text)) add("Human Rights & International Law", "human rights/international law keyword", 4);
  if (/\b(public health|health systems|epidemiology|patient)\b/.test(text)) add("Public Health Systems", "public health systems keyword", 5);
  if (/\b(drugs|addiction|opioid|treatment|dopesick|dreamland|least of us)\b/.test(text)) add("Drugs, Addiction & Treatment", "drugs/addiction keyword", 6);
  if (/\b(essays|criticism|notes|call them|thick|just us|little devil)\b/.test(text)) add("Essays & Cultural Criticism", "essays/cultural criticism keyword", 5);

  addFallbackTopic(book, add);

  const topics = [...matched.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([topic]) => topic);
  const primaryTopic = topics[0];
  const topWeight = primaryTopic ? matched.get(primaryTopic) ?? 0 : 0;
  const confidence = !primaryTopic ? "low" : topWeight <= 1 ? "medium" : topics.length > 2 ? "medium" : "high";

  return {
    primaryTopic,
    topics,
    confidence,
    reasons,
    reviewReason: !primaryTopic
      ? "No topic matched."
      : topics.length > 2
        ? `Primary topic selected from multiple candidates: ${topics.join(", ")}.`
        : undefined,
  };
}

function normalizeTopicPatch(primaryTopic: string | undefined, topics: string[] | undefined, allowedTopics: Set<string>) {
  const normalizedTopics = [...new Set([primaryTopic, ...(topics ?? [])].filter((topic): topic is string => Boolean(topic && allowedTopics.has(topic))))];
  return {
    primaryTopic: normalizedTopics[0],
    topics: normalizedTopics.slice(0, 4),
  };
}

function addFallbackTopic(book: Book, add: (topic: string, reason: string, weight?: number) => void) {
  const fallbackBySubject: Record<string, string> = {
    "American History": "Regional & Local History",
    "World History": "Empire & Colonialism",
    "History": "Regional & Local History",
    "Biography": "Biography & Public Lives",
    "Memoir & Autobiography": "Memoir & Personal History",
    "Politics & Government": "American Politics",
    "Society & Culture": "Class, Poverty & Inequality",
    "Journalism & Reportage": "Media, Journalism & Public Opinion",
    Science: "Science & Discovery",
    "Medicine & Public Health": "Medicine, Health & the Body",
    "Nature & Environment": "Environment, Conservation & Pollution",
    Technology: "Technology, Computing & AI",
    "Business & Economics": "Business, Capitalism & Corporations",
    "Arts & Criticism": "Essays & Cultural Criticism",
    Religion: "Religion & Religious Movements",
    "War & Military": "War & Military Strategy",
    "Race & Ethnicity": "Civil Rights & Racial Justice",
    "Gender & Sexuality": "Gender & Feminism",
    "Travel & Place": "Travel, Exploration & Place",
    Sports: "Sports & Athletes",
    "True Crime & Justice": "Crime, Policing & Violence",
    "General Nonfiction": "Essays & Cultural Criticism",
  };
  const fallback = book.primarySubject ? fallbackBySubject[book.primarySubject] : undefined;
  if (fallback) add(fallback, "subject fallback", 1);
}

function applySubjectEvidenceDecisions({
  books,
  awards,
  appearances,
  subjectDefinitions,
  curatedBookSubjectIds,
  topicClassifications,
  subjectClassifications,
  subjectMapRules,
}: {
  books: Map<string, Book>;
  awards: Map<string, Award>;
  appearances: Map<string, AwardAppearance>;
  subjectDefinitions: SubjectDefinition[];
  curatedBookSubjectIds: Set<string>;
  topicClassifications: Map<string, BookTopicClassification>;
  subjectClassifications: Map<string, BookSubjectClassification>;
  subjectMapRules: SubjectMapRule[];
}) {
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const appearancesByBookId = new Map<string, AwardAppearance[]>();
  for (const appearance of appearances.values()) {
    const current = appearancesByBookId.get(appearance.bookId) ?? [];
    current.push(appearance);
    appearancesByBookId.set(appearance.bookId, current);
  }
  const report: Array<{
    bookId: string;
    title: string;
    author: string;
    primarySubject?: string;
    confidence?: "high" | "medium" | "low";
    candidates: SubjectDecision["candidates"];
    evidence: SubjectEvidence[];
  }> = [];

  for (const book of books.values()) {
    const evidence = buildSubjectEvidenceForBook({
      book,
      awards,
      appearances: appearancesByBookId.get(book.id) ?? [],
      curatedBookSubjectIds,
      subjectClassifications,
      topicClassifications,
      subjectMapRules,
      allowedSubjects,
    });
    const decision = decideSubject(book, evidence, curatedBookSubjectIds.has(book.id), allowedSubjects);
    const subject = decision.primarySubject;
    if (!subject || !allowedSubjects.has(subject)) {
      book.primarySubject = "General Nonfiction";
      book.subjects = ["General Nonfiction"];
      book.subjectEvidence = {
        primarySubject: "General Nonfiction",
        confidence: "low",
        method: "fallback",
        candidates: [],
        evidence,
      };
      continue;
    }
    book.primarySubject = subject;
    book.subjects = [subject];
    book.subjectEvidence = decision;
    if (decision.confidence !== "high" || decision.candidates.length > 1) {
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        primarySubject: book.primarySubject,
        confidence: decision.confidence,
        candidates: decision.candidates,
        evidence: decision.evidence,
      });
    }
  }
  return report.sort((a, b) => confidenceRank(a.confidence ?? "low") - confidenceRank(b.confidence ?? "low") || a.title.localeCompare(b.title));
}

function buildSubjectEvidenceForBook({
  book,
  awards,
  appearances,
  curatedBookSubjectIds,
  subjectClassifications,
  topicClassifications,
  subjectMapRules,
  allowedSubjects,
}: {
  book: Book;
  awards: Map<string, Award>;
  appearances: AwardAppearance[];
  curatedBookSubjectIds: Set<string>;
  subjectClassifications: Map<string, BookSubjectClassification>;
  topicClassifications: Map<string, BookTopicClassification>;
  subjectMapRules: SubjectMapRule[];
  allowedSubjects: Set<string>;
}) {
  const evidence: SubjectEvidence[] = [];
  const seenEvidence = new Set<string>();
  const addEvidence = (item: Omit<SubjectEvidence, "id">) => {
    if (!allowedSubjects.has(item.mappedSubject)) return;
    const key = `${item.source}\u0000${item.rawLabel.toLowerCase()}\u0000${item.mappedSubject}`;
    if (seenEvidence.has(key)) return;
    seenEvidence.add(key);
    evidence.push({ ...item, id: `subject-evidence-${book.id}-${evidence.length + 1}` });
  };

  if (curatedBookSubjectIds.has(book.id)) {
    for (const [index, subject] of book.subjects.entries()) {
      addEvidence({
        source: "manual_curation",
        rawLabel: subject,
        mappedSubject: subject,
        score: 10 - index,
        confidence: "high",
        note: "Manual curation in sources/curation.json.",
      });
    }
  }

  for (const category of book.subjectCategories ?? []) {
    for (const mapped of mapRawSubjectLabel(category.label, subjectMapRules, category.source === "bisac" ? 2 : 0)) {
      addEvidence({
        source: category.source,
        scheme: category.scheme,
        rawLabel: category.label,
        mappedSubject: mapped.subject,
        score: mapped.score,
        confidence: mapped.confidence,
        sourceId: category.sourceId,
      });
    }
  }

  for (const appearance of appearances) {
    const award = awards.get(appearance.awardId);
    if (!award) continue;
    for (const rawLabel of [award.name, ...award.subjectAreas]) {
      if (isGenericSubjectLabel(rawLabel)) continue;
      for (const mapped of mapRawSubjectLabel(rawLabel, subjectMapRules, -3)) {
        addEvidence({
          source: "award_category",
          rawLabel,
          mappedSubject: mapped.subject,
          score: Math.min(2, Math.max(1, mapped.score)),
          confidence: "low",
          sourceId: appearance.sourceIds[0] ?? award.sourceIds[0],
        });
      }
    }
  }

  const subjectClassification = subjectClassifications.get(book.id);
  for (const candidate of subjectClassification?.candidates ?? []) {
    addEvidence({
      source: "keyword_classifier",
      rawLabel: candidate.subject,
      mappedSubject: candidate.subject,
      score: Math.min(2, Math.max(1, candidate.score)),
      confidence: "low",
      note: subjectClassification?.reasons.join("; "),
    });
  }

  const topicClassification = topicClassifications.get(book.id);
  if (topicClassification?.primaryTopic) {
    for (const topic of topicClassification.topics) {
      const mapped = subjectForTopic(topic);
      if (!mapped) continue;
      const onlyFallback = topicClassification.reasons.length === 1 && topicClassification.reasons[0] === "subject fallback";
      addEvidence({
        source: "topic_classifier",
        rawLabel: topic,
        mappedSubject: mapped,
        score: onlyFallback ? 1 : topic === topicClassification.primaryTopic ? 2 : 1,
        confidence: "low",
        note: topicClassification.reasons.join("; "),
      });
    }
  }

  return evidence.sort((a, b) => b.score - a.score || a.mappedSubject.localeCompare(b.mappedSubject));
}

function isGenericSubjectLabel(label: string) {
  const normalized = label.toLowerCase().trim();
  return (
    normalized === "nonfiction" ||
    normalized === "general nonfiction" ||
    normalized.includes("award for nonfiction") ||
    normalized.includes("excellence in nonfiction")
  );
}

function mapRawSubjectLabel(label: string, rules: SubjectMapRule[], bonus = 0) {
  return rules
    .filter((rule) => rule.pattern.test(label))
    .map((rule) => ({
      subject: rule.subject,
      score: Math.max(1, rule.weight + bonus),
      confidence: rule.confidence,
    }));
}

function decideSubject(book: Book, evidence: SubjectEvidence[], isCurated: boolean, allowedSubjects: Set<string>): SubjectDecision {
  const decisiveEvidence = isCurated ? evidence : evidence.filter((item) => isDecisiveSubjectEvidence(item));
  const scoringEvidence = decisiveEvidence.length ? decisiveEvidence : evidence.filter((item) => item.mappedSubject !== "General Nonfiction");
  const scores = new Map<string, { score: number; evidenceCount: number; highCount: number }>();
  for (const item of scoringEvidence) {
    const current = scores.get(item.mappedSubject) ?? { score: 0, evidenceCount: 0, highCount: 0 };
    current.score += item.score;
    current.evidenceCount += 1;
    if (item.confidence === "high") current.highCount += 1;
    scores.set(item.mappedSubject, current);
  }
  if (!scores.size && book.primarySubject && allowedSubjects.has(book.primarySubject)) {
    scores.set(book.primarySubject, { score: 1, evidenceCount: 1, highCount: 0 });
  }
  const candidates = [...scores.entries()]
    .map(([subject, values]) => ({ subject, score: Number(values.score.toFixed(2)), evidenceCount: values.evidenceCount, highCount: values.highCount }))
    .sort((a, b) => b.score - a.score || b.highCount - a.highCount || subjectTieBreakRank(a.subject) - subjectTieBreakRank(b.subject) || a.subject.localeCompare(b.subject));
  const primarySubject = candidates[0]?.subject ?? "General Nonfiction";
  const top = candidates[0];
  const confidence = isCurated || decisiveEvidence.some((item) => item.mappedSubject === primarySubject && item.confidence === "high") ? "high" : decisiveEvidence.length ? "medium" : "low";
  return {
    primarySubject,
    confidence,
    method: isCurated ? "manual" : candidates.length ? "evidence_score" : "fallback",
    candidates: candidates.map(({ subject, score, evidenceCount }) => ({ subject, score, evidenceCount })),
    evidence: evidence.slice(0, 12),
  };
}

function isDecisiveSubjectEvidence(item: SubjectEvidence) {
  return ["manual_curation", "bisac", "google_books", "open_library", "publisher"].includes(item.source) && item.mappedSubject !== "General Nonfiction";
}

function subjectTieBreakRank(subject: string) {
  const rank: Record<string, number> = {
    Biography: 0,
    "Memoir & Autobiography": 1,
    "Race & Ethnicity": 2,
    "Gender & Sexuality": 3,
    Science: 4,
    "Medicine & Public Health": 5,
    "Nature & Environment": 6,
    "War & Military": 7,
    "True Crime & Justice": 8,
    "American History": 9,
    "World History": 10,
    History: 11,
    "Politics & Government": 12,
    "Society & Culture": 13,
    "Arts & Criticism": 14,
    "General Nonfiction": 99,
  };
  return rank[subject] ?? 50;
}

function buildSubjectReviewReport(books: Map<string, Book>): SubjectReviewReportEntry[] {
  const rows: SubjectReviewReportEntry[] = [];
  for (const book of books.values()) {
    const decision = book.subjectEvidence;
    if (!decision) continue;
    const reasons: string[] = [];
    const top = decision.candidates[0];
    const second = decision.candidates[1];
    const decisive = decision.evidence.filter(isDecisiveSubjectEvidence);
    if (decision.confidence !== "high") reasons.push(`${decision.confidence} confidence subject decision`);
    if (!decisive.length) reasons.push("no catalog/BISAC/Open Library/Google/publisher subject evidence");
    if (top && second && top.score - second.score <= 2) reasons.push(`close candidate scores: ${top.subject} ${top.score} vs ${second.subject} ${second.score}`);
    if (decision.primarySubject === "General Nonfiction") reasons.push("still filed as General Nonfiction");
    if (looksLikeBiography(book) && decision.primarySubject !== "Biography" && decision.primarySubject !== "Memoir & Autobiography") {
      reasons.push("title looks biographical but primary subject is not biography/memoir");
    }
    if (decision.evidence.some((item) => isDecisiveSubjectEvidence(item) && item.mappedSubject !== decision.primarySubject)) {
      reasons.push("catalog evidence conflicts with selected primary subject");
    }
    if (!reasons.length) continue;
    rows.push({
      bookId: book.id,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      primarySubject: decision.primarySubject,
      confidence: decision.confidence,
      reasons,
      candidates: decision.candidates.slice(0, 5),
      evidence: decision.evidence.slice(0, 8),
    });
  }
  return rows.sort((a, b) => confidenceRank(a.confidence ?? "low") - confidenceRank(b.confidence ?? "low") || b.reasons.length - a.reasons.length || a.title.localeCompare(b.title));
}

function looksLikeBiography(book: Book) {
  const text = `${book.title} ${book.subtitle ?? ""}`.toLowerCase();
  return /\b(biography|life of|life and times of|portrait of|a life|his life|her life|memoir|autobiography)\b/.test(text);
}

function subjectForTopic(topic: string) {
  const map: Record<string, string> = {
    "American Politics": "Politics & Government",
    "Democracy & Elections": "Politics & Government",
    "Presidency & Executive Power": "Politics & Government",
    "Constitutional History": "American History",
    "Law & Legal Change": "True Crime & Justice",
    "Courts & Trials": "True Crime & Justice",
    "Crime, Policing & Violence": "True Crime & Justice",
    "Prisons & Incarceration": "True Crime & Justice",
    "War & Military Strategy": "War & Military",
    "American Civil War": "War & Military",
    "World War I": "War & Military",
    "World War II": "War & Military",
    "Vietnam War": "War & Military",
    "Soldiers, Veterans & Combat Experience": "War & Military",
    "Cold War & Nuclear Politics": "War & Military",
    Holocaust: "World History",
    "Intelligence, Secrecy & Surveillance": "Politics & Government",
    "Genocide, Atrocity & Political Violence": "War & Military",
    "Empire & Colonialism": "World History",
    "Slavery & Emancipation": "American History",
    Reconstruction: "American History",
    "Indigenous History": "American History",
    "Civil Rights & Racial Justice": "Race & Ethnicity",
    "Black History & Culture": "Race & Ethnicity",
    "Immigration, Refugees & Borderlands": "Society & Culture",
    "Latin America & the Caribbean": "World History",
    "Europe & Russia": "World History",
    "Asia & the Pacific": "World History",
    "Middle East & North Africa": "World History",
    "Africa & the African Diaspora": "World History",
    "Religion & Religious Movements": "Religion",
    "Evangelicalism & Christian Nationalism": "Religion",
    "Gender & Feminism": "Gender & Sexuality",
    "LGBTQ History & Life": "Gender & Sexuality",
    "Reproductive Rights & Family Policy": "Gender & Sexuality",
    "Family, Childhood & Adoption": "Society & Culture",
    "Biography & Public Lives": "Biography",
    "Political Biography": "Biography",
    "Presidential Biography": "Biography",
    "Military Biography": "Biography",
    "Literary Biography": "Biography",
    "Artistic Biography": "Biography",
    "Scientific Biography": "Biography",
    "Business Biography": "Biography",
    "Religious Biography": "Biography",
    "Sports Biography": "Biography",
    "Activist Biography": "Biography",
    "Family Biography": "Biography",
    "Group Biography": "Biography",
    "Intellectual Biography": "Biography",
    "Memoir & Personal History": "Memoir & Autobiography",
    "Grief, Trauma & Recovery": "Memoir & Autobiography",
    "Intellectual History & Ideas": "History",
    "Literature & Writers": "Arts & Criticism",
    "Art, Music & Performance": "Arts & Criticism",
    "Film, Television & Popular Culture": "Arts & Criticism",
    "Media, Journalism & Public Opinion": "Journalism & Reportage",
    "Social Movements & Activism": "Society & Culture",
    "Class, Poverty & Inequality": "Society & Culture",
    "Housing, Cities & Urban Life": "Society & Culture",
    "Labor, Work & Organizing": "Business & Economics",
    "Business, Capitalism & Corporations": "Business & Economics",
    "Money, Markets & Economic Policy": "Business & Economics",
    "Food, Agriculture & Land": "Business & Economics",
    "Infrastructure, Engineering & Built Environment": "Technology",
    "Technology, Computing & AI": "Technology",
    "Science & Discovery": "Science",
    "Medicine, Health & the Body": "Medicine & Public Health",
    "Disease, Epidemics & Drugs": "Medicine & Public Health",
    "Mental Health & Psychology": "Medicine & Public Health",
    "Disability & Difference": "Medicine & Public Health",
    "Climate, Weather & Disaster": "Nature & Environment",
    "Environment, Conservation & Pollution": "Nature & Environment",
    "Natural History & Animals": "Nature & Environment",
    "Oceans, Rivers & Water": "Nature & Environment",
    "Energy, Extraction & Resources": "Business & Economics",
    "Travel, Exploration & Place": "Travel & Place",
    "Regional & Local History": "History",
    "Education & Universities": "Society & Culture",
    "Sports & Athletes": "Sports",
    "Death, Memory & Commemoration": "History",
    "Archives, Museums & Historical Method": "History",
    "Settler Colonialism": "World History",
    "Migration & Diaspora": "Society & Culture",
    "Nationalism & Authoritarianism": "Politics & Government",
    "Human Rights & International Law": "Politics & Government",
    "Public Health Systems": "Medicine & Public Health",
    "Drugs, Addiction & Treatment": "Medicine & Public Health",
    "Essays & Cultural Criticism": "Arts & Criticism",
  };
  return map[topic];
}

function buildSuspiciousSubjectTopicReport(books: Map<string, Book>): SuspiciousSubjectTopicReportEntry[] {
  const rows: SuspiciousSubjectTopicReportEntry[] = [];
  const suspiciousPairs = new Set([
    "Travel & Place\u0000Nationalism & Authoritarianism",
    "Travel & Place\u0000Mental Health & Psychology",
    "Travel & Place\u0000Medicine, Health & the Body",
    "Biography\u0000Oceans, Rivers & Water",
    "Biography\u0000Business, Capitalism & Corporations",
    "American History\u0000Science & Discovery",
    "American History\u0000Medicine, Health & the Body",
    "American History\u0000Natural History & Animals",
    "General Nonfiction\u0000Essays & Cultural Criticism",
  ]);
  for (const book of books.values()) {
    const suggestedSubject = book.primaryTopic ? subjectForTopic(book.primaryTopic) : undefined;
    const key = `${book.primarySubject}\u0000${book.primaryTopic}`;
    if (book.primarySubject === "General Nonfiction") {
      rows.push(reportRow(book, "General Nonfiction remains after topic-derived subject assignment.", suggestedSubject));
      continue;
    }
    if (suggestedSubject && suggestedSubject !== book.primarySubject && !getTitleSubjectOverrides().has(slugify(book.title))) {
      rows.push(reportRow(book, `Primary topic usually maps to ${suggestedSubject}.`, suggestedSubject));
      continue;
    }
    if (suspiciousPairs.has(key)) {
      rows.push(reportRow(book, "Subject/topic pairing looks suspicious.", suggestedSubject));
    }
  }
  return rows.sort((a, b) => a.primarySubject!.localeCompare(b.primarySubject!) || a.title.localeCompare(b.title));
}

function reportRow(book: Book, reason: string, suggestedSubject?: string): SuspiciousSubjectTopicReportEntry {
  return {
    bookId: book.id,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    primarySubject: book.primarySubject,
    primaryTopic: book.primaryTopic,
    topics: book.topics,
    reason,
    suggestedSubject,
  };
}

function validateTaxonomy({
  books,
  subjectDefinitions,
  topicDefinitions,
}: {
  books: Map<string, Book>;
  subjectDefinitions: SubjectDefinition[];
  topicDefinitions: TopicDefinition[];
}): TaxonomyValidationReport {
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const allowedTopics = new Set(topicDefinitions.map((topic) => topic.name));
  const subjectErrors: string[] = [];
  const topicErrors: string[] = [];

  for (const book of books.values()) {
    if (!book.primarySubject) {
      subjectErrors.push(`${book.id}: missing primarySubject`);
    } else if (!allowedSubjects.has(book.primarySubject)) {
      subjectErrors.push(`${book.id}: invalid primarySubject "${book.primarySubject}"`);
    }
    if (!Array.isArray(book.subjects) || book.subjects.length !== 1) {
      subjectErrors.push(`${book.id}: expected exactly one subject, found ${JSON.stringify(book.subjects)}`);
    } else if (book.subjects[0] !== book.primarySubject) {
      subjectErrors.push(`${book.id}: subjects[0] "${book.subjects[0]}" does not match primarySubject "${book.primarySubject}"`);
    }

    if (!book.primaryTopic) {
      topicErrors.push(`${book.id}: missing primaryTopic`);
    } else if (!allowedTopics.has(book.primaryTopic)) {
      topicErrors.push(`${book.id}: invalid primaryTopic "${book.primaryTopic}"`);
    }
    if (!Array.isArray(book.topics) || !book.topics.length) {
      topicErrors.push(`${book.id}: missing topics`);
    } else {
      if (book.primaryTopic && book.topics[0] !== book.primaryTopic) {
        topicErrors.push(`${book.id}: topics[0] "${book.topics[0]}" does not match primaryTopic "${book.primaryTopic}"`);
      }
      for (const topic of book.topics) {
        if (!allowedTopics.has(topic)) topicErrors.push(`${book.id}: invalid topic "${topic}"`);
      }
    }
  }

  return {
    subjectErrors,
    topicErrors,
    totals: {
      books: books.size,
      subjectErrors: subjectErrors.length,
      topicErrors: topicErrors.length,
    },
  };
}

function buildTopicSummary({
  generatedAt,
  books,
  awards,
  appearances,
  topicDefinitions,
}: {
  generatedAt: string;
  books: Map<string, Book>;
  awards: Map<string, Award>;
  appearances: Map<string, AwardAppearance>;
  topicDefinitions: TopicDefinition[];
}): TopicSummary {
  const topicBookIds = new Map<string, Set<string>>();
  const topicAppearanceCounts = new Map<string, number>();
  const byYear = new Map<string, { year: number; topic: string; appearanceCount: number; bookIds: Set<string> }>();
  const byAward = new Map<string, { awardId: string; awardName: string; topic: string; appearanceCount: number; bookIds: Set<string> }>();
  const byAwardYear = new Map<string, { awardId: string; awardName: string; year: number; topic: string; appearanceCount: number; bookIds: Set<string> }>();

  for (const appearance of appearances.values()) {
    const book = books.get(appearance.bookId);
    const topic = book?.primaryTopic;
    const award = awards.get(appearance.awardId);
    if (!book || !topic || !award) continue;

    const topicBooks = topicBookIds.get(topic) ?? new Set<string>();
    topicBooks.add(book.id);
    topicBookIds.set(topic, topicBooks);
    topicAppearanceCounts.set(topic, (topicAppearanceCounts.get(topic) ?? 0) + 1);

    const yearKey = `${appearance.year}\u0000${topic}`;
    const yearEntry = byYear.get(yearKey) ?? { year: appearance.year, topic, appearanceCount: 0, bookIds: new Set<string>() };
    yearEntry.appearanceCount += 1;
    yearEntry.bookIds.add(book.id);
    byYear.set(yearKey, yearEntry);

    const awardKey = `${award.id}\u0000${topic}`;
    const awardEntry = byAward.get(awardKey) ?? { awardId: award.id, awardName: award.name, topic, appearanceCount: 0, bookIds: new Set<string>() };
    awardEntry.appearanceCount += 1;
    awardEntry.bookIds.add(book.id);
    byAward.set(awardKey, awardEntry);

    const awardYearKey = `${award.id}\u0000${appearance.year}\u0000${topic}`;
    const awardYearEntry = byAwardYear.get(awardYearKey) ?? {
      awardId: award.id,
      awardName: award.name,
      year: appearance.year,
      topic,
      appearanceCount: 0,
      bookIds: new Set<string>(),
    };
    awardYearEntry.appearanceCount += 1;
    awardYearEntry.bookIds.add(book.id);
    byAwardYear.set(awardYearKey, awardYearEntry);
  }

  const topicOrder = new Map(topicDefinitions.map((topic) => [topic.name, topic.sortOrder]));
  const sortTopicRows = <T extends { topic: string; appearanceCount: number }>(rows: T[]) =>
    rows.sort((a, b) => (topicOrder.get(a.topic) ?? 9999) - (topicOrder.get(b.topic) ?? 9999) || b.appearanceCount - a.appearanceCount || a.topic.localeCompare(b.topic));

  return {
    generatedAt,
    topics: sortTopicRows(
      [...topicBookIds.entries()].map(([topic, bookIds]) => ({
        topic,
        bookCount: bookIds.size,
        appearanceCount: topicAppearanceCounts.get(topic) ?? 0,
      })),
    ),
    byYear: sortTopicRows(
      [...byYear.values()].map((entry) => ({
        year: entry.year,
        topic: entry.topic,
        appearanceCount: entry.appearanceCount,
        bookCount: entry.bookIds.size,
      })),
    ).sort((a, b) => a.year - b.year || (topicOrder.get(a.topic) ?? 9999) - (topicOrder.get(b.topic) ?? 9999)),
    byAward: sortTopicRows(
      [...byAward.values()].map((entry) => ({
        awardId: entry.awardId,
        awardName: entry.awardName,
        topic: entry.topic,
        appearanceCount: entry.appearanceCount,
        bookCount: entry.bookIds.size,
      })),
    ).sort((a, b) => a.awardName.localeCompare(b.awardName) || (topicOrder.get(a.topic) ?? 9999) - (topicOrder.get(b.topic) ?? 9999)),
    byAwardYear: sortTopicRows(
      [...byAwardYear.values()].map((entry) => ({
        awardId: entry.awardId,
        awardName: entry.awardName,
        year: entry.year,
        topic: entry.topic,
        appearanceCount: entry.appearanceCount,
        bookCount: entry.bookIds.size,
      })),
    ).sort((a, b) => a.awardName.localeCompare(b.awardName) || a.year - b.year || (topicOrder.get(a.topic) ?? 9999) - (topicOrder.get(b.topic) ?? 9999)),
  };
}

function getTitleTopicOverrides() {
  return new Map<string, string[]>([
    ["challenger", ["Infrastructure, Engineering & Built Environment", "Presidency & Executive Power", "Technology, Computing & AI"]],
    ["challenger-a-true-story-of-heroism-and-disaster-on-the-edge-of-space", ["Infrastructure, Engineering & Built Environment", "Presidency & Executive Power", "Technology, Computing & AI"]],
    ["watergate", ["Presidency & Executive Power", "Media, Journalism & Public Opinion", "Law & Legal Change"]],
    ["native-nations", ["Indigenous History", "Settler Colonialism", "Empire & Colonialism"]],
    ["the-deviant-s-war", ["LGBTQ History & Life", "Civil Rights & Racial Justice", "Social Movements & Activism"]],
    ["the-deviant-s-war-the-homosexual-vs-the-united-states-of-america", ["LGBTQ History & Life", "Civil Rights & Racial Justice", "Social Movements & Activism"]],
    ["combee", ["Slavery & Emancipation", "Food, Agriculture & Land", "War & Military Strategy"]],
    ["plantation-goods", ["Slavery & Emancipation", "Business, Capitalism & Corporations", "Food, Agriculture & Land"]],
    ["no-right-to-an-honest-living", ["Labor, Work & Organizing", "Black History & Culture", "Class, Poverty & Inequality"]],
    ["freedom-s-dominion", ["Democracy & Elections", "American Politics", "Civil Rights & Racial Justice"]],
    ["seeing-red", ["Indigenous History", "Settler Colonialism", "American Politics"]],
    ["covered-with-night", ["Courts & Trials", "Indigenous History", "Law & Legal Change"]],
    ["cuba-an-american-history", ["Latin America & the Caribbean", "Empire & Colonialism", "American Politics"]],
    ["franchise", ["Democracy & Elections", "Black History & Culture", "Business, Capitalism & Corporations"]],
    ["a-brief-history-of-everyone-who-ever-lived", ["Science & Discovery", "Family, Childhood & Adoption"]],
    ["a-cold-welcome", ["Climate, Weather & Disaster", "Empire & Colonialism", "Environment, Conservation & Pollution"]],
    ["a-fistful-of-shells", ["Africa & the African Diaspora", "Business, Capitalism & Corporations", "Empire & Colonialism"]],
    ["a-beautiful-mind", ["Mental Health & Psychology", "Biography & Public Lives", "Science & Discovery"]],
    ["a-day-in-the-life-of-abed-salama-anatomy-of-a-jerusalem-tragedy", ["Middle East & North Africa", "Human Rights & International Law", "Media, Journalism & Public Opinion"]],
    ["a-furious-sky", ["Climate, Weather & Disaster", "Oceans, Rivers & Water"]],
    ["a-little-devil-in-america", ["Essays & Cultural Criticism", "Black History & Culture", "Art, Music & Performance"]],
    ["a-machine-to-move-ocean-and-earth", ["Infrastructure, Engineering & Built Environment", "Oceans, Rivers & Water"]],
    ["a-marriage-at-sea", ["Travel, Exploration & Place", "Oceans, Rivers & Water", "Memoir & Personal History"]],
    ["a-question-of-freedom", ["Slavery & Emancipation", "Law & Legal Change", "Black History & Culture"]],
    ["a-walk-in-the-park", ["Travel, Exploration & Place", "Environment, Conservation & Pollution"]],
    ["african-europeans", ["Africa & the African Diaspora", "Europe & Russia", "Race & Ethnicity"]],
    ["ali", ["Sports & Athletes", "Biography & Public Lives", "Black History & Culture"]],
    ["all-that-she-carried", ["Slavery & Emancipation", "Black History & Culture", "Family, Childhood & Adoption"]],
    ["america-america", ["Latin America & the Caribbean", "Empire & Colonialism", "American Politics"]],
    ["american-anarchy", ["American Politics", "Crime, Policing & Violence", "Law & Legal Change"]],
    ["american-eden", ["Science & Discovery", "Biography & Public Lives", "Environment, Conservation & Pollution"]],
    ["american-prison", ["Prisons & Incarceration", "Business, Capitalism & Corporations", "Crime, Policing & Violence"]],
    ["amity-and-prosperity", ["Environment, Conservation & Pollution", "Energy, Extraction & Resources", "Class, Poverty & Inequality"]],
    ["an-american-genocide", ["Genocide, Atrocity & Political Violence", "Indigenous History", "Settler Colonialism"]],
    ["an-immense-world", ["Natural History & Animals", "Science & Discovery"]],
    ["anansi-s-gold", ["Business, Capitalism & Corporations", "Africa & the African Diaspora", "Crime, Policing & Violence"]],
    ["asperger-s-children", ["Disability & Difference", "Medicine, Health & the Body", "Genocide, Atrocity & Political Violence"]],
    ["bad-mexicans", ["Immigration, Refugees & Borderlands", "Social Movements & Activism", "Latin America & the Caribbean"]],
    ["bad-news", ["Media, Journalism & Public Opinion", "Nationalism & Authoritarianism"]],
    ["before-gender", ["Gender & Feminism", "LGBTQ History & Life"]],
    ["before-the-movement", ["Law & Legal Change", "Black History & Culture", "Civil Rights & Racial Justice"]],
    ["black-earth", ["Genocide, Atrocity & Political Violence", "Environment, Conservation & Pollution", "Europe & Russia"]],
    ["black-folk", ["Black History & Culture", "Labor, Work & Organizing"]],
    ["black-in-blues", ["Black History & Culture", "Art, Music & Performance"]],
    ["black-owned", ["Black History & Culture", "Business, Capitalism & Corporations"]],
    ["blood-at-the-root", ["Civil Rights & Racial Justice", "Crime, Policing & Violence", "Black History & Culture"]],
    ["blood-in-the-water", ["Prisons & Incarceration", "Crime, Policing & Violence", "Civil Rights & Racial Justice"]],
    ["blood-on-the-river", ["Slavery & Emancipation", "Empire & Colonialism", "Oceans, Rivers & Water"]],
    ["bottoms-up-and-the-devil-laughs", ["Intelligence, Secrecy & Surveillance", "Technology, Computing & AI", "Media, Journalism & Public Opinion"]],
    ["born-in-flames", ["Business, Capitalism & Corporations", "Crime, Policing & Violence", "American Politics"]],
    ["breathless", ["Disease, Epidemics & Drugs", "Science & Discovery", "Public Health Systems"]],
    ["brooding-over-bloody-revenge", ["Slavery & Emancipation", "Gender & Feminism", "Crime, Policing & Violence"]],
    ["brothers-at-arms", ["War & Military Strategy", "American Politics"]],
    ["by-hands-now-known", ["Civil Rights & Racial Justice", "Crime, Policing & Violence", "Law & Legal Change"]],
    ["caste", ["Civil Rights & Racial Justice", "Class, Poverty & Inequality", "Black History & Culture"]],
    ["cobalt-red", ["Energy, Extraction & Resources", "Labor, Work & Organizing", "Business, Capitalism & Corporations"]],
    ["charged", ["Environment, Conservation & Pollution", "Energy, Extraction & Resources", "Law & Legal Change"]],
    ["cold-war-country", ["Cold War & Nuclear Politics", "Art, Music & Performance"]],
    ["dark-money", ["Money, Markets & Economic Policy", "American Politics", "Business, Capitalism & Corporations"]],
    ["democracy-in-chains", ["American Politics", "Democracy & Elections", "Money, Markets & Economic Policy"]],
    ["deported-americans", ["Immigration, Refugees & Borderlands", "Law & Legal Change", "American Politics"]],
    ["directorate-s", ["Intelligence, Secrecy & Surveillance", "War & Military Strategy", "Middle East & North Africa"]],
    ["dopesick", ["Drugs, Addiction & Treatment", "Disease, Epidemics & Drugs", "Business, Capitalism & Corporations"]],
    ["dreamland", ["Drugs, Addiction & Treatment", "Disease, Epidemics & Drugs", "Crime, Policing & Violence"]],
    ["empire-of-ai", ["Technology, Computing & AI", "Business, Capitalism & Corporations", "Labor, Work & Organizing"]],
    ["empire-of-guns", ["Empire & Colonialism", "War & Military Strategy", "Business, Capitalism & Corporations"]],
    ["empire-of-pain", ["Drugs, Addiction & Treatment", "Business, Capitalism & Corporations", "Disease, Epidemics & Drugs"]],
    ["evicted", ["Housing, Cities & Urban Life", "Class, Poverty & Inequality", "Law & Legal Change"]],
    ["fathoms", ["Natural History & Animals", "Oceans, Rivers & Water", "Environment, Conservation & Pollution"]],
    ["fire-weather", ["Climate, Weather & Disaster", "Environment, Conservation & Pollution"]],
    ["four-hundred-souls", ["Black History & Culture", "Slavery & Emancipation", "Civil Rights & Racial Justice"]],
    ["frederick-douglass-prophet-of-freedom", ["Activist Biography", "Slavery & Emancipation", "Black History & Culture"]],
    ["g-man", ["Political Biography", "Presidency & Executive Power", "Intelligence, Secrecy & Surveillance"]],
    ["h-is-for-hawk", ["Grief, Trauma & Recovery", "Natural History & Animals", "Memoir & Personal History"]],
    ["hidden-valley-road", ["Mental Health & Psychology", "Medicine, Health & the Body", "Family, Childhood & Adoption"]],
    ["his-name-is-george-floyd", ["Activist Biography", "Crime, Policing & Violence", "Civil Rights & Racial Justice"]],
    ["how-to-hide-an-empire", ["Empire & Colonialism", "American Politics", "Settler Colonialism"]],
    ["i-ve-been-here-all-the-while", ["Indigenous History", "Settler Colonialism", "Slavery & Emancipation"]],
    ["hue-1968", ["War & Military Strategy", "Soldiers, Veterans & Combat Experience", "Asia & the Pacific"]],
    ["indigenous-continent", ["Indigenous History", "Settler Colonialism", "Empire & Colonialism"]],
    ["in-the-shadow-of-liberty", ["Immigration, Refugees & Borderlands", "American Politics", "Law & Legal Change"]],
    ["invisible-child", ["Class, Poverty & Inequality", "Housing, Cities & Urban Life", "Media, Journalism & Public Opinion"]],
    ["judgment-at-tokyo", ["Courts & Trials", "Human Rights & International Law", "War & Military Strategy"]],
    ["killers-of-the-flower-moon", ["Crime, Policing & Violence", "Indigenous History", "Business, Capitalism & Corporations"]],
    ["kl", ["Genocide, Atrocity & Political Violence", "Prisons & Incarceration", "Europe & Russia"]],
    ["lakota-america", ["Indigenous History", "Settler Colonialism", "American Politics"]],
    ["let-the-record-show", ["LGBTQ History & Life", "Social Movements & Activism", "Disease, Epidemics & Drugs"]],
    ["manual-for-survival", ["Cold War & Nuclear Politics", "Disease, Epidemics & Drugs", "Environment, Conservation & Pollution"]],
    ["midnight-in-chernobyl", ["Cold War & Nuclear Politics", "Technology, Computing & AI", "Climate, Weather & Disaster"]],
    ["one-person-no-vote", ["Democracy & Elections", "Civil Rights & Racial Justice", "American Politics"]],
    ["our-beloved-kin", ["Indigenous History", "Settler Colonialism", "War & Military Strategy"]],
    ["palo-alto", ["Regional & Local History", "Business, Capitalism & Corporations", "Technology, Computing & AI"]],
    ["race-for-profit", ["Housing, Cities & Urban Life", "Business, Capitalism & Corporations", "Civil Rights & Racial Justice"]],
    ["say-nothing", ["Crime, Policing & Violence", "War & Military Strategy", "Europe & Russia"]],
    ["solitary", ["Prisons & Incarceration", "Memoir & Personal History", "Civil Rights & Racial Justice"]],
    ["the-1619-project", ["Slavery & Emancipation", "Black History & Culture", "Civil Rights & Racial Justice"]],
    ["the-achilles-trap", ["War & Military Strategy", "Middle East & North Africa", "Intelligence, Secrecy & Surveillance"]],
    ["the-anarchy", ["Empire & Colonialism", "Asia & the Pacific", "Business, Capitalism & Corporations"]],
    ["the-black-presidency", ["Presidency & Executive Power", "Black History & Culture", "American Politics"]],
    ["the-broken-constitution", ["Constitutional History", "Law & Legal Change", "American Politics"]],
    ["the-color-of-law", ["Housing, Cities & Urban Life", "Law & Legal Change", "Civil Rights & Racial Justice"]],
    ["the-doomsday-machine", ["Cold War & Nuclear Politics", "Intelligence, Secrecy & Surveillance"]],
    ["the-end-of-the-myth", ["Empire & Colonialism", "Settler Colonialism", "American Politics"]],
    ["the-facemaker", ["Medicine, Health & the Body", "War & Military Strategy", "Disability & Difference"]],
    ["the-family-roe", ["Reproductive Rights & Family Policy", "Law & Legal Change", "Family, Childhood & Adoption"]],
    ["the-great-displacement", ["Climate, Weather & Disaster", "Housing, Cities & Urban Life", "Migration & Diaspora"]],
    ["the-heartbeat-of-wounded-knee", ["Indigenous History", "Civil Rights & Racial Justice", "Settler Colonialism"]],
    ["the-indian-world-of-george-washington", ["Indigenous History", "Settler Colonialism", "Empire & Colonialism"]],
    ["the-invisible-kingdom", ["Medicine, Health & the Body", "Disability & Difference", "Memoir & Personal History"]],
    ["the-least-of-us", ["Drugs, Addiction & Treatment", "Disease, Epidemics & Drugs", "Class, Poverty & Inequality"]],
    ["the-other-slavery", ["Slavery & Emancipation", "Indigenous History", "Empire & Colonialism"]],
    ["the-plains-across-the-overland-emigrants-on-the-trans-mississippi-west-1840-60", ["Migration & Diaspora", "Regional & Local History", "Settler Colonialism"]],
    ["the-new-negro", ["Black History & Culture", "Art, Music & Performance", "Literature & Writers"]],
    ["the-pentagon-s-brain", ["Intelligence, Secrecy & Surveillance", "Technology, Computing & AI", "Cold War & Nuclear Politics"]],
    ["the-rediscovery-of-america", ["Indigenous History", "Settler Colonialism", "American Politics"]],
    ["the-undertow", ["Nationalism & Authoritarianism", "Evangelicalism & Christian Nationalism", "American Politics"]],
    ["the-ungrateful-refugee", ["Immigration, Refugees & Borderlands", "Migration & Diaspora", "Memoir & Personal History"]],
    ["they-were-her-property", ["Slavery & Emancipation", "Gender & Feminism", "Business, Capitalism & Corporations"]],
    ["unworthy-republic", ["Indigenous History", "Settler Colonialism", "American Politics"]],
    ["vanguard", ["Democracy & Elections", "Gender & Feminism", "Civil Rights & Racial Justice"]],
    ["undue-burden", ["Reproductive Rights & Family Policy", "Law & Legal Change", "Gender & Feminism"]],
    ["vagina-obscura", ["Medicine, Health & the Body", "Gender & Feminism", "Science & Discovery"]],
    ["vietnam-a-new-history", ["War & Military Strategy", "Asia & the Pacific", "Cold War & Nuclear Politics"]],
    ["watergate", ["Presidency & Executive Power", "Media, Journalism & Public Opinion", "Law & Legal Change"]],
    ["we-the-corporations", ["Business, Capitalism & Corporations", "Constitutional History", "Law & Legal Change"]],
    ["writing-to-save-a-life", ["Crime, Policing & Violence", "Black History & Culture", "Law & Legal Change"]],
    ["you-are-not-american", ["Immigration, Refugees & Borderlands", "Law & Legal Change", "American Politics"]],
    ["white-trash", ["Class, Poverty & Inequality", "American Politics", "Civil Rights & Racial Justice"]],
  ]);
}

function classifyBooksBySubject({
  books,
  awards,
  appearances,
  subjectDefinitions,
  curatedBookSubjectIds,
}: {
  books: Map<string, Book>;
  awards: Map<string, Award>;
  appearances: Map<string, AwardAppearance>;
  subjectDefinitions: SubjectDefinition[];
  curatedBookSubjectIds: Set<string>;
}): { report: SubjectClassificationReportEntry[]; classifications: Map<string, BookSubjectClassification> } {
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const aliases = new Map([
    ["Nonfiction", "General Nonfiction"],
    ["Global history", "World History"],
    ["American history", "American History"],
    ["Biography & memoir", "Biography"],
    ["Science & medicine", "Science"],
    ["Politics & society", "Society & Culture"],
    ["Race, Gender & Identity", "Race & Ethnicity"],
  ]);
  const report: SubjectClassificationReportEntry[] = [];
  const classifications = new Map<string, BookSubjectClassification>();
  const appearancesByBookId = new Map<string, AwardAppearance[]>();
  for (const appearance of appearances.values()) {
    const current = appearancesByBookId.get(appearance.bookId) ?? [];
    current.push(appearance);
    appearancesByBookId.set(appearance.bookId, current);
  }

  for (const book of books.values()) {
    const awardNames = (appearancesByBookId.get(book.id) ?? [])
      .map((appearance) => awards.get(appearance.awardId)?.name)
      .filter(Boolean) as string[];
    const normalizedCuratedSubjects = normalizeSubjectNames(book.subjects, allowedSubjects, aliases);

    if (curatedBookSubjectIds.has(book.id)) {
      book.subjects = normalizedCuratedSubjects.length ? normalizedCuratedSubjects : ["General Nonfiction"];
      book.primarySubject = book.subjects[0];
      classifications.set(book.id, {
        subjects: book.subjects,
        confidence: "high",
        reasons: ["manual subject curation"],
        candidates: book.subjects.map((subject, index) => ({ subject, score: 10 - index })),
      });
      continue;
    }

    const classification = classifyBookSubject(book, awardNames, allowedSubjects, aliases);
    classifications.set(book.id, classification);
    book.subjects = classification.subjects;
    book.primarySubject = classification.subjects[0];
    if (classification.confidence !== "high" || classification.subjects.some((subject) => subject === "History" || subject === "General Nonfiction")) {
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        subjects: classification.subjects,
        confidence: classification.confidence,
        reasons: classification.reasons,
        reviewReason: classification.reviewReason,
        candidates: classification.candidates,
      });
    }
  }

  return {
    report: report.sort(
      (a, b) =>
        confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
        a.subjects.join(", ").localeCompare(b.subjects.join(", ")) ||
        a.title.localeCompare(b.title),
    ),
    classifications,
  };
}

function classifyBookSubject(
  book: Book,
  awardNames: string[],
  allowedSubjects: Set<string>,
  aliases: Map<string, string>,
): BookSubjectClassification {
  const title = `${book.title} ${book.subtitle ?? ""}`.toLowerCase();
  const summary = (book.summary ?? "").toLowerCase();
  const awardsText = awardNames.join(" ").toLowerCase();
  const existingText = normalizeSubjectNames(book.subjects, allowedSubjects, aliases).join(" ").toLowerCase();
  const text = `${title} ${summary} ${awardsText} ${existingText}`;
  const matched = new Map<string, number>();
  const reasons: string[] = [];

  const add = (subject: string, reason: string, weight = 1) => {
    matched.set(subject, Math.max(matched.get(subject) ?? 0, weight));
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const titleOverrides = getTitleSubjectOverrides().get(slugify(book.title));
  if (titleOverrides) {
    titleOverrides.forEach((subject, index) => add(subject, "title-level subject override", 5 - index / 10));
  }

  if (/\b(memoir|autobiograph|my life|personal history)\b/.test(text)) add("Memoir & Autobiography", "memoir/autobiography keyword", 3);
  if (/\b(biography|life of|life and times of|portrait of|a life|his life|her life)\b/.test(text)) add("Biography", "biography/title pattern", 2);
  if (/\b(american|united states|u\.s\.|usa|mexican american|native american|african american|civil war|reconstruction|jim crow|slavery|enslaved|founding|president|presidential)\b/.test(text)) {
    add("American History", "American history keyword", 3);
  }
  if (/\b(world|global|empire|imperial|colonial|europe|africa|asia|china|russia|soviet|india|latin america|middle east|atlantic|pacific|caribbean|migration|diaspora)\b/.test(text)) {
    add("World History", "world history keyword", 2);
  }
  if (/\b(history|historical|century|ancient|medieval|modern|revolution|archive|past)\b/.test(text) || /\b(bancroft|cundill|wolfson)\b/.test(awardsText)) add("History", "history keyword or history prize", 1);
  if (/\b(war|military|army|navy|battle|soldier|veteran|holocaust|genocide|nazi|confederate|vietnam|iraq|afghanistan)\b/.test(text)) add("War & Military", "war/military keyword", 3);
  if (/\b(politic|government|democracy|election|statecraft|diplomacy|policy|president|parliament|congress|authoritarian|fascis|communis)\b/.test(text)) add("Politics & Government", "politics/government keyword", 3);
  if (/\b(society|social|culture|community|family|class|education|school|housing|city|urban|rural)\b/.test(text)) add("Society & Culture", "society/culture keyword", 2);
  if (/\b(journalism|reportage|investigat|reported|dispatch|correspondent|news|expose)\b/.test(text)) add("Journalism & Reportage", "journalism/reportage keyword", 2);
  if (/\b(science|scientist|physics|biology|chemistry|mathematics|astronomy|evolution|genetic|neuroscience|psychology|animal|species)\b/.test(text)) add("Science", "science keyword", 3);
  if (/\b(medicine|medical|doctor|health|public health|disease|pandemic|virus|cancer|body|hospital|psychiatry|vagina|virology)\b/.test(text)) add("Medicine & Public Health", "medicine/public health keyword", 3);
  if (/\b(nature|environment|climate|ecology|conservation|wilderness|river|ocean|forest|park|earth|weather|hurricane|flood|fire)\b/.test(text)) add("Nature & Environment", "nature/environment keyword", 3);
  if (/\b(technology|computer|internet|digital|machine|engineering|infrastructure|algorithm|data|surveillance|ai|artificial intelligence)\b/.test(text)) add("Technology", "technology keyword", 3);
  if (/\b(business|economic|economy|capitalism|finance|money|market|corporation|labor|work|industry|factory|trade)\b/.test(text)) add("Business & Economics", "business/economics keyword", 3);
  if (/\b(art|artist|music|film|literary|literature|criticism|critic|poetry|novel|theater|theatre|performance|song|blues|jazz)\b/.test(text)) add("Arts & Criticism", "arts/criticism keyword", 3);
  if (/\b(religion|religious|god|faith|church|christian|islam|muslim|jewish|judaism|buddhist|spiritual|theology)\b/.test(text)) add("Religion", "religion keyword", 3);
  if (/\b(race|racial|black|civil rights|indigenous|native|latino|latina|asian american|african american|ethnicity|diaspora|migrant|immigrant|refugee)\b/.test(text)) {
    add("Race & Ethnicity", "race/ethnicity keyword", 2);
  }
  if (/\b(gender|women|woman|queer|transgender|trans(?![-a-z])|sexuality|feminism|abortion|reproductive|gay|lesbian)\b/.test(text)) {
    add("Gender & Sexuality", "gender/sexuality keyword", 2);
  }
  if (/\b(travel|journey|walk|walking|voyage|sea|border|place|landscape|road|mountain|grand canyon|park)\b/.test(text)) add("Travel & Place", "travel/place keyword", 2);
  if (/\b(sport|athlete|baseball|football|basketball|boxing|tennis|soccer|olympic|ali)\b/.test(text)) add("Sports", "sports keyword", 3);
  if (/\b(crime|criminal|prison|police|court|justice|law|legal|trial|murder|violence|incarceration|wrongful)\b/.test(text)) add("True Crime & Justice", "crime/justice keyword", 3);

  if (matched.has("American History")) matched.delete("History");
  if (matched.has("World History") && matched.has("American History")) matched.delete("History");
  if (matched.has("War & Military") && matched.has("History")) matched.delete("History");

  const candidates = [...matched.entries()]
    .filter(([subject]) => allowedSubjects.has(subject))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject]) => subject);
  const subjects = candidates.slice(0, 1);

  if (!subjects.length) {
    return {
      subjects: ["General Nonfiction"],
      confidence: "low",
      reasons: ["no specific subject keyword matched"],
      reviewReason: "Only the General Nonfiction fallback matched.",
      candidates: [],
    };
  }

  const onlyBroadHistory = subjects.length === 1 && subjects[0] === "History";
  const confidence = onlyBroadHistory || candidates.length > subjects.length ? "medium" : "high";
  return {
    subjects,
    confidence,
    reasons,
    candidates: candidates.map((subject) => ({ subject, score: matched.get(subject) ?? 0 })),
    reviewReason: onlyBroadHistory
      ? "History matched, but no more specific history subject matched."
      : candidates.length > subjects.length
        ? `Primary subject selected from multiple candidates: ${candidates.join(", ")}.`
        : undefined,
  };
}

function normalizeSubjectNames(subjects: string[], allowedSubjects: Set<string>, aliases: Map<string, string>) {
  return [
    ...new Set(
      subjects
        .map((subject) => aliases.get(subject) ?? subject)
        .filter((subject) => allowedSubjects.has(subject)),
    ),
  ];
}

function confidenceRank(confidence: "high" | "medium" | "low") {
  if (confidence === "low") return 0;
  if (confidence === "medium") return 1;
  return 2;
}

function getTitleSubjectOverrides() {
  return new Map<string, string[]>([
    ["a-furious-sky", ["Nature & Environment", "History"]],
    ["a-brief-history-of-everyone-who-ever-lived", ["Science", "History"]],
    ["a-cold-welcome", ["World History", "Nature & Environment"]],
    ["a-fistful-of-shells", ["World History", "Business & Economics"]],
    ["a-question-of-freedom", ["American History", "Race & Ethnicity"]],
    ["african-europeans", ["World History", "Race & Ethnicity"]],
    ["america-america", ["World History", "Politics & Government"]],
    ["amity-and-prosperity", ["Nature & Environment", "Business & Economics"]],
    ["another-word-for-love", ["Memoir & Autobiography"]],
    ["anansi-s-gold", ["World History", "Business & Economics", "True Crime & Justice"]],
    ["asperger-s-children", ["Medicine & Public Health", "World History"]],
    ["at-the-existentialist-cafe", ["Biography", "Arts & Criticism"]],
    ["before-the-movement", ["American History", "Race & Ethnicity", "True Crime & Justice"]],
    ["blood-at-the-root", ["American History", "True Crime & Justice", "Race & Ethnicity"]],
    ["born-in-flames", ["American History", "Business & Economics"]],
    ["brooding-over-bloody-revenge", ["American History", "Race & Ethnicity", "True Crime & Justice"]],
    ["bottoms-up-and-the-devil-laughs", ["Politics & Government", "Technology"]],
    ["breathless", ["Medicine & Public Health", "Science"]],
    ["call-them-by-their-true-names", ["Society & Culture", "Politics & Government"]],
    ["children-of-paradise", ["World History", "Politics & Government"]],
    ["circle-of-hope", ["Religion", "Society & Culture"]],
    ["charged", ["American History", "Nature & Environment", "Business & Economics"]],
    ["challenger", ["American History", "Technology"]],
    ["cobalt-red", ["Business & Economics", "Nature & Environment"]],
    ["constructing-a-nervous-system", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["cue-the-sun", ["Arts & Criticism"]],
    ["daughters-of-the-bamboo-grove", ["Society & Culture", "Race & Ethnicity"]],
    ["darkness-falls-on-the-land-of-light", ["American History", "Religion"]],
    ["directorate-s", ["Politics & Government", "War & Military"]],
    ["dopesick", ["Medicine & Public Health", "True Crime & Justice"]],
    ["dreamland", ["Medicine & Public Health", "True Crime & Justice"]],
    ["el-norte", ["American History", "World History", "Race & Ethnicity"]],
    ["empress", ["Biography", "World History"]],
    ["fathoms", ["Nature & Environment", "Science"]],
    ["feeding-ghosts", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["fen-bog-and-swamp", ["Nature & Environment"]],
    ["fifth-sun", ["World History", "Race & Ethnicity"]],
    ["figuring", ["Biography", "Science", "Arts & Criticism"]],
    ["four-hundred-souls", ["American History", "Race & Ethnicity"]],
    ["g-man", ["Biography", "American History", "Politics & Government"]],
    ["go-ahead-in-the-rain", ["Arts & Criticism", "Biography"]],
    ["gods-of-the-upper-air", ["Biography", "Science", "History"]],
    ["h-is-for-hawk", ["Memoir & Autobiography", "Nature & Environment"]],
    ["halfway-home", ["True Crime & Justice", "Society & Culture"]],
    ["heartland", ["Memoir & Autobiography", "Society & Culture"]],
    ["heavy", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["henry-david-thoreau", ["Biography", "Nature & Environment"]],
    ["hitler", ["Biography", "World History", "War & Military"]],
    ["hillbilly-elegy", ["Memoir & Autobiography", "Society & Culture"]],
    ["his-name-is-george-floyd", ["Biography", "Race & Ethnicity", "True Crime & Justice"]],
    ["hue-1968", ["War & Military", "World History", "Journalism & Reportage"]],
    ["i-ve-been-here-all-the-while", ["American History", "Race & Ethnicity"]],
    ["illusions-of-emancipation", ["American History", "Race & Ethnicity"]],
    ["implacable-foes", ["War & Military", "World History"]],
    ["hold-still", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["horizontal-vertigo", ["Travel & Place", "Society & Culture"]],
    ["how-not-to-kill-yourself", ["Memoir & Autobiography", "Medicine & Public Health"]],
    ["how-the-word-is-passed", ["American History", "Race & Ethnicity"]],
    ["how-to-make-a-slave-and-other-essays", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["how-to-say-babylon", ["Memoir & Autobiography", "Religion"]],
    ["how-we-fight-for-our-lives", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["in-sensorium", ["Memoir & Autobiography", "Society & Culture"]],
    ["in-the-darkroom", ["Gender & Sexuality", "Memoir & Autobiography"]],
    ["in-the-shadow-of-liberty", ["American History", "Politics & Government"]],
    ["invisible-child", ["Journalism & Reportage", "Society & Culture"]],
    ["judgment-at-tokyo", ["War & Military", "World History", "True Crime & Justice"]],
    ["just-us", ["Race & Ethnicity", "Society & Culture"]],
    ["just-another-southern-town", ["American History", "Race & Ethnicity"]],
    ["katrina", ["American History", "Nature & Environment", "Society & Culture"]],
    ["king-of-kings", ["Biography", "World History", "Politics & Government"]],
    ["killers-of-the-flower-moon", ["American History", "True Crime & Justice", "Race & Ethnicity"]],
    ["knife", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["kl", ["War & Military", "World History", "True Crime & Justice"]],
    ["lakota-america", ["American History", "Race & Ethnicity"]],
    ["let-the-record-show", ["Gender & Sexuality", "History"]],
    ["lightning-flowers", ["Memoir & Autobiography", "Medicine & Public Health"]],
    ["liliana-s-invincible-summer", ["Memoir & Autobiography", "True Crime & Justice"]],
    ["london-s-triumph", ["World History", "Business & Economics"]],
    ["madison-s-hand", ["American History", "Politics & Government"]],
    ["manual-for-survival", ["Medicine & Public Health", "Nature & Environment", "History"]],
    ["maoism", ["World History", "Politics & Government"]],
    ["master-slave-husband-wife", ["American History", "Biography", "Race & Ethnicity"]],
    ["memorial-drive", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["midnight-in-chernobyl", ["History", "Technology", "Medicine & Public Health"]],
    ["mother-mary-comes-to-me", ["Memoir & Autobiography"]],
    ["motherland", ["Memoir & Autobiography", "Politics & Government"]],
    ["mr-b", ["Biography", "Arts & Criticism"]],
    ["never-caught", ["American History", "Biography", "Race & Ethnicity"]],
    ["no-more-tears", ["Medicine & Public Health", "Journalism & Reportage"]],
    ["no-visible-bruises", ["Journalism & Reportage", "True Crime & Justice", "Society & Culture"]],
    ["nothing-ever-dies", ["War & Military", "World History", "Arts & Criticism"]],
    ["one-day-everyone-will-have-always-been-against-this", ["Politics & Government", "Society & Culture"]],
    ["one-person-no-vote", ["Politics & Government", "Race & Ethnicity"]],
    ["ordinary-notes", ["Memoir & Autobiography", "Race & Ethnicity", "Arts & Criticism"]],
    ["orwell-s-roses", ["Biography", "Nature & Environment"]],
    ["our-beloved-kin", ["American History", "Race & Ethnicity"]],
    ["our-migrant-souls", ["Race & Ethnicity", "Society & Culture"]],
    ["out-of-the-shadows", ["Gender & Sexuality", "Society & Culture"]],
    ["people-love-dead-jews", ["Religion", "Society & Culture", "Race & Ethnicity"]],
    ["priestdaddy", ["Memoir & Autobiography", "Religion"]],
    ["punch-me-up-to-the-gods", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["palo-alto", ["American History", "Business & Economics", "Technology"]],
    ["pogrom", ["World History", "Religion", "True Crime & Justice"]],
    ["prairie-fires", ["Biography", "American History"]],
    ["reckonings", ["World History", "War & Military", "True Crime & Justice"]],
    ["red-memory", ["World History", "Politics & Government"]],
    ["relinquished", ["Society & Culture", "Medicine & Public Health"]],
    ["ruin-their-crops-on-the-ground", ["American History", "Business & Economics", "Race & Ethnicity"]],
    ["running-out", ["Nature & Environment", "Society & Culture"]],
    ["saving-america-s-cities", ["American History", "Society & Culture"]],
    ["savings-and-trust", ["American History", "Business & Economics", "Race & Ethnicity"]],
    ["scots-and-catalans", ["World History", "Politics & Government"]],
    ["say-nothing", ["History", "True Crime & Justice", "War & Military"]],
    ["seek-you", ["Society & Culture", "Arts & Criticism"]],
    ["shadows-at-noon", ["World History", "Politics & Government", "Race & Ethnicity"]],
    ["shakespeare-in-a-divided-america", ["Arts & Criticism", "American History", "Politics & Government"]],
    ["she-come-by-it-natural", ["Arts & Criticism", "Biography"]],
    ["soldiers-and-kings", ["Journalism & Reportage", "Politics & Government", "Travel & Place"]],
    ["solitary", ["Memoir & Autobiography", "True Crime & Justice", "Race & Ethnicity"]],
    ["solito", ["Memoir & Autobiography", "Travel & Place"]],
    ["south-to-freedom", ["American History", "Race & Ethnicity"]],
    ["south-to-america", ["American History", "Travel & Place", "Race & Ethnicity"]],
    ["spain-in-our-hearts", ["War & Military", "World History", "Arts & Criticism"]],
    ["stamped-from-the-beginning", ["American History", "Race & Ethnicity"]],
    ["stakes-is-high", ["Race & Ethnicity", "Politics & Government", "Society & Culture"]],
    ["strangers-in-their-own-land", ["Society & Culture", "Politics & Government"]],
    ["surviving-katyn", ["War & Military", "World History", "True Crime & Justice"]],
    ["survivors", ["War & Military", "World History"]],
    ["tacky-s-revolt", ["World History", "Race & Ethnicity"]],
    ["teaching-white-supremacy", ["American History", "Race & Ethnicity", "Society & Culture"]],
    ["tell-me-how-it-ends", ["Memoir & Autobiography", "Politics & Government"]],
    ["the-1619-project", ["American History", "Race & Ethnicity"]],
    ["the-address-book", ["History", "Travel & Place", "Society & Culture"]],
    ["the-age-of-choice", ["History", "Society & Culture"]],
    ["the-anarchy", ["World History", "Business & Economics"]],
    ["the-beekeeper", ["War & Military", "Journalism & Reportage", "Race & Ethnicity"]],
    ["the-brazen-age", ["American History", "Politics & Government"]],
    ["the-broken-constitution", ["American History", "Politics & Government"]],
    ["the-browns-of-california", ["Biography", "American History", "Politics & Government"]],
    ["the-buried", ["World History", "Politics & Government", "Travel & Place"]],
    ["the-cigarette", ["American History", "Business & Economics", "Medicine & Public Health"]],
    ["the-contagion-of-liberty", ["American History", "Medicine & Public Health"]],
    ["the-cooking-gene", ["Memoir & Autobiography", "American History", "Race & Ethnicity"]],
    ["the-dawn-watch", ["Biography", "World History", "Arts & Criticism"]],
    ["the-dead-are-arising", ["Biography", "American History", "Race & Ethnicity"]],
    ["the-defender", ["Biography", "American History", "Race & Ethnicity"]],
    ["the-facemaker", ["Medicine & Public Health", "War & Military", "History"]],
    ["the-firebrand-and-the-first-lady", ["Biography", "American History", "Race & Ethnicity"]],
    ["the-first-and-last-king-of-haiti", ["Biography", "World History", "Race & Ethnicity"]],
    ["the-freaks-came-out-to-write", ["Journalism & Reportage", "Arts & Criticism", "History"]],
    ["the-garden-against-time", ["Memoir & Autobiography", "Nature & Environment", "Arts & Criticism"]],
    ["the-great-displacement", ["Nature & Environment", "Society & Culture"]],
    ["the-great-escape", ["Business & Economics", "Society & Culture", "Race & Ethnicity"]],
    ["the-future-is-history", ["World History", "Politics & Government", "Race & Ethnicity"]],
    ["the-great-leveler", ["World History", "Business & Economics"]],
    ["the-grimkes", ["Biography", "American History", "Race & Ethnicity"]],
    ["the-horde", ["World History", "War & Military"]],
    ["the-house-of-the-dead", ["World History", "True Crime & Justice"]],
    ["the-inheritors", ["World History", "Race & Ethnicity", "Politics & Government"]],
    ["the-invention-of-miracles", ["Biography", "Medicine & Public Health"]],
    ["the-invisible-kingdom", ["Medicine & Public Health", "Memoir & Autobiography"]],
    ["the-lucky-ones", ["Memoir & Autobiography", "World History", "War & Military"]],
    ["the-man-who-could-move-clouds", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["the-method", ["Arts & Criticism", "History"]],
    ["the-other-olympians", ["Gender & Sexuality", "Sports", "History"]],
    ["the-ottoman-endgame", ["World History", "War & Military"]],
    ["the-saltwater-frontier", ["American History", "Race & Ethnicity"]],
    ["the-sewing-girl-s-tale", ["American History", "True Crime & Justice", "Race & Ethnicity"]],
    ["the-least-of-us", ["Medicine & Public Health", "True Crime & Justice"]],
    ["the-rent-collectors", ["Society & Culture", "True Crime & Justice", "Journalism & Reportage"]],
    ["the-seeds-of-life", ["Science", "History", "Medicine & Public Health"]],
    ["the-thin-light-of-freedom", ["American History", "War & Military", "Race & Ethnicity"]],
    ["the-talk", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["the-undertow", ["Politics & Government", "Religion", "Society & Culture"]],
    ["the-ungrateful-refugee", ["Memoir & Autobiography", "Politics & Government"]],
    ["the-yellow-house", ["Memoir & Autobiography", "Society & Culture"]],
    ["these-truths", ["American History", "Politics & Government"]],
    ["these-precious-days", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["they-were-her-property", ["American History", "Race & Ethnicity", "Business & Economics"]],
    ["thick", ["Society & Culture", "Race & Ethnicity"]],
    ["those-who-forget", ["World History", "War & Military"]],
    ["titans-of-industrial-agriculture", ["Business & Economics", "Nature & Environment"]],
    ["travelers-in-the-third-reich", ["World History", "War & Military"]],
    ["truevine", ["Biography", "Race & Ethnicity"]],
    ["undue-burden", ["Politics & Government", "Medicine & Public Health"]],
    ["unshrinking", ["Gender & Sexuality", "Society & Culture"]],
    ["unworthy-republic", ["American History", "Race & Ethnicity"]],
    ["vanguard", ["American History", "Race & Ethnicity", "Politics & Government"]],
    ["wards-of-the-state", ["Society & Culture", "True Crime & Justice"]],
    ["wayward-lives-beautiful-experiments", ["History", "Race & Ethnicity"]],
    ["we-could-have-been-friends-my-father-and-i", ["Memoir & Autobiography", "Politics & Government"]],
    ["we-re-alone", ["Memoir & Autobiography", "Race & Ethnicity", "Society & Culture"]],
    ["we-the-corporations", ["Business & Economics", "Politics & Government"]],
    ["what-you-have-heard-is-true", ["Memoir & Autobiography", "War & Military", "Politics & Government"]],
    ["when-death-takes-something-from-you-give-it-back", ["Memoir & Autobiography"]],
    ["when-it-all-burns", ["Memoir & Autobiography", "Nature & Environment"]],
    ["whiskey-tender", ["Memoir & Autobiography", "Race & Ethnicity"]],
    ["who-gets-believed", ["Society & Culture", "Politics & Government", "Journalism & Reportage"]],
    ["where-the-jews-aren-t", ["World History", "Religion", "Race & Ethnicity"]],
    ["white-trash", ["American History", "Race & Ethnicity", "Society & Culture"]],
    ["writing-to-save-a-life", ["American History", "Race & Ethnicity", "True Crime & Justice"]],
    ["you-don-t-have-to-say-you-love-me", ["Memoir & Autobiography", "Race & Ethnicity"]],
  ]);
}

async function readGeneratedTopics(): Promise<GeneratedTopicsFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "enrichment", "topics.generated.json"), "utf8")) as GeneratedTopicsFile;
  } catch {
    return { books: {} };
  }
}

async function readWikipediaEvidence(): Promise<WikipediaBookEvidence[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(sourcesDir, "enrichment", "wikipedia.generated.json"), "utf8")) as WikipediaGeneratedFile;
    return Object.values(parsed.wikipediaEvidence ?? {});
  } catch {
    return [];
  }
}

async function readBookAliases(): Promise<BookAliasFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "book-aliases.json"), "utf8")) as BookAliasFile;
  } catch {
    return { aliases: [] };
  }
}

async function readPrizeRegistry(): Promise<PrizeRegistryFileEntry[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "prizes.json"), "utf8")) as PrizeRegistryFileEntry[];
  } catch {
    return [];
  }
}

function applyBookCuration(
  books: Map<string, Book>,
  patches: Record<string, Partial<Book>> | undefined,
  titleResolver: CanonicalTitleResolver,
  options: { allowCreate?: boolean } = {},
) {
  if (!patches) return;
  const allowCreate = options.allowCreate ?? true;
  for (const [id, patch] of Object.entries(patches)) {
    const targetId = titleResolver.resolveBookId(id);
    const current = books.get(targetId);
    if (!current) {
      if (!allowCreate) continue;
      books.set(targetId, normalizeBookPatch(targetId, patch));
      continue;
    }
    books.set(targetId, mergeObject(current, patch));
  }
}

function normalizeBookPatch(id: string, patch: Partial<Book>): Book {
  return {
    slug: id.replace(/^book-/, ""),
    title: "",
    authors: [],
    isbn13: [],
    subjects: [],
    topics: [],
    centralFigures: [],
    links: {},
    sourceIds: [],
    ...patch,
    id,
  } as Book;
}

function applyBookAliases(books: Map<string, Book>, appearances: Map<string, AwardAppearance>, aliasFile: BookAliasFile) {
  const aliasMap = new Map<string, string>();
  for (const group of aliasFile.aliases ?? []) {
    for (const duplicateId of group.duplicateBookIds) {
      if (duplicateId !== group.canonicalBookId) aliasMap.set(duplicateId, group.canonicalBookId);
    }
  }
  const resolveAlias = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (aliasMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = aliasMap.get(current)!;
    }
    return current;
  };

  for (const [duplicateId] of aliasMap) {
    const canonicalId = resolveAlias(duplicateId);
    if (duplicateId === canonicalId) continue;
    const duplicate = books.get(duplicateId);
    if (!duplicate) continue;
    const canonical = books.get(canonicalId);
    if (!canonical) {
      books.set(canonicalId, { ...duplicate, id: canonicalId, slug: canonicalId.replace(/^book-/, "") });
    } else {
      books.set(canonicalId, mergeBooks(canonical, duplicate));
    }
    books.delete(duplicateId);
  }

  for (const appearance of appearances.values()) {
    appearance.bookId = resolveAlias(appearance.bookId);
  }
}

function mergeBooks(canonical: Book, duplicate: Book): Book {
  return {
    ...canonical,
    publicationYear: canonical.publicationYear ?? duplicate.publicationYear,
    publisherId: canonical.publisherId ?? duplicate.publisherId,
    imprintId: canonical.imprintId ?? duplicate.imprintId,
    pageCount: canonical.pageCount ?? duplicate.pageCount,
    summary: canonical.summary ?? duplicate.summary,
    displaySummary: canonical.displaySummary ?? duplicate.displaySummary,
    thumbnailUrl: canonical.thumbnailUrl ?? duplicate.thumbnailUrl,
    isbn13: [...new Set([...canonical.isbn13, ...duplicate.isbn13])],
    subjects: [...new Set([...canonical.subjects, ...duplicate.subjects])],
    topics: [...new Set([...canonical.topics, ...duplicate.topics])],
    centralFigures: [...new Set([...canonical.centralFigures, ...duplicate.centralFigures])],
    subjectCategories: mergeSubjectCategoryArrays(canonical.subjectCategories, duplicate.subjectCategories),
    links: { ...duplicate.links, ...canonical.links },
    sourceIds: [...new Set([...canonical.sourceIds, ...duplicate.sourceIds])],
  };
}

function mergeSubjectCategoryArrays(a: Book["subjectCategories"], b: Book["subjectCategories"]) {
  const categories = [...(a ?? []), ...(b ?? [])];
  const seen = new Set<string>();
  return categories.filter((category) => {
    const key = `${category.source}\0${category.scheme ?? ""}\0${category.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
