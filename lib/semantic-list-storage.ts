import "server-only";

import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getBlobStorageAccess,
  hasBlobStorageCredentials,
} from "@/lib/blob-storage-config";
import {
  isSemanticListSnapshot,
  type SemanticListSnapshot,
} from "@/lib/semantic-list";

const BLOB_PREFIX = "semantic-lists/v1";
const IMMUTABLE_CACHE_SECONDS = 31_536_000;

export async function readSharedSemanticList(id: string): Promise<SemanticListSnapshot | null> {
  if (!validId(id)) return null;
  if (usesBlobStorage()) {
    const result = await get(blobPath(id), { access: getBlobStorageAccess() });
    if (!result || result.statusCode !== 200) return null;
    const parsed = await new Response(result.stream).json().catch(() => null);
    return isSemanticListSnapshot(parsed) ? parsed : null;
  }
  if (isVercelRuntime()) return null;
  const parsed = await readFile(localPath(id), "utf8").then(JSON.parse).catch(() => null);
  return isSemanticListSnapshot(parsed) ? parsed : null;
}

export async function writeSharedSemanticList(snapshot: SemanticListSnapshot) {
  const existing = await readSharedSemanticList(snapshot.id);
  if (existing) return { snapshot: existing, created: false };

  if (usesBlobStorage()) {
    await put(blobPath(snapshot.id), JSON.stringify(snapshot), {
      access: getBlobStorageAccess(),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: IMMUTABLE_CACHE_SECONDS,
      contentType: "application/json; charset=utf-8",
    });
    return { snapshot, created: true };
  }
  if (isVercelRuntime()) {
    throw new Error("Shared-list storage is not configured. Connect a Vercel Blob store to this project.");
  }
  await mkdir(localDirectory(), { recursive: true });
  await writeFile(localPath(snapshot.id), JSON.stringify(snapshot, null, 2), { encoding: "utf8", flag: "wx" })
    .catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  return { snapshot: await readSharedSemanticList(snapshot.id) ?? snapshot, created: true };
}

export function semanticListStorageConfigured() {
  return usesBlobStorage() || !isVercelRuntime();
}

function usesBlobStorage() {
  return hasBlobStorageCredentials();
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function blobPath(id: string) {
  return `${BLOB_PREFIX}/${id}.json`;
}

function localDirectory() {
  return path.join(process.cwd(), ".semantic-lists");
}

function localPath(id: string) {
  return path.join(localDirectory(), `${id}.json`);
}

function validId(id: string) {
  return /^[A-Za-z0-9_-]{22}$/.test(id);
}
