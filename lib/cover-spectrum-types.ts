export type CoverSpectrumBook = {
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  primarySubject?: string;
  wins: number;
  lists: number;
  score: number;
  thumbnailUrl: string;
};

export type CoverSpectrumLayout = {
  columns: number;
  rows: number;
  imageUrl: string;
  order: number[];
};

export type CoverSpectrumData = {
  generatedAt: string;
  count: number;
  books: CoverSpectrumBook[];
  layouts: {
    desktop: CoverSpectrumLayout;
    mobile: CoverSpectrumLayout;
  };
};
