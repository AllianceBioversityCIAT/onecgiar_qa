import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth-guards';

const page = (path: string, group: string, heading: string) => ({
  path,
  title: `${heading} · PRMS Quality Assurance`,
  data: { group, heading },
  loadComponent: () => import('./pages/placeholder/placeholder').then((m) => m.PlaceholderPage),
});

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · PRMS Quality Assurance',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell-layout').then((m) => m.ShellLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      page('overview', 'Assessment', 'Overview'),
      page('results', 'Assessment', 'Results'),
      page('cycle', 'Administration', 'Cycle'),
      page('fields', 'Administration', 'Fields'),
      page('assessors', 'Administration', 'Assessors'),
    ],
  },
  { path: '**', redirectTo: '' },
];
