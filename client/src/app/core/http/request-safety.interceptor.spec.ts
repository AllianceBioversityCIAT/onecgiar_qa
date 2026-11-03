import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { API, err, ok, session, tick } from '../auth/auth-testing';
import { authInterceptor } from '../auth/auth.interceptor';
import { APP_CONFIG } from '../config/app-config';
import { SILENT_ERRORS, TIMEOUT_MS } from './request-context';
import { requestSafetyInterceptor } from './request-safety.interceptor';
import { Toasts } from './toasts';
import { IDEMPOTENCY_HEADER, UnsentQueue } from './unsent-queue';

@Component({ selector: 'qa-safety-blank', template: '' })
class Blank {}

describe('requestSafetyInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let toasts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([requestSafetyInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: Blank }]),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
        { provide: Toasts, useValue: toasts },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    const start = TestBed.inject(AuthSession).signIn({ email: 'ana@cgiar.org', password: 'x' });
    http.expectOne(`${API}/auth/login`).flush(ok(session('tok')));
    await start;
  });
  afterEach(() => http.verify());

  it('two identical writes in flight send ONE request and both callers get its result', async () => {
    const a = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    const b = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    const reqs = http.match(`${API}/users`);
    expect(reqs.length).toBe(1);
    reqs[0].flush(ok({ id: 7 }));
    expect(await a).toEqual(ok({ id: 7 }));
    expect(await b).toEqual(ok({ id: 7 }));
  });

  it('different bodies are different actions', () => {
    void firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    void firstValueFrom(client.post(`${API}/users`, { email: 'b@cgiar.org' }));
    const reqs = http.match(`${API}/users`);
    expect(reqs.length).toBe(2);
    reqs.forEach((r) => r.flush(ok({})));
  });

  it('a new identical write after the first answered is sent again', async () => {
    const first = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    http.expectOne(`${API}/users`).flush(ok({}));
    await first;
    void firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    http.expectOne(`${API}/users`).flush(ok({}));
  });

  it('every write carries an Idempotency-Key; reads do not', () => {
    void firstValueFrom(client.put(`${API}/users/1/roles`, []));
    void firstValueFrom(client.get(`${API}/users`));
    const put = http.expectOne((r) => r.method === 'PUT');
    const get = http.expectOne((r) => r.method === 'GET');
    expect(put.request.headers.get(IDEMPOTENCY_HEADER)).toBeTruthy();
    expect(get.request.headers.has(IDEMPOTENCY_HEADER)).toBe(false);
    put.flush(ok([]));
    get.flush(ok([]));
  });

  it('a server error shows one toast with the catalog message and still reaches the caller', async () => {
    const call = firstValueFrom(client.post(`${API}/users/1/deactivate`, null));
    http.expectOne(`${API}/users/1/deactivate`).flush(err(409, 'USERS_LAST_ADMIN', 'You are the only admin.'), {
      status: 409,
      statusText: 'Conflict',
    });
    await expect(call).rejects.toBeTruthy();
    expect(toasts.error).toHaveBeenCalledExactlyOnceWith('You are the only admin.');
  });

  it('no toast for silent requests, field errors (the form shows them) or auth calls', async () => {
    const silent = firstValueFrom(client.get(`${API}/x`, { context: new HttpContext().set(SILENT_ERRORS, true) }));
    http.expectOne(`${API}/x`).flush(err(500, 'X'), { status: 500, statusText: 'x' });
    await expect(silent).rejects.toBeTruthy();

    const fields = firstValueFrom(client.post(`${API}/users`, { email: '' }));
    http.expectOne(`${API}/users`).flush(
      { success: false, error: { status: 400, code: 'VALIDATION', message: 'Check the form.', fields: [{ field: 'email', code: 'REQUIRED', message: 'Required' }] }, meta: { requestId: 'r', timestamp: 't' } },
      { status: 400, statusText: 'Bad Request' },
    );
    await expect(fields).rejects.toBeTruthy();

    const login = firstValueFrom(client.post(`${API}/auth/login`, { email: 'x', password: 'y' }));
    http.expectOne(`${API}/auth/login`).flush(err(401, 'AUTH_INVALID_CREDENTIALS'), { status: 401, statusText: 'x' });
    await expect(login).rejects.toBeTruthy();

    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('a write that cannot reach the server goes to the unsent queue, not to a toast', async () => {
    const queue = TestBed.inject(UnsentQueue);
    const call = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' }));
    http.expectOne(`${API}/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await expect(call).rejects.toBeTruthy();
    expect(queue.awaitingDecision().length).toBe(1);
    expect(queue.awaitingDecision()[0].method).toBe('POST');
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('a 503 on a write goes to the queue (the server may come back), not to a toast', async () => {
    const queue = TestBed.inject(UnsentQueue);
    const call = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' })).catch(() => 'failed');
    http.expectOne(`${API}/users`).flush(null, { status: 503, statusText: 'Service Unavailable' });
    expect(await call).toBe('failed');
    expect(queue.awaitingDecision().length).toBe(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('a 401 whose refresh could not reach the server is queued while the session lives', async () => {
    const queue = TestBed.inject(UnsentQueue);
    const call = firstValueFrom(client.post(`${API}/users`, { email: 'a@cgiar.org' })).catch(() => 'failed');
    http.expectOne(`${API}/users`).flush(err(401, 'AUTH_TOKEN_INVALID'), { status: 401, statusText: 'x' });
    await tick();
    http.expectOne(`${API}/auth/session/refresh`).error(new ProgressEvent('error'), { status: 0, statusText: 'x' });
    expect(await call).toBe('failed');
    expect(TestBed.inject(AuthSession).isSignedIn()).toBe(true);
    expect(queue.awaitingDecision().length).toBe(1);
  });

  it('a silent server counts as unreachable after the timeout', async () => {
    const queue = TestBed.inject(UnsentQueue);
    // Caught right away: the timeout rejects before the assertion runs.
    const call = firstValueFrom(
      client.post(`${API}/users`, { email: 'a@cgiar.org' }, { context: new HttpContext().set(TIMEOUT_MS, 20) }),
    ).then(
      () => 'answered',
      () => 'failed',
    );
    const pending = http.expectOne(`${API}/users`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await call).toBe('failed');
    expect(pending.cancelled).toBe(true);
    expect(queue.awaitingDecision().length).toBe(1);
    await tick();
  });
});
