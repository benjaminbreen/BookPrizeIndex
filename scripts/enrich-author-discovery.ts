import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorDiscoveryFile, AuthorDiscoveryProfile, AuthorPlatform } from "../lib/author-discovery";
import type { BookStats, PublicData, SourceRef } from "../lib/types";

type RankedAuthor = { personId: string; name: string; rank: number; recognitionScore: number; bookCount: number };
type SearchResult = { id: string; label?: string; description?: string; match?: { text?: string }; aliases?: string[] };
type Entity = { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Record<string, Claim[]>; sitelinks?: Record<string, { title: string }> };
type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type CacheFile = { generatedAt: string; searches: Record<string, SearchResult[]>; entities: Record<string, Entity> };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "cache", "catalog.full.generated.json");
const outputPath = path.join(root, "sources", "enrichment", "people.generated.json");
const reportPath = path.join(root, "data", "reports", "author-discovery-report.json");
const reviewPath = path.join(root, "data", "reports", "author-discovery-review.json");
const cachePath = path.join(root, "data", "cache", "author-discovery-wikidata-cache.json");
const userAgent = "BookPrizeIndex/1.0 (https://github.com/benjaminbreen/BookPrizeIndex; public-author-facet-enrichment)";
const writerContext = /\b(writer|author|historian|journalist|biographer|essayist|critic|scholar|academic|professor|scientist|economist|sociologist|anthropologist|political scientist|physician|naturalist|poet|filmmaker|lawyer|activist)\b/i;

const args = parseArgs(process.argv.slice(2));

