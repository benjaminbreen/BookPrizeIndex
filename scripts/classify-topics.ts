import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Award, AwardAppearance, Book, PublicData, TopicDefinition } from "../lib/types";

type Args = {
  limit?: number;
  llmLimit: number;
  budgetUsd: number;
  embeddingOnly: boolean;
  force: boolean;
  dryRun: boolean;
  model: string;
  embeddingModel: string;
  dimensions: number;
  minScore: number;
  minMargin: number;
  bookQuery?: string;
};

type CachedBook = {
  inputHash: string;
  embeddingModel: string;
  dimensions: number;
  embedding: number[];
};

type TopicPatch = {
  primaryTopic: string;
  topics: string[];
  confidence?: "high" | "medium" | "low";
  method?: "embedding" | "embedding+llm" | "cached";
  reviewStatus?: "generated" | "reviewed" | "rejected";
  rationale?: string;
  candidateScores?: Array<{ topic: string; score: number }>;
  inputHash?: string;
};

type BookReport = {
  bookId: string;
  title: string;
  author: string;
  inputHash: string;
  sourceTextTokensEstimate: number;
  method: "embedding" | "embedding+llm" | "cached" | "skipped";
  primaryTopic?: string;
  topics?: string[];
  confidence: "high" | "medium" | "low";
  reviewReason?: string;
  candidateScores: Array<{ topic: string; score: number }>;
  rationale?: string;
};

type GeneratedTopicsFile = {
  generatedAt: string | null;
  notes: string;
  books: Record<string, TopicPatch>;
};

