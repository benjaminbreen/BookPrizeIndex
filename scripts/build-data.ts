import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import type {
  Award,
  AwardAppearance,
  AwardEdition,
  AwardStatus,
  Book,
  BookStats,
  Imprint,
  Person,
  PublicData,
  Publisher,
  SourceRef,
  SubjectDefinition,
  SubjectSummary,
} from "../lib/types";

type ManifestEntry = {
  id: string;
  label: string;
  file: string;
  type: "xlsx" | "json";
  sourceSheet?: string;
  appearancesSheet?: string;
  notes?: string;
  mappings: Record<string, string>;
};

type RawAppearanceRow = {
  Imprint?: string;
  Year?: number | string;
  Author?: string;
  Title?: string;
  "Award short"?: string;
  Status?: string;
  Award?: string;
};

type CurationFile = {
  books?: Record<string, Partial<Book>>;
  awards?: Record<string, Partial<Award>>;
  imprints?: Record<string, Partial<Imprint>>;
  publishers?: Record<string, Partial<Publisher>>;
  sources?: Record<string, SourceRef>;
};

type SubjectClassificationReportEntry = {
  bookId: string;
  title: string;
  author: string;
  subjects: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
  reviewReason?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcesDir = path.join(root, "sources");
const publicDataDir = path.join(root, "data", "public");

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function clean(input: unknown) {
  return String(input ?? "").trim().replace(/\s+/g, " ");
}

function normalizeStatus(status: string): { status: AwardStatus; rank: number; isTie: boolean } {
  const value = status.toLowerCase();
  const isTie = /\b(co-|joint|tie|tied)\b/.test(value);
  if (value.includes("winner")) return { status: isTie ? "co_winner" : "winner", rank: 1, isTie };
  if (value.includes("finalist")) return { status: "finalist", rank: 2, isTie };
  if (value.includes("shortlist") || value.includes("short-listed") || value.includes("short listed")) {
    return { status: "shortlist", rank: 3, isTie };
  }
  if (value.includes("longlist") || value.includes("long-listed") || value.includes("long listed")) {
    return { status: "longlist", rank: 4, isTie };
  }
  if (value.includes("honor") || value.includes("honour")) return { status: "honorable_mention", rank: 5, isTie };
  if (value.includes("commended")) return { status: "commended", rank: 6, isTie };
  if (value.includes("notable")) return { status: "notable", rank: 7, isTie };
  return { status: "unknown", rank: 99, isTie };
}

function splitPeople(authorText: string): Person[] {
  return authorText
    .split(/\s+(?:and|&)\s+|,\s+(?=[A-Z][^,]+$)/)
    .map(clean)
    .filter(Boolean)
    .map((name) => ({ id: `person-${slugify(name)}`, name }));
}

function inferSubjects(awardName: string, title: string): string[] {
  const text = `${awardName} ${title}`.toLowerCase();
  const subjects = new Set<string>();
  if (text.includes("history") || text.includes("bancroft") || text.includes("cundill")) subjects.add("History");
  if (text.includes("biography")) subjects.add("Biography");
  if (text.includes("memoir")) subjects.add("Memoir & Autobiography");
  if (text.includes("science")) subjects.add("Science");
  if (text.includes("medicine") || text.includes("virology") || text.includes("vagina")) subjects.add("Medicine & Public Health");
  if (text.includes("american") || text.includes("mexican") || text.includes("pulitzer")) subjects.add("American History");
  if (text.includes("global") || text.includes("world") || text.includes("empire")) subjects.add("World History");
  if (text.includes("politic") || text.includes("government")) subjects.add("Politics & Government");
  if (text.includes("society") || text.includes("social")) subjects.add("Society & Culture");
  return [...subjects];
}

async function main() {
  const manifestPath = path.join(sourcesDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestEntry[];
  const subjectDefinitions = await readSubjectDefinitions();
  const curation = await readCuration();
  const enrichment = await readEnrichment();
  const curatedBookSubjectIds = new Set(
    Object.entries(curation.books ?? {})
      .filter(([, patch]) => Array.isArray(patch.subjects))
      .map(([id]) => id),
  );
  const generatedAt = new Date().toISOString();

  const books = new Map<string, Book>();
  const awards = new Map<string, Award>();
  const editions = new Map<string, AwardEdition>();
  const appearances = new Map<string, AwardAppearance>();
  const imprints = new Map<string, Imprint>();
  const publishers = new Map<string, Publisher>();
  const sources = new Map<string, SourceRef>();

  for (const source of manifest) {
    if (source.type !== "xlsx") continue;

    const workbook = XLSX.readFile(path.join(sourcesDir, source.file));
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[source.sourceSheet ?? "Sources"] ?? {});
    const appearanceRows = XLSX.utils.sheet_to_json<RawAppearanceRow>(
      workbook.Sheets[source.appearancesSheet ?? "Raw appearances"] ?? {},
      { defval: "" },
    );

    const manifestSourceId = `source-${source.id}`;
    sources.set(manifestSourceId, {
      id: manifestSourceId,
      label: source.label,
      url: "",
      accessedAt: generatedAt,
      confidence: "manual",
      note: source.notes,
    });

    for (const [index, row] of sourceRows.entries()) {
      const url = clean(row.URL);
      if (!url) continue;
      const id = `source-${source.id}-${index + 1}`;
      sources.set(id, {
        id,
        label: clean(row.Source) || source.label,
        url,
        accessedAt: generatedAt,
        confidence: "official",
      });
    }

    for (const row of appearanceRows) {
      const title = clean(row.Title);
      const authorText = clean(row.Author);
      const year = Number(row.Year);
      const awardName = clean(row.Award);
      const originalStatus = clean(row.Status);
      const imprintName = clean(row.Imprint);
      if (!title || !authorText || !year || !awardName) continue;

      const authorPeople = splitPeople(authorText);
      const bookSlug = slugify(`${title}-${authorText}`);
      const bookId = `book-${bookSlug}`;
      const awardSlug = slugify(awardName);
      const awardId = `award-${awardSlug}`;
      const editionId = `edition-${awardSlug}-${year}`;
      const imprintId = imprintName ? `imprint-${slugify(imprintName)}` : undefined;
      const sourceIds = [manifestSourceId];

      if (imprintId && !imprints.has(imprintId)) {
        imprints.set(imprintId, {
          id: imprintId,
          name: imprintName,
          sourceIds,
        });
      }

      if (!books.has(bookId)) {
        const subjects = inferSubjects(awardName, title);
        books.set(bookId, {
          id: bookId,
          slug: bookSlug,
          title,
          authors: authorPeople,
          publicationYear: year,
          imprintId,
          isbn13: [],
          subjects,
          centralFigures: [],
          links: {
            amazon: `https://www.amazon.com/s?k=${encodeURIComponent(`${title} ${authorText}`)}`,
            bookshop: `https://bookshop.org/search?keywords=${encodeURIComponent(`${title} ${authorText}`)}`,
            indiebound: `https://www.indiebound.org/search/book?keys=${encodeURIComponent(`${title} ${authorText}`)}`,
            worldcat: `https://search.worldcat.org/search?q=${encodeURIComponent(`${title} ${authorText}`)}`,
          },
          sourceIds,
        });
      } else {
        const book = books.get(bookId)!;
        if (!book.imprintId && imprintId) book.imprintId = imprintId;
        book.subjects = [...new Set([...book.subjects, ...inferSubjects(awardName, title)])];
      }

      if (!awards.has(awardId)) {
        const subjectAreas = inferSubjects(awardName, "").filter((subject) => subject !== "Nonfiction");
        awards.set(awardId, {
          id: awardId,
          slug: awardSlug,
          name: awardName,
          shortName: clean(row["Award short"]) || undefined,
          subjectAreas: subjectAreas.length ? subjectAreas : ["Nonfiction"],
          links: {},
          sourceIds,
        });
      }

      if (!editions.has(editionId)) {
        editions.set(editionId, {
          id: editionId,
          awardId,
          year,
          sourceIds,
        });
      }

      const normalized = normalizeStatus(originalStatus);
      const appearanceId = `appearance-${bookSlug}-${awardSlug}-${year}-${slugify(originalStatus || "listed")}`;
      appearances.set(appearanceId, {
        id: appearanceId,
        bookId,
        awardId,
        awardEditionId: editionId,
        year,
        status: normalized.status,
        originalStatus,
        statusRank: normalized.rank,
        isTie: normalized.isTie,
        sourceIds,
      });
    }
  }

  applySourcePatches(sources, enrichment.sources);
  applyCuration(books, enrichment.books);
  applyCuration(awards, enrichment.awards);
  applyCuration(imprints, enrichment.imprints);
  applyCuration(publishers, enrichment.publishers);
  applySourcePatches(sources, curation.sources);
  applyCuration(books, curation.books);
  applyCuration(awards, curation.awards);
  applyCuration(imprints, curation.imprints);
  applyCuration(publishers, curation.publishers);

  const subjectClassificationReport = classifyBooksBySubject({
    books,
    awards,
    appearances,
    subjectDefinitions,
    curatedBookSubjectIds,
  });

  const statusWeights: Record<AwardStatus, number> = {
    winner: 5,
    co_winner: 5,
    finalist: 3,
    shortlist: 2,
    longlist: 1,
    honorable_mention: 1,
    commended: 1,
    notable: 1,
    unknown: 0,
  };

  const stats = new Map<string, BookStats>();
  for (const book of books.values()) {
    stats.set(book.id, {
      bookId: book.id,
      wins: 0,
      lists: 0,
      score: 0,
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
    });
  }

  for (const appearance of appearances.values()) {
    const stat = stats.get(appearance.bookId);
    if (!stat) continue;
    stat.lists += 1;
    stat.statuses[appearance.status] += 1;
    stat.score += statusWeights[appearance.status];
    if (appearance.status === "winner" || appearance.status === "co_winner") stat.wins += 1;
  }

  const subjectDefinitionsByName = new Map(subjectDefinitions.map((subject) => [subject.name, subject]));
  const subjectCounts = new Map<string, { ids: Set<string>; topBookId?: string; topScore: number }>();
  for (const book of books.values()) {
    for (const subject of book.subjects) {
      const current = subjectCounts.get(subject) ?? { ids: new Set<string>(), topScore: -1 };
      current.ids.add(book.id);
      const score = stats.get(book.id)?.score ?? 0;
      if (score > current.topScore) {
        current.topScore = score;
        current.topBookId = book.id;
      }
      subjectCounts.set(subject, current);
    }
  }

  const subjects: SubjectSummary[] = [...subjectCounts.entries()]
    .map(([name, value]) => ({
      id: `subject-${slugify(name)}`,
      slug: slugify(name),
      name,
      description: subjectDefinitionsByName.get(name)?.description,
      sortOrder: subjectDefinitionsByName.get(name)?.sortOrder,
      fallback: subjectDefinitionsByName.get(name)?.fallback,
      bookCount: value.ids.size,
      topBookId: value.topBookId,
    }))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || b.bookCount - a.bookCount || a.name.localeCompare(b.name));

  const publicData: PublicData = {
    generatedAt,
    books: [...books.values()].sort((a, b) => a.title.localeCompare(b.title)),
    awards: [...awards.values()].sort((a, b) => a.name.localeCompare(b.name)),
    editions: [...editions.values()].sort((a, b) => b.year - a.year),
    appearances: [...appearances.values()].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank),
    publishers: [...publishers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    imprints: [...imprints.values()].sort((a, b) => a.name.localeCompare(b.name)),
    subjects,
    sources: [...sources.values()],
    stats: [...stats.values()].sort((a, b) => b.score - a.score),
  };

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(path.join(publicDataDir, "catalog.json"), `${JSON.stringify(publicData, null, 2)}\n`);
  await fs.writeFile(
    path.join(publicDataDir, "subject-classification-report.json"),
    `${JSON.stringify(subjectClassificationReport, null, 2)}\n`,
  );

  const warnings = {
    missingPublisherCount: publicData.books.filter((book) => !book.publisherId).length,
    missingImprintCount: publicData.books.filter((book) => !book.imprintId).length,
    missingSourceUrlsForAppearances: publicData.appearances.filter((appearance) => !appearance.sourceUrl).length,
    unknownStatusCount: publicData.appearances.filter((appearance) => appearance.status === "unknown").length,
  };
  await fs.writeFile(path.join(publicDataDir, "import-report.json"), `${JSON.stringify(warnings, null, 2)}\n`);
  console.log(`Built ${publicData.books.length} books, ${publicData.appearances.length} appearances, ${publicData.awards.length} awards.`);
  console.log(`Warnings: ${JSON.stringify(warnings)}`);
}

