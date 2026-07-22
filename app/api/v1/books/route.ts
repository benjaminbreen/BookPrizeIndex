import { apiResponse, normalized, paginate, pagination, readPublicRelease } from "@/lib/public-api-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const release = await readPublicRelease();
  const searchParams = new URL(request.url).searchParams;
  const query = normalized(searchParams.get("query"));
  const subject = normalized(searchParams.get("subject"));
  const awardId = searchParams.get("awardId")?.trim();
  const publicationYear = Number(searchParams.get("publicationYear"));
  const { page, pageSize } = pagination(searchParams);
  const recognizedBookIds = awardId
    ? new Set(release.appearances.filter((appearance) => appearance.awardId === awardId).map((appearance) => appearance.bookId))
    : null;

  const rows = release.books
    .filter((book) => {
      if (recognizedBookIds && !recognizedBookIds.has(book.id)) return false;
      if (subject && !book.subjects.some((value) => value.toLowerCase() === subject)) return false;
      if (Number.isFinite(publicationYear) && publicationYear > 0 && book.publicationYear !== publicationYear) return false;
      if (!query) return true;
      const searchText = [
        book.title,
        book.subtitle,
        ...book.authors.map((author) => author.name),
        ...book.subjects,
        ...book.topics,
        ...book.isbn13,
      ].filter(Boolean).join(" ").toLowerCase();
      return searchText.includes(query);
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const result = paginate(rows, page, pageSize);

  return apiResponse(release, result.rows, {
    page: result.currentPage,
    pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}
