import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TokenStore } from '../auth/token-store';
import { ApiError } from '../http/api-envelope';
import { SP_PARENT_FRAME } from '../sp/sp-session';
import { FakeParent, SP_API, fakeParent, setupSpTesting, spErr, spOk, startSpSession } from '../sp/sp-testing';
import { SpApi } from './sp-api';

describe('SpApi', () => {
  let http: HttpTestingController;
  let parent: FakeParent;
  let api: SpApi;

  beforeEach(async () => {
    parent = fakeParent();
    http = setupSpTesting(parent);
    api = TestBed.inject(SpApi);
    await startSpSession(http);
  });
  afterEach(() => http.verify());

  it('sends the SP bearer even when the tab holds a Cognito token (the auth interceptor never runs)', async () => {
    TestBed.inject(TokenStore).set('cognito-token', 3600);
    // Sanity: the app HttpClient WOULD add the Cognito token.
    void firstValueFrom(TestBed.inject(HttpClient).get(`${SP_API}/worklist/timelines`));
    const app = http.expectOne(`${SP_API}/worklist/timelines`);
    expect(app.request.headers.get('Authorization')).toBe('Bearer cognito-token');
    app.flush(spOk({}));

    const me = firstValueFrom(api.me());
    const req = http.expectOne(`${SP_API}/sp/me`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer sp-token-1');
    expect(req.request.headers.has('Idempotency-Key')).toBe(false);
    expect(req.request.withCredentials).toBe(false);
    req.flush(spOk({ user: { name: 'Sam Program' }, isReportingAdmin: false, program: null, programs: [] }));
    expect((await me).user.name).toBe('Sam Program');
  });

  it('a 401 ends the SP session (not Cognito) and tells Reporting session_expired once', async () => {
    const tokens = TestBed.inject(TokenStore);
    tokens.set('cognito-token', 3600);
    const call = firstValueFrom(api.timelines(null));
    http.expectOne(`${SP_API}/sp/timelines`).flush(spErr(401, 'SP_SESSION_INVALID'), { status: 401, statusText: 'x' });
    await expect(call).rejects.toBeInstanceOf(ApiError);

    // No refresh, no Cognito sign-out: only the SP session ended.
    http.expectNone(`${SP_API}/auth/refresh`);
    expect(tokens.accessToken()).toBe('cognito-token');
    expect(parent.messages).toEqual([{ type: 'qa-sp:reload-required', reason: 'session_expired' }]);

    // Later calls do not leave and do not post again.
    await expect(firstValueFrom(api.me())).rejects.toMatchObject({ code: 'SP_SESSION_INVALID' });
    http.expectNone(`${SP_API}/sp/me`);
    expect(parent.messages.length).toBe(1);
    expect(TestBed.inject(SP_PARENT_FRAME)).toBe(parent);
  });

  it('results sends programId and the filters as csv, leaving empty ones out', async () => {
    void firstValueFrom(api.results(7, { programId: 102, status: ['pending', 'quality_assessed'], resultTypeKey: [] }));
    const req = http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results`);
    expect(req.request.params.get('programId')).toBe('102');
    expect(req.request.params.get('status')).toBe('pending,quality_assessed');
    expect(req.request.params.has('resultTypeKey')).toBe(false);
    req.flush(spOk({ rows: [], options: { statuses: [], resultTypes: [] }, step: null }));
  });

  it('a non-admin call carries no programId', () => {
    void firstValueFrom(api.result(7, 123, null));
    const req = http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results/123`);
    expect(req.request.params.has('programId')).toBe(false);
    req.flush(spOk({}));
  });

  it('respond PUTs the body as given', async () => {
    const answer = firstValueFrom(api.respond(55, { kind: 'accept' }));
    const req = http.expectOne(`${SP_API}/sp/comments/55/response`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ kind: 'accept' });
    req.flush(spOk({ comment: { id: 55 }, counts: { comments: 2, answered: 1 } }));
    expect((await answer).counts).toEqual({ comments: 2, answered: 1 });
  });

  it('the CSV keeps the envelope error of a refused download', async () => {
    const call = firstValueFrom(api.commentsCsv(7, 123, null));
    const req = http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results/123/comments.csv`);
    expect(req.request.responseType).toBe('blob');
    expect(req.request.headers.get('Authorization')).toBe('Bearer sp-token-1');
    req.flush(new Blob([JSON.stringify(spErr(404, 'SP_NOT_FOUND', 'We could not find this result.'))], { type: 'application/json' }), {
      status: 404,
      statusText: 'Not Found',
    });
    await expect(call).rejects.toMatchObject({ status: 404, code: 'SP_NOT_FOUND', message: 'We could not find this result.' });
  });
});
