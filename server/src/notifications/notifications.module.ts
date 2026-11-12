import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { catalogsConfig } from '../config/catalogs.config.js';
import { notificationsConfig } from '../config/notifications.config.js';
import { AccessNotifier } from './access-notifier.service.js';
import { EmailClient } from './email.client.js';

/** Transactional email through the One CGIAR Notification Microservice. */
@Module({
  imports: [
    ConfigModule.forFeature(notificationsConfig),
    // The CLARISA API key authenticates QA to the service; it is read only in catalogsConfig.
    ConfigModule.forFeature(catalogsConfig),
  ],
  providers: [EmailClient, AccessNotifier],
  exports: [AccessNotifier],
})
export class NotificationsModule {}
