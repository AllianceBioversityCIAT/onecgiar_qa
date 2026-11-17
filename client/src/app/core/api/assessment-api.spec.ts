import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { AssessmentApi } from './assessment-api';
import { ASSESSMENT_ERROR } from './assessment.models';

const API = 'https://api.test/api/v1';
const meta = (nextCursor?: string | null) => ({
  requestId: 'r',
  timestamp: 't',
  ...(nextCursor === undefined ? {} : { page: { nextCursor } }),
});
const worklistData = {
  rows: [{ membershipId: 1, resultCode: '9890', status: 'pending' }],
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
    expect(result.rows.map((r) => r.resultCode)).toEqual(['9890']);
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

  it('view encodes the result code and sends round only when asked', () => {
    api.view(29, 'A/1').subscribe();
    const plain = http.expectOne((r) => r.url === `${API}/timelines/29/results/A%2F1/assessment`);
    expect(plain.request.params.has('round')).toBe(false);
    plain.flush({ success: true, data: {}, meta: meta() });

    api.view(29, '9890', 2).subscribe();
    const admin = http.expectOne((r) => r.url === `${API}/timelines/29/results/9890/assessment`);
    expect(admin.request.params.get('round')).toBe('2');
    admin.flush({ success: true, data: {}, meta: meta() });
  });

  it('validations, comments and quick comments are silent, labelled and may be replayed', () => {
    api.setValidations(29, '9890', { validated: true, all: true }).subscribe();
    api.addComment(29, '9890', 'general.title', 'Too long').subscribe();
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
      expect(req.request.context.get(NO_QUEUE)).toBe(false);
      req.flush({ success: true, data: {}, meta: meta() });
    }
  });

  it('finish, withdraw and the release retry never go to the unsent queue', () => {
    api.finish(29, '9890').subscribe();
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
    const finish = firstValueFrom(api.finish(29, '9890'));
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
    quick.flush({ success: true, data: [], meta: meta() });

    api.releases().subscribe();
    const releases = http.expectOne((r) => r.url === `${API}/assessment-releases`);
    expect(releases.request.params.get('status')).toBe('pending');
    releases.flush({ success: true, data: [], meta: meta() });
  });
});
