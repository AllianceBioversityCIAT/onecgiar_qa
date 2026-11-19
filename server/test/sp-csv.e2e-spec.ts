// P2-3911 (SP view): the CSV export of a result's QA comments, over real HTTP.
import request from 'supertest';
import {
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  IN_STEP_2,
  PLANTED,
  seedSpWorld,
  type SpWorld,
} from './support/sp-seed.js';

describe('SP comments CSV (e2e)', () => {
  let a: AssessmentApp;
  let w: SpWorld;
  let token: string;
  const csvPath = (code: number | string, timelineId = 1) =>
    `/sp/timelines/${timelineId}/results/${code}/comments.csv`;
  /** supertest keeps the raw text of a text/csv answer. */
  const get = (path: string, as: string | null = token) =>
    a.spSend('get', path, as).buffer(true);

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_STEP_2, {
      nicknames: { policy: PLANTED.nickname, policy2: PLANTED.nickname2 },
      names: { policy: { first: PLANTED.first, last: PLANTED.last } },
    });
    w = await seedSpWorld(a);
    token = await a.spLogin();
  });

  afterEach(async () => {
    await a.app.close();
  });

  it('downloads one row per visible comment, with its latest response, as a UTF-8 attachment', async () => {
    // A response that would run as a formula in a spreadsheet.
    await a
      .spSend('put', `/sp/comments/${w.open}/response`, token, {
        kind: 'disagree',
        body: '=HYPERLINK("http://evil.example")',
      })
      .expect(200);
    const res = await get(csvPath(w.codeA)).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="result-${w.codeA}-qa-comments.csv"`,
    );
    const text = res.text;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '"Section","Field","Comment","Comment date","Response","Response comment","Responded at"',
    );
    expect(lines).toHaveLength(4); // header, two comments, final line end
    expect(lines[1]).toContain('"Please add the evidence link"');
    expect(lines[1]).toContain(
      `"Disagreed","'=HYPERLINK(""http://evil.example"")","${IN_STEP_2.toISOString()}"`,
    );
    expect(lines[2]).toContain('"The date looks wrong"');
    expect(lines[2]).toContain('"Accepted","","2026-11-12T09:00:00.000Z"');
    // Never the envelope, an assessor, a responder email, or a hidden comment.
    expect(text).not.toContain('"success"');
    for (const absent of [
      PLANTED.nickname,
      PLANTED.nickname2,
      PLANTED.first,
      PLANTED.last,
      'sub-policy',
      'sp-user@example.org',
      'earlier-responder@example.org',
      'Earlier Responder',
      'Withdrawn text never shown',
      'Not visible text never shown',
    ]) {
      expect(text, absent).not.toContain(absent);
    }
  });

  it('keeps errors in the JSON envelope, with the same 404 as the result view', async () => {
    const missing = await get(csvPath(999999)).expect(404);
    expect(missing.headers['content-type']).toMatch(/application\/json/);
    expect(missing.body.error.code).toBe('SP_NOT_FOUND');
    for (const path of [csvPath(7002), csvPath(w.codeA, 2)]) {
      const res = await get(path).expect(404);
      expect(withoutRequestMeta(res.body)).toEqual(
        withoutRequestMeta(missing.body),
      );
    }
    const anonymous = await request(a.app.getHttpServer())
      .get(`/api/v1${csvPath(w.codeA)}`)
      .expect(401);
    expect(anonymous.body.error.code).toBe('SP_SESSION_INVALID');
  });
});
