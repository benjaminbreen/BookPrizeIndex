/**
 * Submission windows for prizes.
 *
 * Deadlines are cyclical, so entries store the recurring month/day of a cycle
 * (`closesOn`, `opensOn`) alongside the concrete date of the cycle we last
 * verified (`nextCloseDate`). Once a confirmed date passes, the recurring rule
 * keeps the display honest instead of showing a stale year.
 */

export type AwardSubmissionRoute =
  /** Publisher submits the book. */
  | "publisher"
  /** Author or agent may submit directly. */
  | "author"
  /** Either publisher or author may submit. */
  | "publisher_or_author"
  /** Entry is by nomination from members, judges, or institutions. */
  | "nomination"
  /** No call for entries; a committee selects from the field. */
  | "committee"
  /** Books qualify automatically from an existing pool (e.g. starred reviews). */
  | "automatic";

export type AwardSubmission = {
  route: AwardSubmissionRoute;
  /** The prize is no longer awarded, so there is nothing to enter. */
  discontinued?: boolean;
  /** Confirmed close date for the cycle we verified, `YYYY-MM-DD`. */
  nextCloseDate?: string;
  /** Recurring close, `MM-DD`. Used once `nextCloseDate` has passed. */
  closesOn?: string;
  /** Recurring open, `MM-DD`. */
  opensOn?: string;
  /** Human window when only a range is known, e.g. "September–November". */
  window?: string;
  /** What is eligible, e.g. "2026-copyright nonfiction published in the US". */
  eligibility?: string;
  /** Entry fee, e.g. "$75 per title". */
  fee?: string;
  /** Page with entry instructions. */
  url?: string;
  /** Anything the dates cannot express. */
  note?: string;
  /** `YYYY-MM-DD` the entry was last checked against the source. */
  verifiedOn: string;
  /** Page the entry was read from. */
  sourceUrl?: string;
};

export type AwardSubmissionTone = "closing" | "open" | "passive" | "unknown";

export type AwardSubmissionDisplay = {
  /** Primary line, e.g. "Closes 10 Nov 2026". */
  label: string;
  /** Secondary line, e.g. "in 14 days" or "annual cycle". */
  detail?: string;
  tone: AwardSubmissionTone;
  /** Ascending sort key; undated routes sort after dated ones. */
  sortKey: string;
  /** Date is derived from the recurring rule rather than a confirmed cycle. */
  approximate: boolean;
  /** Last verified more than a year ago. */
  stale: boolean;
};

const DAY_MS = 86_400_000;
const STALE_AFTER_DAYS = 365;
const CLOSING_SOON_DAYS = 45;

const routeLabels: Record<AwardSubmissionRoute, string> = {
  publisher: "Publisher entry",
  author: "Author entry",
  publisher_or_author: "Publisher or author entry",
  nomination: "By nomination",
  committee: "No open call",
  automatic: "Automatic entry",
};

export function submissionRouteLabel(route: AwardSubmissionRoute) {
  return routeLabels[route];
}

export function describeAwardSubmission(submission: AwardSubmission | undefined, today: string): AwardSubmissionDisplay {
  if (!submission) {
    return { label: "Not yet sourced", tone: "unknown", sortKey: "9999-12-31", approximate: false, stale: false };
  }

  const stale = daysBetween(submission.verifiedOn, today) > STALE_AFTER_DAYS;

  if (submission.discontinued) {
    return {
      label: "No longer awarded",
      detail: submission.window,
      tone: "passive",
      sortKey: "9999-11-30",
      approximate: false,
      stale: false,
    };
  }

  const closes = nextCloseDate(submission, today);

  if (!closes) {
    const passive = submission.route === "committee" || submission.route === "automatic";
    return {
      label: routeLabels[submission.route],
      detail: submission.window ?? (passive ? undefined : "Dates vary by cycle"),
      tone: passive ? "passive" : "unknown",
      sortKey: passive ? "9998-12-31" : "9997-12-31",
      approximate: false,
      stale,
    };
  }

  const days = daysBetween(today, closes.date);
  const opens = nextRecurrence(submission.opensOn, today);
  const notYetOpen = Boolean(opens && opens < closes.date);

  return {
    label: `${closes.approximate ? "~" : ""}Closes ${formatDay(closes.date)}`,
    detail: notYetOpen && opens ? `Opens ~${formatDay(opens)}` : relativeDetail(days, closes.approximate),
    tone: !notYetOpen && days <= CLOSING_SOON_DAYS ? "closing" : "open",
    sortKey: closes.date,
    approximate: closes.approximate,
    stale,
  };
}

function nextCloseDate(submission: AwardSubmission, today: string) {
  if (submission.nextCloseDate && submission.nextCloseDate >= today) {
    return { date: submission.nextCloseDate, approximate: false };
  }
  const recurring = nextRecurrence(submission.closesOn ?? monthDay(submission.nextCloseDate), today);
  return recurring ? { date: recurring, approximate: true } : undefined;
}

/** Next `YYYY-MM-DD` at or after `today` matching an `MM-DD` rule. */
function nextRecurrence(monthDayRule: string | undefined, today: string) {
  if (!monthDayRule || !/^\d{2}-\d{2}$/.test(monthDayRule)) return undefined;
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${monthDayRule}`;
  return thisYear >= today ? thisYear : `${year + 1}-${monthDayRule}`;
}

function monthDay(date: string | undefined) {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : undefined;
}

function relativeDetail(days: number, approximate: boolean) {
  if (approximate) return "annual cycle";
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 45) return `in ${days} days`;
  const months = Math.round(days / 30);
  return `in about ${months} month${months === 1 ? "" : "s"}`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(date: string) {
  const [year, month, day] = date.split("-");
  const name = monthNames[Number(month) - 1];
  if (!name) return date;
  return `${Number(day)} ${name} ${year}`;
}

/** `YYYY-MM-DD` for the current day in the viewer's timezone. */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
