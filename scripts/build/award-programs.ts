import type { Award, AwardAppearance, AwardEdition, AwardProgram } from "../../lib/types";
import { clean, slugify } from "./text";

export type PrizeScope = "general" | "subject" | "discipline";

export type PrizeRegistryFileEntry = {
  id: string;
  name: string;
  awardType?: "major_award" | "award";
  scope?: PrizeScope;
  organization?: string;
  geography?: string;
  officialUrl?: string;
  notes?: string;
  categories?: Array<{
    id: string;
    name: string;
    awardType?: "major_award" | "award";
    officialUrl?: string;
    sourceUrl?: string;
    sourceLabel?: string;
    sourceConfidence?: string;
    importStrategy?: string;
    activeYears?: string;
    coverageNotes?: string;
  }>;
};
type PrizeRegistryCategory = NonNullable<PrizeRegistryFileEntry["categories"]>[number];

export function findPrizeRegistryEntry(prizeRegistry: PrizeRegistryFileEntry[], prizeId: string) {
  return prizeRegistry.find((prize) => prize.id === prizeId);
}

export function findPrizeRegistryCategory(prizeRegistry: PrizeRegistryFileEntry[], prizeId: string, categoryId: string) {
  return findPrizeRegistryEntry(prizeRegistry, prizeId)?.categories?.find((category) => category.id === categoryId);
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
    const normalized = normalizeAwardNameForProgramMatch(award.name);
    const match =
      award.programId && award.categoryName
        ? matchers.find((candidate) => candidate.prize.id === award.programId && normalizeAwardCategoryName(candidate.category.name) === normalizeAwardCategoryName(award.categoryName ?? ""))
        : matchers.find((candidate) => candidate.name === normalized);
    if (!match) {
      const prize = award.programId ? findPrizeRegistryEntry(prizeRegistry, award.programId) : undefined;
      if (!prize) continue;
      award.awardType = award.awardType ?? prize.awardType;
      award.organization = award.organization ?? prize.organization;
      award.geography = award.geography ?? prize.geography;
      award.scope = award.scope ?? prize.scope;
      award.description = award.description ?? awardDescriptionForRegistry(prize);
      award.criteria = award.criteria ?? awardCriteriaForRegistry(prize, undefined, award.categoryName ?? award.name);
      award.links = {
        ...award.links,
        official: award.links.official ?? prize.officialUrl,
        criteria: award.links.criteria ?? prize.officialUrl,
      };
      continue;
    }

    award.programId = award.programId ?? match.prize.id;
    award.categoryName = award.categoryName ?? displayCategoryName(match.category.name);
    award.categoryYears = award.categoryYears ?? match.category.activeYears;
    award.awardType = award.awardType ?? match.category.awardType ?? match.prize.awardType;
    award.organization = award.organization ?? match.prize.organization;
    award.geography = award.geography ?? match.prize.geography;
    award.scope = award.scope ?? match.prize.scope;
    award.description = award.description ?? awardDescriptionForRegistry(match.prize, match.category);
    award.criteria = award.criteria ?? awardCriteriaForRegistry(match.prize, match.category);
    award.links = {
      ...award.links,
      official: award.links.official ?? match.prize.officialUrl,
      criteria: award.links.criteria ?? match.category.officialUrl ?? match.category.sourceUrl ?? match.prize.officialUrl,
    };
  }
}

