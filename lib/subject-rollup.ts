export const HISTORY_SUBJECT = "History";

export const HISTORY_SUBJECTS = ["History", "American History", "World History"] as const;

const historySubjects = new Set<string>(HISTORY_SUBJECTS);

export function isHistorySubject(subject: string | undefined): boolean {
  return Boolean(subject && historySubjects.has(subject));
}

/**
 * Convert stored editorial classifications into the broader categories used by
 * navigation and comparative charts. The stored value is deliberately left
 * untouched so narrower history classifications remain available for drill-down.
 */
export function rollupSubjectName(subject: string): string {
  return isHistorySubject(subject) ? HISTORY_SUBJECT : subject;
}

export function rollupSubjectSlug(subject: string): string {
  return slugifySubject(rollupSubjectName(subject));
}

export function historySubdivisionLabel(subject: string): string {
  if (subject === "American History") return "American";
  if (subject === "World History") return "World & international";
  return "General";
}

function slugifySubject(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
