import { registerAs } from '@nestjs/config';
import { parseAllowedOrigins } from './env.validation.js';

/** The Hosted UI identity provider of DEV and TEST; PROD sets `COGNITO_SSO_PROVIDER`. */
export const DEFAULT_SSO_PROVIDER = 'CGIAR-AzureAD';

export const authConfig = registerAs('auth', () => {
  const region = process.env.COGNITO_REGION!;
  return {
    cognito: {
      region,
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      // Read only from the environment (FR-17): never a literal, never logged.
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      hostedUiUrl: process.env.COGNITO_URL!,
      userPoolUrl:
        process.env.COGNITO_USER_POOL_URL ||
        `https://cognito-idp.${region}.amazonaws.com/`,
      // `identity_provider` of the SSO authorize URL: the provider name the
      // app client enables (PROD: `CGIAR-Account`). Checked at startup.
      ssoProvider: process.env.COGNITO_SSO_PROVIDER ?? DEFAULT_SSO_PROVIDER,
    },
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS!),
  };
});
