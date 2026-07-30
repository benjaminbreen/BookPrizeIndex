import { ImageResponse } from "next/og";
import { readSharedPersonalList } from "@/lib/personal-list-storage";

export const runtime = "nodejs";
export const revalidate = 31_536_000;
export const alt = "A reading list from The Book Prize Index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await readSharedPersonalList(id);
  const title = snapshot?.title ?? "Shared reading list";
  const books = snapshot?.results.slice(0, 4) ?? [];
  const total = snapshot?.results.length ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f4f1ea",
          color: "#181713",
          borderTop: "18px solid #8f2f24",
          padding: "48px 58px 42px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase" }}>
            The Book Prize Index
          </div>
          <div style={{ color: "#686258", fontSize: 18, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {snapshot?.creatorName ? `${snapshot.creatorName}’s reading list` : "Curated reading list"}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, gap: 48, paddingTop: 42 }}>
          <div style={{ display: "flex", flex: 1.1, flexDirection: "column" }}>
            <div style={{ color: "#8f2f24", fontSize: 18, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {`${total} ${total === 1 ? "book" : "books"}`}
            </div>
            <div style={{ marginTop: 18, fontFamily: "Georgia, serif", fontSize: title.length > 68 ? 48 : 58, lineHeight: 1.04 }}>
              {title}
            </div>
            {snapshot?.introduction ? (
              <div style={{ marginTop: 24, maxWidth: 660, color: "#686258", fontSize: 22, lineHeight: 1.42 }}>
                {previewText(snapshot.introduction, 180)}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", width: 390, flexDirection: "column", borderTop: "1px solid #d8d0c2" }}>
            {books.map((book, index) => (
              <div
                key={book.bookId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  minHeight: 82,
                  borderBottom: "1px solid #d8d0c2",
                  padding: "10px 0",
                }}
              >
                <div style={{ width: 30, color: "#8f2f24", fontSize: 16 }}>{String(index + 1).padStart(2, "0")}</div>
                <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 21, lineHeight: 1.15 }}>{previewText(book.title, 58)}</div>
                  <div style={{ marginTop: 5, color: "#686258", fontSize: 15 }}>{previewText(book.author, 42)}</div>
                </div>
              </div>
            ))}
            {total > books.length ? (
              <div style={{ display: "flex", paddingTop: 14, color: "#686258", fontSize: 15 }}>
                + {total - books.length} more
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #d8d0c2", paddingTop: 18, color: "#686258", fontSize: 15 }}>
          <span>Prize-recognized nonfiction</span>
          <span>bookprizeindex.org</span>
        </div>
      </div>
    ),
    size,
  );
}

function previewText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
