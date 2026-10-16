import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { AuthSession } from '../auth/auth-session';
import { DeepLink, LOGIN_PATH } from '../auth/deep-link';
import { AccessControl } from './access-control';
import { Permission } from './role-definitions';

export const FORBIDDEN_PATH = '/forbidden';

/** Route data contract: `data: { permission: Permission.LEAD_ACCESS }`. */
export interface AccessRouteData {
  readonly permission?: Permission;
}

async function decide(permission: Permission | undefined, url: string): Promise<true | UrlTree> {
  // Every inject() happens BEFORE the first await: after it there is no injection context.
  const session = inject(AuthSession);
  const router = inject(Router);
  const deepLink = inject(DeepLink);
  const access = inject(AccessControl);
  await session.ready();
  if (!session.isSignedIn()) {
    deepLink.save(url);
    return router.parseUrl(LOGIN_PATH);
  }
  if (!permission || access.canAny(permission)) return true;
  return router.parseUrl(FORBIDDEN_PATH);
}

/**
 * Use as BOTH `canMatch` (the lazy chunk is not even downloaded) and `canActivate`
 * (re-checked on every activation). Hiding a menu entry is never enough.
 */
export const permissionMatch: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const router = inject(Router);
  const navigation = router.currentNavigation();
  const url = navigation
    ? router.serializeUrl(navigation.extractedUrl)
    : '/' + segments.map((s) => s.path).join('/');
  return decide((route.data as AccessRouteData | undefined)?.permission, url);
};

export const permissionActivate: CanActivateFn = (route, state) =>
  decide((route.data as AccessRouteData | undefined)?.permission, state.url);
