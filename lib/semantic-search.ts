import type { Book } from "@/lib/types";

export const DEFAULT_SEMANTIC_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_SEMANTIC_DIMENSIONS = 512;

export type SemanticBookIndexRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  primarySubject?: string;
  subjects: string[];
  primaryTopic?: string;
  topics: string[];
  imprint?: string;
  publisher?: string;
  awards: string[];
  recognitionScore: number;
  text: string;
  searchText: string;
  inputHash: string;
  embedding: number[];
  norm: number;
};

export type SemanticBookIndex = {
  generatedAt: string;
  embeddingModel: string;
  dimensions: number;
  inputVersion: number;
  books: SemanticBookIndexRow[];
};

export type SemanticQueryInterpretation = {
  expandedQuery: string;
  concepts: string[];
  eras: string[];
  subjects: string[];
};

export type SemanticSearchResult = {
  bookId: string;
  score: number;
  similarity: number;
  keywordBoost: number;
  conceptBoost: number;
  topicBoost: number;
  periodBoost: number;
  recognitionBoost: number;
  reasons: string[];
};

export function semanticTextForBook({
  awards,
  book,
  imprint,
  publisher,
}: {
  awards: string[];
  book: Book;
  imprint?: string;
  publisher?: string;
}) {
  const parts = [
    `Title: ${[book.title, book.subtitle].filter(Boolean).join(": ")}`,
    `Author: ${book.authors.map((author) => author.name).join(", ")}`,
    book.publicationYear ? `Publication year: ${book.publicationYear}` : "",
    book.primarySubject ? `Primary subject: ${book.primarySubject}` : "",
    book.subjects.length ? `Subjects: ${book.subjects.join(", ")}` : "",
    book.primaryTopic ? `Primary topic: ${book.primaryTopic}` : "",
    book.topics.length ? `Topics: ${book.topics.join(", ")}` : "",
    book.centralFigures.length ? `Central figures: ${book.centralFigures.join(", ")}` : "",
    imprint ? `Imprint: ${imprint}` : "",
    publisher ? `Publisher: ${publisher}` : "",
    awards.length ? `Award recognition: ${awards.slice(0, 14).join("; ")}` : "",
    book.displaySummary ? `Curated summary: ${book.displaySummary}` : "",
    book.summary ? `Catalog summary: ${book.summary}` : "",
    book.subjectCategories?.length
      ? `Catalog subject evidence: ${book.subjectCategories.map((category) => category.label).slice(0, 12).join(", ")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n").slice(0, 7200);
}

export function semanticQueryText(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const parts = [
    `Reader query: ${query}`,
    interpretation?.expandedQuery ? `Expanded search intent: ${interpretation.expandedQuery}` : "",
    interpretation?.concepts.length ? `Concepts: ${interpretation.concepts.join(", ")}` : "",
    interpretation?.eras.length ? `Eras and periods: ${interpretation.eras.join(", ")}` : "",
    interpretation?.subjects.length ? `Likely subjects: ${interpretation.subjects.join(", ")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

export function normalizeForSearch(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function vectorNorm(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function cosineSimilarity(a: number[], b: number[], bNorm = vectorNorm(b)) {
  const aNorm = vectorNorm(a);
  if (!aNorm || !bNorm) return 0;
  let dot = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
  }
  return dot / (aNorm * bNorm);
}

export function searchTerms(input: string) {
  const stop = new Set([
    "about",
    "after",
    "age",
    "also",
    "and",
    "book",
    "called",
    "era",
    "for",
    "from",
    "into",
    "like",
    "looking",
    "novel",
    "nonfiction",
    "recommend",
    "search",
    "show",
    "that",
    "the",
    "this",
    "with",
    "writing",
  ]);
  return Array.from(
    new Set(
      normalizeForSearch(input)
        .split(" ")
        .filter((term) => term.length >= 3 && !stop.has(term)),
    ),
  ).slice(0, 42);
}

export function corpusTermWeights(terms: string[], rows: SemanticBookIndexRow[]) {
  const weights = new Map<string, number>();
  const uniqueTerms = Array.from(new Set(terms));
  const rowCount = Math.max(rows.length, 1);
  for (const term of uniqueTerms) {
    let documentFrequency = 0;
    for (const row of rows) {
      if (row.searchText.includes(term)) documentFrequency += 1;
    }
    weights.set(term, Math.log((rowCount + 1) / (documentFrequency + 1)) + 1);
  }
  return weights;
}

export function inferPeriodRanges(input: string): Array<{ label: string; start: number; end: number }> {
  const normalized = normalizeForSearch(input);
  const ranges: Array<{ label: string; start: number; end: number }> = [];
  for (const match of normalized.matchAll(/\b(1[5-9]\d0|20\d0)s\b/g)) {
    const start = Number(match[1]);
    if (Number.isFinite(start)) ranges.push({ label: `${start}s`, start, end: start + 9 });
  }
  for (const match of normalized.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)) {
    const year = Number(match[1]);
    if (Number.isFinite(year)) ranges.push({ label: String(year), start: year - 4, end: year + 4 });
  }
  if (/\bvictorian\b/.test(normalized)) ranges.push({ label: "Victorian era", start: 1837, end: 1901 });
  if (/\bgilded age\b/.test(normalized)) ranges.push({ label: "Gilded Age", start: 1870, end: 1900 });
  if (/\bprogressive era\b/.test(normalized)) ranges.push({ label: "Progressive Era", start: 1890, end: 1920 });
  return ranges;
}

export function semanticHybridScore({
  interpretation,
  query,
  queryEmbedding,
  row,
  termWeights,
}: {
  interpretation?: SemanticQueryInterpretation | null;
  query: string;
  queryEmbedding: number[];
  row: SemanticBookIndexRow;
  termWeights?: Map<string, number>;
}) {
  const expandedText = [
    query,
    interpretation?.expandedQuery,
    ...(interpretation?.concepts ?? []),
    ...(interpretation?.subjects ?? []),
    ...(interpretation?.eras ?? []),
  ].filter(Boolean).join(" ");
  const terms = searchTerms(expandedText);
  const rowSearch = row.searchText;
  const hits = terms.filter((term) => rowSearch.includes(term));
  const totalTermWeight = terms.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const hitTermWeight = hits.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const keywordBoost = totalTermWeight ? Math.min(1, hitTermWeight / totalTermWeight) : 0;
  const conceptNeedles = uniqueNormalized([...(interpretation?.concepts ?? []), ...(interpretation?.subjects ?? [])]).filter((needle) => needle.length >= 4);
  const conceptHits = conceptNeedles.filter((needle) => rowSearch.includes(needle));
  const totalConceptWeight = conceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0);
  const hitConceptWeight = conceptHits.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0);
  const conceptBoost = totalConceptWeight ? Math.min(1, hitConceptWeight / totalConceptWeight) : 0;
  const topicNeedles = uniqueNormalized([...(interpretation?.subjects ?? []), ...(interpretation?.concepts ?? [])]).filter(Boolean);
  const topicHaystack = normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" "));
  const topicHits = topicNeedles.filter((needle) => needle && topicHaystack.includes(needle));
  const topicBoost = topicNeedles.length ? Math.min(1, topicHits.length / Math.min(topicNeedles.length, 6)) : 0;
  const periods = inferPeriodRanges([query, interpretation?.expandedQuery, ...(interpretation?.eras ?? [])].filter(Boolean).join(" "));
  const periodBoost = rowMentionsPeriod(row, periods) ? 1 : 0;
  const recognitionBoost = Math.min(1, Math.log1p(Math.max(0, row.recognitionScore)) / Math.log1p(32));
  const similarity = cosineSimilarity(queryEmbedding, row.embedding, row.norm);
  const score = similarity * 0.76 + keywordBoost * 0.09 + conceptBoost * 0.07 + topicBoost * 0.04 + periodBoost * 0.02 + recognitionBoost * 0.02;
  const reasons = [
    hits.slice(0, 4).length ? `Matched terms: ${hits.slice(0, 4).join(", ")}` : "",
    conceptHits.slice(0, 3).length ? `Matched concepts: ${conceptHits.slice(0, 3).join(", ")}` : "",
    topicHits.slice(0, 3).length ? `Matched concepts: ${topicHits.slice(0, 3).join(", ")}` : "",
    periodBoost ? "Matched period signal" : "",
  ].filter(Boolean);
  return {
    conceptBoost,
    keywordBoost,
    periodBoost,
    recognitionBoost,
    reasons,
    score: Number(score.toFixed(6)),
    similarity: Number(similarity.toFixed(6)),
    topicBoost,
  };
}

function rowMentionsPeriod(row: SemanticBookIndexRow, periods: Array<{ label: string; start: number; end: number }>) {
  if (!periods.length) return false;
  if (row.publicationYear && periods.some((period) => row.publicationYear! >= period.start && row.publicationYear! <= period.end)) return true;
  const rowSearch = row.searchText;
  return periods.some((period) => {
    const label = normalizeForSearch(period.label);
    if (label && rowSearch.includes(label)) return true;
    if (period.label.endsWith("s") && rowSearch.includes(String(period.start).slice(0, 3))) return true;
    for (const match of rowSearch.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)) {
      const year = Number(match[1]);
      if (year >= period.start && year <= period.end) return true;
    }
    return false;
  });
}

function uniqueNormalized(values: string[]) {
  return Array.from(new Set(values.map(normalizeForSearch).filter(Boolean)));
}

function conceptWeight(needle: string, termWeights?: Map<string, number>) {
  const terms = searchTerms(needle);
  if (!terms.length) return 1;
  return Math.max(...terms.map((term) => termWeights?.get(term) ?? 1));
}
