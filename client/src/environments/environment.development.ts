import { Environment } from './environment.model';

// Local front against the local API (`server/`: `pnpm start:dev`, port 3000).
export const environment: Environment = {
  name: 'development',
  apiBaseUrl: 'http://localhost:3000/api/v1',
  ssoCallbackPath: '/auth/callback',
};
