import { NextRequest, NextResponse } from "next/server";
import { browseBooksByImprintId, browseBooksByPublisherId } from "@/lib/browse-data";
import { sortBrowseBooksByRecognition } from "@/lib/browse-ranking";

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!id || (type !== "imprint" && type !== "publisher")) {
    return NextResponse.json({ error: "Expected type=imprint|publisher and id." }, { status: 400 });
  }

  const books = sortBrowseBooksByRecognition(
    type === "imprint" ? browseBooksByImprintId.get(id) ?? [] : browseBooksByPublisherId.get(id) ?? [],
  );

  return NextResponse.json(
    { books, count: books.length },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
