import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..", "..");
export const rawAwardRecordsDir = path.join(root, "data", "raw", "award-records");

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function cleanText(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readPrizeRegistry() {
  const registryPath = path.join(root, "sources", "prizes.json");
  return JSON.parse(await fs.readFile(registryPath, "utf8")) as PrizeRegistryEntry[];
}

export async function writeRawAwardRecords(fileName: string, records: RawAwardRecord[], metadata: Record<string, unknown>) {
  await fs.mkdir(rawAwardRecordsDir, { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    metadata,
    records,
  };
  await fs.writeFile(path.join(rawAwardRecordsDir, fileName), `${JSON.stringify(output, null, 2)}\n`);
}

export async function fetchMediaWikiWikitext(pageTitle: string) {
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: pageTitle,
    rvslots: "*",
    rvprop: "content",
    format: "json",
    formatversion: "2",
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (https://example.invalid; research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`MediaWiki request failed for ${pageTitle}: ${response.status} ${response.statusText}`);
  const json = await response.json() as {
    query?: {
      pages?: Array<{
        missing?: boolean;
        revisions?: Array<{
          slots?: {
            main?: {
              content?: string;
            };
          };
        }>;
      }>;
    };
  };
  const page = json.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`MediaWiki page not found: ${pageTitle}`);
  const content = page.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error(`MediaWiki page has no wikitext content: ${pageTitle}`);
  return content;
}

export function wikiToPlainText(input: string) {
  let output = input;

  output = output.replace(/\{\{[Ss]ortname\|([^{}]+)\}\}/g, (_match, body: string) => {
    const parts = body.split("|").map((part) => part.trim()).filter(Boolean);
    const params = new Map<string, string>();
    const positional: string[] = [];
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq > 0) params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      else positional.push(part);
    }
    // Numeric-param sortname used for titles: {{sortname|1=The|2=Rest of Title|nolink=1}}
    if (params.has("1") && params.has("2")) {
      return cleanText(`${params.get("1")} ${params.get("2")}`);
    }
    const first = params.get("first") ?? positional[0] ?? "";
    const last = params.get("last") ?? positional[1] ?? "";
    return cleanText(`${first} ${last}`);
  });
  output = output.replace(/\{\{[Ss]ort\|[^|{}]+\|([^{}]+)\}\}/g, "$1");
  output = output.replace(/\{\{nowrap\|([^{}]+)\}\}/g, "$1");
  output = output.replace(/\{\{small\|([^{}]+)\}\}/g, "$1");
  output = output.replace(/\{\{efn\|[^{}]*\}\}/g, "");
  output = output.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  output = output.replace(/<ref[^/>]*\/>/g, "");
  output = output.replace(/<br\s*\/?>/gi, " ");
  output = output.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
  output = output.replace(/\[\[([^\]]+)\]\]/g, "$1");
  output = output.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  output = output.replace(/\{\{[^{}]*\}\}/g, "");
  output = output.replace(/[†‡]/g, "");
  output = output.replace(/data-sort-value="[^"]*"\s*\|/g, "");
  output = output.replace(/'{2,}/g, "");
  output = output.replace(/&ndash;/g, "-");
  output = output.replace(/&mdash;/g, "-");
  output = output.replace(/&amp;/g, "&");
  output = output.replace(/<!--[\s\S]*?-->/g, "");

  return cleanText(output);
}

export function stripCellAttributes(input: string) {
  const trimmed = input.trim();
  const pipeIndex = trimmed.indexOf("|");
  if (pipeIndex === -1) return trimmed;
  const beforePipe = trimmed.slice(0, pipeIndex);
  if (/^(?:rowspan|colspan|scope|style|class|data-sort-value|width|align)\b/i.test(beforePipe.trim())) {
    return trimmed.slice(pipeIndex + 1).trim();
  }
  return trimmed;
}

export function normalizeAuthorList(input: string) {
  return input
    .split(/\s+(?:and|&)\s+|;\s*/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

export function isLikelyTitle(value: string) {
  if (!value) return false;
  if (/^no award$/i.test(value)) return false;
  return /[a-zA-Z0-9]/.test(value);
}
