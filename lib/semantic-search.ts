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
  readerLevel?: string;
  readerTraits?: string[];
  narrativeScore?: number;
  accessibilityScore?: number;
  scholarlyScore?: number;
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
  lexicalScore?: number;
  keywordBoost: number;
  conceptBoost: number;
  topicBoost: number;
  scopeBoost: number;
  periodBoost: number;
  recognitionBoost: number;
  readerIntentBoost?: number;
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
  const summary = clippedText(book.displaySummary || book.summary, 1800);
  const parts = [
    `Title: ${[book.title, book.subtitle].filter(Boolean).join(": ")}`,
    `Author: ${book.authors.map((author) => author.name).join(", ")}`,
    summary ? `Description: ${summary}` : "",
    book.primarySubject ? `Primary subject: ${book.primarySubject}` : "",
    book.subjects.length ? `Subjects: ${book.subjects.join(", ")}` : "",
    book.primaryTopic ? `Primary topic: ${book.primaryTopic}` : "",
    book.topics.length ? `Topics: ${book.topics.join(", ")}` : "",
    book.centralFigures.length ? `Central figures: ${book.centralFigures.join(", ")}` : "",
    book.readerProfile ? `Reader profile: ${readerProfileText(book.readerProfile)}` : "",
    book.subjectCategories?.length
      ? `Catalog subject evidence: ${subjectEvidenceLabels(book.subjectCategories.map((category) => category.label)).join(", ")}`
      : "",
    imprint ? `Imprint: ${imprint}` : "",
    publisher ? `Publisher: ${publisher}` : "",
    awards.length ? `Award recognition: ${awards.slice(0, 14).join("; ")}` : "",
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
    "are",
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
    "read",
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
  const readerExperienceQuery = isReaderExperienceQuery(query, interpretation);
  const terms = searchTerms(expandedText).filter((term) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(term));
  const rowSearch = readerExperienceQuery ? semanticBodySearchText(row) : row.searchText;
  const hits = terms.filter((term) => rowSearch.includes(term));
  const totalTermWeight = terms.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const hitTermWeight = hits.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  const keywordBoost = totalTermWeight ? Math.min(1, hitTermWeight / totalTermWeight) : 0;
  const conceptNeedles = uniqueNormalized([...(interpretation?.concepts ?? []), ...(interpretation?.subjects ?? [])])
    .filter((needle) => needle.length >= 4)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const conceptHits = conceptNeedles.filter((needle) => rowSearch.includes(needle));
  const totalConceptWeight = conceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0);
  const hitConceptWeight = conceptHits.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0);
  const conceptBoost = totalConceptWeight ? Math.min(1, hitConceptWeight / totalConceptWeight) : 0;
  const topicNeedles = uniqueNormalized([...(interpretation?.subjects ?? []), ...(interpretation?.concepts ?? [])])
    .filter(Boolean)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const topicHaystack = normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" "));
  const topicHits = topicNeedles.filter((needle) => needle && topicHaystack.includes(needle));
  const topicBoost = topicNeedles.length ? Math.min(1, topicHits.length / Math.min(topicNeedles.length, 6)) : 0;
  const scopeBoost = subjectScopeScore(query, interpretation, row);
  const periods = inferPeriodRanges([query, interpretation?.expandedQuery, ...(interpretation?.eras ?? [])].filter(Boolean).join(" "));
  const periodBoost = rowMentionsPeriod(row, periods, isPublicationDateQuery(query, interpretation)) ? 1 : 0;
  const readerIntentBoost = readerIntentScore(query, interpretation, row);
  const recognitionBoost = Math.min(1, Math.log1p(Math.max(0, row.recognitionScore)) / Math.log1p(32));
  const similarity = cosineSimilarity(queryEmbedding, row.embedding, row.norm);
  const phraseBoost = phraseMatchBoost(query, interpretation, row);
  const positiveReaderIntentBoost = Math.max(0, readerIntentBoost);
  const lexicalScore = Math.min(1, keywordBoost * 0.26 + conceptBoost * 0.18 + topicBoost * 0.12 + scopeBoost * 0.16 + periodBoost * 0.08 + phraseBoost * 0.05 + positiveReaderIntentBoost * 0.15);
  const score = similarity * 0.7 + lexicalScore * 0.24 + recognitionBoost * 0.06;
  const reasons = [
    hits.slice(0, 4).length ? `Matched terms: ${hits.slice(0, 4).join(", ")}` : "",
    conceptHits.slice(0, 3).length ? `Matched concepts: ${conceptHits.slice(0, 3).join(", ")}` : "",
    topicHits.slice(0, 3).length ? `Matched concepts: ${topicHits.slice(0, 3).join(", ")}` : "",
    scopeBoost ? "Matched subject scope" : "",
    periodBoost ? "Matched period signal" : "",
    readerIntentBoost ? "Matched reader-experience signal" : "",
  ].filter(Boolean);
  return {
    conceptBoost,
    keywordBoost,
    lexicalScore: Number(lexicalScore.toFixed(6)),
    periodBoost,
    recognitionBoost,
    readerIntentBoost: Number(readerIntentBoost.toFixed(6)),
    reasons,
    score: Number(score.toFixed(6)),
    similarity: Number(similarity.toFixed(6)),
    scopeBoost,
    topicBoost,
  };
}

