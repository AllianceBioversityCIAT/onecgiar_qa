import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthError, AuthProvider, AuthUser, Credentials } from './auth-provider';
import { AuthSession, SESSION_STORAGE_KEY } from './auth-session';

class FakeProvider extends AuthProvider {
  readonly isStub = true;
  calls = 0;
  outcome: () => Promise<AuthUser> = () => Promise.resolve({ email: 'ana@cgiar.org' });

  signIn(_credentials: Credentials): Promise<AuthUser> {
    this.calls++;
    return this.outcome();
  }
}

const credentials: Credentials = { email: 'ana@cgiar.org', password: 'secret' };

function setup(platform = 'browser') {
  const provider = new FakeProvider();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthProvider, useValue: provider },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return { provider, session: TestBed.inject(AuthSession) };
}

describe('AuthSession', () => {
  beforeEach(() => sessionStorage.clear());

  it('starts signed out', () => {
    const { session } = setup();
    expect(session.isSignedIn()).toBe(false);
    expect(session.user()).toBeNull();
  });

  it('signs in, exposes the user and persists it for the tab', async () => {
    const { session } = setup();
    await session.signIn(credentials);
    expect(session.user()).toEqual({ email: 'ana@cgiar.org' });
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual({
      email: 'ana@cgiar.org',
    });
  });

  it('restores a stored session (reload keeps the session)', () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ email: 'ana@cgiar.org' }));
    const { session } = setup();
    expect(session.isSignedIn()).toBe(true);
  });

  it('ignores a corrupt stored session', () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, '{not json');
    expect(setup().session.isSignedIn()).toBe(false);
  });

  it('does not touch storage on the server', () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ email: 'ana@cgiar.org' }));
    expect(setup('server').session.isSignedIn()).toBe(false);
  });

  it('two parallel sign-ins make one provider call', async () => {
    const { provider, session } = setup();
    const first = session.signIn(credentials);
    const second = session.signIn(credentials);
    expect(session.signingIn()).toBe(true);
    await Promise.all([first, second]);
    expect(provider.calls).toBe(1);
    expect(session.signingIn()).toBe(false);
  });

  it('stays signed out and frees the lock when the provider rejects', async () => {
    const { provider, session } = setup();
    provider.outcome = () => Promise.reject(new AuthError('rejected', 'no'));
    await expect(session.signIn(credentials)).rejects.toBeInstanceOf(AuthError);
    expect(session.isSignedIn()).toBe(false);
    expect(session.signingIn()).toBe(false);

    provider.outcome = () => Promise.resolve({ email: 'ana@cgiar.org' });
    await session.signIn(credentials);
    expect(provider.calls).toBe(2);
  });

  it('signs out and clears storage', async () => {
    const { session } = setup();
    await session.signIn(credentials);
    session.signOut();
    expect(session.isSignedIn()).toBe(false);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
