import type { Award, AwardAppearance, Book, BookStats, WikipediaBookEvidence } from "@/lib/types";
import type { LibraryShelfNeighborhood } from "@/lib/library-shelf-types";

export type BookDrawerAppearance = AwardAppearance & {
  award?: Pick<Award, "awardType" | "name" | "slug">;
  statusLabel: string;
};

export type BookAuthorPlatformLink = {
  authorName: string;
  personId: string;
  service: "substack";
  title?: string;
  url: string;
};

export type BookDrawerPayload = {
  appearances: BookDrawerAppearance[];
  authorPlatforms?: BookAuthorPlatformLink[];
  book: Book;
  imprint?: string;
  publisher?: string;
  shelfNeighborhood?: LibraryShelfNeighborhood;
  stats: BookStats;
  wikipediaEvidence?: WikipediaBookEvidence;
};
