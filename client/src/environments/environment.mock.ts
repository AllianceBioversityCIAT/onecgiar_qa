import { Environment } from './environment.model';

// Local front against the dev auth mock served by `server.ts` on the same origin (`npm run start:mock`).
export const environment: Environment = {
  name: 'mock',
  apiBaseUrl: '/api/v1',
  ssoCallbackPath: '/auth/callback',
  mockAuth: true,
};
