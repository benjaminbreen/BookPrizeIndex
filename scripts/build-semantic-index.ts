import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SEMANTIC_DIMENSIONS,
  DEFAULT_SEMANTIC_EMBEDDING_MODEL,
  normalizeForSearch,
  semanticTextForBook,
  vectorNorm,
  type SemanticBookIndex,
  type SemanticBookIndexRow,
} from "../lib/semantic-search";
import type { AuthorDiscoveryFile, AuthorDiscoveryProfile, SemanticAuthorFacet } from "../lib/author-discovery";
import { readSemanticBookIndex, semanticEmbeddingPath, writeSemanticBookIndex } from "../lib/semantic-index-storage";
import { buildBrowseData } from "./build/browse-data";
import type { BrowseBookRow } from "../lib/browse-types";
import type { Award, AwardAppearance, Book, Imprint, PublicData, Publisher } from "../lib/types";

type Args = {
  budgetUsd: number;
  dimensions: number;
  dryRun: boolean;
  embeddingModel: string;
  force: boolean;
  outputPath: string;
  reportPath: string;
  limit?: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const authorDiscoveryPath = path.join(root, "sources", "enrichment", "people.generated.json");
const authorPlatformsPath = path.join(root, "sources", "author-platforms.json");
const defaultOutputPath = path.join(root, "data", "public", "book-semantic-index.json");
const defaultReportPath = path.join(root, "data", "reports", "book-semantic-index-report.json");
const INPUT_VERSION = 1;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    budgetUsd: value("budget-usd") ? Number(value("budget-usd")) : 1,
    dimensions: value("dimensions") ? Number(value("dimensions")) : DEFAULT_SEMANTIC_DIMENSIONS,
    dryRun: args.includes("--dry-run"),
    embeddingModel: value("embedding-model") ?? DEFAULT_SEMANTIC_EMBEDDING_MODEL,
    force: args.includes("--force"),
    outputPath: resolveRootPath(value("output") ?? path.relative(root, defaultOutputPath)),
    reportPath: resolveRootPath(value("report") ?? path.relative(root, defaultReportPath)),
    limit: value("limit") ? Number(value("limit")) : undefined,
  };
}

