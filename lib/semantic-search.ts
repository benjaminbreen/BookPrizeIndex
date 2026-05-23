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
  adventurousConcepts?: string[];
  coreConcepts?: string[];
  eras: string[];
  subjects: string[];
};

export type SemanticQueryExpansionModel = "gpt-5.4-mini" | "gemini-3.5-flash";

export type SemanticSearchResult = {
  bookId: string;
  score: number;
  similarity: number;
  lexicalScore?: number;
  keywordBoost: number;
  fieldBoost?: number;
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
  const coreConcepts = semanticCoreConcepts(interpretation);
  const adventurousConcepts = semanticAdventurousConcepts(interpretation);
  const parts = [
    `Reader query: ${query}`,
    interpretation?.expandedQuery ? `Expanded search intent: ${interpretation.expandedQuery}` : "",
    coreConcepts.length ? `Core concepts: ${coreConcepts.join(", ")}` : "",
    adventurousConcepts.length ? `Adventurous adjacent concepts: ${adventurousConcepts.join(", ")}` : "",
    interpretation?.eras.length ? `Eras and periods: ${interpretation.eras.join(", ")}` : "",
    interpretation?.subjects.length ? `Likely subjects: ${interpretation.subjects.join(", ")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

export function semanticRankingTerms(query: string, interpretation?: SemanticQueryInterpretation | null) {
  return searchTerms([
    query,
    interpretation?.expandedQuery,
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
    ...(interpretation?.eras ?? []),
    ...(interpretation?.subjects ?? []),
  ].filter(Boolean).join(" "));
}

export function semanticCoreConcepts(interpretation?: SemanticQueryInterpretation | null) {
  if (interpretation?.coreConcepts?.length) return uniqueValues(interpretation.coreConcepts);
  return uniqueValues(interpretation?.concepts ?? []);
}

export function semanticAdventurousConcepts(interpretation?: SemanticQueryInterpretation | null) {
  return uniqueValues(interpretation?.adventurousConcepts ?? []);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
    "associated",
    "book",
    "books",
    "but",
    "called",
    "era",
    "explore",
    "exploring",
    "for",
    "from",
    "how",
    "interest",
    "interests",
    "into",
    "key",
    "like",
    "likes",
    "looking",
    "matter",
    "more",
    "novel",
    "nonfiction",
    "period",
    "periods",
    "public",
    "recommend",
    "read",
    "reading",
    "search",
    "serious",
    "show",
    "someone",
    "something",
    "still",
    "stuff",
    "terms",
    "that",
    "the",
    "this",
    "things",
    "understand",
    "understanding",
    "under",
    "versus",
    "who",
    "with",
    "would",
    "writing",
    "why",
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
  const coreConcepts = semanticCoreConcepts(interpretation);
  const adventurousConcepts = semanticAdventurousConcepts(interpretation);
  const expandedText = [
    query,
    interpretation?.expandedQuery,
    ...coreConcepts,
    ...adventurousConcepts,
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
  const fieldBoost = fieldAwareTermScore(row, terms, termWeights, readerExperienceQuery);
  const coreConceptNeedles = uniqueNormalized([...coreConcepts, ...(interpretation?.subjects ?? [])])
    .filter((needle) => needle.length >= 4)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const adventurousConceptNeedles = uniqueNormalized(adventurousConcepts)
    .filter((needle) => needle.length >= 4)
    .filter((needle) => !readerExperienceQuery || !readerIntentLexicalStopwords.has(needle));
  const conceptNeedles = uniqueNormalized([...coreConceptNeedles, ...adventurousConceptNeedles]);
  const conceptHits = conceptNeedles.filter((needle) => rowSearch.includes(needle));
  const totalConceptWeight =
    coreConceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0) +
    adventurousConceptNeedles.reduce((sum, needle) => sum + conceptWeight(needle, termWeights) * 0.65, 0);
  const hitConceptWeight =
    coreConceptNeedles.filter((needle) => rowSearch.includes(needle)).reduce((sum, needle) => sum + conceptWeight(needle, termWeights), 0) +
    adventurousConceptNeedles.filter((needle) => rowSearch.includes(needle)).reduce((sum, needle) => sum + conceptWeight(needle, termWeights) * 0.65, 0);
  const conceptBoost = totalConceptWeight ? Math.min(1, hitConceptWeight / totalConceptWeight) : 0;
  const topicNeedles = uniqueNormalized([...(interpretation?.subjects ?? []), ...coreConcepts, ...adventurousConcepts, ...inferredSubjectNeedles(query, interpretation)])
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
  const lexicalScore = Math.min(1, keywordBoost * 0.16 + fieldBoost * 0.18 + conceptBoost * 0.16 + topicBoost * 0.12 + scopeBoost * 0.16 + periodBoost * 0.08 + phraseBoost * 0.05 + positiveReaderIntentBoost * 0.09);
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
    fieldBoost,
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
  return row.keywordBoost * 0.16 + (row.fieldBoost ?? 0) * 0.18 + row.conceptBoost * 0.16 + row.topicBoost * 0.12 + row.scopeBoost * 0.16 + row.periodBoost * 0.08 + (row.readerIntentBoost ?? 0) * 0.09;
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
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
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
  if (/\b(environment|environmental|ecology|pollution|climate|capitalism|industry|industrial|factory|agriculture|land)\b/.test(normalized)) {
    if (/\b(environment|conservation|pollution|climate|weather|disaster|agriculture|land|business|economics|cities|urban|science|nature)\b/.test(rowScope)) {
      score = Math.max(score, 0.9);
    }
  }
  if (/\b(cold war|espionage|intelligence|spy|spies|cia|fbi|soviet|russia)\b/.test(normalized)) {
    if (/\b(cold war|war|military|politics|government|europe|russia|terrorism|intelligence)\b/.test(rowScope)) score = Math.max(score, 0.92);
  }
  if (/\b(race|racism|medicine|medical|health|public health|disease|illness|cancer|care)\b/.test(normalized)) {
    if (/\b(medicine|public health|science|race|africa|african diaspora|biography|memoir|social movements)\b/.test(rowScope)) score = Math.max(score, 0.88);
  }
  if (/\b(technology|digital|data|algorithm|algorithms|ai|computing|surveillance|platform|internet|robot|robots)\b/.test(normalized)) {
    if (/\b(technology|computing|ai|science|business|economics|politics|government|rights|inequality)\b/.test(rowScope)) score = Math.max(score, 0.9);
  }
  if (/\b(empire|imperial|trade|commodity|commodities|slavery|colonial|capitalism|global)\b/.test(normalized)) {
    if (/\b(empire|colonialism|slavery|business|economics|world history|africa|diaspora|trade|politics|government)\b/.test(rowScope)) score = Math.max(score, 0.88);
  }
  if (/\b(ancient|antiquity|archaeology|archeology|rome|roman|greece|greek|egypt|mesopotamia|classical)\b/.test(normalized)) {
    if (/\b(history|ancient|archaeology|art|criticism|science|religion|world history|europe|russia)\b/.test(rowScope)) score = Math.max(score, 0.86);
  }
  return score;
}

function fieldAwareTermScore(row: SemanticBookIndexRow, terms: string[], termWeights: Map<string, number> | undefined, bodyOnly: boolean) {
  if (!terms.length) return 0;
  const fields = [
    bodyOnly ? undefined : { text: normalizeForSearch(row.title), weight: 3 },
    bodyOnly ? undefined : { text: normalizeForSearch(row.author), weight: 1.2 },
    bodyOnly ? undefined : { text: normalizeForSearch([row.primarySubject, ...row.subjects, row.primaryTopic, ...row.topics].filter(Boolean).join(" ")), weight: 2.4 },
    { text: semanticBodySearchText(row), weight: 1 },
  ].filter((field): field is { text: string; weight: number } => Boolean(field?.text));
  const totalWeight = terms.reduce((sum, term) => sum + (termWeights?.get(term) ?? 1), 0);
  if (!totalWeight) return 0;
  let score = 0;
  for (const term of terms) {
    const termWeight = termWeights?.get(term) ?? 1;
    const bestField = fields.reduce((best, field) => field.text.includes(term) ? Math.max(best, field.weight) : best, 0);
    score += termWeight * Math.min(1, bestField / 3);
  }
  return Math.min(1, score / totalWeight);
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
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
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
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
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
    if (row.readerTraits?.some((trait) => ["popular", "accessible", "narrative", "character_driven", "reported", "memoiristic"].includes(trait))) score += 0.12;
  }
  if (wantsNarrative) {
    score += (row.narrativeScore ?? 0) * 0.48;
    if (row.readerTraits?.some((trait) => ["character_driven", "biographical", "reported", "memoiristic", "narrative"].includes(trait))) score += 0.2;
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

function inferredSubjectNeedles(query: string, interpretation?: SemanticQueryInterpretation | null) {
  const normalized = normalizeForSearch([query, interpretation?.expandedQuery ?? ""].join(" "));
  const needles: string[] = [];
  if (/\b(environment|environmental|ecology|pollution|climate|capitalism|industry|industrial|factory|agriculture|land)\b/.test(normalized)) {
    needles.push("environment", "pollution", "climate", "agriculture", "business", "economics", "industry", "capitalism");
  }
  if (/\b(cold war|espionage|intelligence|spy|spies|cia|fbi|soviet|russia)\b/.test(normalized)) {
    needles.push("cold war", "espionage", "intelligence", "war", "military", "politics", "russia");
  }
  if (/\b(race|racism|medicine|medical|health|public health|disease|illness|cancer|care)\b/.test(normalized)) {
    needles.push("medicine", "public health", "race", "illness", "care", "science");
  }
  if (/\b(memoir|grief|family|illness|death|bereavement)\b/.test(normalized)) {
    needles.push("memoir", "family", "grief", "illness", "biography");
  }
  return needles;
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
    ...semanticCoreConcepts(interpretation),
    ...semanticAdventurousConcepts(interpretation),
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
