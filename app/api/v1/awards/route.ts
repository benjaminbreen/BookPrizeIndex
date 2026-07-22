import { apiResponse, normalized, readPublicRelease } from "@/lib/public-api-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const release = await readPublicRelease();
  const searchParams = new URL(request.url).searchParams;
  const query = normalized(searchParams.get("query"));
  const programId = searchParams.get("programId")?.trim();
  const scope = searchParams.get("scope")?.trim();
  const programs = new Map(release.awardPrograms.map((program) => [program.id, program]));
  const appearanceCounts = new Map<string, number>();
  for (const appearance of release.appearances) {
    appearanceCounts.set(appearance.awardId, (appearanceCounts.get(appearance.awardId) ?? 0) + 1);
  }

  const rows = release.awards
    .filter((award) => {
      if (programId && award.programId !== programId) return false;
      if (scope && award.scope !== scope) return false;
      if (query && ![award.name, award.shortName, award.categoryName].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((award) => ({
      ...award,
      program: award.programId ? programs.get(award.programId) : undefined,
      appearanceCount: appearanceCounts.get(award.id) ?? 0,
    }));

  return apiResponse(release, rows, { total: rows.length });
}