async function main() {
  await loadEnvLocal();
  const args = parseArgs();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const authorDiscovery = await readAuthorDiscovery();
  const authorProfiles = new Map(Object.entries(authorDiscovery?.profiles ?? {}));
  const curatedAuthorPlatforms = await readCuratedAuthorPlatforms();
  const existing = await readExistingIndex(args.outputPath);
  const existingByBook = new Map(
    existing?.embeddingModel === args.embeddingModel && existing.dimensions === args.dimensions && existing.inputVersion === INPUT_VERSION
      ? existing.books.map((row) => [row.bookId, row])
      : [],
  );
  const publishers = new Map(catalog.publishers.map((publisher) => [publisher.id, publisher]));
  const imprints = new Map(catalog.imprints.map((imprint) => [imprint.id, imprint]));
  const awardRows = awardsByBook(catalog.awards, catalog.appearances);
  const browseRowsByBookId = new Map(buildBrowseData(catalog).books.map((row) => [row.id, row]));
  const books = catalog.books.slice(0, args.limit ?? catalog.books.length);
  const prepared = books.map((book) => {
    const browseRow = browseRowsByBookId.get(book.id);
    if (!browseRow) throw new Error(`Missing browse row for semantic book ${book.id}.`);
    return prepareBookRow(book, publishers, imprints, awardRows.get(book.id) ?? [], browseRow, authorProfiles, curatedAuthorPlatforms);
  });
  const missing = prepared.filter((row) => {
    if (args.force) return true;
    const cached = existingByBook.get(row.bookId);
    return !cached || cached.inputHash !== row.inputHash || cached.embedding.length !== args.dimensions;
  });
  const estimatedInputTokens = missing.reduce((sum, row) => sum + estimateTokens(row.text), 0);
  const estimatedCost = costEmbedding(estimatedInputTokens, args.embeddingModel);
  if (estimatedCost > args.budgetUsd) {
    throw new Error(`Semantic index embeddings would exceed budget: $${estimatedCost.toFixed(4)} > $${args.budgetUsd}.`);
  }

  const embeddedRows = new Map<string, SemanticBookIndexRow>();
  for (const row of prepared) {
    const cached = existingByBook.get(row.bookId);
    if (!args.force && cached?.inputHash === row.inputHash && cached.embedding.length === args.dimensions) {
      embeddedRows.set(row.bookId, { ...row, embedding: cached.embedding, norm: cached.norm || vectorNorm(cached.embedding) });
    }
  }

  for (const chunk of chunks(missing, 96)) {
    const embeddings = await embedBatch(chunk.map((row) => row.text), args);
    for (const [index, row] of chunk.entries()) {
      const embedding = embeddings[index];
      embeddedRows.set(row.bookId, { ...row, embedding, norm: vectorNorm(embedding) });
    }
    console.log(`Embedded ${embeddedRows.size}/${prepared.length} semantic rows.`);
  }

  const index: SemanticBookIndex = {
    generatedAt: new Date().toISOString(),
    embeddingModel: args.embeddingModel,
    dimensions: args.dimensions,
    inputVersion: INPUT_VERSION,
    books: prepared.map((row) => {
      const embedded = embeddedRows.get(row.bookId);
      if (!embedded) throw new Error(`Missing embedding for ${row.bookId}`);
      return embedded;
    }),
  };
  const report = {
    generatedAt: index.generatedAt,
    dryRun: args.dryRun,
    embeddingModel: args.embeddingModel,
    dimensions: args.dimensions,
    inputVersion: INPUT_VERSION,
    books: prepared.length,
    embedded: missing.length,
    reused: prepared.length - missing.length,
    estimatedInputTokens,
    estimatedSpendUsd: Number(estimatedCost.toFixed(4)),
    outputPath: path.relative(root, args.outputPath),
    vectorPath: path.relative(root, semanticEmbeddingPath(args.outputPath)),
    vectorBytes: prepared.length * args.dimensions * Float32Array.BYTES_PER_ELEMENT,
  };

  await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!args.dryRun) await writeSemanticBookIndex(index, args.outputPath);
  console.log(`Semantic index ready: ${report.books} books, embedded ${report.embedded}, reused ${report.reused}, estimated spend $${report.estimatedSpendUsd}.`);
}

function prepareBookRow(
  book: Book,
  publishers: Map<string, Publisher>,
  imprints: Map<string, Imprint>,
  awards: string[],
  browseRow: BrowseBookRow,
  authorProfiles: Map<string, AuthorDiscoveryProfile>,
  curatedAuthorPlatforms: Map<string, string[]>,
): Omit<SemanticBookIndexRow, "embedding" | "norm"> {
  const publisher = book.publisherId ? publishers.get(book.publisherId)?.name : undefined;
  const imprint = book.imprintId ? imprints.get(book.imprintId)?.name : undefined;
  const authorFacets = book.authors.flatMap((author): SemanticAuthorFacet[] => {
    const profile = authorProfiles.get(author.id);
    const curatedPlatforms = curatedAuthorPlatforms.get(author.id) ?? [];
    if (!profile && !curatedPlatforms.length) return [];
    return [{
      personId: author.id,
      name: author.name,
      countries: profile?.countryConnections.map((country) => ({ code: country.countryCode, name: country.countryName })) ?? [],
      lifeStatus: profile?.lifeStatus.value ?? "unknown",
      platforms: [...new Set([
        ...(profile?.platforms.map((platform) => platform.service) ?? []),
        ...curatedPlatforms,
      ])],
    }];
  });
  const text = semanticTextForBook({ awards, authorFacets, book, imprint, publisher });
  const recognitionScore = recognitionScoreForAwards(awards);
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    authors: authorFacets,
    publicationYear: book.publicationYear,
    primarySubject: book.primarySubject,
    subjects: book.subjects,
    primaryTopic: book.primaryTopic,
    topics: book.topics,
    imprint,
    publisher,
    awards,
    readerLevel: book.readerProfile?.readerLevel,
    readerTraits: book.readerProfile?.traits.map((trait) => trait.id),
    narrativeScore: book.readerProfile?.narrativeScore,
    accessibilityScore: book.readerProfile?.accessibilityScore,
    scholarlyScore: book.readerProfile?.scholarlyScore,
    centralFigures: book.experimentalSemanticProfile?.centralFigures.map((figure) => figure.name) ?? book.centralFigures,
    centralPlaces: book.experimentalSemanticProfile?.centralPlaces.map((place) => place.name) ?? [],
    academicOrientationScore: book.experimentalSemanticProfile?.academicOrientation.score,
    academicOrientationConfidence: book.experimentalSemanticProfile?.academicOrientation.confidence,
    recognitionScore,
    text,
    searchText: normalizeForSearch(text),
    inputHash: hash(text),
    filter: {
      awardIds: browseRow.awardIds,
      publisherId: browseRow.publisherId,
      recognitionByRegion: Object.fromEntries(
        Object.entries(browseRow.recognitionByRegion ?? {}).map(([region, recognition]) => [region, {
          awardIds: recognition.awardIds,
          lists: recognition.lists,
        }]),
      ) as SemanticBookIndexRow["filter"]["recognitionByRegion"],
      hasIsbn: browseRow.hasIsbn,
      hasPageCount: browseRow.hasPageCount,
      hasCover: browseRow.hasCover,
      hasSummary: browseRow.hasSummary,
      hasPublisher: browseRow.hasPublisher,
    },
  };
}

