import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public, same for everyone: prerendered.
  { path: 'login', renderMode: RenderMode.Prerender },
  // The session lives in browser storage, so protected pages render on the client only.
  { path: '**', renderMode: RenderMode.Client },
];