async function readSubjectDefinitions(): Promise<SubjectDefinition[]> {
  const subjects = JSON.parse(await fs.readFile(path.join(sourcesDir, "subjects.json"), "utf8")) as SubjectDefinition[];
  const seen = new Set<string>();
  for (const subject of subjects) {
    if (seen.has(subject.name)) throw new Error(`Duplicate subject name in sources/subjects.json: ${subject.name}`);
    seen.add(subject.name);
    const expectedId = slugify(subject.name);
    if (subject.id !== expectedId) {
      throw new Error(`Subject "${subject.name}" has id "${subject.id}", expected "${expectedId}"`);
    }
  }
  return subjects;
}

function classifyBooksBySubject({
  books,
  awards,
  appearances,
  subjectDefinitions,
  curatedBookSubjectIds,
}: {
  books: Map<string, Book>;
  awards: Map<string, Award>;
  appearances: Map<string, AwardAppearance>;
  subjectDefinitions: SubjectDefinition[];
  curatedBookSubjectIds: Set<string>;
}): SubjectClassificationReportEntry[] {
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const aliases = new Map([
    ["Nonfiction", "General Nonfiction"],
    ["Global history", "World History"],
    ["American history", "American History"],
    ["Biography & memoir", "Biography"],
    ["Science & medicine", "Science"],
    ["Politics & society", "Society & Culture"],
  ]);
  const report: SubjectClassificationReportEntry[] = [];
  const appearancesByBookId = new Map<string, AwardAppearance[]>();
  for (const appearance of appearances.values()) {
    const current = appearancesByBookId.get(appearance.bookId) ?? [];
    current.push(appearance);
    appearancesByBookId.set(appearance.bookId, current);
  }

  for (const book of books.values()) {
    const awardNames = (appearancesByBookId.get(book.id) ?? [])
      .map((appearance) => awards.get(appearance.awardId)?.name)
      .filter(Boolean) as string[];
    const normalizedCuratedSubjects = normalizeSubjectNames(book.subjects, allowedSubjects, aliases);

    if (curatedBookSubjectIds.has(book.id)) {
      book.subjects = normalizedCuratedSubjects.length ? normalizedCuratedSubjects : ["General Nonfiction"];
      continue;
    }

    const classification = classifyBookSubject(book, awardNames, allowedSubjects, aliases);
    book.subjects = classification.subjects;
    if (classification.confidence !== "high" || classification.subjects.some((subject) => subject === "History" || subject === "General Nonfiction")) {
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.authors.map((author) => author.name).join(", "),
        subjects: classification.subjects,
        confidence: classification.confidence,
        reasons: classification.reasons,
        reviewReason: classification.reviewReason,
      });
    }
  }

  return report.sort(
    (a, b) =>
      confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
      a.subjects.join(", ").localeCompare(b.subjects.join(", ")) ||
      a.title.localeCompare(b.title),
  );
}

