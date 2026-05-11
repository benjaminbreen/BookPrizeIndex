import fs from "node:fs/promises";
import path from "node:path";
import type { Award, Book, Imprint, Publisher, SourceRef } from "../../lib/types";
import { sourcesDir } from "./paths";

export type CurationFile = {
  books?: Record<string, Partial<Book>>;
  awards?: Record<string, Partial<Award>>;
  imprints?: Record<string, Partial<Imprint>>;
  publishers?: Record<string, Partial<Publisher>>;
  sources?: Record<string, SourceRef>;
};

export async function readCuration(): Promise<CurationFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "curation.json"), "utf8")) as CurationFile;
  } catch {
    return {};
  }
}

export async function readEnrichment(): Promise<CurationFile> {
  const enrichmentDir = path.join(sourcesDir, "enrichment");
  const merged: CurationFile = { books: {}, awards: {}, imprints: {}, publishers: {}, sources: {} };
  try {
    const files = await fs.readdir(enrichmentDir);
    for (const file of files.filter((item) => item.endsWith(".json") && item !== "topics.generated.json").sort()) {
      const parsed = JSON.parse(await fs.readFile(path.join(enrichmentDir, file), "utf8")) as CurationFile;
      mergeCurationRecords(merged.books!, parsed.books);
      mergeCurationRecords(merged.awards!, parsed.awards);
      mergeCurationRecords(merged.imprints!, parsed.imprints);
      mergeCurationRecords(merged.publishers!, parsed.publishers);
      Object.assign(merged.sources!, parsed.sources);
    }
  } catch {
    return {};
  }
  return merged;
}

export function mergeCurationRecords<T>(target: Record<string, Partial<T>>, incoming?: Record<string, Partial<T>>) {
  if (!incoming) return;
  for (const [id, patch] of Object.entries(incoming)) {
    target[id] = target[id] ? mergeObject(target[id], patch) : patch;
  }
}

export function applySourcePatches(sources: Map<string, SourceRef>, patches?: Record<string, SourceRef>) {
  if (!patches) return;
  for (const [id, source] of Object.entries(patches)) {
    sources.set(id, source);
  }
}

export function applyCuration<T extends { id: string }>(items: Map<string, T>, patches?: Record<string, Partial<T>>) {
  if (!patches) return;
  for (const [id, patch] of Object.entries(patches)) {
    const current = items.get(id);
    if (!current) {
      items.set(id, { id, ...patch } as T);
      continue;
    }
    items.set(id, mergeObject(current, patch));
  }
}

export function mergeObject<T>(current: T, patch: Partial<T>): T {
  const output = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = key === "sourceIds"
        ? [...new Set([...(Array.isArray(output[key]) ? output[key] as unknown[] : []), ...value])]
        : value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = { ...((output[key] as object | undefined) ?? {}), ...value };
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}
