import type { RawAwardRecord } from "../../lib/award-records";

export type RawRecordQualityIssueCode =
  | "missing_title"
  | "missing_author"
  | "invalid_source_url"
  | "invalid_year"
  | "wiki_markup"
  | "table_markup"
  | "html_markup"
  | "html_entity"
  | "broken_entity"
  | "placeholder_title"
  | "publisher_artifact"
  | "parser_delimiter"
  | "merged_titles"
  | "spaced_word"
  | "invalid_author"
  | "author_note";

export type RawRecordQualityIssue = {
  code: RawRecordQualityIssueCode;
  message: string;
  field: "record" | "title" | "authors" | "sourceUrl" | "year";
  recordIndex: number;
  awardId: string;
  categoryId: string;
  year: number;
  title: string;
};

const WIKI_MARKUP = /\[\[|\]\]|\{\{|\}\}/;
const TABLE_MARKUP = /\b(?:bgcolor|rowspan|colspan|data-sort-value|scope|style)\s*=/i;
const HTML_MARKUP = /<\/?[a-z][^>]*>/i;
const HTML_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i;
const BROKEN_ENTITY = /&[a-z]{1,8}(?:\s|$)/i;
const SPACED_WORD = /\b(?:[A-Za-z]\s){3,}[A-Za-z]\b/;
const MERGED_TITLES = /\s+and\s+(?:[A-Z][\p{L}.'’-]+\s+){2,4}for\s+[^\n:]{2,80}:/u;
const PLACEHOLDER_TITLE = /^\s*[:;,]|^\s*\((?:\d+\s+)?volumes?\)\s*$|^\s*(?:award withheld|no award(?: given)?)\s*$/i;
const PUBLISHER_ARTIFACT = /^[A-Z][\p{L}.'’-]+,\s+for\s+/u;
const PARSER_DELIMITER = /^\s*\||\|\s*$/;
const INVALID_AUTHOR = /^(?:by|written by|edited by|n\/?a|unknown)$/i;
const AUTHOR_NOTE = /\b(?:accepting award|editorial director|publisher of law|tax publications)\b/i;

export function findRawRecordQualityIssues(records: RawAwardRecord[]) {
  return records.flatMap((record, recordIndex) => inspectRawRecord(record, recordIndex));
}

export function inspectRawRecord(record: RawAwardRecord, recordIndex = 0): RawRecordQualityIssue[] {
  const issues: RawRecordQualityIssue[] = [];
  const add = (
    code: RawRecordQualityIssueCode,
    field: RawRecordQualityIssue["field"],
    message: string,
  ) => {
    issues.push({
      code,
      field,
      message,
      recordIndex,
      awardId: record.awardId,
      categoryId: record.categoryId,
      year: record.year,
      title: record.title,
    });
  };

  if (!record.title.trim()) add("missing_title", "title", "Title is empty.");
  if (!record.authors.length || record.authors.every((author) => !author.trim())) {
    add("missing_author", "authors", "Author list is empty.");
  }
  if (!Number.isInteger(record.year) || record.year < 1800 || record.year > new Date().getFullYear() + 1) {
    add("invalid_year", "year", `Year ${record.year} is outside the supported range.`);
  }
  if (!isHttpUrl(record.sourceUrl)) add("invalid_source_url", "sourceUrl", "Source URL must be HTTP(S).");

  const textFields = [record.title, ...record.authors];
  if (textFields.some((value) => WIKI_MARKUP.test(value))) {
    add("wiki_markup", "record", "Unparsed MediaWiki link or template markup remains.");
  }
  if (textFields.some((value) => TABLE_MARKUP.test(value))) {
    add("table_markup", "record", "HTML/MediaWiki table attributes remain in display text.");
  }
  if (textFields.some((value) => HTML_MARKUP.test(value))) {
    add("html_markup", "record", "HTML markup remains in display text.");
  }
  if (textFields.some((value) => HTML_ENTITY.test(value))) {
    add("html_entity", "record", "An encoded HTML entity remains in display text.");
  }
  if (textFields.some((value) => BROKEN_ENTITY.test(value))) {
    add("broken_entity", "record", "A truncated HTML entity remains in display text.");
  }
  if (PLACEHOLDER_TITLE.test(record.title)) {
    add("placeholder_title", "title", "Title looks like a placeholder or parser fragment.");
  }
  if (PUBLISHER_ARTIFACT.test(record.title)) {
    add("publisher_artifact", "title", "Title appears to begin with a leaked publisher location.");
  }
  if (textFields.some((value) => PARSER_DELIMITER.test(value))) {
    add("parser_delimiter", "record", "A table-cell delimiter remains at the edge of display text.");
  }
  if (MERGED_TITLES.test(record.title)) {
    add("merged_titles", "title", "Title appears to contain a second author/title pair.");
  }
  if (SPACED_WORD.test(record.title) || record.authors.some((author) => SPACED_WORD.test(author))) {
    add("spaced_word", "record", "A word appears to have been split into individual letters.");
  }

  for (const author of record.authors) {
    if (INVALID_AUTHOR.test(author.trim()) || /\(\s*\)/.test(author)) {
      add("invalid_author", "authors", `Suspicious author value: ${JSON.stringify(author)}.`);
    }
    if (AUTHOR_NOTE.test(author)) {
      add("author_note", "authors", `Editorial or award-acceptance notes leaked into author value: ${JSON.stringify(author)}.`);
    }
  }

  return issues;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
