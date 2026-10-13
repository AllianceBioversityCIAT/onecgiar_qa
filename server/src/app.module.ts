import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { authConfig } from './config/auth.config.js';
import { validateEnv } from './config/env.validation.js';
import { DrizzleModule } from './database/drizzle/drizzle.module.js';
import { DynamoDbModule } from './database/dynamodb/dynamodb.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ConfigModule.forFeature(authConfig),
    DrizzleModule,
    DynamoDbModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
