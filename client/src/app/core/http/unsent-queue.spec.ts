import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { API, err, ok, session, tick } from '../auth/auth-testing';
import { authInterceptor } from '../auth/auth.interceptor';
import { APP_CONFIG } from '../config/app-config';
import { requestSafetyInterceptor } from './request-safety.interceptor';
import { Toasts } from './toasts';
import { IDEMPOTENCY_HEADER, UnsentQueue } from './unsent-queue';

@Component({ selector: 'qa-unsent-blank', template: '' })
class Blank {}

const STORAGE_KEY = 'qa.unsent.v1';

describe('UnsentQueue', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let toasts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  function configure() {
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
  }

  async function signIn(id = 1) {
    // The queue lives from app start (the shell injects it), so its sign-in effect is there.
    TestBed.inject(UnsentQueue);
    const start = TestBed.inject(AuthSession).signIn({ email: 'ana@cgiar.org', password: 'x' });
    http.expectOne(`${API}/auth/login`).flush(ok(session('tok', { id })));
    await start;
    TestBed.tick();
    await tick();
  }

  /** A write that fails to reach the server, as the interceptor sees it. */
  async function failOffline(body: unknown = { email: 'a@cgiar.org' }) {
    const call = firstValueFrom(client.post(`${API}/users`, body));
    http.expectOne(`${API}/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await call.catch(() => undefined);
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    configure();
  });
  afterEach(() => http.verify());

  it('Keep in queue persists the write with its idempotency key', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();
    const key = queue.awaitingDecision()[0].idempotencyKey;
    queue.keepAwaiting();

    expect(queue.awaitingDecision().length).toBe(0);
    expect(queue.count()).toBe(1);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored[0].idempotencyKey).toBe(key);
    expect(JSON.stringify(stored)).not.toContain('tok');
  });

  it('back online: replays with the same key and leaves the list only on 2xx', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();
    const key = queue.awaitingDecision()[0].idempotencyKey;
    queue.keepAwaiting();

    window.dispatchEvent(new Event('online'));
    await tick();
    const replay = http.expectOne(`${API}/users`);
    expect(replay.request.headers.get(IDEMPOTENCY_HEADER)).toBe(key);
    expect(replay.request.headers.get('Authorization')).toBe('Bearer tok');
    replay.flush(ok({ id: 9 }));
    await tick();

    expect(queue.count()).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(toasts.success).toHaveBeenCalledOnce();
  });

  it('a server rejection on replay is marked and never retried by itself', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();
    queue.keepAwaiting();

    void queue.sendPending();
    await tick();
    http.expectOne(`${API}/users`).flush(err(409, 'USERS_EMAIL_TAKEN', 'Email already used.'), { status: 409, statusText: 'x' });
    await tick();
    expect(queue.items()[0].state).toBe('rejected');
    expect(queue.items()[0].error).toBe('Email already used.');

    await queue.sendPending();
    http.expectNone(`${API}/users`);
  });

  it('still offline on replay: stays pending', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();
    queue.keepAwaiting();

    void queue.sendPending();
    await tick();
    http.expectOne(`${API}/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'x' });
    await tick();
    expect(queue.items()[0].state).toBe('pending');
    expect(queue.items()[0].attempts).toBe(2);
  });

  it('Retry sends now; a write that still cannot get through comes back for a decision', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();

    const retry = queue.retryAwaiting();
    await tick();
    http.expectOne(`${API}/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'x' });
    await retry;
    expect(queue.awaitingDecision().length).toBe(1);
    expect(queue.count()).toBe(0);
  });

  it('survives a reload and is sent after signing in again', async () => {
    await signIn(1);
    await failOffline();
    TestBed.inject(UnsentQueue).keepAwaiting();
    http.verify();

    TestBed.resetTestingModule();
    configure();
    await signIn(1);
    const replay = http.expectOne(`${API}/users`);
    replay.flush(ok({}));
    await tick();
    expect(TestBed.inject(UnsentQueue).count()).toBe(0);
  });

  it("another user on this browser never replays someone else's writes", async () => {
    await signIn(1);
    await failOffline();
    TestBed.inject(UnsentQueue).keepAwaiting();

    TestBed.resetTestingModule();
    configure();
    await signIn(2);
    http.expectNone(`${API}/users`);
    expect(TestBed.inject(UnsentQueue).count()).toBe(0);
  });

  it('clear() (sign-out) empties the list and storage', async () => {
    await signIn();
    const queue = TestBed.inject(UnsentQueue);
    await failOffline();
    queue.keepAwaiting();
    queue.clear();
    expect(queue.count()).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
