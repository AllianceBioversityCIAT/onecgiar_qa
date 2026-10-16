import { Environment } from './environment.model';

// Production. TODO(api): confirm the API URL with Juan David once the backend is deployed.
export const environment: Environment = {
  name: 'production',
  apiBaseUrl: 'https://api.qa.cgiar.org/api/v1',
  ssoCallbackPath: '/auth/callback',
  mockAuth: false,
};
