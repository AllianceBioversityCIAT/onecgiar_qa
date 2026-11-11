// @akili-spec assessment/step-1-assessment
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ADMIN_CONFIG_CLOCK } from '../admin-config/admin-config.clock.js';
import { FieldConfigModule } from '../admin-config/field-config/field-config.module.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../common/idempotency/idempotency.store.js';
import { catalogsConfig } from '../config/catalogs.config.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { DynamoDbModule } from '../database/dynamodb/dynamodb.module.js';
import { DynamoSnapshotStore } from '../ingestion/dynamo-snapshot-store.js';
import { DrizzleLoadsStore, LOADS_STORE } from '../ingestion/loads.store.js';
import { ReportingResultsFeedClient } from '../ingestion/reporting-results-feed.client.js';
import { RESULTS_FEED } from '../ingestion/results-feed.port.js';
import { SNAPSHOT_STORE } from '../ingestion/snapshot-store.port.js';
import {
  DrizzleTimelineLoads,
  TIMELINE_LOADS,
} from '../admin-config/timelines/timeline-loads.js';
import { UsersModule } from '../users/users.module.js';
import { WorklistController } from './worklist.controller.js';
import { WorklistService } from './worklist.service.js';
import { DrizzleWorklistStore, WORKLIST_STORE } from './worklist.store.js';

/**
 * Step-1 assessment (spec assessment/step-1-assessment, DD-1). Imports
 * `UsersModule` (`AuthorizationService`) and `FieldConfigModule`
 * (`FIELD_CONFIG_EFFECTIVE`, `FIELD_CATALOG_SOURCE`) only. `IngestionModule`
 * exports nothing and is not imported: this module binds its own copies of the
 * loads store, snapshot store and feed client, the way ingestion does (P-24).
 * Services, stores and controllers are added by later tasks; the replay reader
 * of the comment idempotency is bound with the service it reads from.
 */
@Module({
  controllers: [WorklistController],
  imports: [
    DrizzleModule,
    DynamoDbModule,
    ConfigModule.forFeature(catalogsConfig),
    UsersModule,
    FieldConfigModule,
  ],
  providers: [
    { provide: LOADS_STORE, useClass: DrizzleLoadsStore },
    { provide: SNAPSHOT_STORE, useClass: DynamoSnapshotStore },
    { provide: RESULTS_FEED, useClass: ReportingResultsFeedClient },
    // The only time source of the services (NFR-4), the same factory as the admin-config modules.
    { provide: ADMIN_CONFIG_CLOCK, useValue: () => new Date() },
    // The idempotency store of the comment create (P-17); its clock is also the one a unit of work gives its transaction-bound store.
    { provide: IDEMPOTENCY_STORE, useClass: DrizzleIdempotencyStore },
    { provide: IDEMPOTENCY_CLOCK, useValue: () => new Date() },
    // The worklist (T-7): its read port, the "has a load" probe of the step states (the admin-config adapter, bound here because TimelinesModule exports nothing), and the service.
    { provide: WORKLIST_STORE, useClass: DrizzleWorklistStore },
    { provide: TIMELINE_LOADS, useClass: DrizzleTimelineLoads },
    WorklistService,
  ],
})
export class AssessmentModule {}
