import { buildCommentsCsv, csvCell, csvFileName, csvLine } from './sp-csv.js';
import type { SpResultResponse } from './sp-view.service.js';

describe('SP comments CSV (P2-3911)', () => {
  it('quotes every cell and doubles quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('""');
    expect(csvLine(['a', 'b'])).toBe('"a","b"');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("x")'])(
    'neutralizes a cell that starts like a formula: %j',
    (value) => {
      const cell = csvCell(value);
      expect(cell.startsWith(`"'`)).toBe(true);
    },
  );

  it('leaves a cell that only contains such a character alone', () => {
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell(' =1')).toBe('" =1"');
  });

  it('writes a BOM, the header and one row per comment with its latest response', () => {
    const comment = (
      id: number,
      body: string,
      response: SpResultResponse['sections'][number]['fields'][number]['comments'][number]['response'],
    ) => ({
      id,
      fieldKey: 'f',
      body,
      state: 'open' as const,
      createdAt: '2026-11-05T09:00:00.000Z',
      valueCopy: { value: 'v' },
      valueTruncated: false,
      response,
      history: [],
      clarifications: [],
    });
    const field = (label: string, comments: unknown[]) =>
      ({
        key: label,
        label,
        type: 'text',
        mode: 'assessed',
        core: false,
        value: null,
        labels: null,
        validated: false,
        comments,
        notApplicable: false,
      }) as never;
    const view = {
      sections: [
        {
          key: 'general',
          label: 'General information',
          fields: [
            field('Title', [
              comment(1, 'Fix it', {
                id: 5,
                kind: 'disagree',
                body: '=cmd()',
                respondedBy: { name: 'Responder Name' },
                respondedAt: '2026-11-12T09:00:00.000Z',
              }),
              comment(2, 'Second', null),
            ]),
            field('Empty', []),
          ],
        },
      ],
      other: [],
    } as unknown as SpResultResponse;
    const csv = buildCommentsCsv(view);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Section","Field","Comment","Comment date","Response","Response comment","Responded at"',
      '"General information","Title","Fix it","2026-11-05T09:00:00.000Z","Disagreed","\'=cmd()","2026-11-12T09:00:00.000Z"',
      '"General information","Title","Second","2026-11-05T09:00:00.000Z","","",""',
      '',
    ]);
    expect(csv).not.toContain('Responder Name');
  });

  it('names the file after the result code', () => {
    expect(csvFileName(5001)).toBe('result-5001-qa-comments.csv');
  });
});
