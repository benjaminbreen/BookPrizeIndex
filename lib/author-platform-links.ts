import curatedPlatforms from "@/sources/author-platforms.json";
import generatedPeople from "@/sources/enrichment/people.generated.json";
import type { BookAuthorPlatformLink } from "@/lib/book-drawer-types";
import type { Person } from "@/lib/types";

type Platform = {
  service?: string;
  title?: string;
  url?: string;
};

type PlatformProfiles = Record<string, { platforms?: Platform[] }>;

const platformsByPersonId = buildPlatformIndex([
  generatedPeople.profiles as PlatformProfiles,
  curatedPlatforms.profiles as PlatformProfiles,
]);

export function authorPlatformLinksFor(authors: Person[]): BookAuthorPlatformLink[] {
  return authors.flatMap((author) => (
    (platformsByPersonId.get(author.id) ?? []).map((platform) => ({
      ...platform,
      authorName: author.name,
      personId: author.id,
    }))
  ));
}

function buildPlatformIndex(profileSets: PlatformProfiles[]) {
  const rows = new Map<string, Array<Omit<BookAuthorPlatformLink, "authorName" | "personId">>>();
  for (const profiles of profileSets) {
    for (const [personId, profile] of Object.entries(profiles)) {
      for (const platform of profile.platforms ?? []) {
        if (platform.service !== "substack" || !platform.url) continue;
        const current = rows.get(personId) ?? [];
        if (current.some((item) => item.url === platform.url)) continue;
        current.push({ service: "substack", title: platform.title, url: platform.url });
        rows.set(personId, current);
      }
    }
  }
  return rows;
}
