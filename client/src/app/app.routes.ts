import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth-guards';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · PRMS Quality Assurance',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'PRMS Quality Assurance',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/qa-shell').then((m) => m.QaShell),
    children: [
      {
        path: 'results',
        title: 'Results in QA · PRMS Quality Assurance',
        loadComponent: () =>
          import('./pages/workspace/results/results-view').then((m) => m.ResultsView),
      },
      {
        path: 'results/:code',
        title: 'Review · PRMS Quality Assurance',
        loadComponent: () =>
          import('./pages/workspace/review/review-view').then((m) => m.ReviewView),
      },
      {
        path: 'cycle',
        title: 'Cycle · PRMS Quality Assurance',
        loadComponent: () => import('./pages/workspace/cycle/cycle-view').then((m) => m.CycleView),
      },
      {
        path: 'fields',
        title: 'Fields · PRMS Quality Assurance',
        loadComponent: () =>
          import('./pages/workspace/fields/fields-view').then((m) => m.FieldsView),
      },
      {
        path: 'assessors',
        title: 'Assessors · PRMS Quality Assurance',
        loadComponent: () =>
          import('./pages/workspace/assessors/assessors-view').then((m) => m.AssessorsView),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
