import { Module } from '@nestjs/common';
import { CyclesModule } from './cycles/cycles.module.js';
import { TimelinesModule } from './timelines/timelines.module.js';

/**
 * Cycles and QA timelines (spec admin-config/cycle-timelines, design 3): two
 * Nest modules so each binds its own idempotency replay reader (DD-4).
 */
@Module({ imports: [CyclesModule, TimelinesModule] })
export class AdminConfigModule {}