function awardDescriptionForRegistry(prize: PrizeRegistryFileEntry, category?: PrizeRegistryCategory) {
  const programDescriptions: Record<string, string> = {
    "aha-book-prizes": "American Historical Association publication prizes recognize distinguished historical scholarship across selected fields represented in this catalog.",
    "baillie-gifford-prize": "The Baillie Gifford Prize for Non-Fiction recognizes outstanding nonfiction books published in English for a broad readership.",
    "british-academy-book-prize": "The British Academy Book Prize recognizes nonfiction that deepens public understanding of people, cultures, and societies across the world.",
    "costa-book-awards": "The Costa Book Awards Biography category recognized biography, autobiography, and memoir within the former Costa/Whitbread awards program.",
    "duff-cooper-prize": "The Duff Cooper Prize recognizes nonfiction in history, biography, politics, and related fields, with an emphasis on literary distinction.",
    "ft-business-book-of-the-year": "The Financial Times Business Book of the Year recognizes books with significant insight into business, finance, economics, and management.",
    "helen-bernstein-book-award": "The Helen Bernstein Book Award for Excellence in Journalism recognizes books of journalism that bring public attention to important issues.",
    "hillman-prize-book-journalism": "The Hillman Prize for Book Journalism recognizes book-length journalism in the public interest.",
    "j-anthony-lukas-book-prize": "The J. Anthony Lukas Book Prize recognizes nonfiction on an American topic that combines serious research, literary quality, and social or political insight.",
    "lionel-gelber-prize": "The Lionel Gelber Prize recognizes English-language nonfiction on international affairs and global public policy.",
    "los-angeles-times-book-prize": "The Los Angeles Times Book Prize recognizes books published in the previous year across literary and nonfiction categories.",
    "national-book-awards": "The National Book Awards recognize books published by U.S. publishers across annual literary categories, including nonfiction and historical nonfiction categories represented here.",
    "national-book-critics-circle-awards": "The National Book Critics Circle Awards recognize books published in English across annual categories judged by book critics.",
    "new-york-historical-american-history-book-prize": "The Barbara and David Zalaznick Book Prize in American History recognizes adult nonfiction on American history or biography.",
    "orwell-prize": "The Orwell Prize for Political Writing recognizes nonfiction political writing that makes public issues clear, compelling, and artful.",
    "pen-diamonstein-spielvogel-award": "The PEN/Diamonstein-Spielvogel Award for the Art of the Essay recognizes distinguished essay collections by experienced writers.",
    "pen-eo-wilson-award": "The PEN/E.O. Wilson Literary Science Writing Award recognizes literary excellence in writing about the physical and biological sciences.",
    "pen-weld-biography-award": "The PEN/Jacqueline Bograd Weld Award for Biography recognizes biographies of exceptional literary, narrative, and research quality.",
    "phi-beta-kappa-book-awards": "The Phi Beta Kappa Book Awards recognize outstanding contributions to literature, science, and intellectual life.",
    "plutarch-award": "The Plutarch Award recognizes biography selected by members of Biographers International Organization.",
    "prose-awards": "The PROSE Awards recognize professional and scholarly works of merit across subject areas represented in this catalog.",
    "pulitzer-prize": "The Pulitzer book prizes recognize distinguished works first published in the United States across annual categories represented in this catalog.",
    "rachel-carson-environment-book-award": "The Rachel Carson Environment Book Award recognizes books that illuminate environmental issues through reporting, research, and public-facing nonfiction.",
    "ridenhour-book-prize": "The Ridenhour Book Prize recognizes public-interest nonfiction connected to truth-telling, civic courage, and accountability.",
    "royal-society-science-book-prize": "The Royal Society Science Book Prize recognizes science books written for non-specialist readers.",
  };
  if (programDescriptions[prize.id]) return programDescriptions[prize.id];
  const categoryName = category ? displayCategoryName(category.name) : "represented categories";
  return `${prize.name}: ${categoryName} recognizes ${categoryName.toLowerCase()} books represented in The Book Prize Index.`;
}

function awardCriteriaForRegistry(prize: PrizeRegistryFileEntry, category?: PrizeRegistryCategory, fallbackCategoryName?: string) {
  const parts = [
    category?.activeYears ? `Active years represented: ${category.activeYears}.` : undefined,
    category?.coverageNotes,
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  const categoryName = fallbackCategoryName ? displayCategoryName(fallbackCategoryName) : "this category";
  return `Source coverage note: ${categoryName} records are tracked from ${prize.name} source records; eligibility follows the program rules and category archives where available.`;
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
    ].join("::");
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, appearance);
      continue;
    }
    const preferred = preferredAppearance(existing, appearance);
    const secondary = preferred === existing ? appearance : existing;
    preferred.sourceIds = [...new Set([...preferred.sourceIds, ...secondary.sourceIds])].sort();
    preferred.sourceUrl = preferred.sourceUrl ?? secondary.sourceUrl;
    deduped.set(key, preferred);
  }
  appearances.clear();
  for (const [id, appearance] of deduped) appearances.set(id, appearance);
}

function preferredAppearance(a: AwardAppearance, b: AwardAppearance) {
  return appearanceDedupeScore(b) > appearanceDedupeScore(a) ? b : a;
}

function appearanceDedupeScore(appearance: AwardAppearance) {
  const statusScore: Record<AwardAppearance["status"], number> = {
    co_winner: 700,
    winner: 650,
    finalist: 500,
    shortlist: 450,
    longlist: 300,
    honorable_mention: 200,
    commended: 150,
    notable: 100,
    unknown: 0,
  };
  return (
    statusScore[appearance.status] +
    (appearance.sourceUrl ? 20 : 0) +
    (appearance.sourceIds.some((sourceId) => !sourceId.includes("nonfiction-history-awards-by-imprint")) ? 10 : 0)
  );
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
