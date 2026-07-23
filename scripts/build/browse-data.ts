import type { Award, AwardAppearance, AwardProgram, Book, BookStats, PublicData, SubjectSummary } from "../../lib/types";
import type { BrowseAwardRow, BrowseBookRecognitionStats, BrowseData, BrowseFilterKey, BrowseSubjectRow } from "../../lib/browse-types";
import { HISTORY_SUBJECT, HISTORY_SUBJECTS, rollupSubjectName, rollupSubjectSlug } from "../../lib/subject-rollup";

type TypeFilter = "all" | "fiction" | "nonfiction";
type RegionFilter = "us" | "international" | "all";
const regionFilters = ["us", "international", "all"] as const satisfies readonly RegionFilter[];

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
  const appearancesByBookId = groupBy(data.appearances, (appearance) => appearance.bookId);
  const awardRows = buildAwardRows(data, appearancesByAwardId);

  return {
    generatedAt: data.generatedAt,
    stats: {
      books: data.books.length,
      appearances: data.appearances.length,
      programs: data.awardPrograms.length,
      prizes: data.awards.length,
      imprints: data.imprints.length,
    },
    books: data.books.map((book) => {
      const stats = statsByBookId.get(book.id);
      const bookAppearances = appearancesByBookId.get(book.id) ?? [];
      const years = bookAppearances.map((appearance) => appearance.year);
      const recognitionByRegion = buildBookRecognitionByRegion(bookAppearances, awardsById, programsById);
      return {
        id: book.id,
        slug: book.slug,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        publicationYear: book.publicationYear,
        firstRecognitionYear: years.length ? Math.min(...years) : undefined,
        publisherId: book.publisherId,
        publisher: data.publishers.find((publisher) => publisher.id === book.publisherId)?.name,
        imprintId: book.imprintId,
        imprint: data.imprints.find((imprint) => imprint.id === book.imprintId)?.name,
        thumbnailUrl: book.thumbnailUrl,
        primarySubject: book.primarySubject,
        subjects: book.subjects,
        primaryTopic: book.primaryTopic,
        topics: book.topics,
        awardIds: [...new Set(bookAppearances.map((appearance) => appearance.awardId))],
        wins: stats?.wins ?? 0,
        lists: stats?.lists ?? 0,
        score: stats?.score ?? 0,
        majorWins: stats?.majorWins ?? 0,
        majorShortlists: stats?.majorShortlists ?? 0,
        normalShortlists: stats?.normalShortlists ?? 0,
        majorLonglists: stats?.majorLonglists ?? 0,
        normalLonglists: stats?.normalLonglists ?? 0,
        hasIsbn: book.isbn13.length > 0,
        hasPageCount: Boolean(book.pageCount),
        hasCover: Boolean(book.thumbnailUrl),
        hasSummary: Boolean(book.summary || book.displaySummary),
        hasPublisher: Boolean(book.publisherId),
        searchText: bookSearchText(book, data, awardsById),
        recognitionByRegion,
      };
    }),
    home: Object.fromEntries(filterKeys.map((key) => [key, buildHomeFilterData(key, data, awardsById, programsById, awardRows)])) as BrowseData["home"],
    awards: awardRows,
    subjects: Object.fromEntries(filterKeys.map((key) => [key, buildSubjectRows(key, data, booksById, statsByBookId, awardsById, programsById)])) as BrowseData["subjects"],
  };
}

function buildBookRecognitionByRegion(
  appearances: AwardAppearance[],
  awardsById: Map<string, Award>,
  programsById: Map<string, AwardProgram>,
): Record<RegionFilter, BrowseBookRecognitionStats> {
  return Object.fromEntries(
    regionFilters.map((region) => [region, buildBookRecognitionStats(appearances, awardsById, programsById, region)]),
  ) as Record<RegionFilter, BrowseBookRecognitionStats>;
}

function buildBookRecognitionStats(
  appearances: AwardAppearance[],
  awardsById: Map<string, Award>,
  programsById: Map<string, AwardProgram>,
  region: RegionFilter,
): BrowseBookRecognitionStats {
  const matched = appearances.filter((appearance) => {
    const award = awardsById.get(appearance.awardId);
    return Boolean(award && matchesAward(award, region, "all", programsById));
  });
  const stats: BrowseBookRecognitionStats = {
    awardIds: [...new Set(matched.map((appearance) => appearance.awardId))],
    lists: 0,
    majorLonglists: 0,
    majorShortlists: 0,
    majorWins: 0,
    normalLonglists: 0,
    normalShortlists: 0,
    score: 0,
    wins: 0,
  };
  const years = matched.map((appearance) => appearance.year);
  if (years.length) stats.firstRecognitionYear = Math.min(...years);
  for (const appearance of matched) {
    const award = awardsById.get(appearance.awardId);
    const isMajorAward = award?.awardType === "major_award";
    stats.lists += 1;
    stats.score += recognitionWeight(appearance.status, isMajorAward);
    if (appearance.status === "winner" || appearance.status === "co_winner") {
      stats.wins += 1;
      if (isMajorAward) stats.majorWins += 1;
    } else if (appearance.status === "finalist" || appearance.status === "shortlist") {
      if (isMajorAward) stats.majorShortlists += 1;
      else stats.normalShortlists += 1;
    } else if (appearance.status === "longlist") {
      if (isMajorAward) stats.majorLonglists += 1;
      else stats.normalLonglists += 1;
    }
  }
  return stats;
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
    for (const subject of new Set(book.subjects.map(rollupSubjectName))) {
      subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
    }
  }

  return {
    subjects: browseSubjectDefinitions(data.subjects)
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
        awardIds: [...awardIds],
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
      const description = award.criteria ?? award.description ?? awardBrowseDescription(award);
      return {
        id: award.id,
        awardIds: [award.id],
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

  return browseSubjectDefinitions(data.subjects)
    .map((subject) => subjectRow(subject, browseSubjectNames(subject.name), data, booksById, statsByBookId, bookIds, scoreByBook))
    .filter((row): row is BrowseSubjectRow => Boolean(row))
    .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name));
}

