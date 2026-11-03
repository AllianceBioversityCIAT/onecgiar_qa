import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { API, ok, session, tick } from '../auth/auth-testing';
import { authInterceptor } from '../auth/auth.interceptor';
import { APP_CONFIG } from '../config/app-config';
import { NO_QUEUE } from './request-context';
import { requestSafetyInterceptor } from './request-safety.interceptor';
import { Toasts } from './toasts';
import { IDEMPOTENCY_HEADER, UnsentQueue } from './unsent-queue';
import { WriteEvents, reloadAfterReplay } from './write-events';

@Component({ selector: 'qa-order-blank', template: '' })
class Blank {}

const REMOVE = `${API}/users/7/deactivate`;
const BRING_BACK = `${API}/users/7/activate`;

/** BUG-2 (review 2026-11-03): stored writes keep their order and the screen shows the replay. */
describe('Unsent queue — order and reload after a replay', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let queue: UnsentQueue;

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([requestSafetyInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: Blank }]),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    queue = TestBed.inject(UnsentQueue);
    const start = TestBed.inject(AuthSession).signIn({ email: 'ana@cgiar.org', password: 'x' });
    http.expectOne(`${API}/auth/login`).flush(ok(session('tok')));
    await start;
    TestBed.tick();
    await tick();
  });
  afterEach(() => http.verify());

  /** A write that could not reach the server: it ends in the queue. */
  async function storeOffline(url: string, body: unknown = null): Promise<void> {
    const call = firstValueFrom(client.post(url, body)).catch(() => undefined);
    await tick();
    http.expectOne(url).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await call;
  }

  it('with nothing stored, a write leaves at once', () => {
    void firstValueFrom(client.post(BRING_BACK, null)).catch(() => undefined);
    http.expectOne(BRING_BACK).flush(ok({}));
  });

  it('a stored Remove reaches the server before a newer Bring back', async () => {
    await storeOffline(REMOVE);
    queue.keepAwaiting();

    const bringBack = firstValueFrom(client.post(BRING_BACK, null));
    await tick();
    http.expectNone(BRING_BACK);
    http.expectOne(REMOVE).flush(ok({ id: 7, status: 'inactive' }));
    await tick();
    http.expectOne(BRING_BACK).flush(ok({ id: 7, status: 'active' }));
    await bringBack;
    expect(queue.count()).toBe(0);
  });

  it('a write still waiting for the Retry / Keep answer goes first too, and the question closes', async () => {
    await storeOffline(REMOVE);
    expect(queue.awaitingDecision().length).toBe(1);

    const bringBack = firstValueFrom(client.post(BRING_BACK, null));
    await tick();
    http.expectOne(REMOVE).flush(ok({}));
    await tick();
    http.expectOne(BRING_BACK).flush(ok({}));
    await bringBack;
    expect(queue.awaitingDecision().length).toBe(0);
    expect(queue.count()).toBe(0);
  });

  it('a stored write that still cannot get through keeps the new one behind it', async () => {
    await storeOffline(REMOVE);
    queue.keepAwaiting();

    const bringBack = firstValueFrom(client.post(BRING_BACK, null)).then(() => 'sent', () => 'not sent');
    await tick();
    http.expectOne(REMOVE).flush(null, { status: 503, statusText: 'Service Unavailable' });
    await tick();
    http.expectNone(BRING_BACK);
    expect(await bringBack).toBe('not sent');
    expect(queue.items().map((i) => i.url)).toEqual([REMOVE, BRING_BACK]);
  });

  it('a write that never goes to the queue fails instead of overtaking a stored one', async () => {
    await storeOffline(REMOVE);
    queue.keepAwaiting();

    const discard = firstValueFrom(client.delete(`${API}/cycles/3/field-config/draft`, { context: new HttpContext().set(NO_QUEUE, true) }))
      .then(() => 'sent', () => 'not sent');
    await tick();
    http.expectOne(REMOVE).error(new ProgressEvent('error'), { status: 0, statusText: 'x' });
    await tick();
    http.expectNone(`${API}/cycles/3/field-config/draft`);
    expect(await discard).toBe('not sent');
    expect(queue.items().map((i) => i.url)).toEqual([REMOVE]);
  });

  it('saving the same action again sends ONE request with the stored key', async () => {
    await storeOffline(`${API}/users/7`, { nickname: 'A' });
    const key = queue.items()[0].idempotencyKey;
    queue.keepAwaiting();

    const again = firstValueFrom(client.post(`${API}/users/7`, { nickname: 'A' }));
    const req = http.expectOne(`${API}/users/7`);
    expect(req.request.headers.get(IDEMPOTENCY_HEADER)).toBe(key);
    req.flush(ok({}));
    await again;
    expect(queue.count()).toBe(0);
  });

  it('the online event and Retry at once send each stored write once, one at a time, oldest first', async () => {
    await storeOffline(`${API}/users`, { n: 1 });
    queue.keepAwaiting();
    // The second one waits behind the first, which is still offline: both stay, the second undecided.
    const second = firstValueFrom(client.post(`${API}/users`, { n: 2 })).catch(() => undefined);
    await tick();
    http.expectOne(`${API}/users`).error(new ProgressEvent('error'), { status: 0, statusText: 'x' });
    await second;
    expect(queue.items().map((i) => i.body)).toEqual([{ n: 1 }, { n: 2 }]);

    window.dispatchEvent(new Event('online'));
    const retry = queue.retryAwaiting();
    await tick();
    const first = http.match(`${API}/users`);
    expect(first.map((r) => r.request.body)).toEqual([{ n: 1 }]);
    first[0].flush(ok({}));
    await tick();
    const next = http.match(`${API}/users`);
    expect(next.map((r) => r.request.body)).toEqual([{ n: 2 }]);
    next[0].flush(ok({}));
    await retry;
    await tick();
    http.expectNone(`${API}/users`);
    expect(queue.count()).toBe(0);
  });

  it('a screen reloads after a matching replay, only once the newer write answered', async () => {
    const reload = vi.fn();
    TestBed.runInInjectionContext(() => reloadAfterReplay((path) => path.startsWith('/users'), reload));
    await storeOffline(REMOVE);
    queue.keepAwaiting();

    const bringBack = firstValueFrom(client.post(BRING_BACK, null));
    await tick();
    http.expectOne(REMOVE).flush(ok({}));
    await tick();
    TestBed.tick();
    // The reload would read Ana removed if it ran before Bring back answered.
    expect(reload).not.toHaveBeenCalled();
    http.expectOne(BRING_BACK).flush(ok({}));
    await bringBack;
    TestBed.tick();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a replay of another area does not reload the screen', async () => {
    const reload = vi.fn();
    TestBed.runInInjectionContext(() => reloadAfterReplay((path) => path.startsWith('/users'), reload));
    await storeOffline(`${API}/timelines/3/users`, { userId: 7 });
    queue.keepAwaiting();

    void queue.sendPending();
    await tick();
    http.expectOne(`${API}/timelines/3/users`).flush(ok({}));
    await tick();
    TestBed.tick();
    expect(reload).not.toHaveBeenCalled();
    expect(TestBed.inject(WriteEvents).replayed().map((r) => r.url)).toEqual([`${API}/timelines/3/users`]);
  });
});
