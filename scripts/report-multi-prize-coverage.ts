import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Book, PublicData } from "../lib/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const target = 0.95;

async function main() {
  const data = JSON.parse(await fs.readFile(path.join(root, "data", "cache", "catalog.full.generated.json"), "utf8")) as PublicData;
  const stats = new Map(data.stats.map((row) => [row.bookId, row]));
  const books = data.books.filter((book) => (stats.get(book.id)?.lists ?? 0) >= 2);
  const fields = {
    isbn13: (book: Book) => book.isbn13.length > 0,
    publicationYear: (book: Book) => Boolean(book.publicationYear),
    publisher: (book: Book) => Boolean(book.publisherId),
    pageCount: (book: Book) => Boolean(book.pageCount),
    summary: (book: Book) => Boolean(book.summary),
    cover: (book: Book) => Boolean(book.thumbnailUrl),
  };
  const requiredForTarget = Math.ceil(books.length * target);
  const coverage = Object.fromEntries(Object.entries(fields).map(([field, hasField]) => {
    const complete = books.filter(hasField);
    const missing = books.filter((book) => !hasField(book));
    return [field, {
      complete: complete.length,
      coverage: Number((complete.length / books.length).toFixed(4)),
      neededFor95Percent: Math.max(0, requiredForTarget - complete.length),
      missing: missing.map((book) => ({
        bookId: book.id,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        lists: stats.get(book.id)?.lists ?? 0,
        score: stats.get(book.id)?.score ?? 0,
        isbn13: book.isbn13,
      })).sort((a, b) => b.lists - a.lists || b.score - a.score || a.title.localeCompare(b.title)),
    }];
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    cohort: "Books recognized by at least two prize lists",
    target,
    totalBooks: books.length,
    requiredForTarget,
    coverage,
  };
  const reportPath = path.join(root, "data", "reports", "multi-prize-completion-report.json");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Multi-prize cohort: ${books.length} books. ${Object.entries(coverage).map(([field, row]) => `${field} ${(row.coverage * 100).toFixed(1)}%`).join("; ")}.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
