import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const root = path.resolve(__dirname, "..", "..");
export const sourcesDir = path.join(root, "sources");
/** App-consumed dataset artifacts (catalog, browse, semantic index). */
export const publicDataDir = path.join(root, "data", "public");
/** Pipeline provider caches and attempt ledgers; gitignored, safe to regenerate. */
export const cacheDataDir = path.join(root, "data", "cache");
/** Generated QA reports and review queues. */
export const reportsDataDir = path.join(root, "data", "reports");
export const rawAwardRecordsDir = path.join(root, "data", "raw", "award-records");
