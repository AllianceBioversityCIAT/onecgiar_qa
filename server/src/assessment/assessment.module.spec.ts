// @akili-spec assessment/step-1-assessment
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { FIELD_CATALOG_SOURCE } from '../admin-config/field-config/field-catalog.ports.js';
import { ADMIN_CONFIG_CLOCK } from '../admin-config/admin-config.clock.js';
import { FieldConfigModule } from '../admin-config/field-config/field-config.module.js';
import { ReportingQaCatalogClient } from '../admin-config/field-config/reporting-qa-catalog.client.js';
import { IDEMPOTENCY_REPLAY_READER } from '../common/idempotency/idempotency.interceptor.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../common/idempotency/idempotency.store.js';
import { DRIZZLE, MYSQL_POOL } from '../database/drizzle/drizzle.constants.js';
import { DynamoSnapshotStore } from '../ingestion/dynamo-snapshot-store.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { DrizzleLoadsStore, LOADS_STORE } from '../ingestion/loads.store.js';
import { ReportingResultsFeedClient } from '../ingestion/reporting-results-feed.client.js';
import { RESULTS_FEED } from '../ingestion/results-feed.port.js';
import { SNAPSHOT_STORE } from '../ingestion/snapshot-store.port.js';
import { AuthorizationService } from '../users/authorization.service.js';
import { UsersModule } from '../users/users.module.js';
import {
  DrizzleTimelineLoads,
  TIMELINE_LOADS,
} from '../admin-config/timelines/timeline-loads.js';
import { WorklistService } from './worklist.service.js';
import { DrizzleWorklistStore, WORKLIST_STORE } from './worklist.store.js';
import { AssessmentModule } from './assessment.module.js';

describe('AssessmentModule wiring (DD-1, P-24)', () => {
  it('resolves every binding without overriding any of them, taking the catalog source and authorization from its imports', async () => {
    // Only the connections are replaced; every provider of the module is real.
    const moduleRef = await Test.createTestingModule({
      imports: [AssessmentModule],
    })
      .overrideProvider(MYSQL_POOL)
      .useValue({ end: async () => undefined })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    // Strict on AssessmentModule itself: FieldConfigModule binds its own clock and idempotency copies, which must not answer for this module.
    const own = moduleRef.select(AssessmentModule);
    expect(own.get(LOADS_STORE, { strict: true })).toBeInstanceOf(
      DrizzleLoadsStore,
    );
    expect(own.get(SNAPSHOT_STORE, { strict: true })).toBeInstanceOf(
      DynamoSnapshotStore,
    );
    expect(own.get(RESULTS_FEED, { strict: true })).toBeInstanceOf(
      ReportingResultsFeedClient,
    );
    expect(own.get(IDEMPOTENCY_STORE, { strict: true })).toBeInstanceOf(
      DrizzleIdempotencyStore,
    );
    // The crash window of the comment create (P-17): the module answers a replay itself.
    expect(
      typeof (
        own.get(IDEMPOTENCY_REPLAY_READER, { strict: true }) as {
          read: unknown;
        }
      ).read,
    ).toBe('function');
    expect(own.get(WORKLIST_STORE, { strict: true })).toBeInstanceOf(
      DrizzleWorklistStore,
    );
    expect(own.get(TIMELINE_LOADS, { strict: true })).toBeInstanceOf(
      DrizzleTimelineLoads,
    );
    expect(own.get(WorklistService, { strict: true })).toBeInstanceOf(
      WorklistService,
    );
    expect(
      (own.get(ADMIN_CONFIG_CLOCK, { strict: true }) as () => Date)(),
    ).toBeInstanceOf(Date);
    expect(
      (own.get(IDEMPOTENCY_CLOCK, { strict: true }) as () => Date)(),
    ).toBeInstanceOf(Date);
    await moduleRef.close();
  });

  it('gets the catalog source and the authorization service through its imports, so a missing export fails to resolve', async () => {
    // A probe that sees exactly what AssessmentModule's imports export.
    @Injectable()
    class Probe {
      constructor(
        @Inject(FIELD_CATALOG_SOURCE) readonly catalog: unknown,
        readonly authorization: AuthorizationService,
      ) {}
    }
    @Module({
      imports: Reflect.getMetadata('imports', AssessmentModule) as never[],
      providers: [Probe],
    })
    class ProbeModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    })
      .overrideProvider(MYSQL_POOL)
      .useValue({ end: async () => undefined })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    const probe = moduleRef.get(Probe, { strict: false });
    expect(probe.catalog).toBeInstanceOf(ReportingQaCatalogClient);
    expect(probe.authorization).toBeInstanceOf(AuthorizationService);
    await moduleRef.close();
  });

  it('imports UsersModule and FieldConfigModule and never IngestionModule', () => {
    const imports = Reflect.getMetadata(
      'imports',
      AssessmentModule,
    ) as unknown[];
    expect(imports).toContain(UsersModule);
    expect(imports).toContain(FieldConfigModule);
    expect(imports).not.toContain(IngestionModule);
  });
});
