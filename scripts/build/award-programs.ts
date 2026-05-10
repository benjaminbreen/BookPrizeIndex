import type { Award, AwardAppearance, AwardEdition, AwardProgram } from "../../lib/types";
import { clean, slugify } from "./text";

export type PrizeRegistryFileEntry = {
  id: string;
  name: string;
  organization?: string;
  geography?: string;
  officialUrl?: string;
  notes?: string;
  categories?: Array<{
    id: string;
    name: string;
    activeYears?: string;
    coverageNotes?: string;
  }>;
};

export function findPrizeRegistryCategory(prizeRegistry: PrizeRegistryFileEntry[], prizeId: string, categoryId: string) {
  return prizeRegistry.find((prize) => prize.id === prizeId)?.categories?.find((category) => category.id === categoryId);
}

export function buildAwardPrograms(
  prizeRegistry: PrizeRegistryFileEntry[],
  awards: Map<string, Award>,
  appearances: Map<string, AwardAppearance>,
): AwardProgram[] {
  const usedProgramIds = new Set([...awards.values()].map((award) => award.programId).filter((id): id is string => Boolean(id)));
  return prizeRegistry
    .filter((prize) => usedProgramIds.has(prize.id))
    .map((prize) => ({
      id: prize.id,
      slug: slugify(prize.name),
      name: prize.name,
      organization: prize.organization,
      geography: prize.geography,
      notes: prize.notes,
      officialUrl: prize.officialUrl,
      description: `A program-level overview of ${prize.name} categories currently represented in The Book Prize Index.`,
      sourceIds: sourceIdsForProgram(prize, awards, appearances),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function applyAwardProgramMetadata(awards: Map<string, Award>, prizeRegistry: PrizeRegistryFileEntry[]) {
  const matchers = prizeRegistry.flatMap((prize) =>
    (prize.categories ?? []).flatMap((category) =>
      awardNameCandidates(prize.name, category.name).map((name) => ({
        name: normalizeAwardNameForProgramMatch(name),
        prize,
        category,
      })),
    ),
  );

  for (const award of awards.values()) {
    if (award.programId && award.categoryName) continue;
    const normalized = normalizeAwardNameForProgramMatch(award.name);
    const match = matchers.find((candidate) => candidate.name === normalized);
    if (!match) continue;

    award.programId = award.programId ?? match.prize.id;
    award.categoryName = award.categoryName ?? displayCategoryName(match.category.name);
    award.categoryYears = award.categoryYears ?? match.category.activeYears;
    award.organization = award.organization ?? match.prize.organization;
    award.geography = award.geography ?? match.prize.geography;
    award.links = {
      ...award.links,
      official: award.links.official ?? match.prize.officialUrl,
    };
  }
}

export function mergeDuplicateAwardCategories(
  awards: Map<string, Award>,
  editions: Map<string, AwardEdition>,
  appearances: Map<string, AwardAppearance>,
) {
  const recordCounts = new Map<string, number>();
  for (const appearance of appearances.values()) {
    recordCounts.set(appearance.awardId, (recordCounts.get(appearance.awardId) ?? 0) + 1);
  }

  const groups = new Map<string, Award[]>();
  for (const award of awards.values()) {
    const key = duplicateAwardCategoryKey(award);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), award]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = [...group].sort((a, b) => awardCanonicalScore(b, recordCounts) - awardCanonicalScore(a, recordCounts))[0];
    const duplicates = group.filter((award) => award.id !== canonical.id);
    if (process.env.DEBUG_AWARD_MERGE === "1") {
      console.log(
        `Merging duplicate award category into ${canonical.id}: ${group
          .map((award) => `${award.id} (${award.name}, ${recordCounts.get(award.id) ?? 0} appearances)`)
          .join(" | ")}`,
      );
    }

    for (const duplicate of duplicates) {
      canonical.sourceIds = [...new Set([...canonical.sourceIds, ...duplicate.sourceIds])].sort();
      canonical.description = canonical.description ?? duplicate.description;
      canonical.criteria = canonical.criteria ?? duplicate.criteria;
      canonical.deadline = canonical.deadline ?? duplicate.deadline;
      canonical.prizeAmount = canonical.prizeAmount ?? duplicate.prizeAmount;
      canonical.logoUrl = canonical.logoUrl ?? duplicate.logoUrl;
      canonical.logoAlt = canonical.logoAlt ?? duplicate.logoAlt;
      canonical.logoSourceUrl = canonical.logoSourceUrl ?? duplicate.logoSourceUrl;
      canonical.logoCredit = canonical.logoCredit ?? duplicate.logoCredit;
      canonical.organization = canonical.organization ?? duplicate.organization;
      canonical.geography = canonical.geography ?? duplicate.geography;
      canonical.subjectAreas = [...new Set([...canonical.subjectAreas, ...duplicate.subjectAreas])].sort();
      canonical.links = {
        ...duplicate.links,
        ...canonical.links,
      };

      for (const edition of editions.values()) {
        if (edition.awardId === duplicate.id) edition.awardId = canonical.id;
      }
      for (const appearance of appearances.values()) {
        if (appearance.awardId === duplicate.id) appearance.awardId = canonical.id;
      }
      awards.delete(duplicate.id);
    }
  }

  dedupeAppearances(appearances);
}

function awardNameCandidates(prizeName: string, categoryName: string) {
  const candidates = [
    prizeName,
    `${prizeName}: ${categoryName}`,
    `${prizeName} for ${categoryName}`,
    `${prizeName} in ${categoryName}`,
    `${prizeName.replace(/\bMedals\b/g, "Medal")} in ${categoryName}`,
    `${prizeName.replace(/\bMedals\b/g, "Medal")} for ${categoryName}`,
  ];
  if (/^pulitzer prize$/i.test(prizeName)) {
    candidates.push(`Pulitzer Prize in ${categoryName}`, `Pulitzer Prize for ${categoryName}`);
  }
  if (/^national book awards$/i.test(prizeName)) {
    candidates.push(`National Book Award for ${categoryName}`);
  }
  if (/^national book critics circle awards$/i.test(prizeName)) {
    candidates.push(`National Book Critics Circle Award for ${categoryName}`);
  }
  if (/^los angeles times book prize$/i.test(prizeName)) {
    candidates.push(`Los Angeles Times Book Prize for ${categoryName}`);
  }
  return candidates;
}

function normalizeAwardNameForProgramMatch(input: string) {
  return clean(input)
    .toLowerCase()
    .replace(/\b(and|&)\b/g, "and")
    .replace(/prize for biography$/i, "prize for biography")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function duplicateAwardCategoryKey(award: Award) {
  if (!award.programId || !award.categoryName) return undefined;
  return `${award.programId}::${normalizeAwardCategoryName(award.categoryName)}`;
}

function normalizeAwardCategoryName(input: string) {
  return clean(input)
    .toLowerCase()
    .replace(/non[\s-]?fiction/g, "nonfiction")
    .replace(/\band\b/g, "&")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function awardCanonicalScore(award: Award, recordCounts: Map<string, number>) {
  let score = recordCounts.get(award.id) ?? 0;
  if (award.criteria) score += 10000;
  if (award.description) score += 5000;
  if (!award.name.includes(":")) score += 1000;
  if (award.logoUrl) score += 500;
  return score;
}

function dedupeAppearances(appearances: Map<string, AwardAppearance>) {
  const deduped = new Map<string, AwardAppearance>();
  for (const appearance of appearances.values()) {
    const key = [
      appearance.bookId,
      appearance.awardId,
      appearance.year,
      appearance.status,
      normalizeStatusLabelForDedupe(appearance.originalStatus),
    ].join("::");
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, appearance);
      continue;
    }
    existing.sourceIds = [...new Set([...existing.sourceIds, ...appearance.sourceIds])].sort();
    existing.sourceUrl = existing.sourceUrl ?? appearance.sourceUrl;
  }
  appearances.clear();
  for (const [id, appearance] of deduped) appearances.set(id, appearance);
}

function normalizeStatusLabelForDedupe(input?: string) {
  return clean(input).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceIdsForProgram(
  prize: PrizeRegistryFileEntry,
  awards: Map<string, Award>,
  appearances: Map<string, AwardAppearance>,
) {
  const awardIds = new Set([...awards.values()].filter((award) => award.programId === prize.id).map((award) => award.id));
  const sourceIds = new Set<string>();
  for (const award of awards.values()) {
    if (award.programId === prize.id) {
      for (const sourceId of award.sourceIds) sourceIds.add(sourceId);
    }
  }
  for (const appearance of appearances.values()) {
    if (awardIds.has(appearance.awardId)) {
      for (const sourceId of appearance.sourceIds) sourceIds.add(sourceId);
    }
  }
  return [...sourceIds].sort();
}

function displayCategoryName(input: string) {
  return clean(input).replace(/\b(nonfiction|reference|biography)\b/gi, (match) => {
    if (/^and$/i.test(match)) return "and";
    return match.slice(0, 1).toUpperCase() + match.slice(1).toLowerCase();
  });
}
