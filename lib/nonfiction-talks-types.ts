export type NonfictionTalksClaim = {
  /** Index into NonfictionTalksData.stances. */
  stance: number;
  /** Index into NonfictionTalksData.subjects. */
  subject: number;
  title: string;
  slug: string;
  /** The one-sentence interpretive claim. */
  claim: string;
};

export type NonfictionTalksYear = {
  year: number;
  /** Claimed books, pre-sorted by stance so colour reads as bands. */
  claims: NonfictionTalksClaim[];
  /**
   * Books recognized that year with no extracted claim. Rendered as a faint tail so
   * the true corpus shape shows behind the claimed portion rather than being hidden.
   */
  unclaimed: number;
};

export type NonfictionTalksData = {
  generatedAt: string;
  /** Books carrying an interpretive claim and a publication year. */
  claimCount: number;
  /** All books with a publication year in range, claimed or not. */
  bookCount: number;
  minYear: number;
  maxYear: number;
  /** Widest year, used to scale strip width so the longest row fits its container. */
  maxRow: number;
  subjects: string[];
  stances: string[];
  years: NonfictionTalksYear[];
};
