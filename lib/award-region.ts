import type { Award, AwardProgram } from "@/lib/types";

export type AwardRegionFilter = "us" | "world";

export const AWARD_REGION_COOKIE = "bpi_award_region";

export function normalizeAwardRegion(value: string | undefined | null): AwardRegionFilter {
  return value === "us" ? "us" : "world";
}

export function awardRegionFromCountry(country: string | undefined | null): AwardRegionFilter {
  return country?.toUpperCase() === "US" ? "us" : "world";
}

export function regionLabel(region: AwardRegionFilter) {
  return region === "us" ? "US" : "World";
}

export function matchesAwardRegion(
  item: Pick<Award, "geography" | "name" | "programId">,
  filter: AwardRegionFilter,
  programsById?: Map<string, Pick<AwardProgram, "geography" | "name">>,
) {
  if (filter === "world") return true;
  return isUnitedStatesAward(item, programsById);
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
