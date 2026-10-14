import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { authConfig } from '../config/auth.config.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ADMISSION_UNIT_OF_WORK,
  AdmissionService,
} from './admission.service.js';
import { DrizzleAdmissionUnitOfWork } from './admission.unit-of-work.js';
import { AuthMicroserviceClient } from './auth-microservice.client.js';
import { AuthThrottlerModule } from './auth-throttle.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
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
    AuthThrottlerModule,
  ],
  controllers: [AuthController, MeController],
  providers: [
    // Bound so tests can swap in a pre-loaded cache; production uses the default.
    { provide: JWKS_CACHE, useFactory: () => new SimpleJwksCache() },
    TokenVerifier,
    AuthMicroserviceClient,
    { provide: ADMISSION_UNIT_OF_WORK, useClass: DrizzleAdmissionUnitOfWork },
    AdmissionService,
  ],
  exports: [TokenVerifier, AdmissionService],
})
export class AuthModule {}
