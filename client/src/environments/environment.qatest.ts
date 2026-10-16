import { Environment } from './environment.model';

// TEST environment (qatest). Not named `*.test.ts`: Vitest would load it as a spec file. API deployed by Cristian (dev pipeline, 2026-10-16).
export const environment: Environment = {
  name: 'test',
  apiBaseUrl: 'https://qatest-serv.ciat.cgiar.org/api/v1',
  ssoCallbackPath: '/auth/callback',
  mockAuth: false,
};
