// @akili-spec assessment/step-1-assessment
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS } from '../http/request-context';
import { AssessmentApi } from './assessment-api';
import { ASSESSMENT_ERROR } from './assessment.models';

const API = 'https://api.test/api/v1';
const meta = (nextCursor?: string | null) => ({
  requestId: 'req-1',
  timestamp: 't',
  ...(nextCursor === undefined ? {} : { page: { nextCursor } }),
});
const fail = (status: number, code: string, fields?: unknown) => ({
  success: false,
  error: { status, code, message: `catalog text of ${code}`, ...(fields ? { fields } : {}) },
  meta: meta(),
});
const counters = { pending: 2, finished: 1, total: 3 };

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

  describe('envelope', () => {
    it('timelines unwraps data', async () => {
      const got = firstValueFrom(api.timelines());
      const req = http.expectOne(`${API}/worklist/timelines`);
      expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
      req.flush({ success: true, data: { timelines: [], defaultTimelineId: null, timeZone: 'Europe/Rome' }, meta: meta() });
      expect(await got).toEqual({ timelines: [], defaultTimelineId: null, timeZone: 'Europe/Rome' });
    });

    it('a 200 with success:false is an ApiError with its code and request id', async () => {
      const got = firstValueFrom(api.options(29)).catch((e: unknown) => e);
      http.expectOne(`${API}/timelines/29/worklist/options`).flush(fail(404, ASSESSMENT_ERROR.TIMELINES_NOT_FOUND));
      const error = (await got) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe('TIMELINES_NOT_FOUND');
      expect(error.requestId).toBe('req-1');
    });
  });

  describe('worklist page and cursor', () => {
    it('sends lists as csv, skips empty values and keeps meta.page.nextCursor next to rows and counters', async () => {
      const got = firstValueFrom(
        api.worklist(29, { status: ['pending', 'returned_to_program'], programId: [51, 52], resultTypeKey: [], q: '', sort: 'program', dir: 'desc', limit: 25 }),
      );
      const req = http.expectOne((r) => r.url === `${API}/timelines/29/worklist`);
      expect(req.request.params.get('status')).toBe('pending,returned_to_program');
      expect(req.request.params.get('programId')).toBe('51,52');
      expect(req.request.params.has('resultTypeKey')).toBe(false);
      expect(req.request.params.has('q')).toBe(false);
      expect(req.request.params.has('cursor')).toBe(false);
      expect(req.request.params.get('sort')).toBe('program');
      expect(req.request.params.get('dir')).toBe('desc');
      expect(req.request.params.get('limit')).toBe('25');
      req.flush({ success: true, data: { rows: [{ resultCode: 9890 }], counters, writable: true, noActiveRole: false }, meta: meta('c2') });
      const page = await got;
      expect(page.nextCursor).toBe('c2');
      expect(page.counters).toEqual(counters);
      expect(page.rows).toEqual([{ resultCode: 9890 }]);
      expect(page.writable).toBe(true);
    });

    it('sends the previous cursor back and reads null on the last page', async () => {
      const got = firstValueFrom(api.worklist(29, { cursor: 'c2', sort: 'code', dir: 'asc' }));
      const req = http.expectOne((r) => r.url === `${API}/timelines/29/worklist`);
      expect(req.request.params.get('cursor')).toBe('c2');
      req.flush({ success: true, data: { rows: [], counters, writable: false, noActiveRole: true }, meta: meta(null) });
      const page = await got;
      expect(page.nextCursor).toBeNull();
      expect(page.noActiveRole).toBe(true);
    });

    it('a tampered cursor is a 400 VALIDATION_FAILED naming cursor', async () => {
      const got = firstValueFrom(api.worklist(29, { cursor: 'bad' })).catch((e: unknown) => e);
      http
        .expectOne((r) => r.url === `${API}/timelines/29/worklist`)
        .flush(fail(400, 'VALIDATION_FAILED', [{ field: 'cursor', code: 'INVALID', message: 'Invalid cursor' }]), { status: 400, statusText: 'Bad Request' });
      const error = (await got) as ApiError;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.fieldMessage('cursor')).toBe('Invalid cursor');
      expect(error.fieldKeys).toEqual([]);
    });
  });

  describe('assessment routes and error codes', () => {
    it('reads the view of a result', async () => {
      const got = firstValueFrom(api.view(29, 9890));
      http.expectOne(`${API}/timelines/29/results/9890/assessment`).flush({ success: true, data: { writable: true }, meta: meta() });
      expect((await got).writable).toBe(true);
    });

    it('validate PUTs the body, silent and never queued', async () => {
      const got = firstValueFrom(api.validate(29, 9890, { validated: true, fieldKeys: ['general.title'] }));
      const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/validations`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ validated: true, fieldKeys: ['general.title'] });
      expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
      expect(req.request.context.get(NO_QUEUE)).toBe(true);
      req.flush({ success: true, data: { status: 'pending', assessedBy: null, finishedAt: null, validations: [] }, meta: meta() });
      expect((await got).status).toBe('pending');
    });

    it('comment carries the caller-chosen Idempotency-Key; a replay (same 201) is a success', async () => {
      const got = firstValueFrom(api.comment(29, 9890, { fieldKey: 'general.title', body: 'Fix it' }, 'key-1'));
      const req = http.expectOne(`${API}/timelines/29/results/9890/assessment/comments`);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Idempotency-Key')).toBe('key-1');
      expect(req.request.body).toEqual({ fieldKey: 'general.title', body: 'Fix it' });
      req.flush({ success: true, data: { id: 7, state: 'open' }, meta: meta() }, { status: 201, statusText: 'Created', headers: { 'Idempotency-Replayed': 'true' } });
      expect((await got).id).toBe(7);
    });

    it('withdraw and finish POST with no body', () => {
      void firstValueFrom(api.withdraw(7));
      void firstValueFrom(api.finish(29, 9890));
      const withdraw = http.expectOne(`${API}/assessment-comments/7/withdraw`);
      const finish = http.expectOne(`${API}/timelines/29/results/9890/assessment/finish`);
      for (const req of [withdraw, finish]) {
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toBeNull();
        req.flush({ success: true, data: {}, meta: meta() });
      }
    });

    it.each([
      [409, ASSESSMENT_ERROR.FINISHED],
      [409, ASSESSMENT_ERROR.STEP_CLOSED],
      [403, ASSESSMENT_ERROR.READ_ONLY],
      [404, ASSESSMENT_ERROR.NOT_FOUND],
      [409, ASSESSMENT_ERROR.NO_FIELD_CONFIG],
      [503, ASSESSMENT_ERROR.SERVICE_UNAVAILABLE],
    ])('an HTTP %i keeps the code %s and the catalog message', async (status, code) => {
      const got = firstValueFrom(api.finish(29, 9890)).catch((e: unknown) => e);
      http.expectOne(`${API}/timelines/29/results/9890/assessment/finish`).flush(fail(status, code), { status, statusText: 'x' });
      const error = (await got) as ApiError;
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe(`catalog text of ${code}`);
    });

    it('ASSESSMENT_CORE_UNCOMMENTED: error.fields is a string[] of keys (contract § 6.5)', async () => {
      const got = firstValueFrom(api.finish(29, 9890)).catch((e: unknown) => e);
      http
        .expectOne(`${API}/timelines/29/results/9890/assessment/finish`)
        .flush(fail(409, ASSESSMENT_ERROR.CORE_UNCOMMENTED, ['general.title', 'general.description']), { status: 409, statusText: 'Conflict' });
      const error = (await got) as ApiError;
      expect(error.code).toBe('ASSESSMENT_CORE_UNCOMMENTED');
      expect(error.fieldKeys).toEqual(['general.title', 'general.description']);
      expect(error.fields).toEqual([]);
    });
  });

  describe('quick comments', () => {
    it('lists by role and saves { role, body }', async () => {
      const list = firstValueFrom(api.quickComments('ASSESSOR'));
      const get = http.expectOne((r) => r.url === `${API}/quick-comments`);
      expect(get.request.params.get('role')).toBe('ASSESSOR');
      get.flush({ success: true, data: [{ id: 1, body: 'Add the evidence link', createdAt: 't' }], meta: meta() });
      expect((await list).map((q) => q.body)).toEqual(['Add the evidence link']);

      const saved = firstValueFrom(api.saveQuickComment('ASSESSOR', 'Add the evidence link'));
      const post = http.expectOne(`${API}/quick-comments`);
      expect(post.request.body).toEqual({ role: 'ASSESSOR', body: 'Add the evidence link' });
      post.flush({ success: true, data: { id: 1, body: 'Add the evidence link', createdAt: 't' }, meta: meta() }, { status: 200, statusText: 'OK' });
      expect((await saved).id).toBe(1);
    });
  });
});
