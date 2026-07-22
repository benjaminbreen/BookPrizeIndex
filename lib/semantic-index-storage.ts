import fs from "node:fs/promises";
import path from "node:path";
import type { SemanticBookIndex, SemanticBookIndexRow } from "@/lib/semantic-search";

type SemanticBookIndexManifest = Omit<SemanticBookIndex, "books"> & {
  embeddingFile?: string;
  embeddingFormat?: "float32-le";
  books: Array<Omit<SemanticBookIndexRow, "embedding"> & { embedding?: number[] }>;
};

export function semanticEmbeddingPath(manifestPath: string) {
  const parsed = path.parse(manifestPath);
  return path.join(parsed.dir, `${parsed.name}.f32`);
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
  const books = manifest.books.map((row, index) => ({
    ...row,
    embedding: vectors.subarray(index * manifest.dimensions, (index + 1) * manifest.dimensions),
  }));
  return { ...manifest, books } as SemanticBookIndex;
}

export async function writeSemanticBookIndex(index: SemanticBookIndex, manifestPath: string) {
  const vectorPath = semanticEmbeddingPath(manifestPath);
  const bytes = Buffer.allocUnsafe(index.books.length * index.dimensions * Float32Array.BYTES_PER_ELEMENT);
  let offset = 0;
  for (const row of index.books) {
    if (row.embedding.length !== index.dimensions) {
      throw new Error(`Embedding dimensions for ${row.bookId}: expected ${index.dimensions}, found ${row.embedding.length}.`);
    }
    for (const value of row.embedding) {
      bytes.writeFloatLE(value, offset);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }

  const manifest: SemanticBookIndexManifest = {
    generatedAt: index.generatedAt,
    embeddingModel: index.embeddingModel,
    dimensions: index.dimensions,
    inputVersion: index.inputVersion,
    embeddingFile: path.basename(vectorPath),
    embeddingFormat: "float32-le",
    books: index.books.map(({ embedding: _embedding, ...row }) => row),
  };
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await Promise.all([
    fs.writeFile(vectorPath, bytes),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`),
  ]);
  return vectorPath;
}