type ReportFile = {
  generatedAt: string;
  dryRun: boolean;
  budgetUsd: number;
  estimatedSpendUsd: number;
  embeddingModel: string;
  llmModel: string;
  totals: {
    considered: number;
    changed: number;
    cached: number;
    embedded: number;
    llmCalls: number;
    skippedNoText: number;
    lowConfidence: number;
  };
  books: BookReport[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "public", "catalog.json");
const topicsPath = path.join(root, "sources", "topics.json");
const generatedPath = path.join(root, "sources", "enrichment", "topics.generated.json");
const cachePath = path.join(root, "data", "public", "topic-embedding-cache.json");
const reportPath = path.join(root, "data", "public", "topic-enrichment-report.json");
const qualityReportPath = path.join(root, "data", "public", "topic-quality-report.json");

const EMBEDDING_PRICE_PER_MILLION = 0.02;
const MINI_INPUT_PRICE_PER_MILLION = 0.15;
const MINI_OUTPUT_PRICE_PER_MILLION = 0.60;
const GENERIC_TOPICS = new Set(["Biography & Public Lives", "Regional & Local History", "Empire & Colonialism", "Essays & Cultural Criticism", "Science & Discovery"]);
const BIOGRAPHY_MODE_TOPICS = new Set([
  "Political Biography",
  "Presidential Biography",
  "Military Biography",
  "Literary Biography",
  "Artistic Biography",
  "Scientific Biography",
  "Business Biography",
  "Religious Biography",
  "Sports Biography",
  "Activist Biography",
  "Family Biography",
  "Group Biography",
  "Intellectual Biography",
  "Biography & Public Lives",
]);
const SUBJECT_FALLBACK_TOPICS: Record<string, string> = {
  "American History": "Regional & Local History",
  "Arts & Criticism": "Art, Music & Performance",
  Biography: "Biography & Public Lives",
  "Business & Economics": "Business, Capitalism & Corporations",
  "Gender & Sexuality": "Gender & Feminism",
  "General Nonfiction": "Essays & Cultural Criticism",
  "Journalism & Reportage": "Media, Journalism & Public Opinion",
  "Medicine & Public Health": "Medicine, Health & the Body",
  "Memoir & Autobiography": "Memoir & Personal History",
  "Nature & Environment": "Natural History & Animals",
  "Politics & Government": "American Politics",
  "Race & Ethnicity": "Civil Rights & Racial Justice",
  Religion: "Religion & Religious Movements",
  Science: "Science & Discovery",
  "Society & Culture": "Class, Poverty & Inequality",
  Sports: "Sports & Athletes",
  Technology: "Technology, Computing & AI",
  "Travel & Place": "Travel, Exploration & Place",
  "True Crime & Justice": "Crime, Policing & Violence",
  "War & Military": "War & Military Strategy",
  "World History": "Empire & Colonialism",
  History: "Regional & Local History",
};
const SUBJECT_TOPIC_ALLOWLIST: Record<string, Set<string>> = {
  "American History": new Set([
    "American Politics",
    "Democracy & Elections",
    "Presidency & Executive Power",
    "Constitutional History",
    "Law & Legal Change",
    "Courts & Trials",
    "Crime, Policing & Violence",
    "Prisons & Incarceration",
    "American Civil War",
    "World War I",
    "World War II",
    "Vietnam War",
    "Cold War & Nuclear Politics",
    "Intelligence, Secrecy & Surveillance",
    "Slavery & Emancipation",
    "Reconstruction",
    "Indigenous History",
    "Settler Colonialism",
    "Civil Rights & Racial Justice",
    "Black History & Culture",
    "Immigration, Refugees & Borderlands",
    "Migration & Diaspora",
    "Religion & Religious Movements",
    "Evangelicalism & Christian Nationalism",
    "Gender & Feminism",
    "LGBTQ History & Life",
    "Family, Childhood & Adoption",
    "Social Movements & Activism",
    "Labor, Work & Organizing",
    "Class, Poverty & Inequality",
    "Housing, Cities & Urban Life",
    "Business, Capitalism & Corporations",
    "Money, Markets & Economic Policy",
    "Food, Agriculture & Land",
    "Media, Journalism & Public Opinion",
    "Intellectual History & Ideas",
    "Art, Music & Performance",
    "Literature & Writers",
    "Education & Universities",
    "Sports & Athletes",
    "Travel, Exploration & Place",
    "Environment, Conservation & Pollution",
    "Regional & Local History",
  ]),
  "World History": new Set([
    "War & Military Strategy",
    "World War I",
    "World War II",
    "Cold War & Nuclear Politics",
    "Holocaust",
    "Genocide, Atrocity & Political Violence",
    "Empire & Colonialism",
    "Latin America & the Caribbean",
    "Europe & Russia",
    "Asia & the Pacific",
    "Middle East & North Africa",
    "Africa & the African Diaspora",
    "Settler Colonialism",
    "Migration & Diaspora",
    "Nationalism & Authoritarianism",
    "Human Rights & International Law",
  ]),
  History: new Set([
    "American Politics",
    "Democracy & Elections",
    "Presidency & Executive Power",
    "Constitutional History",
    "Law & Legal Change",
    "Courts & Trials",
    "Crime, Policing & Violence",
    "War & Military Strategy",
    "Soldiers, Veterans & Combat Experience",
    "American Civil War",
    "World War I",
    "World War II",
    "Vietnam War",
    "Cold War & Nuclear Politics",
    "Intelligence, Secrecy & Surveillance",
    "Holocaust",
    "Genocide, Atrocity & Political Violence",
    "Empire & Colonialism",
    "Slavery & Emancipation",
    "Reconstruction",
    "Indigenous History",
    "Settler Colonialism",
    "Civil Rights & Racial Justice",
    "Black History & Culture",
    "Immigration, Refugees & Borderlands",
    "Migration & Diaspora",
    "Latin America & the Caribbean",
    "Europe & Russia",
    "Asia & the Pacific",
    "Middle East & North Africa",
    "Africa & the African Diaspora",
    "Religion & Religious Movements",
    "Evangelicalism & Christian Nationalism",
    "Gender & Feminism",
    "LGBTQ History & Life",
    "Family, Childhood & Adoption",
    "Social Movements & Activism",
    "Labor, Work & Organizing",
    "Class, Poverty & Inequality",
    "Housing, Cities & Urban Life",
    "Business, Capitalism & Corporations",
    "Money, Markets & Economic Policy",
    "Food, Agriculture & Land",
    "Media, Journalism & Public Opinion",
    "Intellectual History & Ideas",
    "Literature & Writers",
    "Art, Music & Performance",
    "Education & Universities",
    "Nationalism & Authoritarianism",
    "Human Rights & International Law",
    "Travel, Exploration & Place",
    "Death, Memory & Commemoration",
    "Archives, Museums & Historical Method",
    "Regional & Local History",
  ]),
  "Politics & Government": new Set([
    "American Politics",
    "Democracy & Elections",
    "Presidency & Executive Power",
    "Constitutional History",
    "Law & Legal Change",
    "Media, Journalism & Public Opinion",
    "Nationalism & Authoritarianism",
    "Human Rights & International Law",
  ]),
  "Society & Culture": new Set([
    "Gender & Feminism",
    "LGBTQ History & Life",
    "Reproductive Rights & Family Policy",
    "Family, Childhood & Adoption",
    "Media, Journalism & Public Opinion",
    "Social Movements & Activism",
    "Class, Poverty & Inequality",
    "Housing, Cities & Urban Life",
    "Labor, Work & Organizing",
    "Education & Universities",
    "Migration & Diaspora",
  ]),
  "Journalism & Reportage": new Set([
    "Media, Journalism & Public Opinion",
    "Crime, Policing & Violence",
    "Prisons & Incarceration",
    "Class, Poverty & Inequality",
    "Housing, Cities & Urban Life",
    "Immigration, Refugees & Borderlands",
    "Human Rights & International Law",
  ]),
  Science: new Set([
    "Science & Discovery",
    "Technology, Computing & AI",
    "Infrastructure, Engineering & Built Environment",
    "Medicine, Health & the Body",
    "Disease, Epidemics & Drugs",
    "Mental Health & Psychology",
    "Disability & Difference",
    "Public Health Systems",
    "Climate, Weather & Disaster",
    "Environment, Conservation & Pollution",
    "Natural History & Animals",
    "Oceans, Rivers & Water",
    "Energy, Extraction & Resources",
    "Food, Agriculture & Land",
    "Intellectual History & Ideas",
    "Archives, Museums & Historical Method",
    "Travel, Exploration & Place",
  ]),
  "Medicine & Public Health": new Set([
    "Medicine, Health & the Body",
    "Disease, Epidemics & Drugs",
    "Mental Health & Psychology",
    "Disability & Difference",
    "Public Health Systems",
    "Drugs, Addiction & Treatment",
  ]),
  "Nature & Environment": new Set([
    "Climate, Weather & Disaster",
    "Environment, Conservation & Pollution",
    "Natural History & Animals",
    "Oceans, Rivers & Water",
    "Energy, Extraction & Resources",
    "Travel, Exploration & Place",
  ]),
  Technology: new Set([
    "Infrastructure, Engineering & Built Environment",
    "Technology, Computing & AI",
    "Science & Discovery",
    "Business, Capitalism & Corporations",
  ]),
  "Business & Economics": new Set([
    "Business, Capitalism & Corporations",
    "Money, Markets & Economic Policy",
    "Labor, Work & Organizing",
    "Energy, Extraction & Resources",
    "Food, Agriculture & Land",
  ]),
  "Arts & Criticism": new Set([
    "Intellectual History & Ideas",
    "Literature & Writers",
    "Art, Music & Performance",
    "Film, Television & Popular Culture",
    "Media, Journalism & Public Opinion",
    "Essays & Cultural Criticism",
  ]),
  Religion: new Set(["Religion & Religious Movements", "Evangelicalism & Christian Nationalism", "Intellectual History & Ideas"]),
  "War & Military": new Set([
    "War & Military Strategy",
    "Soldiers, Veterans & Combat Experience",
    "American Civil War",
    "World War I",
    "World War II",
    "Vietnam War",
    "Cold War & Nuclear Politics",
    "Intelligence, Secrecy & Surveillance",
  ]),
  "Race & Ethnicity": new Set([
    "Slavery & Emancipation",
    "Reconstruction",
    "Indigenous History",
    "Civil Rights & Racial Justice",
    "Black History & Culture",
    "Immigration, Refugees & Borderlands",
    "Africa & the African Diaspora",
    "Settler Colonialism",
    "Migration & Diaspora",
  ]),
  "Gender & Sexuality": new Set(["Gender & Feminism", "LGBTQ History & Life", "Reproductive Rights & Family Policy", "Family, Childhood & Adoption"]),
  "Travel & Place": new Set(["Travel, Exploration & Place", "Regional & Local History", "Oceans, Rivers & Water", "Natural History & Animals"]),
  Sports: new Set(["Sports & Athletes"]),
  "True Crime & Justice": new Set(["Crime, Policing & Violence", "Prisons & Incarceration", "Courts & Trials", "Law & Legal Change"]),
};
const BROAD_SUBJECTS = new Set(["American History", "World History", "History"]);

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    limit: value("limit") ? Number(value("limit")) : undefined,
    llmLimit: value("llm-limit") ? Number(value("llm-limit")) : 200,
    budgetUsd: value("budget-usd") ? Number(value("budget-usd")) : 1,
    embeddingOnly: args.includes("--embedding-only"),
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    model: value("model") ?? "gpt-4o-mini",
    embeddingModel: value("embedding-model") ?? "text-embedding-3-small",
    dimensions: value("dimensions") ? Number(value("dimensions")) : 512,
    minScore: value("min-score") ? Number(value("min-score")) : 0.28,
    minMargin: value("min-margin") ? Number(value("min-margin")) : 0.035,
    bookQuery: value("book-query")?.toLowerCase(),
  };
}

