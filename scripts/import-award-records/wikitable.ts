import { cleanText, stripCellAttributes, wikiToPlainText } from "./helpers";

export type ParsedWikiAwardRow = {
  year: number;
  author: string;
  title: string;
  result: string;
};

export function parseAwardRowsFromWikitable(wikitext: string): ParsedWikiAwardRow[] {
  const rows: ParsedWikiAwardRow[] = [];
  let currentYear: number | undefined;
  let currentResult = "";

  for (const rawRow of wikitext.split(/\n\|-/)) {
    const cells = parseRowCells(rawRow);
    if (cells.length < 2) continue;

    let cursor = 0;
    const maybeYear = parseYear(cells[cursor]);
    if (maybeYear) {
      currentYear = maybeYear;
      cursor += 1;
    }
    if (!currentYear) continue;

    const author = wikiToPlainText(cells[cursor] ?? "");
    const title = titleFromCell(cells[cursor + 1] ?? "");
    const explicitResult = wikiToPlainText(cells[cursor + 2] ?? "");
    if (/winner|finalist|shortlist/i.test(explicitResult)) currentResult = explicitResult;

    if (!author || !title || !currentResult) continue;
    rows.push({
      year: currentYear,
      author,
      title,
      result: currentResult,
    });
  }

  return rows;
}

function parseRowCells(row: string) {
  return row
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^[!|]/.test(line) && !/^\|-/.test(line) && !/^\|}$/.test(line))
    .map((cell) => stripCellAttributes(cell.replace(/^[!|]\s*/, "")))
    .map((cell) => cleanText(cell))
    .filter((cell) => cell && !/^\{\|/.test(cell) && !/^!/.test(cell) && !/^\|}$/.test(cell));
}

function parseYear(cell: string) {
  const yearMatch = wikiToPlainText(cell).match(/\b(19|20)\d{2}\b/);
  return yearMatch ? Number(yearMatch[0]) : undefined;
}

function titleFromCell(cell: string) {
  let value = cell;
  value = value.replace(/\{\{[Ss]ort\|([^{}]+)\|''([^{}]+)''\}\}/g, "$2");
  value = value.replace(/\{\{[Ss]ort\|[^|{}]+\|([^{}]+)\}\}/g, "$1");
  value = value.replace(/\{\{[Ss]ortname\|1=([^|{}]+)\|2=([^|{}]+)(?:\|[^{}]*)?\}\}/g, "$1 $2");
  value = value.replace(/\{\{[Ss]ortname\|1=([^|{}]+)(?:\|[^{}]*)?\}\}/g, "$1");
  value = wikiToPlainText(value);
  return cleanText(value.replace(/^''|''$/g, "").replace(/''/g, ""));
}
