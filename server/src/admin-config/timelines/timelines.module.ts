import { Module } from '@nestjs/common';
import {
  IDEMPOTENCY_REPLAY_READER,
  type IdempotencyReplayReader,
} from '../../common/idempotency/idempotency.interceptor.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../common/idempotency/idempotency.store.js';
import { DrizzleModule } from '../../database/drizzle/drizzle.module.js';
import { UsersModule } from '../../users/users.module.js';
import { ADMIN_CONFIG_CLOCK } from '../admin-config.clock.js';
import { TimelinesController } from './timelines.controller.js';
import { TimelinesService } from './timelines.service.js';
import { DrizzleTimelinesStore, TIMELINES_STORE } from './timelines.store.js';
import {
  DrizzleTimelinesUnitOfWork,
  TIMELINES_UNIT_OF_WORK,
} from './timelines.unit-of-work.js';

/**
 * Timelines: defaults and create (cycle-timelines design 3, DD-4). Its own Nest
 * module so the idempotency replay reader below answers a `Timeline`; the
 * cycles module binds its own reader for a `Cycle` (P-1). `UsersModule` is read
 * only for `CatalogService` (Science Programs and result types, P-8).
 */
@Module({
  imports: [DrizzleModule, UsersModule],
  controllers: [TimelinesController],
  providers: [
    { provide: TIMELINES_STORE, useClass: DrizzleTimelinesStore },
    { provide: TIMELINES_UNIT_OF_WORK, useClass: DrizzleTimelinesUnitOfWork },
    TimelinesService,
    // The only time source of the services (NFR-4, design 7.7), the same factory
    // as `CyclesModule`. The e2e suites override it to pin "today in Rome".
    { provide: ADMIN_CONFIG_CLOCK, useValue: () => new Date() },
    // The idempotency interceptor of `POST /cycles/:id/timelines` (FR-17). The
    // token factory stays unbound: the store generates owner tokens with randomUUID.
    { provide: IDEMPOTENCY_STORE, useClass: DrizzleIdempotencyStore },
    { provide: IDEMPOTENCY_CLOCK, useValue: () => new Date() },
    {
      // The crash window: a key left `executed` without an answer is replayed
      // with a fresh `Timeline`, whose kind is the one stored at create (never
      // decided again). The stored target id is a timeline id here (§ 9).
      provide: IDEMPOTENCY_REPLAY_READER,
      useFactory: (timelines: TimelinesService): IdempotencyReplayReader => ({
        read: (timelineId) => timelines.get(timelineId),
      }),
      inject: [TimelinesService],
    },
  ],
})
export class TimelinesModule {}
