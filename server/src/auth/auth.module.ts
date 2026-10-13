import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { authConfig } from '../config/auth.config.js';
import { UsersModule } from '../users/users.module.js';
import { MeController } from './me.controller.js';
import { JWKS_CACHE, TokenVerifier } from './token-verifier.service.js';

/**
 * Identity and session (design DD-1). The global guards are registered in
 * `AppModule`; they use the `TokenVerifier` exported here.
 */
@Module({
  imports: [UsersModule, ConfigModule.forFeature(authConfig)],
  controllers: [MeController],
  providers: [
    // Bound so tests can swap in a pre-loaded cache; production uses the default.
    { provide: JWKS_CACHE, useFactory: () => new SimpleJwksCache() },
    TokenVerifier,
  ],
  exports: [TokenVerifier],
})
export class AuthModule {}
