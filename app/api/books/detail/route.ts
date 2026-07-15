import {
  appearancesByBookId,
  awardsById,
  booksById,
  getBookStats,
  imprintsById,
  publishersById,
  statusLabels,
  wikipediaEvidenceByBook,
} from "@/lib/data";
import type { BookDrawerPayload } from "@/lib/book-drawer-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get("id")?.trim();
  if (!bookId) return Response.json({ error: "A book id is required." }, { status: 400 });
  const book = booksById.get(bookId);
  if (!book) return Response.json({ error: "Book not found." }, { status: 404 });

  const payload: BookDrawerPayload = {
    book,
    appearances: (appearancesByBookId.get(bookId) ?? []).map((appearance) => {
      const award = awardsById.get(appearance.awardId);
      return {
        ...appearance,
        award: award ? { awardType: award.awardType, name: award.name, slug: award.slug } : undefined,
        statusLabel: statusLabels[appearance.status],
      };
    }),
    imprint: book.imprintId ? imprintsById.get(book.imprintId)?.name : undefined,
    publisher: book.publisherId ? publishersById.get(book.publisherId)?.name : undefined,
    stats: getBookStats(bookId),
    wikipediaEvidence: wikipediaEvidenceByBook.get(bookId),
  };
  return Response.json(payload, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" } });
}
