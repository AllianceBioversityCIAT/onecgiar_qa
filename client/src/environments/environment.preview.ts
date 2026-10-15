import { Environment } from './environment.model';

// Design preview (CloudFront of the `jp-design/*` branch) while the QA API is not deployed: the auth mock
// in `server.ts` answers on the same origin. Any email signs in as ADMIN; `@mock.qa` personas test roles.
// TODO(api): switch the preview Dockerfile back to `--configuration production` once the API is live.
export const environment: Environment = {
  name: 'preview',
  apiBaseUrl: '/api/v1',
  ssoCallbackPath: '/auth/callback',
  mockAuth: true,
};