export function semanticRankFusion(results: SemanticSearchResult[]) {
  const vectorRanks = ranksBy(results, (row) => row.similarity);
  const lexicalRanks = ranksBy(results, (row) => row.lexicalScore ?? lexicalScore(row));
  const topicRanks = ranksBy(results, (row) => row.scopeBoost + row.topicBoost * 0.8 + row.conceptBoost * 0.5 + row.periodBoost * 0.35);
  const readerRanks = ranksBy(results, (row) => Math.max(0, row.readerIntentBoost ?? 0));
  const recognitionRanks = ranksBy(results, (row) => row.recognitionBoost);
  const k = 60;
  return results.map((row) => {
    const fused =
      0.44 / (k + (vectorRanks.get(row.bookId) ?? results.length)) +
      0.18 / (k + (lexicalRanks.get(row.bookId) ?? results.length)) +
      0.15 / (k + (topicRanks.get(row.bookId) ?? results.length)) +
      0.16 / (k + (readerRanks.get(row.bookId) ?? results.length)) +
      0.07 / (k + (recognitionRanks.get(row.bookId) ?? results.length));
    const readerPenalty = Math.min(0, row.readerIntentBoost ?? 0) * 1.15;
    const fitBonus =
      Math.max(0, row.readerIntentBoost ?? 0) * 0.24 +
      row.scopeBoost * 0.12 +
      row.recognitionBoost * 0.1;
    return {
      ...row,
      score: Number((fused * 100 + fitBonus + readerPenalty).toFixed(6)),
    };
  });
}

function ranksBy(results: SemanticSearchResult[], score: (row: SemanticSearchResult) => number) {
  return new Map(
    [...results]
      .sort((a, b) => score(b) - score(a) || b.similarity - a.similarity)
      .map((row, index) => [row.bookId, index + 1]),
  );
}

function lexicalScore(row: SemanticSearchResult) {
  return row.keywordBoost * 0.26 + row.conceptBoost * 0.18 + row.topicBoost * 0.12 + row.scopeBoost * 0.16 + row.periodBoost * 0.08 + (row.readerIntentBoost ?? 0) * 0.15;
}

