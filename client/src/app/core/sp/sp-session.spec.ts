import { PLATFORM_ID } from '@angular/core';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SP_RELOAD_MESSAGE_TYPE, SpSession } from './sp-session';
import { FakeParent, SP_API, fakeParent, sessionData, setupSpTesting, spErr, spOk, startSpSession, until } from './sp-testing';

describe('SpSession', () => {
  let http: HttpTestingController;
  let parent: FakeParent;

  beforeEach(() => {
    parent = fakeParent();
    http = setupSpTesting(parent);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('trades the code in the browser, keeps the session in memory and drops the code from the address bar', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/sp?code=one-time-code&tab=x');
    const cookies = document.cookie;
    const session = TestBed.inject(SpSession);

    const started = session.begin('one-time-code');
    const req = await until(() => http.expectOne(`${SP_API}/sp-access/session`));
    // The code is out of the URL before the exchange answers.
    expect(router.url).toBe('/sp?tab=x');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'one-time-code' });
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(spOk(sessionData({ accessToken: 'sp-token-xyz' })));
    await started;

    expect(session.status()).toBe('ready');
    expect(session.token()).toBe('sp-token-xyz');
    expect(session.session()?.user.name).toBe('Sam Program');
    // Nothing persisted anywhere.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(cookies);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('sp-token-xyz');
    expect(parent.messages).toEqual([]);
  });

  it('never trades the code during server rendering', async () => {
    TestBed.resetTestingModule();
    http = setupSpTesting(parent, [{ provide: PLATFORM_ID, useValue: 'server' }]);
    const session = TestBed.inject(SpSession);
    await session.begin('one-time-code');
    http.expectNone(`${SP_API}/sp-access/session`);
    expect(session.status()).toBe('idle');
    expect(parent.messages).toEqual([]);
  });

  it('a refused code shows the expired state and posts code_invalid exactly once', async () => {
    const session = TestBed.inject(SpSession);
    const started = session.begin('used-code');
    (await until(() => http.expectOne(`${SP_API}/sp-access/session`))).flush(spErr(401, 'SP_CODE_INVALID'), {
      status: 401,
      statusText: 'Unauthorized',
    });
    await started;

    expect(session.status()).toBe('expired');
    expect(session.expiredReason()).toBe('code_invalid');
    session.expire('session_expired');
    expect(parent.messages).toEqual([{ type: SP_RELOAD_MESSAGE_TYPE, reason: 'code_invalid' }]);
  });

  it('no code and no session: the link has expired (code_invalid), told once', async () => {
    const session = TestBed.inject(SpSession);
    await session.begin(null);
    await session.begin(null);
    http.expectNone(`${SP_API}/sp-access/session`);
    expect(session.status()).toBe('expired');
    expect(parent.messages).toEqual([{ type: 'qa-sp:reload-required', reason: 'code_invalid' }]);
  });

  it('no code with a live session keeps it (navigation inside the iframe)', async () => {
    const session = await startSpSession(http);
    await session.begin(null);
    expect(session.status()).toBe('ready');
    expect(parent.messages).toEqual([]);
  });

  it('a session past its expiry ends on the next call and posts session_expired once', async () => {
    const session = await startSpSession(http, sessionData({ expiresAt: new Date(Date.now() + 1000).toISOString() }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2000);

    expect(session.token()).toBeNull();
    expect(session.token()).toBeNull();
    expect(session.status()).toBe('expired');
    expect(session.expiredReason()).toBe('session_expired');
    expect(parent.messages).toEqual([{ type: 'qa-sp:reload-required', reason: 'session_expired' }]);
  });

  it('a network failure is not an expired link: it can retry with the same code', async () => {
    const session = TestBed.inject(SpSession);
    const started = session.begin('code-2');
    (await until(() => http.expectOne(`${SP_API}/sp-access/session`))).error(new ProgressEvent('error'), { status: 0 });
    await started;
    expect(session.status()).toBe('failed');
    expect(parent.messages).toEqual([]);

    const retried = session.retry();
    const again = await until(() => http.expectOne(`${SP_API}/sp-access/session`));
    expect(again.request.body).toEqual({ code: 'code-2' });
    again.flush(spOk(sessionData()));
    await retried;
    expect(session.status()).toBe('ready');
  });

  it('outside a frame it posts nothing', async () => {
    TestBed.resetTestingModule();
    http = setupSpTesting(null);
    const session = TestBed.inject(SpSession);
    await session.begin(null);
    expect(session.status()).toBe('expired');
  });
});
