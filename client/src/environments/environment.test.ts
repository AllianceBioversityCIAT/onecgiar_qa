import { Environment } from './environment.model';

// TEST environment. TODO(api): confirm the API URL with Juan David once the backend is deployed.
export const environment: Environment = {
  name: 'test',
  apiBaseUrl: 'https://qatest-serv.ciat.cgiar.org/api/v1',
  ssoCallbackPath: '/auth/callback',
  mockAuth: false,
};
