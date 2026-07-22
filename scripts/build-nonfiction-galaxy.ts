import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UMAP } from "umap-js";
import type { BrowseData } from "../lib/browse-types";
import type {
  NonfictionGalaxyData,
  NonfictionGalaxyPoint,
  NonfictionGalaxySubject,
} from "../lib/nonfiction-galaxy-types";
import { vectorNorm, type SemanticBookIndex, type SemanticBookIndexRow } from "../lib/semantic-search";
import { readSemanticBookIndex } from "../lib/semantic-index-storage";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "data/public/book-semantic-index.json");
const BROWSE_PATH = path.join(ROOT, "data/public/browse.json");
const OUTPUT_PATH = path.join(ROOT, "public/fun/nonfiction-galaxy.json");
const REPORT_PATH = path.join(ROOT, "data/reports/nonfiction-galaxy-report.json");
const N_NEIGHBORS = 24;
const MIN_DIST = 0.14;
const N_EPOCHS = 350;
const RANDOM_SEED = 1729;
const QUANTILE_TRIM = 0.004;
const POINT_DATA_VERSION = 2;

async function main() {
  const force = process.argv.includes("--force");
  const [semanticIndex, browse] = await Promise.all([
    readSemanticBookIndex(INDEX_PATH),
    readJson<BrowseData>(BROWSE_PATH),
  ]);
  if (!semanticIndex.books.length) throw new Error("The semantic index contains no books.");
  if (semanticIndex.books.some((book) => book.embedding.length !== semanticIndex.dimensions)) {
    throw new Error("The semantic index contains an embedding with the wrong number of dimensions.");
  }

  const rows = [...semanticIndex.books].sort((a, b) => a.bookId.localeCompare(b.bookId));
  const sourceInputHash = semanticInputHash(rows, semanticIndex);
  const existing = await readJsonIfExists<NonfictionGalaxyData>(OUTPUT_PATH);
  const reusableProjection = !force && existing && projectionIsCurrent(existing, semanticIndex, sourceInputHash)
    ? existing
    : undefined;
  const pointDataIsCurrent = reusableProjection?.pointDataVersion === POINT_DATA_VERSION
    && reusableProjection.sourceBrowseGeneratedAt === browse.generatedAt;
  if (pointDataIsCurrent) {
    console.log(
      `Galaxy projection is current for ${reusableProjection.count.toLocaleString("en-US")} books (${sourceInputHash}); use --force to rebuild.`,
    );
    return;
  }
  const browseByBookId = new Map(browse.books.map((book) => [book.id, book]));
  let coordinates: number[][];
  if (reusableProjection) {
    const existingByBookId = new Map(reusableProjection.points.map((point) => [point.bookId, point]));
    coordinates = rows.map((row) => {
      const point = existingByBookId.get(row.bookId);
      if (!point) throw new Error(`Existing Galaxy projection is missing ${row.bookId}.`);
      return [point.x, point.y];
    });
    console.log(`Refreshing Galaxy point metadata while preserving the current UMAP projection...`);
  } else {
    const normalizedEmbeddings = rows.map(normalizedEmbedding);
    const random = mulberry32(RANDOM_SEED);
    const umap = new UMAP({
      distanceFn: cosineDistance,
      minDist: MIN_DIST,
      nComponents: 2,
      nEpochs: N_EPOCHS,
      nNeighbors: N_NEIGHBORS,
      random,
    });

    console.log(
      `Projecting ${rows.length.toLocaleString("en-US")} books from ${semanticIndex.dimensions} dimensions with UMAP...`,
    );
    const rawProjection = await umap.fitAsync(normalizedEmbeddings, (epoch) => {
      if (epoch === 0 || (epoch + 1) % 25 === 0 || epoch + 1 === N_EPOCHS) {
        console.log(`UMAP epoch ${Math.min(epoch + 1, N_EPOCHS)}/${N_EPOCHS}`);
      }
    });
    coordinates = normalizeProjection(rawProjection);
  }
  const subjectNames = subjectOrder(rows);
  const subjectIndexByName = new Map(subjectNames.map((name, index) => [name, index]));
  const points: NonfictionGalaxyPoint[] = rows.map((row, index) => {
    const browseBook = browseByBookId.get(row.bookId);
    const primarySubject = row.primarySubject || row.subjects[0] || "Unclassified";
    return {
      bookId: row.bookId,
      slug: row.slug,
      title: row.title,
      author: row.author,
      publicationYear: row.publicationYear,
      subjectIndex: subjectIndexByName.get(primarySubject) ?? subjectNames.length - 1,
      primaryTopic: row.primaryTopic,
      recognitionScore: round(row.recognitionScore, 2),
      awardCount: row.awards.length,
      isMajorWinner: (browseBook?.majorWins ?? 0) > 0,
      thumbnailUrl: browseBook?.thumbnailUrl,
      x: round(coordinates[index][0], 6),
      y: round(coordinates[index][1], 6),
    };
  });
  const subjects = subjectSummaries(subjectNames, points);
  const generatedAt = new Date().toISOString();
  const output: NonfictionGalaxyData = {
    generatedAt,
    sourceGeneratedAt: semanticIndex.generatedAt,
    sourceBrowseGeneratedAt: browse.generatedAt,
    sourceInputHash,
    pointDataVersion: POINT_DATA_VERSION,
    count: points.length,
    dimensions: semanticIndex.dimensions,
    projection: {
      algorithm: "UMAP",
      metric: "cosine",
      neighbors: N_NEIGHBORS,
      minDist: MIN_DIST,
      epochs: N_EPOCHS,
      seed: RANDOM_SEED,
    },
    subjects,
    points,
  };
  const serialized = `${JSON.stringify(output)}\n`;
  const report = {
    generatedAt,
    sourceGeneratedAt: semanticIndex.generatedAt,
    sourceInputHash,
    input: path.relative(ROOT, INDEX_PATH),
    output: path.relative(ROOT, OUTPUT_PATH),
    books: points.length,
    dimensions: semanticIndex.dimensions,
    subjects: subjects.length,
    booksWithCovers: points.filter((point) => point.thumbnailUrl).length,
    majorAwardWinners: points.filter((point) => point.isMajorWinner).length,
    outputBytes: Buffer.byteLength(serialized),
    projection: output.projection,
    note: "Placement is an unsupervised projection of semantic embeddings. Subject labels color and annotate the map but do not influence coordinates.",
  };

  await Promise.all([
    fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true }),
    fs.mkdir(path.dirname(REPORT_PATH), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(OUTPUT_PATH, serialized),
    fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`),
  ]);
  console.log(
    `Wrote ${points.length.toLocaleString("en-US")} points (${formatBytes(report.outputBytes)}) to ${path.relative(ROOT, OUTPUT_PATH)}.`,
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function projectionIsCurrent(data: NonfictionGalaxyData, index: SemanticBookIndex, sourceInputHash: string) {
  return data.sourceInputHash === sourceInputHash
    && data.count === index.books.length
    && data.dimensions === index.dimensions
    && data.projection.algorithm === "UMAP"
    && data.projection.metric === "cosine"
    && data.projection.neighbors === N_NEIGHBORS
    && data.projection.minDist === MIN_DIST
    && data.projection.epochs === N_EPOCHS
    && data.projection.seed === RANDOM_SEED;
}

function normalizedEmbedding(row: SemanticBookIndexRow) {
  const norm = row.norm || vectorNorm(row.embedding);
  if (!norm) throw new Error(`Embedding for ${row.bookId} has zero length.`);
  return Array.from(row.embedding, (value) => value / norm);
}

function cosineDistance(a: number[], b: number[]) {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return Math.max(0, Math.min(2, 1 - dot));
}

function normalizeProjection(projection: number[][]) {
  const xs = projection.map((point) => point[0]).sort((a, b) => a - b);
  const ys = projection.map((point) => point[1]).sort((a, b) => a - b);
  const minX = quantile(xs, QUANTILE_TRIM);
  const maxX = quantile(xs, 1 - QUANTILE_TRIM);
  const minY = quantile(ys, QUANTILE_TRIM);
  const maxY = quantile(ys, 1 - QUANTILE_TRIM);
  const width = Math.max(Number.EPSILON, maxX - minX);
  const height = Math.max(Number.EPSILON, maxY - minY);
  return projection.map(([x, y]) => [clamp01((x - minX) / width), clamp01((y - minY) / height)]);
}

function quantile(sorted: number[], value: number) {
  const position = (sorted.length - 1) * value;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function subjectOrder(rows: SemanticBookIndexRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const subject = row.primarySubject || row.subjects[0] || "Unclassified";
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject]) => subject);
}

function subjectSummaries(names: string[], points: NonfictionGalaxyPoint[]): NonfictionGalaxySubject[] {
  const totals = names.map(() => ({ count: 0, x: 0, y: 0 }));
  for (const point of points) {
    const total = totals[point.subjectIndex];
    total.count += 1;
    total.x += point.x;
    total.y += point.y;
  }
  return names.map((name, index) => ({
    name,
    count: totals[index].count,
    x: round(totals[index].x / Math.max(1, totals[index].count), 6),
    y: round(totals[index].y / Math.max(1, totals[index].count), 6),
  }));
}

function semanticInputHash(rows: SemanticBookIndexRow[], index: SemanticBookIndex) {
  const hash = crypto.createHash("sha256");
  hash.update(`${index.embeddingModel}:${index.dimensions}:${index.inputVersion}\n`);
  for (const row of rows) hash.update(`${row.bookId}:${row.inputHash}\n`);
  return hash.digest("hex").slice(0, 20);
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
