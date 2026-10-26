// @akili-spec admin-config/field-configuration
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  IDEMPOTENCY_REPLAY_READER,
  type IdempotencyReplayReader,
} from '../../common/idempotency/idempotency.interceptor.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../common/idempotency/idempotency.store.js';
import { catalogsConfig } from '../../config/catalogs.config.js';
import { DrizzleModule } from '../../database/drizzle/drizzle.module.js';
import { ADMIN_CONFIG_CLOCK } from '../admin-config.clock.js';
import { FIELD_CATALOG_SOURCE } from './field-catalog.ports.js';
import { FieldConfigController } from './field-config.controller.js';
import { FieldConfigService } from './field-config.service.js';
import {
  DrizzleFieldConfigStore,
  FIELD_CONFIG_STORE,
} from './field-config.store.js';
import {
  DrizzleFieldConfigUnitOfWork,
  FIELD_CONFIG_UNIT_OF_WORK,
} from './field-config.unit-of-work.js';
import { ReportingQaCatalogClient } from './reporting-qa-catalog.client.js';
import type { ConfigItem } from './field-config-diff.js';

/** Port: the effective field configuration of a timeline for one result type (FR-10). Later review stories inject it. */
export const FIELD_CONFIG_EFFECTIVE = Symbol('FIELD_CONFIG_EFFECTIVE');

/** The option sets a timeline uses for one result type (FR-10): its resolved version's items for that type. */
export interface EffectiveFieldConfig {
  timelineId: number;
  resultTypeKey: string;
  /** The version the timeline resolves to. */
  version: number;
  /** True while the timeline has not started: a later publication can still change it (S-4). */
  provisional: boolean;
  /** One option set per applicable top-level field, in the order stored; a field with no classification reads `hidden`. Subfields follow their field (S-1). */
  items: ConfigItem[];
}

export interface FieldConfigEffective {
  /**
   * @throws TimelineNotFoundError the cycle has no such timeline.
   * @throws FieldConfigTypeNotInTimelineError the timeline does not cover the type.
   * @throws FieldConfigNoVersionError the timeline resolves to no version.
   */
  effectiveFor(
    cycleId: number,
    timelineId: number,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig>;
}

/**
 * Field configuration per cycle (design 3, 4). `ConfigModule` is global, but the
 * catalog config is registered per module, as `UsersModule` does (P-6).
 * `AdminConfigModule` imports it. The one export is the effective-configuration
 * port (FR-10). Its own Nest module so the replay reader below answers a
 * publication (DD-9); the cycles and timelines modules bind theirs.
 */
@Module({
  imports: [DrizzleModule, ConfigModule.forFeature(catalogsConfig)],
  controllers: [FieldConfigController],
  providers: [
    { provide: FIELD_CONFIG_STORE, useClass: DrizzleFieldConfigStore },
    {
      provide: FIELD_CONFIG_UNIT_OF_WORK,
      useClass: DrizzleFieldConfigUnitOfWork,
    },
    { provide: FIELD_CATALOG_SOURCE, useClass: ReportingQaCatalogClient },
    // The only time source (NFR-4), the same factory as the cycles and timelines modules.
    { provide: ADMIN_CONFIG_CLOCK, useValue: () => new Date() },
    // The clock of the idempotency store the unit of work builds on its transaction.
    { provide: IDEMPOTENCY_CLOCK, useValue: () => new Date() },
    // The idempotency interceptor of the publish (FR-8, DD-9). The token factory
    // stays unbound: the store generates owner tokens with randomUUID.
    { provide: IDEMPOTENCY_STORE, useClass: DrizzleIdempotencyStore },
    FieldConfigService,
    {
      // The crash window: a key left `executed` without an answer is replayed
      // with the publication re-read from its version and audit row. The stored
      // target id is a version id here (design 7.6).
      provide: IDEMPOTENCY_REPLAY_READER,
      useFactory: (service: FieldConfigService): IdempotencyReplayReader => ({
        read: (versionId) => service.replayPublish(versionId),
      }),
      inject: [FieldConfigService],
    },
    { provide: FIELD_CONFIG_EFFECTIVE, useExisting: FieldConfigService },
  ],
  exports: [FIELD_CONFIG_EFFECTIVE],
})
export class FieldConfigModule {}
