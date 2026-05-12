import type { Award, AwardAppearance, AwardProgram, Book, BookStats, PublicData, SubjectSummary } from "../../lib/types";
import type { BrowseAwardRow, BrowseData, BrowseFilterKey, BrowseSubjectRow } from "../../lib/browse-types";

type TypeFilter = "all" | "fiction" | "nonfiction";
type RegionFilter = "us" | "international" | "all";

const filterKeys = [
  "us:all",
  "us:fiction",
  "us:nonfiction",
  "international:all",
  "international:fiction",
  "international:nonfiction",
  "all:all",
  "all:fiction",
  "all:nonfiction",
] as BrowseFilterKey[];

export function buildBrowseData(data: PublicData): BrowseData {
  const booksById = new Map(data.books.map((book) => [book.id, book]));
  const statsByBookId = new Map(data.stats.map((stat) => [stat.bookId, stat]));
  const awardsById = new Map(data.awards.map((award) => [award.id, award]));
  const programsById = new Map((data.awardPrograms ?? []).map((program) => [program.id, program]));
  const appearancesByAwardId = groupBy(data.appearances, (appearance) => appearance.awardId);
  const awardRows = buildAwardRows(data, appearancesByAwardId);

  return {
    generatedAt: data.generatedAt,
    stats: {
      books: data.books.length,
      appearances: data.appearances.length,
      prizes: data.awards.length,
      imprints: data.imprints.length,
    },
    books: data.books.map((book) => {
      const stats = statsByBookId.get(book.id);
      return {
        id: book.id,
        slug: book.slug,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        publicationYear: book.publicationYear,
        publisher: data.publishers.find((publisher) => publisher.id === book.publisherId)?.name,
        imprint: data.imprints.find((imprint) => imprint.id === book.imprintId)?.name,
        thumbnailUrl: book.thumbnailUrl,
        primarySubject: book.primarySubject,
        subjects: book.subjects,
        wins: stats?.wins ?? 0,
        lists: stats?.lists ?? 0,
        score: stats?.score ?? 0,
        majorWins: stats?.majorWins ?? 0,
        majorShortlists: stats?.majorShortlists ?? 0,
        normalShortlists: stats?.normalShortlists ?? 0,
        majorLonglists: stats?.majorLonglists ?? 0,
        normalLonglists: stats?.normalLonglists ?? 0,
        searchText: bookSearchText(book, data, awardsById),
      };
    }),
    home: Object.fromEntries(filterKeys.map((key) => [key, buildHomeFilterData(key, data, awardsById, programsById, awardRows)])) as BrowseData["home"],
    awards: awardRows,
    subjects: Object.fromEntries(filterKeys.map((key) => [key, buildSubjectRows(key, data, booksById, statsByBookId, awardsById, programsById)])) as BrowseData["subjects"],
  };
}

