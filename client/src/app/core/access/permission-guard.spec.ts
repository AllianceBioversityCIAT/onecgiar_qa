import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from '../auth/auth-guards';
import { AuthSession } from '../auth/auth-session';
import { API, err, ok, session, setupAuthTesting } from '../auth/auth-testing';
import { permissionActivate, permissionMatch } from './permission-guard';
import { Permission } from './role-definitions';

describe('guards', () => {
  let http: ReturnType<typeof setupAuthTesting>;
  let auth: AuthSession;

  const run = <T>(fn: () => T) => TestBed.runInInjectionContext(fn);
  const asUrl = (result: unknown) => (result instanceof UrlTree ? result.toString() : result);
  const state = (url: string) => ({ url }) as RouterStateSnapshot;

  async function boot(signedIn: boolean, assignments = session().user.assignments) {
    const done = auth.bootstrap();
    const req = http.expectOne(`${API}/auth/session/refresh`);
    if (signedIn) req.flush(ok({ ...session(), user: { ...session().user, assignments } }));
    else req.flush(err(401, 'AUTH_SESSION_MISSING'), { status: 401, statusText: 'x' });
    await done;
  }

  beforeEach(() => {
    http = setupAuthTesting();
    auth = TestBed.inject(AuthSession);
  });
  afterEach(() => http.verify());

  it('waits for the startup refresh instead of reading a default', async () => {
    let settled = false;
    const decision = run(
      () => authGuard({} as ActivatedRouteSnapshot, state('/cycle')) as Promise<unknown>,
    ).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await boot(true);
    expect(await decision).toBe(true);
  });

  it('anonymous users go to login and the page is kept for after sign-in', async () => {
    await boot(false);
    const result = await run(
      () => authGuard({} as ActivatedRouteSnapshot, state('/cycle')) as Promise<unknown>,
    );
    expect(asUrl(result)).toBe('/login');
    expect(sessionStorage.getItem('qa.pendingRedirect')).toBe('/cycle');
  });

  it('canMatch refuses an admin page to an assessor (chunk never loaded)', async () => {
    await boot(true, [{ role: 'ASSESSOR', resultTypeKey: 'KP' }]);
    const route: Route = { path: 'cycle', data: { permission: Permission.ADMIN_ACCESS } };
    const result = await run(
      () => permissionMatch(route, [{ path: 'cycle' } as never], {} as never) as Promise<unknown>,
    );
    expect(asUrl(result)).toBe('/forbidden');
  });

  it('canActivate lets an admin in', async () => {
    await boot(true, [{ role: 'ADMIN' }]);
    const snapshot = {
      data: { permission: Permission.ADMIN_ACCESS },
    } as unknown as ActivatedRouteSnapshot;
    expect(await run(() => permissionActivate(snapshot, state('/cycle')) as Promise<unknown>)).toBe(
      true,
    );
  });
});
