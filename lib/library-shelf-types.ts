export type LibraryShelfRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  thumbnailUrl?: string;
  primarySubject?: string;
  callNumber: string;
  mainClass: string;
  subclass: string;
  confidence: "high" | "medium";
  sourceId: string;
};

export type LibraryShelfClass = {
  code: string;
  label: string;
  count: number;
  startIndex: number;
  endIndex: number;
};

export type LibraryShelfArtifact = {
  generatedAt: string;
  policyVersion: number;
  stats: {
    catalogBooks: number;
    shelfBooks: number;
    highConfidence: number;
    mediumConfidence: number;
  };
  classes: LibraryShelfClass[];
  rows: LibraryShelfRow[];
};

export type LibraryShelfNeighborhood = {
  selected: LibraryShelfRow;
  before: LibraryShelfRow[];
  after: LibraryShelfRow[];
  position: number;
  total: number;
};

export type LibraryShelfWindow = {
  generatedAt: string;
  stats: LibraryShelfArtifact["stats"];
  classes: LibraryShelfClass[];
  selectedIndex: number;
  windowStart: number;
  windowEnd: number;
  rows: LibraryShelfRow[];
  query?: string;
  matchCount?: number;
};
