import type { AwardRegionFilter } from "@/lib/award-region";
import type { AwardSubmission } from "@/lib/award-submission";

export type BrowseBookRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  authors: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  publicationYear?: number;
  firstRecognitionYear?: number;
  publisherId?: string;
  publisher?: string;
  imprintId?: string;
  imprint?: string;
  thumbnailUrl?: string;
  primarySubject?: string;
  subjects: string[];
  primaryTopic?: string;
  topics: string[];
  awardIds: string[];
  wins: number;
  lists: number;
  score: number;
  majorWins: number;
  majorShortlists: number;
  normalShortlists: number;
  majorLonglists: number;
  normalLonglists: number;
  hasIsbn: boolean;
  hasLibraryShelfPlacement?: boolean;
  hasPageCount: boolean;
  hasCover: boolean;
  hasSummary: boolean;
  hasPublisher: boolean;
  searchText: string;
  recognitionByRegion?: Record<AwardRegionFilter, BrowseBookRecognitionStats>;
};

export type BrowseBookRecognitionStats = {
  awardIds: string[];
  firstRecognitionYear?: number;
  lists: number;
  majorLonglists: number;
  majorShortlists: number;
  majorWins: number;
  normalLonglists: number;
  normalShortlists: number;
  score: number;
  wins: number;
};

export type BrowseLinkRow = {
  id: string;
  slug: string;
  name: string;
  count: number;
};

export type BrowseAwardRow = {
  id: string;
  awardIds: string[];
  slug: string;
  name: string;
  shortName?: string;
  description: string;
  geography?: string;
  subjects: string[];
  submission?: AwardSubmission;
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
    programs: number;
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
