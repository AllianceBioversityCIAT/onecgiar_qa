import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public, same for everyone: prerendered.
  { path: 'login', renderMode: RenderMode.Prerender },
  // The session (token in memory, refresh cookie) exists only in the browser, so the SSO callback
  // and every protected page render on the client (backend contract § 8: SSR only for public pages).
  { path: '**', renderMode: RenderMode.Client },
];
