import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';
import { OPENAPI_PATH, setupOpenApi } from './common/openapi.js';
import { openApiConfig } from './config/openapi.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  if (app.get(openApiConfig.KEY).enabled) setupOpenApi(app);
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  if (app.get(openApiConfig.KEY).enabled) {
    Logger.log(`API docs: http://localhost:${port}/${OPENAPI_PATH}`, 'OpenAPI');
  }
}
await bootstrap();
