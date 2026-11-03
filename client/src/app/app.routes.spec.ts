import { Route } from '@angular/router';
import { routes } from './app.routes';
import { NavRouteData } from './core/access/nav-items';
import { permissionActivate, permissionMatch } from './core/access/permission-guard';
import { Permission } from './core/access/role-definitions';

/** The workspace routes: the children of the shell route (the one with a `loadComponent` and children). */
const workspaceRoutes = (): readonly Route[] => routes.find((r) => r.children && r.loadComponent)?.children ?? [];

describe('workspace routes', () => {
  // (f) FR-6 "No access" and P-20: the entry's configuration. The guard's behavior is covered by permission-guard.spec.ts.
  describe('the notifications route', () => {
    const route = () => workspaceRoutes().find((r) => r.path === 'notifications');

    it('(f) exists under the shell route, behind ADMIN_ACCESS, with the guards that stop the chunk download', () => {
      const entry = route();
      expect(entry, 'notifications route under the shell').toBeTruthy();
      expect((entry!.data as NavRouteData | undefined)?.permission).toBe(Permission.ADMIN_ACCESS);
      expect(entry!.canMatch).toContain(permissionMatch);
      expect(entry!.canActivate).toContain(permissionActivate);
    });

    it('(f) has no sidebar entry', () => {
      expect((route()?.data as NavRouteData | undefined)?.nav).toBeUndefined();
    });

    it('(f) is lazy loaded', () => {
      expect(route()?.loadComponent).toBeTypeOf('function');
      expect(route()?.component).toBeUndefined();
    });
  });
});
