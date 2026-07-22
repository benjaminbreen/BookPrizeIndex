import type { PublicData } from "@/lib/types";

export const PUBLIC_DATA_LICENSE = "CC-BY-4.0";
export const PUBLIC_DATA_SCHEMA_VERSION = "1";

export type PublicRelease = ReturnType<typeof buildPublicRelease>;
export type PublicReleaseBook = PublicRelease["books"][number];
export type PublicReleaseAppearance = PublicRelease["appearances"][number];

export function buildPublicRelease(data: PublicData) {
  const datasetVersion = data.generatedAt.slice(0, 10);

  return {
    schemaVersion: PUBLIC_DATA_SCHEMA_VERSION,
    datasetVersion,
    generatedAt: data.generatedAt,
    license: PUBLIC_DATA_LICENSE,
    books: data.books.map((book) => ({
      id: book.id,
      slug: book.slug,
      title: book.title,
      subtitle: book.subtitle,
      authors: book.authors.map(({ id, name }) => ({ id, name })),
      publicationYear: book.publicationYear,
      publisherId: book.publisherId,
      imprintId: book.imprintId,
      pageCount: book.pageCount,
      isbn13: book.isbn13,
      primarySubject: book.primarySubject,
      subjects: book.subjects,
      primaryTopic: book.primaryTopic,
      topics: book.topics,
      links: {
        publisher: book.links.publisher,
        worldcat: book.links.worldcat,
        wikipedia: book.links.wikipedia,
        wikidata: book.links.wikidata,
      },
      sourceIds: book.sourceIds,
    })),
    awardPrograms: data.awardPrograms.map((program) => ({
      id: program.id,
      slug: program.slug,
      name: program.name,
      organization: program.organization,
      geography: program.geography,
      officialUrl: program.officialUrl,
      sourceIds: program.sourceIds,
    })),
    awards: data.awards.map((award) => ({
      id: award.id,
      slug: award.slug,
      name: award.name,
      programId: award.programId,
      categoryName: award.categoryName,
      categoryYears: award.categoryYears,
      shortName: award.shortName,
      awardType: award.awardType,
      scope: award.scope,
      organization: award.organization,
      geography: award.geography,
      subjectAreas: award.subjectAreas,
      officialUrl: award.links.official,
      sourceIds: award.sourceIds,
    })),
    editions: data.editions.map((edition) => ({ ...edition })),
    appearances: data.appearances.map((appearance) => ({ ...appearance })),
    publishers: data.publishers.map((publisher) => ({ ...publisher })),
    imprints: data.imprints.map((imprint) => ({ ...imprint })),
    subjects: data.subjects.map((subject) => ({ ...subject })),
    sources: data.sources.map((source) => ({ ...source })),
  };
}

export function releaseCounts(release: PublicRelease) {
  return {
    books: release.books.length,
    awardPrograms: release.awardPrograms.length,
    awards: release.awards.length,
    editions: release.editions.length,
    appearances: release.appearances.length,
    publishers: release.publishers.length,
    imprints: release.imprints.length,
    subjects: release.subjects.length,
    sources: release.sources.length,
  };
}
