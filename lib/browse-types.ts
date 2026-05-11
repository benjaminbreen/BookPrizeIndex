import type { AwardRegionFilter } from "@/lib/award-region";

export type BrowseBookRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  publisher?: string;
  imprint?: string;
  wins: number;
  lists: number;
  score: number;
  majorWins: number;
  majorShortlists: number;
  normalShortlists: number;
  majorLonglists: number;
  normalLonglists: number;
  searchText: string;
};

export type BrowseLinkRow = {
  id: string;
  slug: string;
  name: string;
  count: number;
};

export type BrowseAwardRow = {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  description: string;
  geography?: string;
  subjects: string[];
  deadline?: string;
  typeLabel: string;
  yearRange: string;
  records: number;
  searchText: string;
};

export type BrowseSubjectRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  bookCount: number;
  topBook?: {
    id: string;
    slug: string;
    title: string;
    author: string;
    publicationYear?: number;
  };
  searchText: string;
};

export type BrowseFilterKey = `${AwardRegionFilter}:${"all" | "fiction" | "nonfiction"}`;

export type BrowseData = {
  generatedAt: string;
  stats: {
    books: number;
    appearances: number;
    prizes: number;
    imprints: number;
  };
  books: BrowseBookRow[];
  home: Record<BrowseFilterKey, {
    subjects: BrowseLinkRow[];
    awards: BrowseLinkRow[];
  }>;
  awards: BrowseAwardRow[];
  subjects: Record<BrowseFilterKey, BrowseSubjectRow[]>;
};
