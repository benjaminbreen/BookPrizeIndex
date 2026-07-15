import { browseData } from "@/lib/browse-data";
import { queryBookCatalog, type BookCatalogQuery } from "@/lib/book-catalog-query";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as BookCatalogQuery | null;
  if (!body) return Response.json({ error: "Invalid catalog query." }, { status: 400 });
  return Response.json(queryBookCatalog(browseData.books, body), {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}
