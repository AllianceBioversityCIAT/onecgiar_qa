import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { cognitoAdminConfig } from '../config/cognito-admin.config.js';
import {
  COGNITO_IDP_CLIENT,
  CognitoAdminClient,
  type CognitoIdpSender,
} from './cognito-admin.client.js';

/**
 * The Cognito admin API (user management), alone in its module so that
 * `UsersModule` (whose `UsersAdminService` invites custom users) can import it
 * without an `AuthModule` <-> `UsersModule` cycle (`AuthModule` imports
 * `UsersModule`).
 */
@Module({
  imports: [ConfigModule.forFeature(cognitoAdminConfig)],
  providers: [
    // SigV4 with the local keys, else the default credential chain.
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
  ],
  exports: [CognitoAdminClient],
})
export class CognitoAdminModule {}
