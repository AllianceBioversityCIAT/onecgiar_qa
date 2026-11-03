import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AdminConfigModule } from './admin-config/admin-config.module.js';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { PermissionGuard } from './auth/guards/permission.guard.js';
import { authConfig } from './config/auth.config.js';
import { openApiConfig } from './config/openapi.config.js';
import { validateEnv } from './config/env.validation.js';
import { DrizzleModule } from './database/drizzle/drizzle.module.js';
import { DynamoDbModule } from './database/dynamodb/dynamodb.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ConfigModule.forFeature(authConfig),
    ConfigModule.forFeature(openApiConfig),
    DrizzleModule,
    DynamoDbModule,
    UsersModule,
    AuthModule,
    AdminConfigModule,
  ],
  controllers: [AppController],
  providers: [
    // Global guards run in registration order: authenticate, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
