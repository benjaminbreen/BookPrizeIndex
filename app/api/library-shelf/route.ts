import { getLibraryShelfWindow } from "@/lib/library-shelf-data";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const indexValue = Number(params.get("index"));
  const radiusValue = Number(params.get("radius"));
  const payload = getLibraryShelfWindow({
    book: params.get("book")?.trim() || undefined,
    classCode: params.get("class")?.trim() || undefined,
    index: Number.isFinite(indexValue) ? indexValue : undefined,
    query: params.get("q")?.trim() || undefined,
    radius: Number.isFinite(radiusValue) ? radiusValue : undefined,
  });
  return Response.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" },
  });
}
