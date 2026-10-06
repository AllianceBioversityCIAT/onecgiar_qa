import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthSession } from './auth-session';
import { authGuard, guestGuard, safeReturnUrl } from './auth-guards';

function run(guard: typeof authGuard, signedIn: boolean, url = '/') {
  TestBed.configureTestingModule({
    providers: [{ provide: AuthSession, useValue: { isSignedIn: () => signedIn } }],
  });
  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
  const router = TestBed.inject(Router);
  return result instanceof UrlTree ? router.serializeUrl(result) : result;
}

describe('authGuard', () => {
  it('lets a signed-in user through', () => {
    expect(run(authGuard, true, '/batches')).toBe(true);
  });

  it('sends an anonymous user to login', () => {
    expect(run(authGuard, false, '/')).toBe('/login');
  });

  it('keeps the requested path as returnUrl', () => {
    expect(run(authGuard, false, '/batches/7?tab=2')).toBe(
      '/login?returnUrl=%2Fbatches%2F7%3Ftab%3D2',
    );
  });
});

describe('guestGuard', () => {
  it('lets an anonymous user see login', () => {
    expect(run(guestGuard, false)).toBe(true);
  });

  it('sends a signed-in user home', () => {
    expect(run(guestGuard, true)).toBe('/');
  });
});

describe('safeReturnUrl', () => {
  it.each([
    ['/batches/7', '/batches/7'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected);
  });
});
