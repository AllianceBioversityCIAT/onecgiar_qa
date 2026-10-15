import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSession } from './auth-session';
import { API, err, ok, session, setupAuthTesting, tick } from './auth-testing';

describe('authInterceptor', () => {
  let http: ReturnType<typeof setupAuthTesting>;
  let client: HttpClient;
  let auth: AuthSession;

  async function signedIn(token = 'tok-1') {
    const start = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
    http.expectOne(`${API}/auth/login`).flush(ok(session(token)));
    await start;
  }

  beforeEach(() => {
    http = setupAuthTesting();
    client = TestBed.inject(HttpClient);
    auth = TestBed.inject(AuthSession);
  });
  afterEach(() => http.verify());

  it('leaves calls to other hosts untouched (no token leaks)', async () => {
    await signedIn();
    void firstValueFrom(client.get('https://other.example/data'));
    const req = http.expectOne('https://other.example/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });

  it('adds the Bearer token to API calls, never the PRMS custom header', async () => {
    await signedIn('tok-abc');
    void firstValueFrom(client.get(`${API}/results`));
    const req = http.expectOne(`${API}/results`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-abc');
    expect(req.request.headers.has('auth')).toBe(false);
    req.flush(ok([]));
  });

  it('two parallel 401 make ONE refresh and each call is retried once with the new token', async () => {
    await signedIn('old');
    const a = firstValueFrom(client.get(`${API}/a`));
    const b = firstValueFrom(client.get(`${API}/b`));
    http
      .expectOne(`${API}/a`)
      .flush(err(401, 'AUTH_TOKEN_INVALID'), { status: 401, statusText: 'x' });
    http
      .expectOne(`${API}/b`)
      .flush(err(401, 'AUTH_TOKEN_INVALID'), { status: 401, statusText: 'x' });
    await tick();

    const refreshes = http.match(`${API}/auth/session/refresh`);
    expect(refreshes.length).toBe(1);
    refreshes[0].flush(ok(session('new')));
    await tick();

    const retryA = http.expectOne(`${API}/a`);
    const retryB = http.expectOne(`${API}/b`);
    expect(retryA.request.headers.get('Authorization')).toBe('Bearer new');
    retryA.flush(ok('A'));
    retryB.flush(ok('B'));
    await expect(a).resolves.toEqual(ok('A'));
    await expect(b).resolves.toEqual(ok('B'));
  });

  it('a failed refresh ends the session and goes to login keeping the page', async () => {
    await signedIn();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/cycle');
    const call = firstValueFrom(client.get(`${API}/a`)).catch((e: unknown) => e);
    http
      .expectOne(`${API}/a`)
      .flush(err(401, 'AUTH_TOKEN_INVALID'), { status: 401, statusText: 'x' });
    await tick();
    http
      .expectOne(`${API}/auth/session/refresh`)
      .flush(err(401, 'AUTH_SESSION_EXPIRED'), { status: 401, statusText: 'x' });
    await call;
    await tick();

    expect(auth.status()).toBe('anonymous');
    expect(router.url).toBe('/login');
    expect(sessionStorage.getItem('qa.pendingRedirect')).toBe('/cycle');
  });

  it('a refresh that fails on the network keeps the session (no logout on a blip)', async () => {
    await signedIn();
    const call = firstValueFrom(client.get(`${API}/a`)).catch((e: unknown) => e);
    http
      .expectOne(`${API}/a`)
      .flush(err(401, 'AUTH_TOKEN_INVALID'), { status: 401, statusText: 'x' });
    await tick();
    http.expectOne(`${API}/auth/session/refresh`).error(new ProgressEvent('error'));
    await call;
    expect(auth.isSignedIn()).toBe(true);
  });

  it('a 401 from login is an answer, not an expired token (no refresh)', async () => {
    const attempt = auth
      .signIn({ email: 'ana@cgiar.org', password: 'bad' })
      .catch((e: unknown) => e);
    const req = http.expectOne(`${API}/auth/login`);
    expect(req.request.withCredentials).toBe(true);
    req.flush(err(401, 'AUTH_INVALID_CREDENTIALS'), { status: 401, statusText: 'x' });
    await attempt;
    http.expectNone(`${API}/auth/session/refresh`);
  });
});
