// @akili-spec ingestion/step-1-loads
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  IDEMPOTENCY_REPLAY_READER,
  type IdempotencyReplayReader,
} from '../common/idempotency/idempotency.interceptor.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../common/idempotency/idempotency.store.js';
import { catalogsConfig } from '../config/catalogs.config.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { DynamoDbModule } from '../database/dynamodb/dynamodb.module.js';
import { ADMIN_CONFIG_CLOCK } from '../admin-config/admin-config.clock.js';
import { FIELD_CATALOG_SOURCE } from '../admin-config/field-config/field-catalog.ports.js';
import { ReportingQaCatalogClient } from '../admin-config/field-config/reporting-qa-catalog.client.js';
import {
  DrizzleTimelinesStore,
  TIMELINES_STORE,
} from '../admin-config/timelines/timelines.store.js';
import { DEFAULT_KP_RULES, KP_RULES } from './kp-classifier.js';
import { DynamoSnapshotStore } from './dynamo-snapshot-store.js';
import {
  KP_RELEASE_ENABLED,
  KP_RELEASE_SETTING,
  LoadRunner,
} from './load-runner.js';
import { LoadsController } from './loads.controller.js';
import { LOAD_RUNNER, LoadsService } from './loads.service.js';
import { DrizzleLoadsStore, LOADS_STORE } from './loads.store.js';
import {
  DrizzleLoadsTransactions,
  LOADS_TRANSACTIONS,
  LoadsUnitOfWork,
} from './loads.unit-of-work.js';
import { RESULTS_FEED } from './results-feed.port.js';
import { ReportingResultsFeedClient } from './reporting-results-feed.client.js';
import { SNAPSHOT_STORE } from './snapshot-store.port.js';

/**
 * Step-1 loads (spec ingestion/step-1-loads, design 3): the four routes of
 * `LoadsController`, the service behind them and the runner it starts.
 *
 * `TimelinesModule` never imports this module (DD-9: it reads the load tables
 * through its own `DrizzleTimelineLoads`), so there is no cycle. This module
 * binds its own copy of the two read-only collaborators it needs from
 * admin-config, which those modules do not export: `DrizzleTimelinesStore`
 * (stateless over `DRIZZLE`) and `ReportingQaCatalogClient` (its own catalog
 * copy; the runner forces a refresh when the version differs, DD-10).
 */
@Module({
  imports: [
    DrizzleModule,
    DynamoDbModule,
    ConfigModule.forFeature(catalogsConfig),
  ],
  controllers: [LoadsController],
  providers: [
    { provide: TIMELINES_STORE, useClass: DrizzleTimelinesStore },
    { provide: FIELD_CATALOG_SOURCE, useClass: ReportingQaCatalogClient },
    { provide: LOADS_STORE, useClass: DrizzleLoadsStore },
    { provide: LOADS_TRANSACTIONS, useClass: DrizzleLoadsTransactions },
    LoadsUnitOfWork,
    LoadsService,
    LoadRunner,
    { provide: LOAD_RUNNER, useExisting: LoadRunner },
    { provide: RESULTS_FEED, useClass: ReportingResultsFeedClient },
    { provide: SNAPSHOT_STORE, useClass: DynamoSnapshotStore },
    { provide: KP_RULES, useValue: DEFAULT_KP_RULES },
    // FR-14: the release of KPs is off (a code constant); a test turns it on here.
    { provide: KP_RELEASE_SETTING, useValue: KP_RELEASE_ENABLED },
    // The only time source of the services (NFR-4), the same factory as the admin-config modules.
    { provide: ADMIN_CONFIG_CLOCK, useValue: () => new Date() },
    // The idempotency interceptor of the start (FR-2). The token factory stays
    // unbound: the store generates owner tokens with randomUUID. The clock is
    // also the one the unit of work gives its transaction-bound store.
    { provide: IDEMPOTENCY_STORE, useClass: DrizzleIdempotencyStore },
    { provide: IDEMPOTENCY_CLOCK, useValue: () => new Date() },
    {
      // The crash window: a key left `executed` without an answer is replayed
      // with the answer the start gave, 202 `{ id, status: 'running' }`. The
      // stored target id is a load id here (the unit of work marks it), and
      // the status stays `running` because it is what the first answer said.
      provide: IDEMPOTENCY_REPLAY_READER,
      useValue: {
        read: (loadId) =>
          Promise.resolve({ id: loadId, status: 'running' as const }),
      } satisfies IdempotencyReplayReader,
    },
  ],
})
export class IngestionModule {}
