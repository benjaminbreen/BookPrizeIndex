import { compareLibraryCallNumbers, stableFilingKey } from "../../lib/library-call-number";
import type { LibraryShelfArtifact, LibraryShelfRow } from "../../lib/library-shelf-types";
import type { PublicData } from "../../lib/types";

export type LibraryClassDefinition = {
  code: string;
  label: string;
};

export function buildLibraryShelf(
  data: PublicData,
  classDefinitions: LibraryClassDefinition[],
): LibraryShelfArtifact {
  const booksById = new Map(data.books.map((book) => [book.id, book]));
  const rows = data.books
    .filter((book) => book.libraryShelf?.completeness === "full_call_number")
    .map((book): LibraryShelfRow => ({
      id: book.id,
      slug: book.slug,
      title: book.title,
      author: book.authors.map((author) => author.name).join(", "),
      publicationYear: book.publicationYear,
      thumbnailUrl: book.thumbnailUrl,
      primarySubject: book.primarySubject,
      callNumber: book.libraryShelf!.callNumber,
      mainClass: book.libraryShelf!.mainClass,
      subclass: book.libraryShelf!.subclass,
      confidence: book.libraryShelf!.confidence,
      sourceId: book.libraryShelf!.sourceId,
    }))
    .sort((a, b) => {
      const aBook = booksById.get(a.id)!;
      const bBook = booksById.get(b.id)!;
      return (
        compareLibraryCallNumbers(aBook.libraryShelf!.sort, bBook.libraryShelf!.sort) ||
        asciiCompare(stableFilingKey(a.author), stableFilingKey(b.author)) ||
        asciiCompare(stableFilingKey(a.title), stableFilingKey(b.title)) ||
        (a.publicationYear ?? 0) - (b.publicationYear ?? 0) ||
        asciiCompare(a.id, b.id)
      );
    });

  const definitionsByCode = new Map(classDefinitions.map((definition) => [definition.code, definition]));
  const classes = [...new Set(rows.map((row) => row.mainClass))]
    .map((code) => {
      const startIndex = rows.findIndex((row) => row.mainClass === code);
      let endIndex = startIndex;
      while (endIndex + 1 < rows.length && rows[endIndex + 1].mainClass === code) endIndex += 1;
      return {
        code,
        label: definitionsByCode.get(code)?.label ?? code,
        count: endIndex - startIndex + 1,
        startIndex,
        endIndex,
      };
    });

  return {
    generatedAt: data.generatedAt,
    policyVersion: 1,
    stats: {
      catalogBooks: data.books.length,
      shelfBooks: rows.length,
      highConfidence: rows.filter((row) => row.confidence === "high").length,
      mediumConfidence: rows.filter((row) => row.confidence === "medium").length,
    },
    classes,
    rows,
  };
}

function asciiCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
