import { apiResponse, paginate, pagination, readPublicRelease } from "@/lib/public-api-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const release = await readPublicRelease();
  const searchParams = new URL(request.url).searchParams;
  const awardId = searchParams.get("awardId")?.trim();
  const programId = searchParams.get("programId")?.trim();
  const bookId = searchParams.get("bookId")?.trim();
  const status = searchParams.get("status")?.trim();
  const year = Number(searchParams.get("year"));
  const yearFrom = Number(searchParams.get("yearFrom"));
  const yearTo = Number(searchParams.get("yearTo"));
  const { page, pageSize } = pagination(searchParams);
  const books = new Map(release.books.map((book) => [book.id, book]));
  const awards = new Map(release.awards.map((award) => [award.id, award]));

  const rows = release.appearances
    .filter((appearance) => {
      const award = awards.get(appearance.awardId);
      if (awardId && appearance.awardId !== awardId) return false;
      if (programId && award?.programId !== programId) return false;
      if (bookId && appearance.bookId !== bookId) return false;
      if (status && appearance.status !== status) return false;
      if (Number.isFinite(year) && year > 0 && appearance.year !== year) return false;
      if (Number.isFinite(yearFrom) && yearFrom > 0 && appearance.year < yearFrom) return false;
      if (Number.isFinite(yearTo) && yearTo > 0 && appearance.year > yearTo) return false;
      return true;
    })
    .sort((a, b) => b.year - a.year || a.awardId.localeCompare(b.awardId) || a.bookId.localeCompare(b.bookId))
    .map((appearance) => {
      const book = books.get(appearance.bookId);
      const award = awards.get(appearance.awardId);
      return {
        ...appearance,
        book: book ? { id: book.id, slug: book.slug, title: book.title, authors: book.authors } : undefined,
        award: award ? { id: award.id, slug: award.slug, name: award.name, programId: award.programId } : undefined,
      };
    });
  const result = paginate(rows, page, pageSize);

  return apiResponse(release, result.rows, {
    page: result.currentPage,
    pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}