async function readAuthorDiscovery() {
  try {
    return JSON.parse(await fs.readFile(authorDiscoveryPath, "utf8")) as AuthorDiscoveryFile;
  } catch {
    return null;
  }
}

async function readCuratedAuthorPlatforms() {
  try {
    const data = JSON.parse(await fs.readFile(authorPlatformsPath, "utf8")) as {
      profiles?: Record<string, { platforms?: Array<{ service?: string }> }>;
    };
    return new Map(Object.entries(data.profiles ?? {}).map(([personId, profile]) => [
      personId,
      [...new Set((profile.platforms ?? []).flatMap((platform) => platform.service ? [platform.service] : []))],
    ]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map<string, string[]>();
    throw error;
  }
}

function awardsByBook(awards: Award[], appearances: AwardAppearance[]) {
  const awardsById = new Map(awards.map((award) => [award.id, award]));
  const rows = new Map<string, string[]>();
  for (const appearance of [...appearances].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank)) {
    const award = awardsById.get(appearance.awardId);
    const label = [
      appearance.year,
      statusLabel(appearance.status),
      award?.shortName ?? award?.name,
      award?.categoryName,
      award?.subjectAreas?.slice(0, 2).join(", "),
    ]
      .filter(Boolean)
      .join(" ");
    if (!label) continue;
    const list = rows.get(appearance.bookId) ?? [];
    list.push(label);
    rows.set(appearance.bookId, list);
  }
  return rows;
}

function recognitionScoreForAwards(awards: string[]) {
  return awards.reduce((score, award) => {
    if (/\bwinner\b|\bco-winner\b/i.test(award)) return score + 4;
    if (/\bfinalist\b|\bshortlist\b/i.test(award)) return score + 2;
    if (/\blonglist\b/i.test(award)) return score + 1;
    return score + 0.5;
  }, 0);
}

function statusLabel(status: AwardAppearance["status"]) {
  return status.replaceAll("_", "-");
}

async function readExistingIndex(outputPath: string) {
  try {
    return await readSemanticBookIndex(outputPath);
  } catch {
    return null;
  }
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
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local env file.
    }
  }
}

async function embedBatch(input: string[], args: Args) {
  if (args.dryRun) return input.map(() => Array.from({ length: args.dimensions }, () => 0));
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to build the semantic search index.");
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

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
      if (response.ok || (response.status < 500 && response.status !== 429) || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, responseRetryDelayMs(lastResponse, attempt)));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

function responseRetryDelayMs(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  return Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 1500 * attempt;
}

function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function estimateTokens(input: string) {
  return Math.ceil(input.length / 4);
}

function costEmbedding(tokens: number, model: string) {
  return (tokens / 1_000_000) * embeddingPricePerMillion(model);
}

function embeddingPricePerMillion(model: string) {
  if (model.includes("large")) return 0.13;
  return 0.02;
}

function resolveRootPath(value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value);
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
