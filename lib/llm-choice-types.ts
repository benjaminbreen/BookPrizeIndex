export type LlmChoiceTagDimension = "craft" | "evidence" | "stance";

export type LlmChoiceBook = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  thumbnailUrl?: string;
  primaryTopic?: string;
  /** 0-100 model self-reported pull toward the book. */
  affinity: number;
  /** 0-100 model-estimated general recognition. */
  fame: number;
  /** 0-100 standing among critics and scholars. */
  criticalRenown: number;
  /** affinity net of what fame predicts. The "loves it, nobody reads it" axis. */
  residual: number;
  tags: Record<LlmChoiceTagDimension, string>;
  /** One-sentence model rationale for the affinity score. */
  note?: string;
};

export type LlmChoiceData = {
  generatedAt: string;
  model: string;
  /** Books carrying a renown profile the model actually recognized. */
  count: number;
  /** Corpus-wide means, used to caption the scatter and the stat rail. */
  meanAffinity: number;
  meanFame: number;
  /** Pearson r between affinity and fame across the scored corpus. */
  affinityFameCorrelation: number;
  tagCounts: Record<LlmChoiceTagDimension, Array<{ value: string; count: number }>>;
  /** Ranked descending by residual. */
  overlooked: LlmChoiceBook[];
  /** Ranked descending by raw affinity. */
  favorites: LlmChoiceBook[];
  /**
   * Binned density over (fame, affinity) rather than 7,554 raw points: the raw
   * scatter was 1.3 MB and rendered as overlapping mush. `x` and `y` are bin indices
   * into a GRID x GRID lattice over 0-100.
   */
  grid: number;
  density: Array<{ x: number; y: number; n: number }>;
};