function buildHomeFilterData(
  key: BrowseFilterKey,
  data: PublicData,
  awardsById: Map<string, Award>,
  programsById: Map<string, AwardProgram>,
  awardRows: BrowseAwardRow[],
) {
  const [region, type] = key.split(":") as [RegionFilter, TypeFilter];
  const awards = data.awards.filter((award) => matchesAward(award, region, type, programsById));
  const awardIds = new Set(awards.map((award) => award.id));
  const appearances = data.appearances.filter((appearance) => awardIds.has(appearance.awardId));
  const bookIds = new Set(appearances.map((appearance) => appearance.bookId));
  const subjectCounts = new Map<string, number>();
  for (const book of data.books) {
    if (!bookIds.has(book.id)) continue;
    for (const subject of book.subjects) subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }

  return {
    subjects: data.subjects
      .map((subject) => ({ id: subject.id, slug: subject.slug, name: subject.name, count: subjectCounts.get(subject.name) ?? 0 }))
      .filter((subject) => subject.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    awards: awardRows
      .filter((award) => matchesAwardRow(award, region, type))
      .map((award) => ({
        id: award.id,
        slug: award.slug,
        name: award.name,
        count: award.records,
      }))
      .filter((award) => award.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

function buildAwardRows(data: PublicData, appearancesByAwardId: Map<string, AwardAppearance[]>): BrowseAwardRow[] {
  const programRows: BrowseAwardRow[] = (data.awardPrograms ?? [])
    .map((program) => {
      const awards = data.awards.filter((award) => award.programId === program.id);
      if (awards.length < 2) return null;
      const awardIds = new Set(awards.map((award) => award.id));
      const appearances = data.appearances.filter((appearance) => awardIds.has(appearance.awardId));
      const years = appearances.map((appearance) => appearance.year);
      const subjects = unique(awards.flatMap((award) => award.subjectAreas));
      const categories = awards.map((award) => award.categoryName ?? award.name).sort((a, b) => a.localeCompare(b));
      const description = `${awards.length} categories represented: ${categories.slice(0, 3).join(", ")}${categories.length > 3 ? ", ..." : ""}`;
      return {
        id: `program-${program.id}`,
        slug: program.slug,
        name: program.name,
        description,
        geography: program.geography,
        subjects,
        typeLabel: `${awards.length} categories`,
        yearRange: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown",
        records: appearances.length,
        searchText: [program.name, description, program.geography, subjects.join(" "), categories.join(" ")].filter(Boolean).join(" ").toLowerCase(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const groupedAwardIds = new Set(programRows.flatMap((row) => row.id.replace(/^program-/, "")).flatMap((programId) => data.awards.filter((award) => award.programId === programId).map((award) => award.id)));

  const awardRows: BrowseAwardRow[] = data.awards
    .filter((award) => !groupedAwardIds.has(award.id))
    .map((award) => {
      const appearances = appearancesByAwardId.get(award.id) ?? [];
      const years = appearances.map((appearance) => appearance.year);
      const description = award.criteria ?? "Pending official criteria import";
      return {
        id: award.id,
        slug: award.slug,
        name: award.name,
        shortName: award.shortName,
        description,
        geography: award.geography,
        subjects: award.subjectAreas,
        deadline: award.deadline,
        typeLabel: award.awardType === "award" ? "Award" : "Major award",
        yearRange: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Unknown",
        records: appearances.length,
        searchText: [award.name, award.shortName, description, award.geography, award.subjectAreas.join(" ")].filter(Boolean).join(" ").toLowerCase(),
      };
    });

  return [...programRows, ...awardRows].filter((row) => row.records > 0);
}

function buildSubjectRows(
  key: BrowseFilterKey,
  data: PublicData,
  booksById: Map<string, Book>,
  statsByBookId: Map<string, BookStats>,
  awardsById: Map<string, Award>,
  programsById: Map<string, AwardProgram>,
): BrowseSubjectRow[] {
  const [region, type] = key.split(":") as [RegionFilter, TypeFilter];
  const bookIds = new Set<string>();
  const scoreByBook = new Map<string, number>();
  for (const appearance of data.appearances) {
    const award = awardsById.get(appearance.awardId);
    if (!award || !matchesAward(award, region, type, programsById)) continue;
    bookIds.add(appearance.bookId);
    scoreByBook.set(appearance.bookId, (scoreByBook.get(appearance.bookId) ?? 0) + appearanceScore(appearance.statusRank));
  }

  return data.subjects
    .map((subject) => subjectRow(subject, data, booksById, statsByBookId, bookIds, scoreByBook))
    .filter((row): row is BrowseSubjectRow => Boolean(row))
    .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name));
}

function subjectRow(
  subject: SubjectSummary,
  data: PublicData,
  booksById: Map<string, Book>,
  statsByBookId: Map<string, BookStats>,
  filteredBookIds: Set<string>,
  scoreByBook: Map<string, number>,
): BrowseSubjectRow | undefined {
  const subjectBooks = data.books.filter((book) => filteredBookIds.has(book.id) && book.subjects.includes(subject.name));
  if (!subjectBooks.length) return undefined;
  const topBook = [...subjectBooks].sort((a, b) => (scoreByBook.get(b.id) ?? 0) - (scoreByBook.get(a.id) ?? 0) || (statsByBookId.get(b.id)?.score ?? 0) - (statsByBookId.get(a.id)?.score ?? 0) || a.title.localeCompare(b.title))[0];
  return {
    id: subject.id,
    slug: subject.slug,
    name: subject.name,
    description: subject.description ?? subjectDeck(subject.name),
    bookCount: subjectBooks.length,
    topBook: topBook ? {
      id: topBook.id,
      slug: topBook.slug,
      title: topBook.title,
      author: topBook.authors.map((author) => author.name).join(", "),
      publicationYear: topBook.publicationYear,
    } : undefined,
    searchText: [subject.name, subject.description, subjectDeck(subject.name), topBook?.title, topBook?.authors.map((author) => author.name).join(" ")].filter(Boolean).join(" ").toLowerCase(),
  };
}

function matchesAward(award: Award, region: RegionFilter, type: TypeFilter, programsById: Map<string, AwardProgram>) {
  const isUs = isUsAward(award, programsById);
  if (region === "us" && !isUs) return false;
  if (region === "international" && isUs) return false;
  if (type === "all") return true;
  const normalized = award.subjectAreas.map((subject) => subject.toLowerCase());
  if (type === "fiction") return normalized.some((subject) => subject === "fiction" || subject.includes(" fiction"));
  return normalized.some((subject) => subject === "nonfiction" || subject.includes("nonfiction"));
}

function matchesAwardRow(award: BrowseAwardRow, region: RegionFilter, type: TypeFilter) {
  const isUs = isUsGeography(award.geography);
  if (region === "us" && !isUs) return false;
  if (region === "international" && isUs) return false;
  if (type === "all") return true;
  const normalized = award.subjects.map((subject) => subject.toLowerCase());
  if (type === "fiction") return normalized.some((subject) => subject === "fiction" || subject.includes(" fiction"));
  return normalized.some((subject) => subject === "nonfiction" || subject.includes("nonfiction"));
}

function isUsAward(award: Award, programsById: Map<string, AwardProgram>) {
  const program = award.programId ? programsById.get(award.programId) : undefined;
  return isUsGeography(award.geography) || isUsGeography(program?.geography);
}

function isUsGeography(value?: string) {
  if (!value) return false;
  return /united states|u\.s\.|us publication|united states publication/i.test(value);
}

function bookSearchText(book: Book, data: PublicData, awardsById: Map<string, Award>) {
  const appearances = data.appearances
    .filter((appearance) => appearance.bookId === book.id)
    .map((appearance) => awardsById.get(appearance.awardId)?.name)
    .filter(Boolean)
    .join(" ");
  return [
    book.title,
    book.subtitle,
    book.authors.map((author) => author.name).join(" "),
    data.publishers.find((publisher) => publisher.id === book.publisherId)?.name,
    data.imprints.find((imprint) => imprint.id === book.imprintId)?.name,
    book.subjects.join(" "),
    book.centralFigures.join(" "),
    appearances,
    book.summary,
  ].filter(Boolean).join(" ").toLowerCase();
}

function appearanceScore(statusRank: number) {
  if (statusRank <= 1) return 10;
  if (statusRank <= 3) return 5;
  return 2;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function subjectDeck(name: string) {
  const decks: Record<string, string> = {
    "American History": "United States history, from pre-colonial period to present day.",
    "World History": "Global and international history.",
    Biography: "Life stories of individuals.",
    "Memoir & Autobiography": "Personal narratives and life experiences.",
    "Politics & Government": "Political systems, theory, and public policy.",
    "Society & Culture": "Social issues, customs, and cultural studies.",
    "Journalism & Reportage": "Journalistic works and on-the-ground reporting.",
    Science: "Scientific discoveries and explanations.",
  };
  return decks[name] ?? `${name} books and related award records.`;
}
