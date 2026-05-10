import { clean, normalizeAuthorKey, normalizeTitleForMatch, slugify } from "./text";

export type TitleCandidate = {
  title: string;
  authors: string[];
};

export type CanonicalTitleResolver = {
  resolve: (title: string, authors: string[]) => string;
  resolveBookId: (bookId: string) => string;
};

export function buildCanonicalTitleResolver(candidates: TitleCandidate[]): CanonicalTitleResolver {
  const titlesByAuthor = new Map<string, string[]>();
  for (const candidate of candidates) {
    const title = clean(candidate.title);
    const authorKey = normalizeAuthorKey(candidate.authors);
    if (!title || !authorKey) continue;
    titlesByAuthor.set(authorKey, [...(titlesByAuthor.get(authorKey) ?? []), title]);
  }

  const aliases = new Map<string, string>();
  const bookIdAliases = new Map<string, string>();
  for (const [authorKey, titles] of titlesByAuthor) {
    const uniqueTitles = [...new Set(titles)].sort((a, b) => b.length - a.length || a.localeCompare(b));
    for (const title of uniqueTitles) {
      const canonical = uniqueTitles.find((candidate) => isFullerTitleFor(candidate, title)) ?? title;
      aliases.set(`${authorKey}::${normalizeTitleForMatch(title)}`, canonical);
      const authors = authorKey.split("|").join(" and ");
      const oldBookId = `book-${slugify(`${title}-${authors}`)}`;
      const canonicalBookId = `book-${slugify(`${canonical}-${authors}`)}`;
      if (oldBookId !== canonicalBookId) bookIdAliases.set(oldBookId, canonicalBookId);
    }
  }

  return {
    resolve(title: string, authors: string[]) {
      const cleanedTitle = clean(title);
      const authorKey = normalizeAuthorKey(authors);
      return aliases.get(`${authorKey}::${normalizeTitleForMatch(cleanedTitle)}`) ?? cleanedTitle;
    },
    resolveBookId(bookId: string) {
      return bookIdAliases.get(bookId) ?? bookId;
    },
  };
}

function isFullerTitleFor(candidate: string, title: string) {
  if (candidate === title || candidate.length <= title.length) return false;
  const candidateKey = normalizeTitleForMatch(candidate);
  const titleKey = normalizeTitleForMatch(title);
  if (!candidateKey.startsWith(`${titleKey} `)) return false;
  const remainder = candidateKey.slice(titleKey.length).trim();
  if (!remainder || remainder.length < 3) return false;

  return true;
}
