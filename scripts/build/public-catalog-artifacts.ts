import fs from "node:fs/promises";
import path from "node:path";
import type { BookDrawerPayload } from "../../lib/book-drawer-types";
import type { AwardStatus, Book, PublicData, SourceRef } from "../../lib/types";

export const FULL_CATALOG_CACHE_FILENAME = "catalog.full.generated.json";

type BookDetailArtifact = BookDrawerPayload & {
  sources: SourceRef[];
};

const statusLabels: Record<AwardStatus, string> = {
  winner: "Winner",
  co_winner: "Co-winner",
  finalist: "Finalist",
  shortlist: "Shortlist",
  longlist: "Longlist",
  honorable_mention: "Honorable mention",
  commended: "Commended",
  notable: "Notable",
  unknown: "Listed",
};

export async function writePublicCatalogArtifacts({
  cacheDir,
  data,
  publicDir,
}: {
  cacheDir: string;
  data: PublicData;
  publicDir: string;
}) {
  const detailDir = path.join(publicDir, "book-details");
  await Promise.all([
    fs.mkdir(cacheDir, { recursive: true }),
    fs.mkdir(detailDir, { recursive: true }),
  ]);

  const expectedDetailFiles = new Set(data.books.map((book) => `${book.id}.json`));
  const existingDetailFiles = await fs.readdir(detailDir).catch(() => [] as string[]);
  await Promise.all(existingDetailFiles
    .filter((filename) => filename.endsWith(".json") && !expectedDetailFiles.has(filename))
    .map((filename) => fs.unlink(path.join(detailDir, filename))));

  const statsByBookId = new Map(data.stats.map((row) => [row.bookId, row]));
  const awardsById = new Map(data.awards.map((award) => [award.id, award]));
  const imprintsById = new Map(data.imprints.map((imprint) => [imprint.id, imprint]));
  const publishersById = new Map(data.publishers.map((publisher) => [publisher.id, publisher]));
  const sourcesById = new Map(data.sources.map((source) => [source.id, source]));
  const evidenceByBookId = new Map((data.wikipediaEvidence ?? []).map((row) => [row.bookId, row]));
  const appearancesByBookId = groupBy(data.appearances, (appearance) => appearance.bookId);

  const compactBooks = data.books.map(compactBook);
  const booksArtifact = {
    generatedAt: data.generatedAt,
    books: compactBooks,
    stats: data.stats,
  };
  const entitiesArtifact = {
    generatedAt: data.generatedAt,
    awardPrograms: data.awardPrograms,
    awards: data.awards,
    editions: data.editions,
    appearances: data.appearances,
    publishers: data.publishers,
    imprints: data.imprints,
    subjects: data.subjects,
  };
  await Promise.all([
    fs.writeFile(path.join(cacheDir, FULL_CATALOG_CACHE_FILENAME), `${JSON.stringify(data)}\n`),
    fs.writeFile(path.join(publicDir, "catalog-books.json"), `${JSON.stringify(booksArtifact)}\n`),
    fs.writeFile(path.join(publicDir, "catalog-entities.json"), `${JSON.stringify(entitiesArtifact)}\n`),
  ]);

  for (const batch of chunks(data.books, 100)) {
    await Promise.all(batch.map(async (book) => {
      const appearances = appearancesByBookId.get(book.id) ?? [];
      const sourceIds = new Set([
        ...book.sourceIds,
        ...appearances.flatMap((appearance) => appearance.sourceIds),
      ]);
      const artifact: BookDetailArtifact = {
        book,
        appearances: appearances.map((appearance) => {
          const award = awardsById.get(appearance.awardId);
          return {
            ...appearance,
            award: award ? { awardType: award.awardType, name: award.name, slug: award.slug } : undefined,
            statusLabel: statusLabels[appearance.status],
          };
        }),
        imprint: book.imprintId ? imprintsById.get(book.imprintId)?.name : undefined,
        publisher: book.publisherId ? publishersById.get(book.publisherId)?.name : undefined,
        stats: statsByBookId.get(book.id) ?? emptyBookStats(book.id),
        wikipediaEvidence: evidenceByBookId.get(book.id),
        sources: [...sourceIds].map((sourceId) => sourcesById.get(sourceId)).filter((source): source is SourceRef => Boolean(source)),
      };
      await fs.writeFile(path.join(detailDir, `${book.id}.json`), `${JSON.stringify(artifact)}\n`);
    }));
  }
}

function compactBook(book: Book): Book {
  const {
    displaySummary: _displaySummary,
    experimentalSemanticProfile: _experimentalSemanticProfile,
    nytBestseller: _nytBestseller,
    readerProfile: _readerProfile,
    relatedBookIds: _relatedBookIds,
    subjectCategories: _subjectCategories,
    subjectEvidence: _subjectEvidence,
    summary: _summary,
    ...compact
  } = book;
  return compact;
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string) {
  const rows = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const current = rows.get(key) ?? [];
    current.push(item);
    rows.set(key, current);
  }
  return rows;
}

function chunks<T>(items: T[], size: number) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

function emptyBookStats(bookId: string): BookDrawerPayload["stats"] {
  return {
    bookId,
    wins: 0,
    lists: 0,
    score: 0,
    majorWins: 0,
    normalWins: 0,
    majorShortlists: 0,
    normalShortlists: 0,
    majorLonglists: 0,
    normalLonglists: 0,
    statuses: {
      winner: 0,
      co_winner: 0,
      finalist: 0,
      shortlist: 0,
      longlist: 0,
      honorable_mention: 0,
      commended: 0,
      notable: 0,
      unknown: 0,
    },
  };
}