async function main() {
  await loadEnvLocal();
  const args = parseArgs();
  const data = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const topics = JSON.parse(await fs.readFile(topicsPath, "utf8")) as TopicDefinition[];
  const generated = await readGeneratedTopics();
  const cache = await readCache();
  let estimatedSpendUsd = estimateMissingTopicEmbeddingCost(topics, args, cache);
  if (estimatedSpendUsd > args.budgetUsd) {
    throw new Error(`Topic definition embeddings would exceed budget before classifying books: $${estimatedSpendUsd.toFixed(4)} > $${args.budgetUsd}.`);
  }
  const topicVectors = await embedTopics(topics, args, cache);
  const topicDefinitions = new Map(topics.map((topic) => [topic.name, topicText(topic)]));
  const awardText = awardsByBook(data.appearances, data.awards);
  const books = data.books
    .filter((book) => classificationText(book, awardText.get(book.id) ?? "").length >= 40)
    .filter((book) => !args.bookQuery || [book.title, book.subtitle, ...book.authors.map((author) => author.name)].filter(Boolean).join(" ").toLowerCase().includes(args.bookQuery))
    .filter((book) => args.force || !generated.books[book.id])
    .slice(0, args.limit ?? data.books.length);
  const bookInputs = books.map((book) => {
    const text = classificationText(book, awardText.get(book.id) ?? "");
    return { book, text, inputHash: hash(text), tokenEstimate: estimateTokens(text) };
  });
  const missingEmbeddings = bookInputs.filter(({ book, inputHash }) => {
    const cached = cache.books[book.id];
    return !cached || cached.inputHash !== inputHash || cached.embeddingModel !== args.embeddingModel || cached.dimensions !== args.dimensions;
  });
  const embeddedBookIds = new Set(missingEmbeddings.map((item) => item.book.id));
  const missingEmbeddingCost = missingEmbeddings.reduce((sum, item) => sum + costEmbedding(item.tokenEstimate), 0);
  if (estimatedSpendUsd + missingEmbeddingCost > args.budgetUsd) {
    throw new Error(`Book embeddings would exceed budget: $${(estimatedSpendUsd + missingEmbeddingCost).toFixed(4)} > $${args.budgetUsd}.`);
  }
  for (const chunk of chunks(missingEmbeddings, 96)) {
    const embeddings = await embedBatch(chunk.map((item) => item.text), args);
    for (const [index, item] of chunk.entries()) {
      cache.books[item.book.id] = {
        inputHash: item.inputHash,
        embeddingModel: args.embeddingModel,
        dimensions: args.dimensions,
        embedding: embeddings[index],
      };
    }
  }
  estimatedSpendUsd += missingEmbeddingCost;

  let llmCalls = 0;
  let embedded = missingEmbeddings.length;
  let cached = bookInputs.length - missingEmbeddings.length;
  let skippedNoText = 0;
  let changed = 0;
  const reportRows: BookReport[] = [];
  const patches: Record<string, TopicPatch> = { ...generated.books };

  const totalBooks = bookInputs.length;
  console.log(`Classifying ${totalBooks} books (llm-limit=${args.llmLimit}, budget=$${args.budgetUsd}).`);
  let processed = 0;
  for (const { book, text, inputHash, tokenEstimate } of bookInputs) {
    processed += 1;
    if (processed % 25 === 0 || processed === totalBooks) {
      console.log(`  [${processed}/${totalBooks}] llmCalls=${llmCalls} spend=$${estimatedSpendUsd.toFixed(3)}`);
    }
    if (!text.trim()) {
      skippedNoText += 1;
      continue;
    }
    const bookVector = cache.books[book.id];
    if (!bookVector) continue;

    const candidates = rankTopics(bookVector.embedding, topicVectors, 12, book);
    const best = candidates[0];
    const second = candidates[1];
    const shouldReviewWithLlm = Boolean(
      best &&
      (GENERIC_TOPICS.has(best.topic) ||
        hasMultipleBiographyModeCandidates(candidates.slice(0, 5)) ||
        (!second || best.score - second.score < args.minMargin))
    );
    const autoAccept = Boolean(
      best &&
        best.score >= args.minScore &&
        (!second || best.score - second.score >= args.minMargin) &&
        !GENERIC_TOPICS.has(best.topic) &&
        !shouldReviewWithLlm
    );
    let patch: TopicPatch | undefined;
    let method: BookReport["method"] = embeddedBookIds.has(book.id) ? "embedding" : "cached";
    let confidence: BookReport["confidence"] = autoAccept ? "high" : "medium";
    let rationale: string | undefined;

    if (autoAccept || args.embeddingOnly || llmCalls >= args.llmLimit || !process.env.OPENAI_API_KEY) {
      patch = embeddingPatch(candidates, book, args);
      confidence = autoAccept ? "high" : "medium";
    } else {
      const llmTokenEstimate = estimateTokens(text) + 900;
      estimatedSpendUsd += costMini(llmTokenEstimate, 180);
      if (estimatedSpendUsd > args.budgetUsd) break;
      try {
        const selected = await selectTopicsWithLlm({ book, text, candidates, args, topicDefinitions });
        patch = selected.patch;
        confidence = selected.confidence;
        rationale = selected.rationale;
        method = "embedding+llm";
        llmCalls += 1;
      } catch (error) {
        patch = embeddingPatch(candidates, book, args);
        confidence = "medium";
        rationale = `LLM adjudication failed; used embedding-ranked candidates. ${error instanceof Error ? error.message.slice(0, 160) : ""}`.trim();
      }
    }

    if (patch?.primaryTopic) {
      patch = normalizeTopicPatch(patch, book, candidates, args);
      patches[book.id] = {
        ...patch,
        confidence,
        method: method === "cached" ? "embedding" : method,
        reviewStatus: "generated",
        rationale,
        candidateScores: candidates.slice(0, 8),
        inputHash,
      };
      changed += 1;
    }

    reportRows.push({
      bookId: book.id,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      inputHash,
      sourceTextTokensEstimate: tokenEstimate,
      method,
      primaryTopic: patch?.primaryTopic,
      topics: patch?.topics,
      confidence,
      reviewReason: confidence === "low" ? "Low confidence generated topic classification." : undefined,
      candidateScores: candidates.slice(0, 8),
      rationale,
    });
  }

  const generatedOut: GeneratedTopicsFile = {
    generatedAt: new Date().toISOString(),
    notes: "Generated topic patches from scripts/classify-topics.ts. Manual topic corrections belong in sources/curation.json and override this file.",
    books: sortObject(normalizeGeneratedPatches(patches, data.books, args)),
  };
  const qualityReport = buildQualityReport(generatedOut.books, data.books);
  const report: ReportFile = {
    generatedAt: generatedOut.generatedAt!,
    dryRun: args.dryRun,
    budgetUsd: args.budgetUsd,
    estimatedSpendUsd: Number(estimatedSpendUsd.toFixed(4)),
    embeddingModel: args.embeddingModel,
    llmModel: args.embeddingOnly ? "none" : args.model,
    totals: {
      considered: books.length,
      changed,
      cached,
      embedded,
      llmCalls,
      skippedNoText,
      lowConfidence: reportRows.filter((row) => row.confidence === "low").length,
    },
    books: reportRows,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(qualityReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  if (!args.dryRun) await fs.writeFile(generatedPath, `${JSON.stringify(generatedOut, null, 2)}\n`);
  console.log(`Topic classification considered ${books.length} books, wrote ${changed} patches, estimated spend $${report.estimatedSpendUsd}.`);
}

async function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
        process.env[key] = value;
      }
    } catch {
      // Optional local env file.
    }
  }
}