function classifyBookSubject(
  book: Book,
  awardNames: string[],
  allowedSubjects: Set<string>,
  aliases: Map<string, string>,
): { subjects: string[]; confidence: "high" | "medium" | "low"; reasons: string[]; reviewReason?: string } {
  const title = `${book.title} ${book.subtitle ?? ""}`.toLowerCase();
  const summary = (book.summary ?? "").toLowerCase();
  const awardsText = awardNames.join(" ").toLowerCase();
  const existingText = normalizeSubjectNames(book.subjects, allowedSubjects, aliases).join(" ").toLowerCase();
  const text = `${title} ${summary} ${awardsText} ${existingText}`;
  const matched = new Map<string, number>();
  const reasons: string[] = [];

  const add = (subject: string, reason: string, weight = 1) => {
    matched.set(subject, Math.max(matched.get(subject) ?? 0, weight));
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const titleOverrides = getTitleSubjectOverrides().get(slugify(book.title));
  if (titleOverrides) {
    for (const subject of titleOverrides) add(subject, "title-level subject override", 4);
  }

  if (/\b(memoir|autobiograph|my life|personal history)\b/.test(text)) add("Memoir & Autobiography", "memoir/autobiography keyword", 3);
  if (/\b(biography|life of|portrait of)\b/.test(text) || /^([a-z.'-]+\s){0,3}[a-z.'-]+:/.test(title)) add("Biography", "biography/title pattern", 2);
  if (/\b(american|united states|u\.s\.|usa|mexican american|native american|african american|civil war|reconstruction|jim crow|slavery|enslaved|founding|president|presidential)\b/.test(text)) {
    add("American History", "American history keyword", 3);
  }
  if (/\b(world|global|empire|imperial|colonial|europe|africa|asia|china|russia|soviet|india|latin america|middle east|atlantic|pacific|caribbean|migration|diaspora)\b/.test(text)) {
    add("World History", "world history keyword", 2);
  }
  if (/\b(history|historical|century|ancient|medieval|modern|revolution|archive|past)\b/.test(text) || /\b(bancroft|cundill|wolfson)\b/.test(awardsText)) add("History", "history keyword or history prize", 1);
  if (/\b(war|military|army|navy|battle|soldier|veteran|holocaust|genocide|nazi|confederate|vietnam|iraq|afghanistan)\b/.test(text)) add("War & Military", "war/military keyword", 3);
  if (/\b(politic|government|democracy|election|statecraft|diplomacy|policy|president|parliament|congress|authoritarian|fascis|communis)\b/.test(text)) add("Politics & Government", "politics/government keyword", 3);
  if (/\b(society|social|culture|community|family|class|education|school|housing|city|urban|rural)\b/.test(text)) add("Society & Culture", "society/culture keyword", 2);
  if (/\b(journalism|reportage|investigat|reported|dispatch|correspondent|news|expose)\b/.test(text)) add("Journalism & Reportage", "journalism/reportage keyword", 2);
  if (/\b(science|scientist|physics|biology|chemistry|mathematics|astronomy|evolution|genetic|neuroscience|psychology|animal|species)\b/.test(text)) add("Science", "science keyword", 3);
  if (/\b(medicine|medical|doctor|health|public health|disease|pandemic|virus|cancer|body|hospital|psychiatry|vagina|virology)\b/.test(text)) add("Medicine & Public Health", "medicine/public health keyword", 3);
  if (/\b(nature|environment|climate|ecology|conservation|wilderness|river|ocean|forest|park|earth|weather|hurricane|flood|fire)\b/.test(text)) add("Nature & Environment", "nature/environment keyword", 3);
  if (/\b(technology|computer|internet|digital|machine|engineering|infrastructure|algorithm|data|surveillance|ai|artificial intelligence)\b/.test(text)) add("Technology", "technology keyword", 3);
  if (/\b(business|economic|economy|capitalism|finance|money|market|corporation|labor|work|industry|factory|trade)\b/.test(text)) add("Business & Economics", "business/economics keyword", 3);
  if (/\b(art|artist|music|film|literary|literature|criticism|critic|poetry|novel|theater|theatre|performance|song|blues|jazz)\b/.test(text)) add("Arts & Criticism", "arts/criticism keyword", 3);
  if (/\b(religion|religious|god|faith|church|christian|islam|muslim|jewish|judaism|buddhist|spiritual|theology)\b/.test(text)) add("Religion", "religion keyword", 3);
  if (/\b(race|racial|black|gender|women|woman|queer|trans|sexuality|identity|civil rights|indigenous|native|latino|latina|asian american)\b/.test(text)) add("Race, Gender & Identity", "race/gender/identity keyword", 2);
  if (/\b(travel|journey|walk|walking|voyage|sea|border|place|landscape|road|mountain|grand canyon|park)\b/.test(text)) add("Travel & Place", "travel/place keyword", 2);
  if (/\b(sport|athlete|baseball|football|basketball|boxing|tennis|soccer|olympic|ali)\b/.test(text)) add("Sports", "sports keyword", 3);
  if (/\b(crime|criminal|prison|police|court|justice|law|legal|trial|murder|violence|incarceration|wrongful)\b/.test(text)) add("True Crime & Justice", "crime/justice keyword", 3);

  if (matched.has("American History")) matched.delete("History");
  if (matched.has("World History") && matched.has("American History")) matched.delete("History");
  if (matched.has("War & Military") && matched.has("History")) matched.delete("History");

  const subjects = [...matched.entries()]
    .filter(([subject]) => allowedSubjects.has(subject))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([subject]) => subject);

  if (!subjects.length) {
    return {
      subjects: ["General Nonfiction"],
      confidence: "low",
      reasons: ["no specific subject keyword matched"],
      reviewReason: "Only the General Nonfiction fallback matched.",
    };
  }

  const onlyBroadHistory = subjects.length === 1 && subjects[0] === "History";
  const confidence = onlyBroadHistory ? "medium" : subjects.length > 2 ? "medium" : "high";
  return {
    subjects,
    confidence,
    reasons,
    reviewReason: onlyBroadHistory
      ? "History matched, but no more specific history subject matched."
      : subjects.length > 2
        ? "Multiple top-level subjects matched; review ordering and inclusion."
        : undefined,
  };
}

function normalizeSubjectNames(subjects: string[], allowedSubjects: Set<string>, aliases: Map<string, string>) {
  return [
    ...new Set(
      subjects
        .map((subject) => aliases.get(subject) ?? subject)
        .filter((subject) => allowedSubjects.has(subject)),
    ),
  ];
}

function confidenceRank(confidence: "high" | "medium" | "low") {
  if (confidence === "low") return 0;
  if (confidence === "medium") return 1;
  return 2;
}

function getTitleSubjectOverrides() {
  return new Map<string, string[]>([
    ["a-furious-sky", ["Nature & Environment", "History"]],
    ["a-brief-history-of-everyone-who-ever-lived", ["Science", "History"]],
    ["a-cold-welcome", ["World History", "Nature & Environment"]],
    ["a-fistful-of-shells", ["World History", "Business & Economics"]],
    ["a-question-of-freedom", ["American History", "Race, Gender & Identity"]],
    ["african-europeans", ["World History", "Race, Gender & Identity"]],
    ["america-america", ["World History", "Politics & Government"]],
    ["amity-and-prosperity", ["Nature & Environment", "Business & Economics"]],
    ["another-word-for-love", ["Memoir & Autobiography"]],
    ["anansi-s-gold", ["World History", "Business & Economics", "True Crime & Justice"]],
    ["asperger-s-children", ["Medicine & Public Health", "World History"]],
    ["at-the-existentialist-cafe", ["Biography", "Arts & Criticism"]],
    ["before-the-movement", ["American History", "Race, Gender & Identity", "True Crime & Justice"]],
    ["blood-at-the-root", ["American History", "True Crime & Justice", "Race, Gender & Identity"]],
    ["born-in-flames", ["American History", "Business & Economics"]],
    ["brooding-over-bloody-revenge", ["American History", "Race, Gender & Identity", "True Crime & Justice"]],
    ["bottoms-up-and-the-devil-laughs", ["Politics & Government", "Technology"]],
    ["breathless", ["Medicine & Public Health", "Science"]],
    ["call-them-by-their-true-names", ["Society & Culture", "Politics & Government"]],
    ["children-of-paradise", ["World History", "Politics & Government"]],
    ["circle-of-hope", ["Religion", "Society & Culture"]],
    ["charged", ["American History", "Nature & Environment", "Business & Economics"]],
    ["cobalt-red", ["Business & Economics", "Nature & Environment"]],
    ["constructing-a-nervous-system", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["cue-the-sun", ["Arts & Criticism"]],
    ["daughters-of-the-bamboo-grove", ["Society & Culture", "Race, Gender & Identity"]],
    ["darkness-falls-on-the-land-of-light", ["American History", "Religion"]],
    ["directorate-s", ["Politics & Government", "War & Military"]],
    ["dopesick", ["Medicine & Public Health", "True Crime & Justice"]],
    ["dreamland", ["Medicine & Public Health", "True Crime & Justice"]],
    ["el-norte", ["American History", "World History", "Race, Gender & Identity"]],
    ["empress", ["Biography", "World History"]],
    ["fathoms", ["Nature & Environment", "Science"]],
    ["feeding-ghosts", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["fen-bog-and-swamp", ["Nature & Environment"]],
    ["fifth-sun", ["World History", "Race, Gender & Identity"]],
    ["figuring", ["Biography", "Science", "Arts & Criticism"]],
    ["four-hundred-souls", ["American History", "Race, Gender & Identity"]],
    ["g-man", ["Biography", "American History", "Politics & Government"]],
    ["go-ahead-in-the-rain", ["Arts & Criticism", "Biography"]],
    ["gods-of-the-upper-air", ["Biography", "Science", "History"]],
    ["h-is-for-hawk", ["Memoir & Autobiography", "Nature & Environment"]],
    ["halfway-home", ["True Crime & Justice", "Society & Culture"]],
    ["heartland", ["Memoir & Autobiography", "Society & Culture"]],
    ["heavy", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["henry-david-thoreau", ["Biography", "Nature & Environment"]],
    ["hitler", ["Biography", "World History", "War & Military"]],
    ["hillbilly-elegy", ["Memoir & Autobiography", "Society & Culture"]],
    ["his-name-is-george-floyd", ["Biography", "Race, Gender & Identity", "True Crime & Justice"]],
    ["hue-1968", ["War & Military", "World History", "Journalism & Reportage"]],
    ["i-ve-been-here-all-the-while", ["American History", "Race, Gender & Identity"]],
    ["illusions-of-emancipation", ["American History", "Race, Gender & Identity"]],
    ["implacable-foes", ["War & Military", "World History"]],
    ["hold-still", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["horizontal-vertigo", ["Travel & Place", "Society & Culture"]],
    ["how-not-to-kill-yourself", ["Memoir & Autobiography", "Medicine & Public Health"]],
    ["how-the-word-is-passed", ["American History", "Race, Gender & Identity"]],
    ["how-to-make-a-slave-and-other-essays", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["how-to-say-babylon", ["Memoir & Autobiography", "Religion"]],
    ["how-we-fight-for-our-lives", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["in-sensorium", ["Memoir & Autobiography", "Society & Culture"]],
    ["in-the-darkroom", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["in-the-shadow-of-liberty", ["American History", "Politics & Government"]],
    ["invisible-child", ["Journalism & Reportage", "Society & Culture"]],
    ["judgment-at-tokyo", ["War & Military", "World History", "True Crime & Justice"]],
    ["just-us", ["Race, Gender & Identity", "Society & Culture"]],
    ["just-another-southern-town", ["American History", "Race, Gender & Identity"]],
    ["katrina", ["American History", "Nature & Environment", "Society & Culture"]],
    ["king-of-kings", ["Biography", "World History", "Politics & Government"]],
    ["killers-of-the-flower-moon", ["American History", "True Crime & Justice", "Race, Gender & Identity"]],
    ["knife", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["kl", ["War & Military", "World History", "True Crime & Justice"]],
    ["lakota-america", ["American History", "Race, Gender & Identity"]],
    ["let-the-record-show", ["History", "Race, Gender & Identity"]],
    ["lightning-flowers", ["Memoir & Autobiography", "Medicine & Public Health"]],
    ["liliana-s-invincible-summer", ["Memoir & Autobiography", "True Crime & Justice"]],
    ["london-s-triumph", ["World History", "Business & Economics"]],
    ["madison-s-hand", ["American History", "Politics & Government"]],
    ["manual-for-survival", ["Medicine & Public Health", "Nature & Environment", "History"]],
    ["maoism", ["World History", "Politics & Government"]],
    ["master-slave-husband-wife", ["American History", "Biography", "Race, Gender & Identity"]],
    ["memorial-drive", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["midnight-in-chernobyl", ["History", "Technology", "Medicine & Public Health"]],
    ["mother-mary-comes-to-me", ["Memoir & Autobiography"]],
    ["motherland", ["Memoir & Autobiography", "Politics & Government"]],
    ["mr-b", ["Biography", "Arts & Criticism"]],
    ["never-caught", ["American History", "Biography", "Race, Gender & Identity"]],
    ["no-more-tears", ["Medicine & Public Health", "Journalism & Reportage"]],
    ["no-visible-bruises", ["Journalism & Reportage", "True Crime & Justice", "Society & Culture"]],
    ["nothing-ever-dies", ["War & Military", "World History", "Arts & Criticism"]],
    ["one-day-everyone-will-have-always-been-against-this", ["Politics & Government", "Society & Culture"]],
    ["one-person-no-vote", ["Politics & Government", "Race, Gender & Identity"]],
    ["ordinary-notes", ["Memoir & Autobiography", "Race, Gender & Identity", "Arts & Criticism"]],
    ["orwell-s-roses", ["Biography", "Nature & Environment"]],
    ["our-beloved-kin", ["American History", "Race, Gender & Identity"]],
    ["our-migrant-souls", ["Race, Gender & Identity", "Society & Culture"]],
    ["out-of-the-shadows", ["Race, Gender & Identity", "Society & Culture"]],
    ["people-love-dead-jews", ["Religion", "Society & Culture", "Race, Gender & Identity"]],
    ["priestdaddy", ["Memoir & Autobiography", "Religion"]],
    ["punch-me-up-to-the-gods", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["palo-alto", ["American History", "Business & Economics", "Technology"]],
    ["pogrom", ["World History", "Religion", "True Crime & Justice"]],
    ["prairie-fires", ["Biography", "American History"]],
    ["reckonings", ["World History", "War & Military", "True Crime & Justice"]],
    ["red-memory", ["World History", "Politics & Government"]],
    ["relinquished", ["Society & Culture", "Medicine & Public Health"]],
    ["ruin-their-crops-on-the-ground", ["American History", "Business & Economics", "Race, Gender & Identity"]],
    ["running-out", ["Nature & Environment", "Society & Culture"]],
    ["saving-america-s-cities", ["American History", "Society & Culture"]],
    ["savings-and-trust", ["American History", "Business & Economics", "Race, Gender & Identity"]],
    ["scots-and-catalans", ["World History", "Politics & Government"]],
    ["say-nothing", ["History", "True Crime & Justice", "War & Military"]],
    ["seek-you", ["Society & Culture", "Arts & Criticism"]],
    ["shadows-at-noon", ["World History", "Politics & Government", "Race, Gender & Identity"]],
    ["shakespeare-in-a-divided-america", ["Arts & Criticism", "American History", "Politics & Government"]],
    ["she-come-by-it-natural", ["Arts & Criticism", "Biography"]],
    ["soldiers-and-kings", ["Journalism & Reportage", "Politics & Government", "Travel & Place"]],
    ["solitary", ["Memoir & Autobiography", "True Crime & Justice", "Race, Gender & Identity"]],
    ["solito", ["Memoir & Autobiography", "Travel & Place"]],
    ["south-to-freedom", ["American History", "Race, Gender & Identity"]],
    ["south-to-america", ["American History", "Travel & Place", "Race, Gender & Identity"]],
    ["spain-in-our-hearts", ["War & Military", "World History", "Arts & Criticism"]],
    ["stamped-from-the-beginning", ["American History", "Race, Gender & Identity"]],
    ["stakes-is-high", ["Race, Gender & Identity", "Politics & Government", "Society & Culture"]],
    ["strangers-in-their-own-land", ["Society & Culture", "Politics & Government"]],
    ["surviving-katyn", ["War & Military", "World History", "True Crime & Justice"]],
    ["survivors", ["War & Military", "World History"]],
    ["tacky-s-revolt", ["World History", "Race, Gender & Identity"]],
    ["teaching-white-supremacy", ["American History", "Race, Gender & Identity", "Society & Culture"]],
    ["tell-me-how-it-ends", ["Memoir & Autobiography", "Politics & Government"]],
    ["the-1619-project", ["American History", "Race, Gender & Identity"]],
    ["the-address-book", ["History", "Travel & Place", "Society & Culture"]],
    ["the-age-of-choice", ["History", "Society & Culture"]],
    ["the-anarchy", ["World History", "Business & Economics"]],
    ["the-beekeeper", ["War & Military", "Journalism & Reportage", "Race, Gender & Identity"]],
    ["the-brazen-age", ["American History", "Politics & Government"]],
    ["the-broken-constitution", ["American History", "Politics & Government"]],
    ["the-browns-of-california", ["Biography", "American History", "Politics & Government"]],
    ["the-buried", ["World History", "Politics & Government", "Travel & Place"]],
    ["the-cigarette", ["American History", "Business & Economics", "Medicine & Public Health"]],
    ["the-contagion-of-liberty", ["American History", "Medicine & Public Health"]],
    ["the-cooking-gene", ["Memoir & Autobiography", "American History", "Race, Gender & Identity"]],
    ["the-dawn-watch", ["Biography", "World History", "Arts & Criticism"]],
    ["the-dead-are-arising", ["Biography", "American History", "Race, Gender & Identity"]],
    ["the-defender", ["Biography", "American History", "Race, Gender & Identity"]],
    ["the-facemaker", ["Medicine & Public Health", "War & Military", "History"]],
    ["the-firebrand-and-the-first-lady", ["Biography", "American History", "Race, Gender & Identity"]],
    ["the-first-and-last-king-of-haiti", ["Biography", "World History", "Race, Gender & Identity"]],
    ["the-freaks-came-out-to-write", ["Journalism & Reportage", "Arts & Criticism", "History"]],
    ["the-garden-against-time", ["Memoir & Autobiography", "Nature & Environment", "Arts & Criticism"]],
    ["the-great-displacement", ["Nature & Environment", "Society & Culture"]],
    ["the-great-escape", ["Business & Economics", "Society & Culture", "Race, Gender & Identity"]],
    ["the-future-is-history", ["World History", "Politics & Government", "Race, Gender & Identity"]],
    ["the-great-leveler", ["World History", "Business & Economics"]],
    ["the-grimkes", ["Biography", "American History", "Race, Gender & Identity"]],
    ["the-horde", ["World History", "War & Military"]],
    ["the-house-of-the-dead", ["World History", "True Crime & Justice"]],
    ["the-inheritors", ["World History", "Race, Gender & Identity", "Politics & Government"]],
    ["the-invention-of-miracles", ["Biography", "Medicine & Public Health"]],
    ["the-invisible-kingdom", ["Medicine & Public Health", "Memoir & Autobiography"]],
    ["the-lucky-ones", ["Memoir & Autobiography", "World History", "War & Military"]],
    ["the-man-who-could-move-clouds", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["the-method", ["Arts & Criticism", "History"]],
    ["the-other-olympians", ["Sports", "Race, Gender & Identity", "History"]],
    ["the-ottoman-endgame", ["World History", "War & Military"]],
    ["the-saltwater-frontier", ["American History", "Race, Gender & Identity"]],
    ["the-sewing-girl-s-tale", ["American History", "True Crime & Justice", "Race, Gender & Identity"]],
    ["the-least-of-us", ["Medicine & Public Health", "True Crime & Justice"]],
    ["the-rent-collectors", ["Society & Culture", "True Crime & Justice", "Journalism & Reportage"]],
    ["the-seeds-of-life", ["Science", "History", "Medicine & Public Health"]],
    ["the-thin-light-of-freedom", ["American History", "War & Military", "Race, Gender & Identity"]],
    ["the-talk", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["the-undertow", ["Politics & Government", "Religion", "Society & Culture"]],
    ["the-ungrateful-refugee", ["Memoir & Autobiography", "Politics & Government"]],
    ["the-yellow-house", ["Memoir & Autobiography", "Society & Culture"]],
    ["these-truths", ["American History", "Politics & Government"]],
    ["these-precious-days", ["Memoir & Autobiography", "Arts & Criticism"]],
    ["they-were-her-property", ["American History", "Race, Gender & Identity", "Business & Economics"]],
    ["thick", ["Society & Culture", "Race, Gender & Identity"]],
    ["those-who-forget", ["World History", "War & Military"]],
    ["titans-of-industrial-agriculture", ["Business & Economics", "Nature & Environment"]],
    ["travelers-in-the-third-reich", ["World History", "War & Military"]],
    ["truevine", ["Biography", "Race, Gender & Identity"]],
    ["undue-burden", ["Politics & Government", "Medicine & Public Health"]],
    ["unshrinking", ["Society & Culture", "Race, Gender & Identity"]],
    ["unworthy-republic", ["American History", "Race, Gender & Identity"]],
    ["vanguard", ["American History", "Race, Gender & Identity", "Politics & Government"]],
    ["wards-of-the-state", ["Society & Culture", "True Crime & Justice"]],
    ["wayward-lives-beautiful-experiments", ["History", "Race, Gender & Identity"]],
    ["we-could-have-been-friends-my-father-and-i", ["Memoir & Autobiography", "Politics & Government"]],
    ["we-re-alone", ["Memoir & Autobiography", "Race, Gender & Identity", "Society & Culture"]],
    ["we-the-corporations", ["Business & Economics", "Politics & Government"]],
    ["what-you-have-heard-is-true", ["Memoir & Autobiography", "War & Military", "Politics & Government"]],
    ["when-death-takes-something-from-you-give-it-back", ["Memoir & Autobiography"]],
    ["when-it-all-burns", ["Memoir & Autobiography", "Nature & Environment"]],
    ["whiskey-tender", ["Memoir & Autobiography", "Race, Gender & Identity"]],
    ["who-gets-believed", ["Society & Culture", "Politics & Government", "Journalism & Reportage"]],
    ["where-the-jews-aren-t", ["World History", "Religion", "Race, Gender & Identity"]],
    ["white-trash", ["American History", "Race, Gender & Identity", "Society & Culture"]],
    ["writing-to-save-a-life", ["American History", "Race, Gender & Identity", "True Crime & Justice"]],
    ["you-don-t-have-to-say-you-love-me", ["Memoir & Autobiography", "Race, Gender & Identity"]],
  ]);
}

async function readCuration(): Promise<CurationFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(sourcesDir, "curation.json"), "utf8")) as CurationFile;
  } catch {
    return {};
  }
}

async function readEnrichment(): Promise<CurationFile> {
  const enrichmentDir = path.join(sourcesDir, "enrichment");
  const merged: CurationFile = { books: {}, awards: {}, imprints: {}, publishers: {}, sources: {} };
  try {
    const files = await fs.readdir(enrichmentDir);
    for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
      const parsed = JSON.parse(await fs.readFile(path.join(enrichmentDir, file), "utf8")) as CurationFile;
      Object.assign(merged.books!, parsed.books);
      Object.assign(merged.awards!, parsed.awards);
      Object.assign(merged.imprints!, parsed.imprints);
      Object.assign(merged.publishers!, parsed.publishers);
      Object.assign(merged.sources!, parsed.sources);
    }
  } catch {
    return {};
  }
  return merged;
}

function applySourcePatches(sources: Map<string, SourceRef>, patches?: Record<string, SourceRef>) {
  if (!patches) return;
  for (const [id, source] of Object.entries(patches)) {
    sources.set(id, source);
  }
}

function applyCuration<T extends { id: string }>(items: Map<string, T>, patches?: Record<string, Partial<T>>) {
  if (!patches) return;
  for (const [id, patch] of Object.entries(patches)) {
    const current = items.get(id);
    if (!current) {
      items.set(id, { id, ...patch } as T);
      continue;
    }
    items.set(id, mergeObject(current, patch));
  }
}

function mergeObject<T>(current: T, patch: Partial<T>): T {
  const output = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = { ...((output[key] as object | undefined) ?? {}), ...value };
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
