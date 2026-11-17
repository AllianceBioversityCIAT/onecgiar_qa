// P2-3911: the CSV export of a result's QA comments for the program. Pure.
// One row per comment visible to the program, with its latest response. No
// assessor name and no responder email. Every cell is quoted, and a cell that
// a spreadsheet would run as a formula is neutralized (CSV injection).
import type { SpResponseKind } from '../../database/drizzle/schema/sp-comment-responses.js';
import type { SpResultResponse } from './sp-view.service.js';

export const CSV_HEADER = [
  'Section',
  'Field',
  'Comment',
  'Comment date',
  'Response',
  'Response comment',
  'Responded at',
] as const;

export const RESPONSE_LABELS: Readonly<Record<SpResponseKind, string>> = {
  accept: 'Accepted',
  accept_with_comment: 'Accepted with comment',
  disagree: 'Disagreed',
  request_clarification: 'Clarification requested',
};

/** The UTF-8 byte order mark, so spreadsheets read the file as UTF-8. */
export const CSV_BOM = '﻿';

/** Characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: neutralized when it starts like a formula, always quoted, quotes doubled. */
export function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvLine(
  cells: ReadonlyArray<string | null | undefined>,
): string {
  return cells.map(csvCell).join(',');
}

/** The whole file: BOM, header, one row per comment; CRLF line ends (RFC 4180). */
export function buildCommentsCsv(view: SpResultResponse): string {
  const lines = [csvLine(CSV_HEADER)];
  const fields = [
    ...view.sections.flatMap((section) =>
      section.fields.map((field) => ({ section: section.label, field })),
    ),
    ...view.other.map((field) => ({ section: 'Other', field })),
  ];
  for (const { section, field } of fields) {
    for (const comment of field.comments) {
      const response = comment.response;
      lines.push(
        csvLine([
          section,
          field.label,
          comment.body,
          comment.createdAt,
          response === null ? '' : RESPONSE_LABELS[response.kind],
          response?.body ?? '',
          response?.respondedAt ?? '',
        ]),
      );
    }
  }
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/** `result-<code>-qa-comments.csv`: the code is an integer, so the name needs no escaping. */
export const csvFileName = (resultCode: number): string =>
  `result-${Math.trunc(resultCode)}-qa-comments.csv`;