function subjectRow(
  subject: SubjectSummary,
  storedSubjectNames: readonly string[],
  data: PublicData,
  booksById: Map<string, Book>,
  statsByBookId: Map<string, BookStats>,
  filteredBookIds: Set<string>,
  scoreByBook: Map<string, number>,
): BrowseSubjectRow | undefined {
  const storedSubjectSet = new Set(storedSubjectNames);
  const subjectBooks = data.books.filter((book) => filteredBookIds.has(book.id) && book.subjects.some((name) => storedSubjectSet.has(name)));
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

function browseSubjectDefinitions(subjects: SubjectSummary[]): SubjectSummary[] {
  const definitions = new Map<string, SubjectSummary>();
  for (const subject of subjects) {
    const name = rollupSubjectName(subject.name);
    if (definitions.has(name)) continue;
    definitions.set(name, name === HISTORY_SUBJECT ? {
      ...subject,
      id: "history",
      slug: rollupSubjectSlug(name),
      name,
      description: "History across the United States, the wider world, and transnational or general historical subjects.",
      sortOrder: Math.min(...subjects.filter((item) => HISTORY_SUBJECTS.includes(item.name as (typeof HISTORY_SUBJECTS)[number])).map((item) => item.sortOrder ?? Number.MAX_SAFE_INTEGER)),
    } : subject);
  }
  return [...definitions.values()];
}

function browseSubjectNames(subject: string): readonly string[] {
  return subject === HISTORY_SUBJECT ? HISTORY_SUBJECTS : [subject];
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
    book.experimentalSemanticProfile?.centralPlaces.map((place) => place.name).join(" "),
    book.experimentalSemanticProfile?.argument.present ? book.experimentalSemanticProfile.argument.statement : "",
    appearances,
    book.summary,
  ].filter(Boolean).join(" ").toLowerCase();
}

function appearanceScore(statusRank: number) {
  if (statusRank <= 1) return 10;
  if (statusRank <= 3) return 5;
  return 2;
}

function recognitionWeight(status: AwardAppearance["status"], isMajorAward: boolean) {
  if (status === "winner" || status === "co_winner") return isMajorAward ? 10 : 4;
  if (status === "finalist" || status === "shortlist") return isMajorAward ? 4 : 2;
  if (status === "longlist") return isMajorAward ? 2 : 1;
  return 0;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function awardBrowseDescription(award: Award) {
  const programDescriptions: Record<string, string> = {
    "baillie-gifford-prize": "Recognizes outstanding nonfiction books published in English, with an emphasis on ambitious, well-researched writing for general readers.",
    "new-york-historical-american-history-book-prize": "Recognizes distinguished books on American history, including works that bring new scholarship to a broad readership.",
    "british-academy-book-prize": "Recognizes nonfiction that deepens public understanding of people, cultures, and societies across the world.",
    "costa-book-awards": "The Biography category recognized life-writing published for a general readership as part of the former Costa Book Awards.",
    "duff-cooper-prize": "Recognizes nonfiction in history, biography, politics, and related fields, with an emphasis on literary distinction and public interest.",
    "ft-business-book-of-the-year": "Recognizes books that offer compelling and significant insight into business, finance, economics, and management.",
    "helen-bernstein-book-award": "Recognizes works of journalism that bring clarity, depth, and public value to important contemporary issues.",
    "hillman-prize-book-journalism": "Recognizes book-length journalism in the public interest, especially reporting connected to social justice and public affairs.",
    "j-anthony-lukas-book-prize": "Recognizes nonfiction on an American topic that combines serious research, literary quality, and social or political insight.",
    "lionel-gelber-prize": "Recognizes major English-language books on international affairs and global public policy.",
    "orwell-prize": "Recognizes political writing that turns public issues into compelling, clear, and artful nonfiction.",
    "pen-diamonstein-spielvogel-award": "Recognizes essay collections distinguished by literary craft, originality, and sustained critical or personal insight.",
    "pen-eo-wilson-award": "Recognizes literary nonfiction that communicates scientific ideas with clarity, narrative power, and broad appeal.",
    "pen-weld-biography-award": "Recognizes biographies of exceptional literary, narrative, and research quality.",
    "plutarch-award": "Recognizes biographies selected by biographers, honoring excellence in life-writing and biographical craft.",
    "rachel-carson-environment-book-award": "Recognizes books that illuminate environmental issues through reporting, research, and public-facing nonfiction.",
    "ridenhour-book-prize": "Recognizes books that advance truth-telling, civic courage, and public accountability.",
    "royal-society-science-book-prize": "Recognizes science books written for non-specialist readers that make scientific ideas accessible and engaging.",
  };
  if (award.programId && programDescriptions[award.programId]) return programDescriptions[award.programId];

  const subjects = award.subjectAreas.filter((subject) => subject !== "Nonfiction").slice(0, 2);
  const scope = subjects.length ? subjects.join(" and ").toLowerCase() : "nonfiction";
  return `${award.name} recognizes award-listed ${scope} books in the current prize corpus.`;
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
