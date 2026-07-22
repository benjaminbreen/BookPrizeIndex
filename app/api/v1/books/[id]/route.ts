import { apiResponse, readPublicRelease } from "@/lib/public-api-data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const release = await readPublicRelease();
  const { id } = await params;
  const book = release.books.find((candidate) => candidate.id === id || candidate.slug === id);
  if (!book) return apiResponse(release, null, { error: "Book not found." }, 404);

  const awards = new Map(release.awards.map((award) => [award.id, award]));
  const appearances = release.appearances
    .filter((appearance) => appearance.bookId === book.id)
    .sort((a, b) => b.year - a.year || a.statusRank - b.statusRank)
    .map((appearance) => ({ ...appearance, award: awards.get(appearance.awardId) }));
  const sourceIds = new Set([...book.sourceIds, ...appearances.flatMap((appearance) => appearance.sourceIds)]);
  const sources = release.sources.filter((source) => sourceIds.has(source.id));

  return apiResponse(release, { ...book, appearances, sources });
}
