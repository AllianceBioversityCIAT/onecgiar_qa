import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { API_PREFIX, configureApp } from './common/configure-app.js';
import { OPENAPI_PATH, setupOpenApi } from './common/openapi.js';
import { openApiConfig } from './config/openapi.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const docs = app.get(openApiConfig.KEY).enabled;
  if (docs) setupOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);

  // The port actually bound (PORT=0 lets the OS pick a free one).
  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://localhost:${port}`;
  Logger.log(
    `API listening on port ${port}: ${base}/${API_PREFIX}`,
    'Bootstrap',
  );
  if (docs) Logger.log(`API docs: ${base}/${OPENAPI_PATH}`, 'OpenAPI');
}
await bootstrap();
