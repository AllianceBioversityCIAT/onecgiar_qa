import { registerAs } from '@nestjs/config';
import { parseAllowedOrigins } from './env.validation.js';

export const authConfig = registerAs('auth', () => ({
  cognito: {
    region: process.env.COGNITO_REGION!,
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    clientId: process.env.COGNITO_CLIENT_ID!,
  },
  msAuth: {
    url: process.env.MS_AUTH_URL!,
    user: process.env.MS_AUTH_USER!,
    password: process.env.MS_AUTH_PASSWORD!,
  },
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS!),
}));
