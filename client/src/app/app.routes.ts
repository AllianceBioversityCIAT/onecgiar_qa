import { Route, Routes } from '@angular/router';
import { NavRouteData } from './core/access/nav-items';
import { permissionActivate, permissionMatch } from './core/access/permission-guard';
import { Permission } from './core/access/role-definitions';
import { authGuard, guestGuard } from './core/auth/auth-guards';
import { unsavedChangesGuard } from './core/forms/unsaved-changes';
import { aiPreviewMatch } from './pages/workspace/ai-preview/ai-preview.guard';

/**
 * Workspace view: guarded by permission at match (the chunk is not downloaded) and at activation.
 * `data.permission` is the single rule; the shell menu uses the same permissions.
 */
function view(
  path: string,
  title: string,
  data: NavRouteData,
  loadComponent: Route['loadComponent'],
): Route {
  return {
    path,
    title,
    data,
    canMatch: [permissionMatch],
    canActivate: [permissionActivate],
    // Leaving a view with a dirty form or drawer asks first.
    canDeactivate: [unsavedChangesGuard],
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
    data: { nav: { label: 'Overview', group: 'assessment', order: 0 } } satisfies NavRouteData,
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/qa-shell').then((m) => m.QaShell),
    children: [
      view(
        'results',
        'Results in QA · PRMS Quality Assurance',
        { nav: { label: 'Results', group: 'assessment', order: 1 } },
        () => import('./pages/workspace/results/results-view').then((m) => m.ResultsView),
      ),
      view('results/:code', 'Review · PRMS Quality Assurance', {}, () =>
        import('./pages/workspace/review/review-view').then((m) => m.ReviewView),
      ),
      view(
        'cycle',
        'Cycle · PRMS Quality Assurance',
        {
          permission: Permission.ADMIN_ACCESS,
          nav: { label: 'Cycle', group: 'administration', order: 10 },
        },
        () => import('./pages/workspace/cycle/cycle-view').then((m) => m.CycleView),
      ),
      view(
        'fields',
        'Fields · PRMS Quality Assurance',
        {
          permission: Permission.ADMIN_ACCESS,
          nav: { label: 'Fields', group: 'administration', order: 11 },
        },
        () => import('./pages/workspace/fields/fields-view').then((m) => m.FieldsView),
      ),
      view(
        'assessors',
        'Assessors · PRMS Quality Assurance',
        {
          permission: Permission.ADMIN_ACCESS,
          nav: { label: 'Assessors', group: 'administration', order: 12 },
        },
        () => import('./pages/workspace/assessors/assessors-view').then((m) => m.AssessorsView),
      ),
      // P2-3915 Traceability: configuration log (design, sample data).
      view(
        'activity-log',
        'Activity log · PRMS Quality Assurance',
        {
          permission: Permission.ADMIN_ACCESS,
          nav: { label: 'Activity log', group: 'administration', order: 13 },
        },
        () => import('./pages/workspace/activity-log/activity-log-view').then((m) => m.ActivityLogView),
      ),
      // Plan B of P2-3918: dev/test-only AI preview (the flag guard runs first, so production never matches).
      {
        path: 'ai-preview/:timelineId/:resultCode',
        title: 'AI suggestions · PRMS Quality Assurance',
        canMatch: [aiPreviewMatch, permissionMatch],
        canActivate: [permissionActivate],
        loadComponent: () => import('./pages/workspace/ai-preview/ai-preview').then((m) => m.AiPreviewPage),
      },
      view('notifications', 'Notifications · PRMS Quality Assurance', { permission: Permission.ADMIN_ACCESS }, () =>
        import('./pages/workspace/notifications/notifications-view').then((m) => m.NotificationsView),
      ),
    ],
  },
  // P2-3911: the Science Program view inside Reporting's iframe. No authGuard and no shell: it has its
  // own SP session (traded from a one-time code), never the Cognito one. Client-rendered (`**` in
  // app.routes.server.ts), so the code is only traded in the browser.
  {
    path: 'sp',
    loadChildren: () => import('./pages/sp/sp.routes').then((m) => m.SP_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
