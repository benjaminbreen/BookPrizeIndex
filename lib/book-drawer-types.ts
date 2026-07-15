import type { Award, AwardAppearance, Book, BookStats, WikipediaBookEvidence } from "@/lib/types";

export type BookDrawerAppearance = AwardAppearance & {
  award?: Pick<Award, "awardType" | "name" | "slug">;
  statusLabel: string;
};

export type BookDrawerPayload = {
  appearances: BookDrawerAppearance[];
  book: Book;
  imprint?: string;
  publisher?: string;
  stats: BookStats;
  wikipediaEvidence?: WikipediaBookEvidence;
};
