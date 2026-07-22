import fs from "node:fs/promises";
import path from "node:path";
import type { BookDrawerPayload } from "@/lib/book-drawer-types";
import type { SourceRef } from "@/lib/types";

export type BookDetailArtifact = BookDrawerPayload & { sources?: SourceRef[] };

const detailCache = new Map<string, Promise<BookDetailArtifact | null>>();

export function readBookDetailArtifact(bookId: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(bookId)) return Promise.resolve(null);
  const cached = detailCache.get(bookId);
  if (cached) return cached;
  const pending = fs
    .readFile(path.join(process.cwd(), "data", "public", "book-details", `${bookId}.json`), "utf8")
    .then((content) => JSON.parse(content) as BookDetailArtifact)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  detailCache.set(bookId, pending);
  return pending;
}
