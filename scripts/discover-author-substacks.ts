import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorDiscoveryFile } from "../lib/author-discovery";
import type { BookStats, PublicData } from "../lib/types";

type RankedAuthor = { personId: string; name: string; rank: number; recognitionScore: number; bookCount: number };
type SitemapEntry = { authorName: string; publicationTitle: string; publicationUrl: string };
type SitemapPage = { start: string; url: string };
type CacheFile = { generatedAt: string; sitemapPages?: SitemapPage[]; pages: Record<string, { fetchedAt: string; entries: SitemapEntry[] }> };
type CuratedPlatforms = { profiles?: Record<string, { platforms?: Array<{ service?: string }> }> };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const peoplePath = path.join(root, "sources", "enrichment", "people.generated.json");
const curatedPlatformsPath = path.join(root, "sources", "author-platforms.json");
const cachePath = path.join(root, "data", "cache", "substack-author-sitemap-cache.json");
const reportPath = path.join(root, "data", "reports", "author-substack-discovery-report.json");
const reviewPath = path.join(root, "data", "reports", "author-substack-review.json");
const userAgent = "BookPrizeIndex/1.0 (public-author-platform discovery; https://github.com/benjaminbreen/BookPrizeIndex)";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const generatedAt = new Date().toISOString();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const people = JSON.parse(await fs.readFile(peoplePath, "utf8")) as AuthorDiscoveryFile;
  const curatedPlatforms = JSON.parse(await fs.readFile(curatedPlatformsPath, "utf8")) as CuratedPlatforms;
  const authors = rankAuthors(catalog).slice(0, args.limit);
  const cache = await readCache();
  const hasCachedIndex = cache.sitemapPages?.some((page) => Boolean(page.start)) ?? false;
  const sitemapPages = args.offline
    ? hasCachedIndex ? cache.sitemapPages! : Object.keys(cache.pages).map((url) => ({ start: "", url }))
    : args.refresh || !hasCachedIndex
      ? parseSitemapIndex(await fetchText("https://substack.com/sitemap"))
      : cache.sitemapPages!;
  if (!args.offline || hasCachedIndex) cache.sitemapPages = sitemapPages;
  if (!sitemapPages.length) throw new Error("Substack sitemap index contained no author pages.");
  const requestedPages = hasCachedIndex ? selectRelevantPages(authors, sitemapPages) : sitemapPages;
  const relevantPages = args.offline ? requestedPages.filter((page) => cache.pages[page.url]) : requestedPages;
  const pagesToFetch = args.offline
    ? []
    : relevantPages.filter((page) => args.refresh || !cache.pages[page.url]).slice(0, args.pageLimit);
  let rateLimited = false;
  const failures: Array<{ url: string; error: string }> = [];

  await mapConcurrent(pagesToFetch, args.concurrency, async (page, index) => {
    if (rateLimited) return;
    try {
      const html = await fetchText(page.url);
      cache.pages[page.url] = { fetchedAt: new Date().toISOString(), entries: parsePublicationPage(html) };
      await writeJson(cachePath, { ...cache, generatedAt: new Date().toISOString() });
      await wait(args.requestDelayMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ url: page.url, error: message });
      if (error instanceof RateLimitError) rateLimited = true;
      return;
    }
    if (!args.offline && (index + 1) % args.checkpointEvery === 0) {
      cache.generatedAt = new Date().toISOString();
      await writeJson(cachePath, cache);
      console.log(`Fetched ${index + 1}/${pagesToFetch.length} Substack sitemap pages in this batch.`);
    }
  });
  if (!args.offline) {
    cache.generatedAt = generatedAt;
    await writeJson(cachePath, cache);
  }

  const entries = relevantPages.flatMap((page) => cache.pages[page.url]?.entries ?? []);
  const entriesByExactName = groupEntriesByName(entries, normalizeName);
  const entriesByRelaxedName = groupEntriesByName(entries, relaxedName);
  const rows = authors.map((author) => {
    const strict = entriesByExactName.get(normalizeName(author.name)) ?? [];
    const relaxed = strict.length ? strict : entriesByRelaxedName.get(relaxedName(author.name)) ?? [];
    const candidates = uniqueCandidates(relaxed);
    const alreadyKnown = Boolean(
      people.profiles[author.personId]?.platforms.some((platform) => platform.service === "substack")
      || curatedPlatforms.profiles?.[author.personId]?.platforms?.some((platform) => platform.service === "substack"),
    );
    return {
      ...author,
      status: alreadyKnown ? "already_known" : candidates.length === 1 ? (strict.length ? "unique_exact" : "unique_relaxed") : candidates.length > 1 ? "ambiguous" : "not_found",
      candidates: candidates.map((candidate) => ({ ...candidate, sourceUrl: pageForEntry(candidate, relevantPages, cache) })),
    };
  });
  const candidates = rows.filter((row) => row.status === "unique_exact" || row.status === "unique_relaxed" || row.status === "ambiguous");
  const cachedSitemapPages = requestedPages.filter((page) => cache.pages[page.url]).length;
  const report = {
    generatedAt,
    requestedAuthors: authors.length,
    requestedSitemapPages: requestedPages.length,
    attemptedSitemapPages: pagesToFetch.length,
    cachedSitemapPages,
    rateLimited,
    failures,
    alreadyKnown: rows.filter((row) => row.status === "already_known").length,
    uniqueExactCandidates: rows.filter((row) => row.status === "unique_exact").length,
    uniqueRelaxedCandidates: rows.filter((row) => row.status === "unique_relaxed").length,
    ambiguousCandidates: rows.filter((row) => row.status === "ambiguous").length,
    noCandidate: rows.filter((row) => row.status === "not_found").length,
    complete: hasCachedIndex && cachedSitemapPages === requestedPages.length && !failures.length,
    note: "Candidates come from Substack's public alphabetical author/publication sitemap. The author limit may cover the entire catalog; unique names remain review candidates until public biography, book-title, or official-site evidence verifies identity. Incomplete cached runs undercount candidates.",
  };
  await Promise.all([
    writeJson(reportPath, report),
    writeJson(reviewPath, { generatedAt, source: "https://substack.com/sitemap", rows: candidates }),
  ]);
  console.log(JSON.stringify(report, null, 2));
}

