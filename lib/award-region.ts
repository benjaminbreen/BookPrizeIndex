import type { Award, AwardProgram } from "@/lib/types";

export type AwardRegionFilter = "us" | "international" | "all";

export const AWARD_REGION_COOKIE = "bpi_award_region";

export function normalizeAwardRegion(value: string | undefined | null): AwardRegionFilter {
  if (value === "international") return "international";
  if (value === "all" || value === "world") return "all";
  return "us";
}

export function awardRegionFromCountry(country: string | undefined | null): AwardRegionFilter {
  return country?.toUpperCase() === "US" ? "us" : "international";
}

export function regionLabel(region: AwardRegionFilter) {
  if (region === "us") return "US";
  if (region === "international") return "International";
  return "All";
}

export function matchesAwardRegion(
  item: Pick<Award, "geography" | "name" | "programId">,
  filter: AwardRegionFilter,
  programsById?: Map<string, Pick<AwardProgram, "geography" | "name">>,
) {
  if (filter === "all") return true;
  const isUs = isUnitedStatesAward(item, programsById);
  return filter === "us" ? isUs : !isUs;
}

export function isUnitedStatesAward(
  item: Pick<Award, "geography" | "name" | "programId">,
  programsById?: Map<string, Pick<AwardProgram, "geography" | "name">>,
) {
  const program = item.programId ? programsById?.get(item.programId) : undefined;
  return isUnitedStatesGeography(item.geography) || isUnitedStatesGeography(program?.geography);
}

function isUnitedStatesGeography(geography?: string) {
  if (!geography) return false;
  const normalized = geography.toLowerCase();
  return (
    normalized.includes("united states") ||
    normalized.includes("u.s.") ||
    normalized.includes("us publication") ||
    normalized.includes("united states publication")
  );
}

// Returns a required publication region for awards with strict national eligibility.
// Awards listed as "/ International" return undefined — any publisher is eligible.
export function awardRequiredPublicationRegion(geography: string | undefined): string | undefined {
  if (!geography) return undefined;
  if (geography === "United States" || geography === "United States publication") return "us";
  if (geography === "United Kingdom") return "gb";
  return undefined;
}
