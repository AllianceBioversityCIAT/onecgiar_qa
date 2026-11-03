import { Module } from '@nestjs/common';
import { CyclesModule } from './cycles/cycles.module.js';
import { FieldConfigModule } from './field-config/field-config.module.js';
import { TimelinesModule } from './timelines/timelines.module.js';

/**
 * Cycles and QA timelines (spec admin-config/cycle-timelines, design 3): two
 * Nest modules so each binds its own idempotency replay reader (DD-4), plus the
 * field configuration of a cycle (spec admin-config/field-configuration).
 */
@Module({ imports: [CyclesModule, TimelinesModule, FieldConfigModule] })
export class AdminConfigModule {}
