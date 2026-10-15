import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ApiError } from '../http/api-envelope';
import { AuthSession } from './auth-session';
import { API, err, ok, session, setupAuthTesting, tick } from './auth-testing';
import { TokenStore } from './token-store';

describe('AuthSession', () => {
  let http: ReturnType<typeof setupAuthTesting>;
  let auth: AuthSession;

  beforeEach(() => {
    http = setupAuthTesting();
    auth = TestBed.inject(AuthSession);
  });
  afterEach(() => http.verify());

  describe('startup', () => {
    it('recovers the session with the refresh cookie and stores nothing in the browser', async () => {
      const done = auth.bootstrap();
      const req = http.expectOne(`${API}/auth/session/refresh`);
      expect(req.request.withCredentials).toBe(true);
      req.flush(ok(session('tok-start')));
      await done;
      expect(auth.status()).toBe('authenticated');
      expect(TestBed.inject(TokenStore).accessToken()).toBe('tok-start');
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('a 401 means anonymous, not an error banner', async () => {
      const done = auth.bootstrap();
      http
        .expectOne(`${API}/auth/session/refresh`)
        .flush(err(401, 'AUTH_SESSION_MISSING'), { status: 401, statusText: 'x' });
      await done;
      expect(auth.status()).toBe('anonymous');
      expect(auth.startupError()).toBeNull();
    });

    it('a network failure resolves the status and reports the problem', async () => {
      const done = auth.bootstrap();
      http.expectOne(`${API}/auth/session/refresh`).error(new ProgressEvent('error'));
      await done;
      expect(auth.status()).toBe('anonymous');
      expect(auth.startupError()?.code).toBe('CLIENT_NETWORK_ERROR');
    });
  });

  describe('sign-in', () => {
    it('two quick submits make exactly one request', async () => {
      const a = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
      const b = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
      expect(a).toBe(b);
      http.expectOne(`${API}/auth/login`).flush(ok(session()));
      await a;
      expect(auth.isSignedIn()).toBe(true);
      expect(auth.signingIn()).toBe(false);
    });

    it('first login: challenge, then new password gives the session', async () => {
      const login = auth.signIn({ email: 'new@cgiar.org', password: 'temp' });
      http
        .expectOne(`${API}/auth/login`)
        .flush(ok({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'chal-1' }));
      await login;
      expect(auth.pendingChallenge()?.email).toBe('new@cgiar.org');
      expect(auth.isSignedIn()).toBe(false);

      const done = auth.completeNewPassword('Secret123');
      const req = http.expectOne(`${API}/auth/complete-new-password`);
      expect(req.request.body).toEqual({
        email: 'new@cgiar.org',
        newPassword: 'Secret123',
        session: 'chal-1',
      });
      req.flush(ok(session()));
      await done;
      expect(auth.isSignedIn()).toBe(true);
      expect(auth.pendingChallenge()).toBeNull();
    });

    it('an expired challenge sends the user back to the first step', async () => {
      const login = auth.signIn({ email: 'new@cgiar.org', password: 'temp' });
      http
        .expectOne(`${API}/auth/login`)
        .flush(ok({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'chal-1' }));
      await login;
      const done = auth.completeNewPassword('Secret123');
      http
        .expectOne(`${API}/auth/complete-new-password`)
        .flush(err(401, 'AUTH_CHALLENGE_EXPIRED'), { status: 401, statusText: 'x' });
      await expect(done).rejects.toBeInstanceOf(ApiError);
      expect(auth.pendingChallenge()).toBeNull();
    });
  });

  describe('refresh', () => {
    it('concurrent callers share one request', async () => {
      const a = auth.refresh();
      const b = auth.refresh();
      expect(a).toBe(b);
      http.expectOne(`${API}/auth/session/refresh`).flush(ok(session('tok-2')));
      expect(await a).toBe('renewed');
    });

    it('a 401 ends the session', async () => {
      const p = auth.refresh();
      http
        .expectOne(`${API}/auth/session/refresh`)
        .flush(err(401, 'AUTH_SESSION_EXPIRED'), { status: 401, statusText: 'x' });
      expect(await p).toBe('ended');
      expect(auth.status()).toBe('anonymous');
    });

    it('a network blip or 503 keeps the session', async () => {
      const start = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
      http.expectOne(`${API}/auth/login`).flush(ok(session()));
      await start;
      const p = auth.refresh();
      http
        .expectOne(`${API}/auth/session/refresh`)
        .flush(err(503, 'AUTH_SERVICE_UNAVAILABLE'), { status: 503, statusText: 'x' });
      expect(await p).toBe('unavailable');
      expect(auth.isSignedIn()).toBe(true);
    });
  });

  describe('sign-out', () => {
    it('ends the local session even when the server cannot be reached', async () => {
      const start = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
      http.expectOne(`${API}/auth/login`).flush(ok(session()));
      await start;
      localStorage.setItem('qa.prefs', 'keep-me');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

      const done = auth.signOut();
      const req = http.expectOne(`${API}/auth/session/logout`);
      expect(req.request.withCredentials).toBe(true);
      req.error(new ProgressEvent('error'));
      await done;
      await tick();

      expect(auth.status()).toBe('anonymous');
      expect(TestBed.inject(TokenStore).accessToken()).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/login');
      expect(localStorage.getItem('qa.prefs')).toBe('keep-me');
    });
  });

  describe('review fixes (15-Oct-2026)', () => {
    const signedIn = async () => {
      const start = auth.signIn({ email: 'ana@cgiar.org', password: 'x' });
      http.expectOne(`${API}/auth/login`).flush(ok(session()));
      await start;
    };

    it('a 502 on refresh keeps the session (only 401 ends it)', async () => {
      await signedIn();
      const p = auth.refresh();
      http
        .expectOne(`${API}/auth/session/refresh`)
        .flush('<html>Bad gateway</html>', { status: 502, statusText: 'x' });
      expect(await p).toBe('unavailable');
      expect(auth.isSignedIn()).toBe(true);
    });

    it('a refresh answer that arrives after sign-out does not revive the session', async () => {
      await signedIn();
      const pending = auth.refresh();
      const out = auth.signOut();
      http.expectOne(`${API}/auth/session/logout`).flush(null, { status: 204, statusText: 'x' });
      await out;
      http.expectOne(`${API}/auth/session/refresh`).flush(ok(session('late')));
      expect(await pending).toBe('ended');
      expect(auth.status()).toBe('anonymous');
      expect(TestBed.inject(TokenStore).accessToken()).toBeNull();
    });

    it('a sign-out that could not reach the server is finished on the next start, not revived', async () => {
      await signedIn();
      const out = auth.signOut();
      http.expectOne(`${API}/auth/session/logout`).error(new ProgressEvent('error'));
      await out;
      expect(sessionStorage.getItem('qa.pendingLogout')).toBe('1');

      TestBed.resetTestingModule();
      http = setupAuthTesting();
      sessionStorage.setItem('qa.pendingLogout', '1');
      auth = TestBed.inject(AuthSession);
      const boot = auth.bootstrap();
      http.expectOne(`${API}/auth/session/logout`).flush(null, { status: 204, statusText: 'x' });
      await boot;
      http.expectNone(`${API}/auth/session/refresh`);
      expect(auth.status()).toBe('anonymous');
      expect(sessionStorage.getItem('qa.pendingLogout')).toBeNull();
    });
  });
});