function rankAuthors(catalog: PublicData): RankedAuthor[] {
  const stats = new Map(catalog.stats.map((row) => [row.bookId, row]));
  const rows = new Map<string, Omit<RankedAuthor, "rank">>();
  for (const book of catalog.books) {
    const score = statsFor(stats.get(book.id)).score;
    for (const author of book.authors) {
      const current = rows.get(author.id) ?? { personId: author.id, name: author.name, recognitionScore: 0, bookCount: 0 };
      current.recognitionScore += score;
      current.bookCount += 1;
      rows.set(author.id, current);
    }
  }
  return [...rows.values()]
    .sort((a, b) => b.recognitionScore - a.recognitionScore || b.bookCount - a.bookCount || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function statsFor(stats: BookStats | undefined): BookStats {
  return stats ?? { bookId: "", wins: 0, lists: 0, score: 0, majorWins: 0, normalWins: 0, majorShortlists: 0, normalShortlists: 0, majorLonglists: 0, normalLonglists: 0, statuses: { winner: 0, co_winner: 0, finalist: 0, shortlist: 0, longlist: 0, honorable_mention: 0, commended: 0, notable: 0, unknown: 0 } };
}

function parseSitemapIndex(html: string): SitemapPage[] {
  const rows: SitemapPage[] = [];
  const pattern = /href="(https:\/\/substack\.com\/sitemap\/publications-\d+)"[^>]*>Authors, starting with &quot;([^&]+)&quot;<\/a>/g;
  for (const match of html.matchAll(pattern)) rows.push({ url: match[1], start: normalizeSortKey(match[2]).slice(0, 3) });
  return rows;
}

function parsePublicationPage(html: string): SitemapEntry[] {
  const rows: SitemapEntry[] = [];
  const pattern = /<a[^>]+class="sitemap-link"[^>]+href="(https?:\/\/[^\"]+)"[^>]*>([^<]+)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const label = decodeHtml(match[2]).trim();
    const separator = label.indexOf(" - ");
    if (separator < 1) continue;
    rows.push({
      authorName: label.slice(0, separator).trim(),
      publicationTitle: label.slice(separator + 3).trim(),
      publicationUrl: decodeHtml(match[1]),
    });
  }
  return rows;
}

function selectRelevantPages(authors: RankedAuthor[], pages: SitemapPage[]) {
  const selected = new Map<string, SitemapPage>();
  for (const author of authors) {
    const prefix = normalizeSortKey(author.name).slice(0, 3);
    const exact = pages.filter((page) => page.start === prefix);
    if (exact.length) {
      for (const page of exact) selected.set(page.url, page);
      continue;
    }
    const preceding = pages.filter((page) => page.start <= prefix).at(-1) ?? pages[0];
    selected.set(preceding.url, preceding);
  }
  return [...selected.values()];
}

function pageForEntry(entry: SitemapEntry, pages: SitemapPage[], cache: CacheFile) {
  return pages.find((page) => cache.pages[page.url]?.entries.some((candidate) => candidate.publicationUrl === entry.publicationUrl))?.url;
}

function uniqueCandidates(entries: SitemapEntry[]) {
  return [...new Map(entries.map((entry) => [entry.publicationUrl, entry])).values()];
}

function groupEntriesByName(entries: SitemapEntry[], keyFor: (name: string) => string) {
  const grouped = new Map<string, SitemapEntry[]>();
  for (const entry of entries) {
    const key = keyFor(entry.authorName);
    const rows = grouped.get(key) ?? [];
    rows.push(entry);
    grouped.set(key, rows);
  }
  return grouped;
}

function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(jr|sr)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function relaxedName(value: string) {
  return normalizeName(value).split(" ").filter((token) => token.length > 1).join(" ");
}

function normalizeSortKey(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function fetchText(url: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (response.ok) return response.text();
    if (response.status === 429 && !response.headers.get("retry-after")) throw new RateLimitError(`Substack rate limit reached: ${url}`);
    if (response.status !== 429 && response.status < 500) throw new Error(`Substack request failed (${response.status}): ${url}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(20_000, 1000 * 2 ** attempt));
  }
  throw new Error(`Substack request failed after retries: ${url}`);
}

class RateLimitError extends Error {}

function parseArgs(raw: string[]) {
  const value = (name: string) => { const index = raw.indexOf(name); return index >= 0 ? raw[index + 1] : undefined; };
  return {
    limit: positiveNumber(value("--limit"), 500),
    concurrency: positiveNumber(value("--concurrency"), 3),
    pageLimit: positiveNumber(value("--page-limit"), 20),
    requestDelayMs: nonNegativeNumber(value("--request-delay-ms"), 250),
    checkpointEvery: positiveNumber(value("--checkpoint-every"), 20),
    refresh: raw.includes("--refresh"),
    offline: raw.includes("--offline"),
  };
}

function positiveNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function nonNegativeNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function wait(ms: number) { return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }
async function mapConcurrent<T>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<void>) { let next = 0; await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => { while (next < values.length) { const index = next++; await worker(values[index], index); } })); }
async function writeJson(filename: string, value: unknown) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`); }
async function readCache(): Promise<CacheFile> { try { return JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile; } catch { return { generatedAt: new Date(0).toISOString(), pages: {} }; } }

main().catch((error) => { console.error(error); process.exitCode = 1; });
