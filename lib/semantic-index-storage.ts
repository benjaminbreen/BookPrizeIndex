import fs from "node:fs/promises";
import path from "node:path";
import type { SemanticBookIndex, SemanticBookIndexRow } from "@/lib/semantic-search";

type SemanticBookIndexManifest = Omit<SemanticBookIndex, "books"> & {
  embeddingFile?: string;
  embeddingFormat?: "float32-le";
  experienceEmbeddingFile?: string;
  books: Array<Omit<SemanticBookIndexRow, "embedding" | "experienceEmbedding"> & {
    embedding?: number[];
    experienceEmbedding?: number[];
  }>;
};

export function semanticEmbeddingPath(manifestPath: string, kind: "content" | "experience" = "content") {
  const parsed = path.parse(manifestPath);
  return path.join(parsed.dir, `${parsed.name}${kind === "experience" ? ".experience" : ""}.f32`);
}

export async function readSemanticBookIndex(manifestPath: string): Promise<SemanticBookIndex> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SemanticBookIndexManifest;
  if (manifest.books.every((row) => Array.isArray(row.embedding))) {
    return manifest as SemanticBookIndex;
  }
  if (manifest.embeddingFormat !== "float32-le" || !manifest.embeddingFile) {
    throw new Error(`Semantic index ${manifestPath} does not contain embeddings or a supported binary vector file.`);
  }

  const vectorPath = path.resolve(path.dirname(manifestPath), manifest.embeddingFile);
  const bytes = await fs.readFile(vectorPath);
  const expectedBytes = manifest.books.length * manifest.dimensions * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`Semantic vector size mismatch: expected ${expectedBytes} bytes, found ${bytes.byteLength}.`);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const vectors = new Float32Array(buffer);
  let experienceVectors: Float32Array | undefined;
  if (manifest.experienceEmbeddingFile) {
    const experiencePath = path.resolve(path.dirname(manifestPath), manifest.experienceEmbeddingFile);
    const experienceBytes = await fs.readFile(experiencePath);
    if (experienceBytes.byteLength !== expectedBytes) {
      throw new Error(`Semantic experience vector size mismatch: expected ${expectedBytes} bytes, found ${experienceBytes.byteLength}.`);
    }
    const experienceBuffer = experienceBytes.buffer.slice(
      experienceBytes.byteOffset,
      experienceBytes.byteOffset + experienceBytes.byteLength,
    );
    experienceVectors = new Float32Array(experienceBuffer);
  }
  const books = manifest.books.map((row, index) => ({
    ...row,
    embedding: vectors.subarray(index * manifest.dimensions, (index + 1) * manifest.dimensions),
    experienceEmbedding: experienceVectors?.subarray(
      index * manifest.dimensions,
      (index + 1) * manifest.dimensions,
    ),
  }));
  return { ...manifest, books } as SemanticBookIndex;
}

export async function writeSemanticBookIndex(index: SemanticBookIndex, manifestPath: string) {
  const vectorPath = semanticEmbeddingPath(manifestPath);
  const bytes = Buffer.allocUnsafe(index.books.length * index.dimensions * Float32Array.BYTES_PER_ELEMENT);
  const hasExperienceVectors = index.books.every((row) => row.experienceEmbedding?.length === index.dimensions);
  const experienceVectorPath = hasExperienceVectors ? semanticEmbeddingPath(manifestPath, "experience") : undefined;
  const experienceBytes = hasExperienceVectors
    ? Buffer.allocUnsafe(index.books.length * index.dimensions * Float32Array.BYTES_PER_ELEMENT)
    : undefined;
  let offset = 0;
  let experienceOffset = 0;
  for (const row of index.books) {
    if (row.embedding.length !== index.dimensions) {
      throw new Error(`Embedding dimensions for ${row.bookId}: expected ${index.dimensions}, found ${row.embedding.length}.`);
    }
    for (const value of row.embedding) {
      bytes.writeFloatLE(value, offset);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
    if (experienceBytes && row.experienceEmbedding) {
      for (const value of row.experienceEmbedding) {
        experienceBytes.writeFloatLE(value, experienceOffset);
        experienceOffset += Float32Array.BYTES_PER_ELEMENT;
      }
    }
  }

  const manifest: SemanticBookIndexManifest = {
    generatedAt: index.generatedAt,
    embeddingModel: index.embeddingModel,
    dimensions: index.dimensions,
    inputVersion: index.inputVersion,
    vectorProfile: index.vectorProfile,
    embeddingFile: path.basename(vectorPath),
    embeddingFormat: "float32-le",
    experienceEmbeddingFile: experienceVectorPath ? path.basename(experienceVectorPath) : undefined,
    books: index.books.map(({
      contentText: _contentText,
      embedding: _embedding,
      experienceEmbedding: _experienceEmbedding,
      experienceText: _experienceText,
      ...row
    }) => row),
  };
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await Promise.all([
    fs.writeFile(vectorPath, bytes),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`),
    ...(experienceBytes && experienceVectorPath ? [fs.writeFile(experienceVectorPath, experienceBytes)] : []),
  ]);
  return vectorPath;
}
