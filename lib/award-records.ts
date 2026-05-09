export type RawAwardRecordStatus =
  | "winner"
  | "co_winner"
  | "finalist"
  | "shortlist"
  | "longlist"
  | "honorable_mention"
  | "commended"
  | "unknown";

export type RawAwardRecordSourceConfidence = "official" | "secondary" | "manual" | "unknown";

export type RawAwardRecord = {
  awardId: string;
  awardName: string;
  categoryId: string;
  categoryName: string;
  year: number;
  status: RawAwardRecordStatus;
  title: string;
  authors: string[];
  publisher?: string;
  imprint?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceConfidence: RawAwardRecordSourceConfidence;
  notes?: string;
};

export type PrizeCategoryRegistryEntry = {
  id: string;
  name: string;
  officialUrl?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceConfidence: RawAwardRecordSourceConfidence;
  importStrategy: string;
  activeYears?: string;
  coverageNotes?: string;
};

export type PrizeRegistryEntry = {
  id: string;
  name: string;
  organization: string;
  geography: string;
  officialUrl?: string;
  notes?: string;
  categories: PrizeCategoryRegistryEntry[];
};