async function readGeneratedTopics(): Promise<GeneratedTopicsFile> {
  try {
    return JSON.parse(await fs.readFile(generatedPath, "utf8")) as GeneratedTopicsFile;
  } catch {
    return { generatedAt: null, notes: "", books: {} };
  }
}

async function readCache(): Promise<{ topics: Record<string, CachedBook>; books: Record<string, CachedBook> }> {
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return { topics: {}, books: {} };
  }
}

async function embedTopics(topics: TopicDefinition[], args: Args, cache: { topics: Record<string, CachedBook> }) {
  const missing: Array<{ topic: TopicDefinition; text: string; inputHash: string }> = [];
  for (const topic of topics) {
    const text = topicText(topic);
    const inputHash = hash(text);
    const cached = cache.topics[topic.name];
    if (cached?.inputHash === inputHash && cached.embeddingModel === args.embeddingModel && cached.dimensions === args.dimensions) {
      continue;
    }
    missing.push({ topic, text, inputHash });
  }
  for (const chunk of chunks(missing, 96)) {
    const embeddings = await embedBatch(chunk.map((item) => item.text), args);
    for (const [index, item] of chunk.entries()) {
      cache.topics[item.topic.name] = {
        inputHash: item.inputHash,
        embeddingModel: args.embeddingModel,
        dimensions: args.dimensions,
        embedding: embeddings[index],
      };
    }
  }
  return topics
    .map((topic) => ({ topic: topic.name, embedding: cache.topics[topic.name]?.embedding }))
    .filter((row): row is { topic: string; embedding: number[] } => Array.isArray(row.embedding));
}

