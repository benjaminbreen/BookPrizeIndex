import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const root = path.resolve(__dirname, "..", "..");
export const sourcesDir = path.join(root, "sources");
export const publicDataDir = path.join(root, "data", "public");
export const rawAwardRecordsDir = path.join(root, "data", "raw", "award-records");
