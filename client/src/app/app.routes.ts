import { Route, Routes } from '@angular/router';
import { NavRouteData } from './core/access/nav-items';
import { permissionActivate, permissionMatch } from './core/access/permission-guard';
import { Permission } from './core/access/role-definitions';
import { authGuard, guestGuard } from './core/auth/auth-guards';

const placeholder = () =>
  import('./pages/section-placeholder/section-placeholder').then((m) => m.SectionPlaceholderPage);

/**
 * Protected section: guarded by permission at match (no chunk download) and at activation.
 * The menu reads `data.nav` from here, so an entry never shows for a page that would be refused.
 */
function section(
  path: string,
  data: NavRouteData,
  loadComponent: Route['loadComponent'] = placeholder,
): Route {
  return {
    path,
    data,
    canMatch: [permissionMatch],
    canActivate: [permissionActivate],
    loadComponent,
  };
}

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · PRMS Quality Assurance',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'auth/callback',
    title: 'Signing in · PRMS Quality Assurance',
    loadComponent: () =>
      import('./pages/auth-callback/auth-callback').then((m) => m.AuthCallbackPage),
  },
  {
    path: 'forbidden',
    title: 'No access · PRMS Quality Assurance',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'PRMS Quality Assurance',
    canActivate: [authGuard],
    data: { nav: { label: 'Start', group: 'assessment', order: 0 } } satisfies NavRouteData,
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  // Workspace sections. TODO(design): swap `placeholder` for Juanpa's pages when his branch is approved.
  section('results', { nav: { label: 'Results', group: 'assessment', order: 1 } }),
  section('assessments', {
    permission: Permission.ASSESSOR_ACCESS,
    nav: { label: 'My assessments', group: 'assessment', order: 2 },
  }),
  section('lead-review', {
    permission: Permission.LEAD_ACCESS,
    nav: { label: 'Lead review', group: 'assessment', order: 3 },
  }),
  section('program-responses', {
    permission: Permission.PROGRAM_ACCESS,
    nav: { label: 'Program responses', group: 'assessment', order: 4 },
  }),
  section('broker', {
    permission: Permission.TPB_ACCESS,
    nav: { label: 'Third-party broker', group: 'assessment', order: 5 },
  }),
  section('ppu', {
    permission: Permission.PPU_ACCESS,
    nav: { label: 'PPU cases', group: 'assessment', order: 6 },
  }),
  section('cycle', {
    permission: Permission.ADMIN_ACCESS,
    nav: { label: 'Cycle', group: 'administration', order: 10 },
  }),
  section('fields', {
    permission: Permission.ADMIN_ACCESS,
    nav: { label: 'Fields', group: 'administration', order: 11 },
  }),
  section('assessors', {
    permission: Permission.ADMIN_ACCESS,
    nav: { label: 'Assessors', group: 'administration', order: 12 },
  }),
  { path: '**', redirectTo: '' },
];
