import { Environment } from './environment.model';

// Template. Copy it to environment.ts (production default), environment.development.ts
// (`ng serve`) and environment.qatest.ts (`--configuration test`), then fill the values.
// Those three files are git-ignored: the CD (Jenkins) writes them before building.
export const environment: Environment = {
  name: 'development',
  apiBaseUrl: 'http://localhost:3000/api/v1',
  ssoCallbackPath: '/auth/callback',
};
