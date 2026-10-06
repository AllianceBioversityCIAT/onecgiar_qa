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
  { path: '**', redirectTo: '' },
];