async function embed(input: string, args: Args) {
  return (await embedBatch([input], args))[0];
}

async function embedBatch(input: string[], args: Args) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for topic embeddings. Use existing cache or set the key before running topics:classify.");
  }
  const response = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: args.embeddingModel,
      input,
      dimensions: args.dimensions,
      encoding_format: "float",
    }),
  });
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  return json.data.map((item) => item.embedding);
}

async function selectTopicsWithLlm({
  book,
  text,
  candidates,
  args,
  topicDefinitions,
}: {
  book: Book;
  text: string;
  candidates: Array<{ topic: string; score: number }>;
  args: Args;
  topicDefinitions: Map<string, string>;
}) {
  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        {
          role: "system",
          content:
            "Choose nonfiction book topics from the provided candidate list only. Use the definitions to distinguish nearby categories. Prefer one precise primary topic and only strong secondary topics. Use Presidential Biography only for actual presidents, prime ministers, heads of state, first families, or books centrally about presidential power. Return compact JSON with primaryTopic, topics, confidence, and rationale. Do not invent topics.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: book.title,
            authors: book.authors.map((author) => author.name),
            primarySubject: book.primarySubject,
            text,
            candidates: candidates.map((candidate) => ({
              topic: candidate.topic,
              definition: topicDefinitions.get(candidate.topic) ?? candidate.topic,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "topic_selection",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              primaryTopic: { type: "string" },
              topics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string" },
            },
            required: ["primaryTopic", "topics", "confidence", "rationale"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`LLM topic selection failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const textOut = json.output_text ?? json.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
  const parsed = JSON.parse(textOut) as { primaryTopic: string; topics: string[]; confidence: "high" | "medium" | "low"; rationale: string };
  const allowed = new Set(candidates.map((candidate) => candidate.topic));
  const topics = [parsed.primaryTopic, ...parsed.topics].filter((topic, index, list) => allowed.has(topic) && list.indexOf(topic) === index).slice(0, 4);
  return {
    patch: normalizeTopicPatch(
      { primaryTopic: topics[0] ?? candidates[0].topic, topics: topics.length ? topics : candidates.slice(0, 4).map((candidate) => candidate.topic) },
      book,
      candidates,
      args
    ),
    confidence: parsed.confidence,
    rationale: parsed.rationale,
  };
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  const timeoutMs = Number(process.env.CLASSIFY_FETCH_TIMEOUT_MS ?? 60000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (isTimeout) console.warn(`  [fetch timeout after ${timeoutMs}ms on attempt ${attempt}/${attempts}]`);
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

function embeddingPatch(candidates: Array<{ topic: string; score: number }>, book: Book, args: Args): TopicPatch {
  const best = candidates.find((candidate) => !GENERIC_TOPICS.has(candidate.topic)) ?? candidates[0];
  const selected = candidates.filter((candidate) => {
    if (!best) return false;
    if (GENERIC_TOPICS.has(candidate.topic) && candidate.topic !== best.topic) return false;
    if (candidate.score < args.minScore) return false;
    return best.score - candidate.score <= args.minMargin + 0.02;
  });
  const topics = (selected.length ? selected : best ? [best] : candidates.slice(0, 1)).map((candidate) => candidate.topic);
  return normalizeTopicPatch({ primaryTopic: topics[0], topics }, book, candidates, args);
}

function rankTopics(embedding: number[], topics: Array<{ topic: string; embedding: number[] }>, limit: number, book: Book) {
  return topics
    .filter((topic) => subjectAllowsTopic(topic.topic, book))
    .map((topic) => ({ topic: topic.topic, score: Number(cosine(embedding, topic.embedding).toFixed(4)) }))
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}

function allowedTopicForBook(topic: string, book: Book) {
  if (!BIOGRAPHY_MODE_TOPICS.has(topic)) return true;
  if (book.primarySubject !== "Biography") return false;
  return true;
}

function subjectAllowsTopic(topic: string, book: Book) {
  if (!allowedTopicForBook(topic, book)) return false;
  if (book.primarySubject === "Biography" || book.primarySubject === "Memoir & Autobiography") return true;
  if (BROAD_SUBJECTS.has(book.primarySubject ?? "")) return true;
  const allowlist = SUBJECT_TOPIC_ALLOWLIST[book.primarySubject ?? ""];
  return !allowlist || allowlist.has(topic);
}

function normalizeGeneratedPatches(patches: Record<string, TopicPatch>, books: Book[], args: Args) {
  const booksById = new Map(books.map((book) => [book.id, book]));
  const normalized: Record<string, TopicPatch> = {};
  for (const [bookId, patch] of Object.entries(patches)) {
    const book = booksById.get(bookId);
    if (!book) {
      normalized[bookId] = patch;
      continue;
    }
    normalized[bookId] = normalizeTopicPatch(patch, book, patch.candidateScores ?? [], args);
  }
  return normalized;
}

function normalizeTopicPatch(patch: TopicPatch, book: Book, candidates: Array<{ topic: string; score: number }>, args: Args): TopicPatch {
  const candidateTopics = candidates.map((candidate) => candidate.topic);
  const fallbackTopic = SUBJECT_FALLBACK_TOPICS[book.primarySubject ?? ""] ?? "Essays & Cultural Criticism";
  const ordered = uniqueTopics([
    patch.primaryTopic,
    ...(patch.topics ?? []),
    ...candidateTopics.filter((topic) => !GENERIC_TOPICS.has(topic)),
    fallbackTopic,
  ]);
  let topics = ordered.filter((topic) => subjectAllowsTopic(topic, book));
  const nonGeneric = topics.filter((topic) => !GENERIC_TOPICS.has(topic));
  if (nonGeneric.length) topics = nonGeneric;

  if (book.primarySubject === "Biography") {
    const firstBiographyModeTopic = topics.find((topic) => BIOGRAPHY_MODE_TOPICS.has(topic));
    topics = topics.filter((topic) => !BIOGRAPHY_MODE_TOPICS.has(topic) || topic === firstBiographyModeTopic);
  } else {
    topics = topics.filter((topic) => !BIOGRAPHY_MODE_TOPICS.has(topic));
  }

  if (!topics.length) topics = [fallbackTopic];
  const rankedTopics = topics.slice(0, patch.method === "embedding+llm" ? 4 : 3);
  const scored = new Map(candidates.map((candidate) => [candidate.topic, candidate.score]));
  const primaryTopic = choosePrimaryTopic(rankedTopics, scored, book, args);
  const finalTopics = uniqueTopics([primaryTopic, ...rankedTopics]).slice(0, patch.method === "embedding+llm" ? 4 : 3);
  return {
    ...patch,
    primaryTopic,
    topics: finalTopics,
  };
}

function choosePrimaryTopic(topics: string[], scores: Map<string, number>, book: Book, args: Args) {
  if (!topics.length) return SUBJECT_FALLBACK_TOPICS[book.primarySubject ?? ""] ?? "Essays & Cultural Criticism";
  const allowed = topics.filter((topic) => subjectAllowsTopic(topic, book));
  const pool = allowed.length ? allowed : topics;
  return [...pool].sort((a, b) => {
    const aScore = scores.get(a);
    const bScore = scores.get(b);
    if (aScore === undefined && bScore === undefined) return 0;
    return (bScore ?? args.minScore) - (aScore ?? args.minScore) || a.localeCompare(b);
  })[0];
}

function hasMultipleBiographyModeCandidates(candidates: Array<{ topic: string; score: number }>) {
  return candidates.filter((candidate) => BIOGRAPHY_MODE_TOPICS.has(candidate.topic)).length > 1;
}

function uniqueTopics(topics: Array<string | undefined>) {
  return topics.filter((topic, index, list): topic is string => Boolean(topic) && list.indexOf(topic) === index);
}

function buildQualityReport(patches: Record<string, TopicPatch>, books: Book[]) {
  const rows = books.flatMap((book) => {
    const patch = patches[book.id];
    if (!patch) return [];
    const biographyTopics = patch.topics.filter((topic) => BIOGRAPHY_MODE_TOPICS.has(topic));
    const reasons = [
      book.primarySubject !== "Biography" && biographyTopics.length ? "biography_topic_outside_biography_subject" : "",
      biographyTopics.length > 1 ? "multiple_biography_mode_topics" : "",
      GENERIC_TOPICS.has(patch.primaryTopic) ? "generic_primary_topic" : "",
      patch.topics.some((topic) => !subjectAllowsTopic(topic, book)) ? "topic_outside_subject_allowlist" : "",
      patch.topics.length > 3 && patch.method !== "embedding+llm" ? "too_many_embedding_topics" : "",
    ].filter(Boolean);
    if (!reasons.length) return [];
    return [{
      bookId: book.id,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      primarySubject: book.primarySubject,
      primaryTopic: patch.primaryTopic,
      topics: patch.topics,
      reasons,
    }];
  });
  const totalsByReason = rows.reduce<Record<string, number>>((totals, row) => {
    for (const reason of row.reasons) totals[reason] = (totals[reason] ?? 0) + 1;
    return totals;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    notes: "Flags suspicious generated topic assignments after classifier normalization. Curated overrides should live in sources/curation.json.",
    totals: {
      flaggedBooks: rows.length,
      byReason: sortObject(totalsByReason),
    },
    books: rows.slice(0, 250),
  };
}

function classificationText(book: Book, awards: string) {
  return [
    `Title: ${book.title}`,
    book.subtitle ? `Subtitle: ${book.subtitle}` : "",
    `Authors: ${book.authors.map((author) => author.name).join(", ")}`,
    book.publicationYear ? `Publication year: ${book.publicationYear}` : "",
    book.primarySubject ? `Primary subject: ${book.primarySubject}` : "",
    book.subjects.length ? `Subjects: ${book.subjects.join(", ")}` : "",
    book.subjectCategories?.length ? `Catalog subject labels: ${book.subjectCategories.map((category) => category.label).join("; ")}` : "",
    book.centralFigures.length ? `Central figures: ${book.centralFigures.join(", ")}` : "",
    awards ? `Award categories: ${awards}` : "",
    book.summary ? `Description: ${book.summary.slice(0, 1800)}` : "",
  ].filter(Boolean).join("\n");
}

function awardsByBook(appearances: AwardAppearance[], awards: Award[]) {
  const awardsById = new Map(awards.map((award) => [award.id, award]));
  const map = new Map<string, Set<string>>();
  for (const appearance of appearances) {
    const award = awardsById.get(appearance.awardId);
    if (!award) continue;
    const values = map.get(appearance.bookId) ?? new Set<string>();
    values.add([award.name, award.subjectAreas.join(", ")].filter(Boolean).join(" / "));
    map.set(appearance.bookId, values);
  }
  return new Map([...map.entries()].map(([bookId, values]) => [bookId, [...values].join("; ")]));
}

function topicText(topic: TopicDefinition) {
  return [`Topic: ${topic.name}`, `Definition: ${topic.description}`, topicExamples(topic.name)].filter(Boolean).join("\n");
}

function topicExamples(topic: string) {
  const examples: Record<string, string> = {
    "American Civil War": "Examples: Civil War, Abraham Lincoln, Ulysses S. Grant, Robert E. Lee, Gettysburg, Appomattox, Confederacy, Union Army.",
    "World War I": "Examples: First World War, Great War, 1914, 1918, trenches, Versailles, Woodrow Wilson and wartime diplomacy.",
    "World War II": "Examples: World War II, Second World War, Nazi Germany, Hitler, Pearl Harbor, D-Day, Manhattan Project, Oppenheimer, oral histories of wartime experience.",
    "Vietnam War": "Examples: Vietnam War, John Paul Vann, Hanoi, Saigon, Hue 1968, U.S. intervention in Vietnam, Indochina.",
    Holocaust: "Examples: Holocaust, Shoah, Auschwitz, Nazi genocide, Jewish survivors, memory of genocide.",
    Reconstruction: "Examples: Reconstruction, freedpeople, Freedmen's Bureau, Black officeholding, post-Civil War South.",
    "Political Biography": "Examples: biographies of senators, governors, diplomats, cabinet members, political advisers, activists in government, Walter Lippmann as public political figure.",
    "Presidential Biography": "Examples: biographies of presidents and heads of state: Lincoln, Washington, Jefferson, Roosevelt, Kennedy, Nixon, Reagan, Obama.",
    "Military Biography": "Examples: biographies of soldiers, generals, officers, strategists, veterans, John Paul Vann, wartime leaders; not general oral histories of wars.",
    "Literary Biography": "Examples: biographies of writers, poets, editors, literary critics, Orwell, Virginia Woolf, James Baldwin, Shakespeare.",
    "Artistic Biography": "Examples: biographies of painters, musicians, composers, actors, performers, Picasso, Dolly Parton, dancers, filmmakers.",
    "Scientific Biography": "Examples: biographies of scientists, inventors, physicians, physicists, mathematicians, Einstein, Oppenheimer, Darwin, scientific lives.",
    "Business Biography": "Examples: biographies of entrepreneurs, financiers, executives, industrialists, corporate leaders; business lives rather than business history.",
    "Religious Biography": "Examples: biographies of clergy, theologians, rabbis, priests, pastors, spiritual leaders, religious reformers.",
    "Sports Biography": "Examples: biographies of athletes, coaches, Olympians, boxers, baseball players, Muhammad Ali.",
    "Activist Biography": "Examples: biographies of activists, organizers, abolitionists, civil rights leaders, Malcolm X, Frederick Douglass, Martin Luther King Jr.",
    "Family Biography": "Examples: family histories and biographies of families, dynasties, kinship networks, The Hemingses of Monticello.",
    "Group Biography": "Examples: collective biography, group lives, linked lives of multiple people, generations, circles, cohorts.",
    "Intellectual Biography": "Examples: biographies of thinkers, philosophers, public intellectuals, journalists, theorists, Walter Lippmann, lives of ideas.",
    "Cold War & Nuclear Politics": "Examples: Cold War, Soviet Union, nuclear weapons, arms race, deterrence, Chernobyl, Oppenheimer's nuclear legacy.",
    "Science & Discovery": "Examples: scientific discovery, physics, biology, astronomy, genetics, scientific method, history of science.",
    "War & Military Strategy": "Examples: battles, campaigns, strategy, military institutions, war planning, armed conflict, military history.",
  };
  return examples[topic] ? `Seed examples: ${examples[topic]}` : "";
}

function estimateMissingTopicEmbeddingCost(topics: TopicDefinition[], args: Args, cache: { topics: Record<string, CachedBook> }) {
  let cost = 0;
  for (const topic of topics) {
    const text = topicText(topic);
    const inputHash = hash(text);
    const cached = cache.topics[topic.name];
    if (cached?.inputHash === inputHash && cached.embeddingModel === args.embeddingModel && cached.dimensions === args.dimensions) continue;
    cost += costEmbedding(estimateTokens(text));
  }
  return cost;
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function estimateTokens(input: string) {
  return Math.ceil(input.length / 4);
}

function costEmbedding(tokens: number) {
  return (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION;
}

function costMini(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * MINI_INPUT_PRICE_PER_MILLION + (outputTokens / 1_000_000) * MINI_OUTPUT_PRICE_PER_MILLION;
}

function sortObject<T>(value: Record<string, T>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
