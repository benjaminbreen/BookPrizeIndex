import type { AwardSubmission } from "./award-submission";

export type { AwardSubmission } from "./award-submission";

export type AwardStatus =
  | "winner"
  | "co_winner"
  | "finalist"
  | "shortlist"
  | "longlist"
  | "honorable_mention"
  | "commended"
  | "notable"
  | "unknown";

export type SourceConfidence = "official" | "secondary" | "catalog" | "retailer" | "manual" | "unknown";

export type SourceRef = {
  id: string;
  label: string;
  url: string;
  accessedAt?: string;
  field?: string;
  confidence: SourceConfidence;
  note?: string;
};

export type Publisher = {
  id: string;
  name: string;
  region?: string; // ISO 2-letter country code: "us", "gb", "ca", "au"
  websiteUrl?: string;
  sourceIds: string[];
};

export type Imprint = {
  id: string;
  name: string;
  shortName?: string;
  publisherId?: string;
  websiteUrl?: string;
  sourceIds: string[];
};

export type Person = {
  id: string;
  name: string;
};

export type SubjectEvidenceSource =
  | "manual_curation"
  | "bisac"
  | "google_books"
  | "open_library"
  | "publisher"
  | "award_category"
  | "topic_classifier"
  | "keyword_classifier"
  | "llm_classifier";

export type SubjectEvidence = {
  id: string;
  source: SubjectEvidenceSource;
  scheme?: string;
  rawLabel: string;
  mappedSubject: string;
  score: number;
  confidence: "high" | "medium" | "low";
  note?: string;
  sourceId?: string;
};

export type SubjectDecision = {
  primarySubject: string;
  confidence: "high" | "medium" | "low";
  method: "manual" | "evidence_score" | "fallback";
  candidates: Array<{
    subject: string;
    score: number;
    evidenceCount: number;
  }>;
  evidence: SubjectEvidence[];
};

export type BookSubjectCategory = {
  source: "bisac" | "google_books" | "open_library" | "publisher";
  scheme?: string;
  label: string;
  sourceId?: string;
};

export type ReaderTraitConfidence = "high" | "medium" | "low";

export type BookReaderTrait = {
  id: string;
  score: number;
  confidence: ReaderTraitConfidence;
  evidence: string[];
};

export type BookReaderProfile = {
  readerLevel: "popular" | "crossover" | "academic" | "reference";
  narrativeScore: number;
  accessibilityScore: number;
  scholarlyScore: number;
  traits: BookReaderTrait[];
  method?: string;
};

export type LibraryCallNumberSortParts = {
  classLetters: string;
  classWholeNumber: number;
  classDecimalDigits?: string;
  cutters: Array<{
    letters: string;
    decimalDigits: string;
  }>;
  year?: number;
  suffix?: string;
  trailingTokens?: string[];
};

export type LibraryShelfPlacement = {
  scheme: "lcc";
  callNumber: string;
  rawCallNumber: string;
  mainClass: string;
  subclass: string;
  completeness: "full_call_number" | "classification_only";
  confidence: "high" | "medium";
  matchedBy:
    | "manual"
    | "loc_exact_isbn"
    | "open_library_exact_isbn"
    | "open_library_work_consensus";
  sourceId: string;
  sourceEditionId?: string;
  sourceWorkId?: string;
  sourceIsbn13?: string;
  sort: LibraryCallNumberSortParts;
};

export type ExperimentalSemanticEntity = {
  name: string;
  confidence: number;
};

export type ExperimentalSemanticProfile = {
  centralFigures: ExperimentalSemanticEntity[];
  centralPlaces: ExperimentalSemanticEntity[];
  argument: {
    present: boolean;
    statement: string;
    confidence: number;
  };
  academicOrientation: {
    score: number;
    confidence: number;
  };
  profileConfidence: number;
  lowerConfidenceCandidates?: {
    centralFigures?: ExperimentalSemanticEntity[];
    centralPlaces?: ExperimentalSemanticEntity[];
    argument?: {
      statement: string;
      confidence: number;
    };
  };
  model: string;
  promptVersion: number;
  inputHash: string;
  reviewStatus: "unreviewed" | "flagged" | "reviewed";
  validationWarnings?: string[];
};

