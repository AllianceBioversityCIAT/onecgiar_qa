import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { AssessmentApi } from './assessment-api';
import { ASSESSMENT_ERROR } from './assessment.models';
import { decisionResultFixture, roundTwoViewFixture } from '../../pages/workspace/review/review.round2-fixture';

const API = 'https://api.test/api/v1';
const meta = (nextCursor?: string | null) => ({
  requestId: 'r',
  timestamp: 't',
  ...(nextCursor === undefined ? {} : { page: { nextCursor } }),
});
const worklistData = {
  rows: [{ membershipId: 1, resultCode: 9890, status: 'pending' }],
  counters: { pending: 1, finished: 0, total: 1 },
  writable: true,
  noActiveRole: false,
};

describe('AssessmentApi', () => {
  let http: HttpTestingController;
  let api: AssessmentApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(AssessmentApi);
  });
  afterEach(() => http.verify());

  it('timelines unwraps the envelope', async () => {
    const answer = firstValueFrom(api.timelines());
    http.expectOne(`${API}/worklist/timelines`).flush({
      success: true,
      data: { timelines: [], defaultTimelineId: null, timeZone: 'Europe/Rome' },
      meta: meta(),
    });
    expect(await answer).toEqual({ timelines: [], defaultTimelineId: null, timeZone: 'Europe/Rome' });
  });

  it('worklist sends lists as csv, leaves empty filters out and keeps the cursor next to the data', async () => {
    const page = firstValueFrom(
      api.worklist(29, { status: ['pending', 'auto_validated'], programId: [], q: '', sort: 'status', dir: 'desc', limit: 25, cursor: 'c1' }),
    );
    const req = http.expectOne((r) => r.url === `${API}/timelines/29/worklist`);
    expect(req.request.params.get('status')).toBe('pending,auto_validated');
    expect(req.request.params.has('programId')).toBe(false);
    expect(req.request.params.has('q')).toBe(false);
    expect(req.request.params.get('sort')).toBe('status');
    expect(req.request.params.get('dir')).toBe('desc');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('cursor')).toBe('c1');
    req.flush({ success: true, data: worklistData, meta: meta('c2') });

    const result = await page;
    expect(result.nextCursor).toBe('c2');
    expect(result.counters.total).toBe(1);
    expect(result.noActiveRole).toBe(false);
    expect(result.rows.map((r) => r.resultCode)).toEqual([9890]);
  });

  it('the last worklist page has a null cursor', async () => {
    const page = firstValueFrom(api.worklist(29));
    http.expectOne((r) => r.url === `${API}/timelines/29/worklist`).flush({ success: true, data: worklistData, meta: meta(null) });
    expect((await page).nextCursor).toBeNull();
  });

  it('a 404 TIMELINES_NOT_FOUND on the worklist becomes an ApiError with its code', async () => {
    const page = firstValueFrom(api.worklist(7));
    http
      .expectOne((r) => r.url === `${API}/timelines/7/worklist`)
      .flush(
        { success: false, error: { status: 404, code: 'TIMELINES_NOT_FOUND', message: 'Not found' }, meta: meta() },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(page).rejects.toMatchObject({ status: 404, code: 'TIMELINES_NOT_FOUND' });
  });

  it('view reads one result of one timeline and sends round only when asked', () => {
    api.view(29, 8793).subscribe();
    const plain = http.expectOne((r) => r.url === `${API}/timelines/29/results/8793/assessment`);
    expect(plain.request.params.has('round')).toBe(false);
    plain.flush({ success: true, data: {}, meta: meta() });

    api.view(29, 9890, 2).subscribe();
    const admin = http.expectOne((r) => r.url === `${API}/timelines/29/results/9890/assessment`);
    expect(admin.request.params.get('round')).toBe('2');
    admin.flush({ success: true, data: {}, meta: meta() });
  });

  it('a comment is never queued: sent later by the queue, a second try of the reviewer would write it twice', () => {
    api.addComment(29, 9890, 'general.title', 'Too long').subscribe();
    const comment = http.expectOne(`${API}/timelines/29/results/9890/assessment/comments`);
    expect(comment.request.context.get(NO_QUEUE)).toBe(true);
    comment.flush({ success: true, data: {}, meta: meta() });
  });

  it('validations, comments and quick comments are silent, labelled and may be replayed', () => {
    api.setValidations(29, 9890, { validated: true, all: true }).subscribe();
    api.addComment(29, 9890, 'general.title', 'Too long').subscribe();
    api.saveQuickComment('ASSESSOR', 'Check the source').subscribe();

    const validations = http.expectOne(`${API}/timelines/29/results/9890/assessment/validations`);
    expect(validations.request.method).toBe('PUT');
    expect(validations.request.body).toEqual({ validated: true, all: true });
    const comment = http.expectOne(`${API}/timelines/29/results/9890/assessment/comments`);
    expect(comment.request.body).toEqual({ fieldKey: 'general.title', body: 'Too long' });
    const quick = http.expectOne(`${API}/quick-comments`);
    expect(quick.request.body).toEqual({ role: 'ASSESSOR', body: 'Check the source' });

    for (const req of [validations, comment, quick]) {
      expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
      expect(req.request.context.get(UNSENT_LABEL)).toBeTruthy();
      req.flush({ success: true, data: {}, meta: meta() });
    }
    // The green/grey write and the quick comment can be sent again safely (same end state, one entry per text).
    for (const req of [validations, quick]) expect(req.request.context.get(NO_QUEUE)).toBe(false);
  });

  it('finish, withdraw and the release retry never go to the unsent queue', () => {
    api.finish(29, 9890).subscribe();
    api.withdrawComment(5).subscribe();
    api.retryReleases().subscribe();
    for (const url of [
      `${API}/timelines/29/results/9890/assessment/finish`,
      `${API}/assessment-comments/5/withdraw`,
      `${API}/assessment-releases/retry`,
    ]) {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('POST');
      expect(req.request.context.get(NO_QUEUE)).toBe(true);
      req.flush({ success: true, data: {}, meta: meta() });
    }
  });

  it('a finish refused with core fields left exposes their keys on fieldKeys, not on fields', async () => {
    const finish = firstValueFrom(api.finish(29, 9890));
    http.expectOne(`${API}/timelines/29/results/9890/assessment/finish`).flush(
      {
        success: false,
        error: {
          status: 409,
          code: ASSESSMENT_ERROR.CORE_UNCOMMENTED,
          message: 'Validate or comment on every core field first.',
          fields: ['general.title', 'general.description'],
        },
        meta: meta(),
      },
      { status: 409, statusText: 'Conflict' },
    );
    const error = (await finish.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ASSESSMENT_ERROR.CORE_UNCOMMENTED);
    expect(error.fieldKeys).toEqual(['general.title', 'general.description']);
    expect(error.fields).toEqual([]);
    expect(error.fieldMessage('general.title')).toBeNull();
  });

  it('quick comments and releases send their query', () => {
    api.quickComments('TPB').subscribe();
    const quick = http.expectOne((r) => r.url === `${API}/quick-comments`);
    expect(quick.request.params.get('role')).toBe('TPB');
    // No toast of its own: a caller with no grant of the role (403) simply has no list.
    expect(quick.request.context.get(SILENT_ERRORS)).toBe(true);
    quick.flush({ success: true, data: [], meta: meta() });

    api.releases().subscribe();
    const releases = http.expectOne((r) => r.url === `${API}/assessment-releases`);
    expect(releases.request.params.get('status')).toBe('pending');
    releases.flush({ success: true, data: [], meta: meta() });
  });

  it("reads the program's responses of a result as a list of threads (P2-3911)", async () => {
    const thread = { commentId: 5, fieldKey: 'general.title', state: 'accepted', response: null, history: [], clarifications: [] };
    const read = firstValueFrom(api.programResponses(29, 9890));
    const req = http.expectOne(`${API}/timelines/29/results/9890/sp-responses`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: { comments: [thread] }, meta: meta() });
    expect(await read).toEqual([thread]);
  });

  it('a clarification answer sends its text and never goes to the unsent queue (a replay would answer twice)', () => {
    api.answerClarification(5, 'The link in the evidence section.').subscribe();
    const req = http.expectOne(`${API}/assessment-comments/5/clarification-answer`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ body: 'The link in the evidence section.' });
    expect(req.request.context.get(NO_QUEUE)).toBe(true);
    req.flush({ success: true, data: {}, meta: meta() });
  });
  // ── Round 2 (Lead Assessor, P2-3912) ──

  it('view hands back a round-2 view untouched: round, per-field flags, thread and the Lead\'s own comment keys', async () => {
    const fixture = roundTwoViewFixture();
    const read = firstValueFrom(api.view(29, 9890));
    http.expectOne((r) => r.url === `${API}/timelines/29/results/9890/assessment`).flush({ success: true, data: fixture, meta: meta() });
    const view = await read;
    expect(view).toEqual(fixture);
    expect(view.round).toBe(2);
    const [carried, updated] = view.sections[0].fields;
    expect(carried.effectiveValidated && carried.carried).toBe(true);
    expect(updated.thread?.[0].choices).toEqual(['agree_program', 'escalate']);
    expect(updated.comments[0].choices).toEqual(['escalate']);
  });

  it('decide PUTs the decision and its text on the comment path and unwraps the decision result', async () => {
    const answer = decisionResultFixture();
    const decided = firstValueFrom(api.decide(29, 9890, 41, 'agree_program', 'The program is right.'));
    const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/decisions/41`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ decision: 'agree_program', body: 'The program is right.' });
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    expect(req.request.context.get(UNSENT_LABEL)).toBeTruthy();
    // A PUT: sent twice it gives the same state, so the Unsent list may replay it.
    expect(req.request.context.get(NO_QUEUE)).toBe(false);
    req.flush({ success: true, data: answer, meta: meta() });
    expect(await decided).toEqual(answer);
  });

  it('TPB: decide PUTs a TPB choice with its required reason (P2-3916)', async () => {
    const decided = firstValueFrom(api.decide(29, 9890, 41, 'tpb_agree_assessor', 'The assessor is right.'));
    const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/decisions/41`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ decision: 'tpb_agree_assessor', body: 'The assessor is right.' });
    req.flush({ success: true, data: decisionResultFixture({ decision: { decision: 'tpb_agree_assessor', body: 'The assessor is right.', decidedAt: '2026-11-30T10:00:00.000Z' } }), meta: meta() });
    expect((await decided).decision?.decision).toBe('tpb_agree_assessor');
  });

  it('PPU: a Done with no note leaves `body` out of the request (a blank body is a 400, P2-3917 § 5)', async () => {
    const done = firstValueFrom(api.decide(29, 9890, 41, 'ppu_done', null));
    const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/decisions/41`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ decision: 'ppu_done' });
    req.flush({ success: true, data: decisionResultFixture({ status: 'quality_assessed', decision: { decision: 'ppu_done', body: null, decidedAt: '2026-12-04T10:00:00.000Z' } }), meta: meta() });
    expect((await done).status).toBe('quality_assessed');
  });

  it('PPU: a Done with a note sends it', async () => {
    const done = firstValueFrom(api.decide(29, 9890, 41, 'ppu_done', 'Fixed in Reporting.'));
    const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/decisions/41`);
    expect(req.request.body).toEqual({ decision: 'ppu_done', body: 'Fixed in Reporting.' });
    req.flush({ success: true, data: decisionResultFixture(), meta: meta() });
    await done;
  });

  it('clearDecision DELETEs the same path with no body and unwraps decision: null', async () => {
    const answer = decisionResultFixture({ decision: null, validations: [] });
    const cleared = firstValueFrom(api.clearDecision(29, 9890, 41));
    const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/decisions/41`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    // Clearing where there is none changes nothing: a replay is safe, like the decision itself.
    expect(req.request.context.get(NO_QUEUE)).toBe(false);
    req.flush({ success: true, data: answer, meta: meta() });
    expect((await cleared).decision).toBeNull();
  });

  it('deleteComment POSTs to the delete path with no body and never goes to the unsent queue (a second delete is a 409)', async () => {
    const deleted = firstValueFrom(api.deleteComment(41));
    const req = http.expectOne(`${API}/assessment-comments/41/delete`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    expect(req.request.context.get(NO_QUEUE)).toBe(true);
    req.flush({
      success: true,
      data: { id: 41, state: 'disagreed', deletedAt: '2026-11-25T12:00:00.000Z', deletedBy: 14 },
      meta: meta(),
    });
    expect(await deleted).toMatchObject({ id: 41, deletedAt: '2026-11-25T12:00:00.000Z', deletedBy: 14 });
  });

  it('a round-2 finish refused with undecided core fields exposes their keys on fieldKeys', async () => {
    const finish = firstValueFrom(api.finish(29, 9890));
    http.expectOne(`${API}/timelines/29/results/9890/assessment/finish`).flush(
      {
        success: false,
        error: {
          status: 409,
          code: ASSESSMENT_ERROR.CORE_UNDECIDED,
          message: 'Decide every grey core field first.',
          fields: ['general.description'],
        },
        meta: meta(),
      },
      { status: 409, statusText: 'Conflict' },
    );
    const error = (await finish.catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('ASSESSMENT_CORE_UNDECIDED');
    expect(error.fieldKeys).toEqual(['general.description']);
    expect(error.fields).toEqual([]);
  });

  it('the round-2 error codes are the exact server strings', () => {
    expect([
      ASSESSMENT_ERROR.FIELD_NOT_CORE,
      ASSESSMENT_ERROR.FIELD_ESCALATED,
      ASSESSMENT_ERROR.CORE_COMMENT_UNDECIDED,
      ASSESSMENT_ERROR.DECISION_INVALID,
      ASSESSMENT_ERROR.CORE_UNDECIDED,
      ASSESSMENT_ERROR.COMMENT_NOT_DELETABLE,
    ]).toEqual([
      'ASSESSMENT_FIELD_NOT_CORE',
      'ASSESSMENT_FIELD_ESCALATED',
      'ASSESSMENT_CORE_COMMENT_UNDECIDED',
      'ASSESSMENT_DECISION_INVALID',
      'ASSESSMENT_CORE_UNDECIDED',
      'ASSESSMENT_COMMENT_NOT_DELETABLE',
    ]);
  });
});