function rowMentionsPeriod(row: SemanticBookIndexRow, periods: Array<{ label: string; start: number; end: number }>, allowPublicationYear: boolean) {
  if (!periods.length) return false;
  if (allowPublicationYear && row.publicationYear && periods.some((period) => row.publicationYear! >= period.start && row.publicationYear! <= period.end)) return true;
  const rowSearch = semanticContentSearchText(row);
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

function isPublicationDateQuery(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([query, interpretation?.expandedQuery ?? ""].join(" "));
  return /\b(published|publication|released|came out|from the|books from|written in|recent|new|contemporary)\b/.test(normalized);
}

function subjectScopeScore(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const normalized = normalizeForSearch([
    query,
    interpretation?.expandedQuery ?? "",
    ...(interpretation?.subjects ?? []),
    ...(interpretation?.concepts ?? []),
  ].join(" "));
  const rowScope = normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" "))
    .replace(/\bpersonal history\b/g, "personal narrative");
  let score = 0;
  if (/\b(histories|history|historical)\b/.test(normalized)) {
    if (/\bhistory\b/.test(rowScope)) score = Math.max(score, 1);
    if (/\b(world war|holocaust|civil rights|cold war|political history|intellectual history|regional history|local history)\b/.test(rowScope)) score = Math.max(score, 0.72);
  }
  if (/\b(science|scientific|nature|discovery)\b/.test(normalized)) {
    if (/\b(science|nature|discovery|environment|medicine|public health)\b/.test(rowScope)) score = Math.max(score, 1);
  }
  if (/\b(memoir|grief|family|illness)\b/.test(normalized)) {
    if (/\b(memoir|biography|family|medicine|public health)\b/.test(rowScope)) score = Math.max(score, 0.85);
  }
  if (/\b(poverty|housing|inequality)\b/.test(normalized)) {
    if (/\b(poverty|housing|cities|urban|economics|social movements|race)\b/.test(rowScope)) score = Math.max(score, 1);
  }
  return score;
}

function semanticContentSearchText(row: SemanticBookIndexRow) {
  return normalizeForSearch(
    row.text
      .split("\n")
      .filter((line) => !/^award recognition:/i.test(line) && !/^book publication year:/i.test(line))
      .join("\n"),
  );
}

function semanticBodySearchText(row: SemanticBookIndexRow) {
  return normalizeForSearch(
    row.text
      .split("\n")
      .filter((line) => !/^title:/i.test(line) && !/^author:/i.test(line) && !/^award recognition:/i.test(line) && !/^book publication year:/i.test(line))
      .join("\n"),
  );
}

function phraseMatchBoost(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const phrases = uniqueNormalized([
    ...quotedPhrases(query),
    ...(interpretation?.concepts ?? []),
    ...(interpretation?.subjects ?? []),
    ...(interpretation?.eras ?? []),
  ]).filter((phrase) => phrase.includes(" ") && phrase.length >= 8);
  if (!phrases.length) return 0;
  const content = semanticContentSearchText(row);
  const hits = phrases.filter((phrase) => content.includes(phrase));
  return Math.min(1, hits.length / Math.min(phrases.length, 4));
}

function quotedPhrases(input: string) {
  return Array.from(input.matchAll(/["'“”]([^"'“”]{3,80})["'“”]/g)).map((match) => match[1]);
}

function clippedText(input: string | undefined, maxLength: number) {
  const normalized = input?.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength);
  return clipped.slice(0, Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","), maxLength - 120)).trim();
}

function subjectEvidenceLabels(labels: string[]) {
  const generic = new Set(["general", "nonfiction", "history", "biography", "books", "literature"]);
  return Array.from(
    new Set(
      labels
        .map((label) => label.trim())
        .filter((label) => label.length >= 4 && !generic.has(normalizeForSearch(label))),
    ),
  ).slice(0, 8);
}

function readerProfileText(profile: NonNullable<Book["readerProfile"]>) {
  const traits = profile.traits
    .filter((trait) => trait.score >= 0.25)
    .slice(0, 8)
    .map((trait) => trait.id.replaceAll("_", " "))
    .join(", ");
  return [
    `level ${profile.readerLevel}`,
    `narrative ${profile.narrativeScore}`,
    `accessible ${profile.accessibilityScore}`,
    `scholarly ${profile.scholarlyScore}`,
    traits ? `traits ${traits}` : "",
  ].filter(Boolean).join("; ");
}

