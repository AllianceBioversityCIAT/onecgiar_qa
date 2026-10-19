import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { authConfig } from '../config/auth.config.js';
import { cognitoAdminConfig } from '../config/cognito-admin.config.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ADMISSION_UNIT_OF_WORK,
  AdmissionService,
} from './admission.service.js';
import { DrizzleAdmissionUnitOfWork } from './admission.unit-of-work.js';
import {
  COGNITO_IDP_CLIENT,
  CognitoAdminClient,
  type CognitoIdpSender,
} from './cognito-admin.client.js';
import { CognitoAuthClient } from './cognito-auth.client.js';
import { AuthThrottlerModule } from './auth-throttle.js';
import { AuthController } from './auth.controller.js';
import { OriginGuard } from './guards/origin.guard.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { JWKS_CACHE, TokenVerifier } from './token-verifier.service.js';

/**
 * Identity and session (design DD-1). The global guards are registered in
 * `AppModule`; they use the `TokenVerifier` exported here.
 */
@Module({
  imports: [
    DrizzleModule,
    UsersModule,
    ConfigModule.forFeature(authConfig),
    ConfigModule.forFeature(cognitoAdminConfig),
    AuthThrottlerModule,
  ],
  controllers: [AuthController, SessionController, MeController],
  providers: [
    // Bound so tests can swap in a pre-loaded cache; production uses the default.
    { provide: JWKS_CACHE, useFactory: () => new SimpleJwksCache() },
    TokenVerifier,
    CognitoAuthClient,
    // Admin API (user management): SigV4 with the local keys, else the default chain.
    {
      provide: COGNITO_IDP_CLIENT,
      inject: [cognitoAdminConfig.KEY],
      useFactory: (config: ConfigType<typeof cognitoAdminConfig>) =>
        new CognitoIdentityProviderClient({
          region: config.region,
          credentials: config.credentials,
        }) as CognitoIdpSender,
    },
    CognitoAdminClient,
    OriginGuard,
    { provide: ADMISSION_UNIT_OF_WORK, useClass: DrizzleAdmissionUnitOfWork },
    AdmissionService,
  ],
  exports: [TokenVerifier, AdmissionService, CognitoAdminClient],
})
export class AuthModule {}
