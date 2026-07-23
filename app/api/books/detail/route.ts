import { readBookDetailArtifact } from "@/lib/book-detail-artifacts";
import { authorPlatformLinksFor } from "@/lib/author-platform-links";
import { libraryShelfNeighborhoodFor } from "@/lib/library-shelf-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get("id")?.trim();
  if (!bookId) return Response.json({ error: "A book id is required." }, { status: 400 });
  const payload = await readBookDetailArtifact(bookId);
  if (!payload) return Response.json({ error: "Book not found." }, { status: 404 });
  return Response.json({
    ...payload,
    authorPlatforms: authorPlatformLinksFor(payload.book.authors),
    shelfNeighborhood: libraryShelfNeighborhoodFor(payload.book.id),
  }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" } });
}
