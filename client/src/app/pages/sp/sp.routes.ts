import { Routes } from '@angular/router';

/**
 * Science Program view (P2-3911), opened by Reporting in an iframe as `/sp?code=…`. No Cognito guard
 * and no QA shell: the page trades the one-time code for its own SP session (`SpSession`).
 */
export const SP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./sp-frame').then((m) => m.SpFrame),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Quality Assurance · Science Program',
        loadComponent: () => import('./sp-results-page').then((m) => m.SpResultsPage),
      },
      // Anything else under /sp stays in the SP view (never the Cognito login).
      { path: '**', redirectTo: '' },
    ],
  },
];