async function main() {
  const generatedAt = new Date().toISOString();
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const cache = await readCache();
  const ranked = rankAuthors(catalog).slice(0, args.limit);

  await mapConcurrent(ranked, args.concurrency, async (author, index) => {
    if (!cache.searches[author.personId] || args.refresh) {
      cache.searches[author.personId] = await searchWikidata(author.name);
      await wait(args.requestDelayMs);
    }
    if ((index + 1) % args.checkpointEvery === 0) {
      cache.generatedAt = new Date().toISOString();
      await writeJson(cachePath, cache);
      console.log(`Searched ${index + 1}/${ranked.length} authors.`);
    }
  });

  const decisions = ranked.map((author) => ({ author, ...chooseCandidate(author, cache.searches[author.personId] ?? []) }));
  const acceptedIds = [...new Set(decisions.flatMap((decision) => decision.wikidataId ? [decision.wikidataId] : []))];
  await hydrateEntities(acceptedIds, cache);

  const countryIds = [...new Set(acceptedIds.flatMap((id) => claimEntityIds(cache.entities[id], "P27")))];
  await hydrateEntities(countryIds, cache);
  cache.generatedAt = new Date().toISOString();
  await writeJson(cachePath, cache);

  const profiles: Record<string, AuthorDiscoveryProfile> = {};
  const sources: Record<string, SourceRef> = {};
  for (const decision of decisions) {
    if (!decision.wikidataId) continue;
    const entity = cache.entities[decision.wikidataId];
    if (!entity) continue;
    const sourceId = `source-wikidata-author-${decision.wikidataId.toLowerCase()}`;
    sources[sourceId] = {
      id: sourceId,
      label: `Wikidata author record for ${decision.author.name}`,
      url: `https://www.wikidata.org/wiki/${decision.wikidataId}`,
      accessedAt: generatedAt,
      confidence: "secondary",
      field: "author",
      note: "Structured public professional metadata used for coarse discovery facets only.",
    };
    profiles[decision.author.personId] = buildProfile(decision.author, entity, cache.entities, sourceId, generatedAt);
  }

  const output: AuthorDiscoveryFile = {
    generatedAt,
    notes: "Generated from Wikidata for public-interest book discovery. Stores only coarse country connections, tri-state life status, and public Substack identifiers; ambiguous author matches are excluded.",
    scope: { rankedAuthors: ranked.length, rankingMethod: "sum of book recognition scores, then book count, then author name" },
    profiles: sortRecord(profiles),
    sources: sortRecord(sources),
  };
  const review = decisions.filter((decision) => !decision.wikidataId).map((decision) => ({
    ...decision.author,
    status: decision.status,
    note: decision.note,
    candidates: (cache.searches[decision.author.personId] ?? []).slice(0, 5),
  }));
  const profileRows = Object.values(profiles);
  const report = {
    generatedAt,
    requestedAuthors: ranked.length,
    matchedAuthors: profileRows.length,
    unresolvedAuthors: review.length,
    withCountryConnections: profileRows.filter((profile) => profile.countryConnections.length).length,
    living: profileRows.filter((profile) => profile.lifeStatus.value === "living").length,
    deceased: profileRows.filter((profile) => profile.lifeStatus.value === "deceased").length,
    unknownLifeStatus: profileRows.filter((profile) => profile.lifeStatus.value === "unknown").length,
    withSubstack: profileRows.filter((profile) => profile.platforms.some((platform) => platform.service === "substack")).length,
  };
  await Promise.all([writeJson(outputPath, output), writeJson(reportPath, report), writeJson(reviewPath, { generatedAt, rows: review })]);
  console.log(`Matched ${report.matchedAuthors}/${report.requestedAuthors} authors; ${report.withCountryConnections} country profiles, ${report.withSubstack} Substack profiles, ${report.unresolvedAuthors} review rows.`);
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

function chooseCandidate(author: RankedAuthor, results: SearchResult[]) {
  const exact = results.filter((candidate) => candidateNameValues(candidate).some((value) => normalizeName(value) === normalizeName(author.name)));
  const contextual = exact.filter((candidate) => writerContext.test(candidate.description ?? ""));
  if (contextual.length === 1) return { wikidataId: contextual[0].id, status: "matched", note: "Exact name and public writer-context match." };
  if (contextual.length > 1) return { wikidataId: undefined, status: "ambiguous", note: "Multiple exact writer-context Wikidata matches." };
  if (exact.length === 1 && results[0]?.id === exact[0].id) return { wikidataId: exact[0].id, status: "matched", note: "Unique top-ranked exact-name match." };
  return { wikidataId: undefined, status: results.length ? "low_confidence" : "not_found", note: exact.length ? "Exact name lacks sufficient writer context." : "No exact Wikidata label or alias match." };
}

function buildProfile(author: RankedAuthor, entity: Entity, entities: Record<string, Entity>, sourceId: string, checkedAt: string): AuthorDiscoveryProfile {
  const birthYear = claimTimeYear(entity, "P569");
  const deathYear = claimTimeYear(entity, "P570");
  const lifeStatus = deathYear
    ? { value: "deceased" as const, confidence: "high" as const, checkedAt, sourceId, method: "death_statement" as const }
    : birthYear && birthYear >= 1930
      ? { value: "living" as const, confidence: "medium" as const, checkedAt, sourceId, method: "recent_birth_record_without_death_statement" as const }
      : { value: "unknown" as const, confidence: "low" as const, checkedAt, sourceId, method: "insufficient_evidence" as const };
  const countryConnections = claimEntityIds(entity, "P27").flatMap((countryId) => {
    const country = entities[countryId];
    const countryName = country?.labels?.en?.value;
    if (!countryName) return [];
    return [{ countryId, countryName, countryCode: claimString(country, "P297")?.toUpperCase(), relation: "citizen_of" as const, sourceId }];
  });
  const platforms = substackPlatforms(entity, sourceId);
  const wikipediaTitle = entity.sitelinks?.enwiki?.title;
  const imageFileName = claimString(entity, "P18");
  return {
    ...author,
    description: entity.descriptions?.en?.value,
    wikidataId: entity.id,
    wikipediaUrl: wikipediaTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikipediaTitle.replaceAll(" ", "_"))}` : undefined,
    imageFileName,
    imageUrl: imageFileName ? `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(imageFileName.replaceAll(" ", "_"))}?width=640` : undefined,
    imageSourceUrl: imageFileName ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(imageFileName.replaceAll(" ", "_"))}` : undefined,
    countryConnections,
    lifeStatus,
    platforms,
    sourceIds: [sourceId],
  };
}

function substackPlatforms(entity: Entity, sourceId: string): AuthorPlatform[] {
  const handle = claimString(entity, "P13568")?.replace(/^@/, "");
  const identifier = claimString(entity, "P12007");
  const websites = claimStrings(entity, "P856").filter((url) => /(^|\.)substack\.com\b/i.test(safeHost(url)));
  const rows: AuthorPlatform[] = [];
  if (handle || identifier) rows.push({ service: "substack", handle, identifier, url: handle ? `https://substack.com/@${handle}` : undefined, sourceId });
  for (const url of websites) if (!rows.some((row) => row.url === url)) rows.push({ service: "substack", url, sourceId });
  return rows;
}