export type Book = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  authors: Person[];
  publicationYear?: number;
  publisherId?: string;
  imprintId?: string;
  pageCount?: number;
  isbn13: string[];
  /**
   * ISO 639-1 code of the language the work was written in. Absent means English:
   * the catalog was anglophone-only before international prizes were added, so
   * absence is the safe default rather than "unknown".
   */
  originalLanguage?: string;
  /**
   * Whether an anglophone reader can actually read this book. True for English
   * originals and for works with a confirmed translation. Drives the default
   * semantic-search filter — untranslated books stay in the catalog and on award
   * pages but are withheld from retrieval unless the reader opts in.
   */
  hasEnglishEdition?: boolean;
  englishEdition?: {
    title?: string;
    year?: number;
    publisher?: string;
    isbn13?: string;
  };
  libraryShelf?: LibraryShelfPlacement;
  primarySubject?: string;
  subjects: string[];
  subjectCategories?: BookSubjectCategory[];
  subjectEvidence?: SubjectDecision;
  readerProfile?: BookReaderProfile;
  primaryTopic?: string;
  topics: string[];
  relatedBookIds?: string[];
  centralFigures: string[];
  experimentalSemanticProfile?: ExperimentalSemanticProfile;
  nytBestseller?: NytBestsellerStats;
  summary?: string;
  displaySummary?: string;
  thumbnailUrl?: string;
  links: {
    publisher?: string;
    amazon?: string;
    bookshop?: string;
    indiebound?: string;
    worldcat?: string;
    wikipedia?: string;
    wikidata?: string;
  };
  sourceIds: string[];
};

export type NytBestsellerListStats = {
  listName: string;
  displayName: string;
  firstPublishedDate: string;
  latestPublishedDate: string;
  bestRank: number;
  weeksOnList: number;
  appearances: number;
};

export type NytBestsellerStats = {
  provider: "new_york_times";
  matchedBy: "isbn13" | "title_author";
  firstPublishedDate: string;
  latestPublishedDate: string;
  bestRank: number;
  weeksOnList: number;
  appearances: number;
  lists: NytBestsellerListStats[];
};

export type Award = {
  id: string;
  slug: string;
  name: string;
  programId?: string;
  categoryName?: string;
  categoryYears?: string;
  shortName?: string;
  awardType?: "major_award" | "award";
  scope?: "general" | "subject" | "discipline";
  organization?: string;
  description?: string;
  geography?: string;
  subjectAreas: string[];
  /** Legacy free-text deadline. Prefer `submission`. */
  deadline?: string;
  submission?: AwardSubmission;
  criteria?: string;
  prizeAmount?: string;
  logoUrl?: string;
  logoAlt?: string;
  logoSourceUrl?: string;
  logoCredit?: string;
  links: {
    official?: string;
    criteria?: string;
    submission?: string;
  };
  sourceIds: string[];
};

export type AwardProgram = {
  id: string;
  slug: string;
  name: string;
  organization?: string;
  description?: string;
  geography?: string;
  notes?: string;
  officialUrl?: string;
  submission?: AwardSubmission;
  sourceIds: string[];
};

export type AwardEdition = {
  id: string;
  awardId: string;
  year: number;
  category?: string;
  announcementUrl?: string;
  sourceIds: string[];
};

export type AwardAppearance = {
  id: string;
  bookId: string;
  awardId: string;
  awardEditionId: string;
  year: number;
  status: AwardStatus;
  originalStatus: string;
  statusRank: number;
  isTie: boolean;
  sourceUrl?: string;
  sourceIds: string[];
};

export type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  bookCount: number;
  description?: string;
  sortOrder?: number;
  fallback?: boolean;
  topBookId?: string;
};

export type SubjectDefinition = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  fallback?: boolean;
};

export type TopicDefinition = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type BookStats = {
  bookId: string;
  wins: number;
  lists: number;
  score: number;
  majorWins: number;
  normalWins: number;
  majorShortlists: number;
  normalShortlists: number;
  majorLonglists: number;
  normalLonglists: number;
  statuses: Record<AwardStatus, number>;
};

export type PublisherEvidenceSource =
  | "wikipedia_infobox"
  | "award_record"
  | "catalog_metadata"
  | "manual";

export type PublisherEvidence = {
  id: string;
  bookId: string;
  rawName: string;
  source: PublisherEvidenceSource;
  confidence: "high" | "medium" | "low";
  sourceUrl?: string;
  sourceId?: string;
  note?: string;
};

export type WikipediaBookEvidence = {
  bookId: string;
  pageTitle: string;
  pageId?: number;
  wikidataId?: string;
  url: string;
  revisionId?: number;
  accessedAt?: string;
  extract?: string;
  matchedBy: string;
  confidence: "high" | "medium" | "low";
  attribution: {
    label: string;
    url: string;
    license: string;
    licenseUrl: string;
  };
  infobox?: {
    title?: string;
    author?: string;
    publisher?: string;
    publicationDate?: string;
    publicationPlace?: string;
    pages?: string;
    isbn?: string;
    language?: string;
    subject?: string;
    genre?: string;
  };
  publisherEvidenceId?: string;
};

export type PublicData = {
  generatedAt: string;
  books: Book[];
  awardPrograms: AwardProgram[];
  awards: Award[];
  editions: AwardEdition[];
  appearances: AwardAppearance[];
  publishers: Publisher[];
  imprints: Imprint[];
  subjects: SubjectSummary[];
  sources: SourceRef[];
  stats: BookStats[];
  wikipediaEvidence?: WikipediaBookEvidence[];
};
