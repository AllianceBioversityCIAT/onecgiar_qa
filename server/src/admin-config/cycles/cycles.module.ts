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
import { ADMIN_CONFIG_CLOCK } from '../admin-config.clock.js';
import { CyclesController } from './cycles.controller.js';
import { CyclesService } from './cycles.service.js';
import { CYCLES_STORE, DrizzleCyclesStore } from './cycles.store.js';
import {
  CYCLES_UNIT_OF_WORK,
  DrizzleCyclesUnitOfWork,
} from './cycles.unit-of-work.js';

/**
 * Cycles: create, list, activate (cycle-timelines design 3, DD-4). Its own
 * Nest module so the idempotency replay reader below answers a `Cycle`; the
 * timelines module binds its own reader for a `Timeline` (P-1).
 */
@Module({
  imports: [DrizzleModule],
  controllers: [CyclesController],
  providers: [
    { provide: CYCLES_STORE, useClass: DrizzleCyclesStore },
    { provide: CYCLES_UNIT_OF_WORK, useClass: DrizzleCyclesUnitOfWork },
    CyclesService,
    // The only time source of the services (NFR-4, design 7.7). The e2e suites
    // override it to pin "today in Rome".
    { provide: ADMIN_CONFIG_CLOCK, useValue: () => new Date() },
    // The idempotency interceptor of `POST /cycles` (FR-17). The token factory
    // stays unbound: the store generates owner tokens with randomUUID.
    { provide: IDEMPOTENCY_STORE, useClass: DrizzleIdempotencyStore },
    { provide: IDEMPOTENCY_CLOCK, useValue: () => new Date() },
    {
      // The crash window: a key left `executed` without an answer is replayed
      // with a fresh `Cycle`. The stored target id is a cycle id here (§ 9).
      provide: IDEMPOTENCY_REPLAY_READER,
      useFactory: (cycles: CyclesService): IdempotencyReplayReader => ({
        read: (cycleId) => cycles.get(cycleId),
      }),
      inject: [CyclesService],
    },
  ],
})
export class CyclesModule {}