async function searchWikidata(name: string) {
  const params = new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", uselang: "en", type: "item", limit: "8", format: "json", origin: "*" });
  const json = await fetchWikidataJson<{ search?: SearchResult[] }>(`https://www.wikidata.org/w/api.php?${params}`, `search for ${name}`);
  return json.search ?? [];
}

async function hydrateEntities(ids: string[], cache: CacheFile) {
  const missing = ids.filter((id) => !cache.entities[id]);
  for (const batch of chunks(missing, 40)) {
    const params = new URLSearchParams({ action: "wbgetentities", ids: batch.join("|"), props: "labels|descriptions|claims|sitelinks", languages: "en", sitefilter: "enwiki", format: "json", origin: "*" });
    const json = await fetchWikidataJson<{ entities?: Record<string, Entity> }>(`https://www.wikidata.org/w/api.php?${params}`, "entity batch");
    Object.assign(cache.entities, json.entities ?? {});
    await wait(args.requestDelayMs);
  }
}

async function fetchWikidataJson<T>(url: string, label: string): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (response.ok) return response.json() as Promise<T>;
    if (response.status !== 429 && response.status < 500) throw new Error(`Wikidata ${label} failed: ${response.status}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
    console.warn(`Wikidata ${label} returned ${response.status}; retrying in ${delay}ms.`);
    await wait(delay);
  }
  throw new Error(`Wikidata ${label} failed after retries.`);
}

function claimValues(entity: Entity | undefined, property: string) {
  return (entity?.claims?.[property] ?? []).map((claim) => claim.mainsnak?.datavalue?.value).filter((value) => value !== undefined);
}

function claimEntityIds(entity: Entity | undefined, property: string) {
  return claimValues(entity, property).flatMap((value) => typeof value === "object" && value && "id" in value ? [String((value as { id: string }).id)] : []);
}

function claimStrings(entity: Entity | undefined, property: string) {
  return claimValues(entity, property).filter((value): value is string => typeof value === "string");
}

function claimString(entity: Entity | undefined, property: string) {
  return claimStrings(entity, property)[0];
}

function claimTimeYear(entity: Entity | undefined, property: string) {
  const value = claimValues(entity, property)[0];
  if (!value || typeof value !== "object" || !("time" in value)) return undefined;
  const match = String((value as { time: string }).time).match(/^[+-](\d{4,})-/);
  return match ? Number(match[1]) : undefined;
}

function candidateNameValues(candidate: SearchResult) {
  return [candidate.label, candidate.match?.text, ...(candidate.aliases ?? [])].filter((value): value is string => Boolean(value));
}

function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(jr|sr)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function safeHost(value: string) {
  try { return new URL(value).hostname; } catch { return ""; }
}

function statsFor(stats: BookStats | undefined): BookStats {
  return stats ?? { bookId: "", wins: 0, lists: 0, score: 0, majorWins: 0, normalWins: 0, majorShortlists: 0, normalShortlists: 0, majorLonglists: 0, normalLonglists: 0, statuses: { winner: 0, co_winner: 0, finalist: 0, shortlist: 0, longlist: 0, honorable_mention: 0, commended: 0, notable: 0, unknown: 0 } };
}

function parseArgs(raw: string[]) {
  const value = (name: string) => { const index = raw.indexOf(name); return index >= 0 ? raw[index + 1] : undefined; };
  return {
    limit: positiveNumber(value("--limit"), 500),
    concurrency: positiveNumber(value("--concurrency"), 4),
    requestDelayMs: nonNegativeNumber(value("--request-delay-ms"), 100),
    checkpointEvery: positiveNumber(value("--checkpoint-every"), 25),
    refresh: raw.includes("--refresh"),
  };
}

function positiveNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function nonNegativeNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function chunks<T>(values: T[], size: number) { const rows: T[][] = []; for (let index = 0; index < values.length; index += size) rows.push(values.slice(index, index + size)); return rows; }
function wait(ms: number) { return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }
async function mapConcurrent<T>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<void>) { let next = 0; await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => { while (next < values.length) { const index = next++; await worker(values[index], index); } })); }
function sortRecord<T>(record: Record<string, T>) { return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))); }
async function writeJson(filename: string, value: unknown) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`); }
async function readCache(): Promise<CacheFile> { try { return JSON.parse(await fs.readFile(cachePath, "utf8")) as CacheFile; } catch { return { generatedAt: new Date(0).toISOString(), searches: {}, entities: {} }; } }

main().catch((error) => { console.error(error); process.exitCode = 1; });
