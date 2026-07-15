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
export type AwardRegistryType = "major_award" | "award";
export type PrizeScope = "general" | "subject" | "discipline";

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
  awardType?: AwardRegistryType;
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
  awardType?: AwardRegistryType;
  scope?: PrizeScope;
  organization: string;
  geography: string;
  /** First year the prize was awarded (real-world founding, which may predate corpus coverage). */
  foundedYear?: number;
  /** Final year the prize was awarded, when the prize has been discontinued. */
  discontinuedYear?: number;
  /** Inclusive [start, end] year ranges when the prize was not awarded (e.g. wartime hiatus). */
  dormantYears?: Array<[number, number]>;
  officialUrl?: string;
  notes?: string;
  categories: PrizeCategoryRegistryEntry[];
};
