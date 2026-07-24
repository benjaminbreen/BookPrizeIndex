import type { SourceRef } from "./types";

export type AuthorLifeStatus = "living" | "deceased" | "unknown";

export type AuthorCountryConnection = {
  countryCode?: string;
  countryId: string;
  countryName: string;
  relation: "citizen_of" | "described_as";
  sourceId: string;
};

export type AuthorPlatform = {
  handle?: string;
  identifier?: string;
  service: "substack";
  sourceId: string;
  url?: string;
};

export type AuthorDiscoveryProfile = {
  personId: string;
  name: string;
  description?: string;
  rank: number;
  recognitionScore: number;
  bookCount: number;
  wikidataId: string;
  wikipediaUrl?: string;
  imageFileName?: string;
  imageUrl?: string;
  imageSourceUrl?: string;
  countryConnections: AuthorCountryConnection[];
  lifeStatus: {
    value: AuthorLifeStatus;
    confidence: "high" | "medium" | "low";
    checkedAt: string;
    sourceId: string;
    method: "death_statement" | "recent_birth_record_without_death_statement" | "insufficient_evidence";
  };
  platforms: AuthorPlatform[];
  sourceIds: string[];
};

export type AuthorDiscoveryFile = {
  generatedAt: string;
  notes: string;
  scope: {
    rankedAuthors: number;
    rankingMethod: string;
  };
  profiles: Record<string, AuthorDiscoveryProfile>;
  sources: Record<string, SourceRef>;
};

export type SemanticAuthorFacet = {
  personId: string;
  name: string;
  countries: Array<{ code?: string; name: string }>;
  lifeStatus: AuthorLifeStatus;
  platforms: string[];
};

export type SemanticAuthorIntent = {
  countries?: string[];
  lifeStatus?: AuthorLifeStatus | "any";
  platforms?: string[];
  mode?: "filter" | "boost" | "none";
};

export function authorFacetMatchesIntent(author: SemanticAuthorFacet, intent: SemanticAuthorIntent) {
  const countries = (intent.countries ?? []).map(normalizeAuthorFacetValue).filter(Boolean);
  const platforms = (intent.platforms ?? []).map(normalizeAuthorFacetValue).filter(Boolean);
  const authorCountries = author.countries.flatMap((country) => [country.name, country.code ?? ""]).map(normalizeAuthorFacetValue);
  const authorPlatforms = author.platforms.map(normalizeAuthorFacetValue);
  if (countries.length && !countries.some((country) => authorCountries.includes(country))) return false;
  if (platforms.length && !platforms.every((platform) => authorPlatforms.includes(platform))) return false;
  if ((intent.lifeStatus === "living" || intent.lifeStatus === "deceased") && author.lifeStatus !== intent.lifeStatus) return false;
  return Boolean(countries.length || platforms.length || intent.lifeStatus === "living" || intent.lifeStatus === "deceased");
}

export function bookAuthorsMatchIntent(authors: SemanticAuthorFacet[] | undefined, intent: SemanticAuthorIntent | undefined) {
  if (!intent || intent.mode === "none") return false;
  return (authors ?? []).some((author) => authorFacetMatchesIntent(author, intent));
}

export function fallbackAuthorIntent(query: string): SemanticAuthorIntent | undefined {
  const normalized = normalizeAuthorFacetValue(query);
  const detectedCountries = Object.entries(countryAliases)
    .filter(([alias]) => new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized))
    .map(([, country]) => country);
  const platforms = /\bsubstack\b/i.test(query) ? ["substack"] : [];
  const explicitAuthorConstraint = /\b(by|author|authors|writer|writers|essayist|essayists|historian|historians|journalist|journalists)\b/i.test(query);
  const tasteAudience = /\b(?:substack\s+)?readers?\b.*\b(like|love|enjoy|recommend)|\bwould\s+like\b/i.test(query);
  const countries = explicitAuthorConstraint ? detectedCountries : [];
  const lifeStatus = explicitAuthorConstraint
    ? /\bliving\b/i.test(query) ? "living" : /\b(dead|deceased)\b/i.test(query) ? "deceased" : undefined
    : undefined;
  if (!countries.length && !platforms.length && !lifeStatus) return undefined;
  return {
    countries: unique(countries),
    lifeStatus,
    platforms,
    mode: explicitAuthorConstraint && !tasteAudience ? "filter" : "boost",
  };
}

export function normalizeAuthorFacetValue(value: string) {
  const normalized = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return countryAliases[normalized] ?? normalized;
}

const countryAliases: Record<string, string> = {
  american: "united states",
  australian: "australia",
  british: "united kingdom",
  canadian: "canada",
  chinese: "china",
  english: "united kingdom",
  french: "france",
  german: "germany",
  indian: "india",
  irish: "ireland",
  italian: "italy",
  japanese: "japan",
  mexican: "mexico",
  nigerian: "nigeria",
  pakistani: "pakistan",
  scottish: "united kingdom",
  spanish: "spain",
  welsh: "united kingdom",
};

function unique(values: string[]) {
  return [...new Set(values)];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
