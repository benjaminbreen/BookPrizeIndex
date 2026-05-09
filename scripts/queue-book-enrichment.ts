import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, getBookStats } from "../lib/data";
import type { Book } from "../lib/types";

type MissingBookField = "isbn13" | "pageCount" | "summary" | "thumbnailUrl" | "publisherLink" | "wikipedia";

type QueueRow = {
  bookId: string;
  slug: string;
  title: string;
  author: string;
  score: number;
  missingFields: MissingBookField[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDataDir = path.join(root, "data", "public");
const limit = Number(process.env.ENRICH_LIMIT ?? readArg("--limit") ?? "100");

async function main() {
  const generatedAt = new Date().toISOString();
  const queue = data.books
    .map((book) => toQueueRow(book))
    .filter((row) => row.missingFields.length > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(
    path.join(publicDataDir, "book-enrichment-queue.json"),
    `${JSON.stringify({ generatedAt, limit, count: queue.length, queue }, null, 2)}\n`,
  );

  console.log(`Queued ${queue.length} books for enrichment. Report written to data/public/book-enrichment-queue.json.`);
}

function toQueueRow(book: Book): QueueRow {
  const missingFields: MissingBookField[] = [];
  if (!book.isbn13.length) missingFields.push("isbn13");
  if (!book.pageCount) missingFields.push("pageCount");
  if (!book.summary) missingFields.push("summary");
  if (!book.thumbnailUrl) missingFields.push("thumbnailUrl");
  if (!book.links.publisher) missingFields.push("publisherLink");
  if (!book.links.wikipedia) missingFields.push("wikipedia");

  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    author: book.authors.map((item) => item.name).join(" "),
    score: getBookStats(book.id).score,
    missingFields,
  };
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
