import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
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
    DrizzleModule,
    DynamoDbModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
