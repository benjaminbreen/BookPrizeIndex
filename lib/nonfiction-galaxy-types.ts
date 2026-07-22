export type NonfictionGalaxyPoint = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  subjectIndex: number;
  primaryTopic?: string;
  recognitionScore: number;
  awardCount: number;
  isMajorWinner: boolean;
  thumbnailUrl?: string;
  x: number;
  y: number;
};

export type NonfictionGalaxySubject = {
  name: string;
  count: number;
  x: number;
  y: number;
};

export type NonfictionGalaxyData = {
  generatedAt: string;
  sourceGeneratedAt: string;
  sourceBrowseGeneratedAt: string;
  sourceInputHash: string;
  pointDataVersion: number;
  count: number;
  dimensions: number;
  projection: {
    algorithm: "UMAP";
    metric: "cosine";
    neighbors: number;
    minDist: number;
    epochs: number;
    seed: number;
  };
  subjects: NonfictionGalaxySubject[];
  points: NonfictionGalaxyPoint[];
};
