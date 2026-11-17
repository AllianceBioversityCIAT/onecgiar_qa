// @akili-spec assessment/step-1-assessment
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ADMIN_CONFIG_CLOCK } from '../admin-config/admin-config.clock.js';
import { FieldConfigModule } from '../admin-config/field-config/field-config.module.js';
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
import {
  DrizzleTitleBackfillStore,
  TITLE_BACKFILL_STORE,
  TitleBackfill,
} from './title-backfill.js';
import {
  AI_SUGGESTION_STORE,
  DynamoAiSuggestionStore,
} from '../ai-suggestions/ai-suggestion.store.js';
import {
  AiAnalysisController,
  AiSuggestionsController,
} from './ai-suggestions.controller.js';
import { AiSuggestionsService } from './ai-suggestions.service.js';
import { AI_USAGE_STORE, DrizzleAiUsageStore } from './ai-usage.store.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentService } from './assessment.service.js';
import {
  ASSESSMENT_UNIT_OF_WORK,
  DrizzleAssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import {
  ASSESSMENT_STORE,
  DrizzleAssessmentStore,
} from './assessment.store.js';
import { QuickCommentsController } from './quick-comments.controller.js';
import {
  RELEASE_DISPATCHER,
  RELEASE_PAUSE,
  ReleaseService,
  defaultReleasePause,
} from './release.service.js';
import { DrizzleReleaseStore, RELEASE_STORE } from './release.store.js';
import { ReleasesController } from './releases.controller.js';
import { QuickCommentsService } from './quick-comments.service.js';
import { WorklistController } from './worklist.controller.js';
import { WorklistService } from './worklist.service.js';
import { DrizzleWorklistStore, WORKLIST_STORE } from './worklist.store.js';
import { spAccessConfig } from '../config/sp-access.config.js';
import { AuthThrottlerModule } from '../auth/auth-throttle.js';
import { SpAccessController } from './sp-view/sp-access.controller.js';
import { SpAccessService } from './sp-view/sp-access.service.js';
import {
  DrizzleSpAccessStore,
  SP_ACCESS_STORE,
} from './sp-view/sp-access.store.js';
import { SpApiKeyGuard } from './sp-view/sp-api-key.guard.js';
import { SpSessionGuard } from './sp-view/sp-session.guard.js';
import { SpViewController } from './sp-view/sp-view.controller.js';

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
  controllers: [
    WorklistController,
    AssessmentController,
    QuickCommentsController,
    ReleasesController,
    AiSuggestionsController,
    AiAnalysisController,
    // The Science Program view (P2-3911, sp-view/).
    SpAccessController,
    SpViewController,
  ],
  imports: [
    DrizzleModule,
    DynamoDbModule,
    ConfigModule.forFeature(catalogsConfig),
    ConfigModule.forFeature(spAccessConfig),
    // The per-IP limit of the SP code exchange (P2-3911): the same global throttler AuthModule uses.
    AuthThrottlerModule,
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
    // The assessment view (T-9): its read port, and the service. The write side (T-10) is the unit of work below.
    { provide: ASSESSMENT_STORE, useClass: DrizzleAssessmentStore },
    // The write side (T-10): one READ COMMITTED transaction per write, in the lock order of design 5.
    {
      provide: ASSESSMENT_UNIT_OF_WORK,
      useClass: DrizzleAssessmentUnitOfWork,
    },
    AssessmentService,
    // The quick comments shared by role (T-11, FR-12): over the same stores and unit of work.
    QuickCommentsService,
    {
      // The crash window of the comment create (P-17): a key left `executed`
      // without a stored answer is replayed with the comment re-read from its
      // id. The stored target id is a comment id here.
      provide: IDEMPOTENCY_REPLAY_READER,
      useFactory: (service: AssessmentService): IdempotencyReplayReader => ({
        read: (commentId) => service.replayComment(commentId),
      }),
      inject: [AssessmentService],
    },
    // The release outbox (T-12, FR-18, DD-5): the claim and the admin list on the pool, the service that sends and acknowledges, and the dispatcher `AssessmentService` calls after an end commits.
    { provide: RELEASE_STORE, useClass: DrizzleReleaseStore },
    // The wait between two attempts of a send, a token so the e2e apps run no timer.
    { provide: RELEASE_PAUSE, useValue: defaultReleasePause },
    ReleaseService,
    { provide: RELEASE_DISPATCHER, useExisting: ReleaseService },
    // The title backfill (T-13, FR-24): a bootstrap hook that is not awaited.
    { provide: TITLE_BACKFILL_STORE, useClass: DrizzleTitleBackfillStore },
    TitleBackfill,
    // AI suggestions (ai-suggestions T-5, T-8): the worker's items in DynamoDB, the usage rows in MySQL.
    { provide: AI_SUGGESTION_STORE, useClass: DynamoAiSuggestionStore },
    { provide: AI_USAGE_STORE, useClass: DrizzleAiUsageStore },
    AiSuggestionsService,
    // The Science Program view (P2-3911): link codes and SP sessions, the machine-key and session guards.
    { provide: SP_ACCESS_STORE, useClass: DrizzleSpAccessStore },
    SpAccessService,
    SpApiKeyGuard,
    SpSessionGuard,
  ],
})
export class AssessmentModule {}