function readerIntentScore(query: string, interpretation: SemanticQueryInterpretation | null | undefined, row: SemanticBookIndexRow) {
  const normalized = normalizeForSearch([
    query,
    interpretation?.expandedQuery ?? "",
    ...(interpretation?.concepts ?? []),
    ...(interpretation?.subjects ?? []),
  ].join(" "));
  const wantsReadable = /\b(fun|readable|engaging|accessible|popular|page turner|page-turner|good read|general reader|not academic|beach read)\b/.test(normalized);
  const wantsNarrative = /\b(narrative|story|stories|character|character driven|people|lives|biographical|reported|journalistic|immersive)\b/.test(normalized);
  const wantsScholarly = /\b(academic|scholarly|dense|historiography|historiographical|theory|monograph|specialist)\b/.test(normalized);
  let score = 0;
  if (wantsReadable) {
    score += (row.accessibilityScore ?? 0) * 0.5;
    score += row.readerLevel === "popular" ? 0.22 : row.readerLevel === "crossover" && (row.accessibilityScore ?? 0) >= 0.2 ? 0.08 : 0;
    score -= (row.scholarlyScore ?? 0) * 0.72;
    if ((row.accessibilityScore ?? 0) < 0.12 && row.readerLevel !== "popular") score -= 0.16;
    if (row.readerLevel === "academic" || row.readerLevel === "reference") score -= 0.42;
    if (row.readerTraits?.some((trait) => ["dense", "academic", "scholarly", "reference"].includes(trait))) score -= 0.18;
  }
  if (wantsNarrative) {
    score += (row.narrativeScore ?? 0) * 0.48;
    if (row.readerTraits?.some((trait) => ["character_driven", "biographical", "reported", "memoiristic"].includes(trait))) score += 0.14;
    if (row.readerTraits?.includes("argument_driven") && !wantsScholarly) score -= 0.08;
    if (!wantsScholarly) score -= (row.scholarlyScore ?? 0) * 0.45;
    if (!wantsScholarly && (row.readerLevel === "academic" || row.readerLevel === "reference")) score -= 0.2;
    if (!wantsScholarly && (row.narrativeScore ?? 0) < 0.1 && (row.scholarlyScore ?? 0) >= 0.25) score -= 0.35;
    if ((row.narrativeScore ?? 0) < 0.1 && !row.readerTraits?.some((trait) => ["character_driven", "biographical", "reported", "memoiristic", "narrative"].includes(trait))) score -= 0.2;
  }
  if (wantsReadable && wantsNarrative && (row.accessibilityScore ?? 0) < 0.12 && (row.narrativeScore ?? 0) < 0.12) score -= 0.18;
  if (wantsScholarly) {
    score += (row.scholarlyScore ?? 0) * 0.5;
    if (row.readerLevel === "academic") score += 0.18;
  }
  if (!wantsReadable && !wantsNarrative && !wantsScholarly) return 0;
  return Math.max(-1, Math.min(1, score));
}

const readerIntentLexicalStopwords = new Set([
  "accessible",
  "character",
  "driven",
  "engaging",
  "fun",
  "histories",
  "history",
  "narrative",
  "narratives",
  "popular",
  "readable",
  "stories",
  "story",
]);

function isReaderExperienceQuery(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([
    query,
    interpretation?.expandedQuery ?? "",
    ...(interpretation?.concepts ?? []),
  ].join(" "));
  return /\b(fun|readable|engaging|accessible|popular|page turner|page-turner|good read|general reader|beach read|narrative|story|stories|character driven|immersive)\b/.test(normalized);
}

function uniqueNormalized(values: string[]) {
  return Array.from(new Set(values.map(normalizeForSearch).filter(Boolean)));
}

function conceptWeight(needle: string, termWeights?: Map<string, number>) {
  const terms = searchTerms(needle);
  if (!terms.length) return 1;
  return Math.max(...terms.map((term) => termWeights?.get(term) ?? 1));
}
