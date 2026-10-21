import { Module } from '@nestjs/common';
import { CyclesModule } from './cycles/cycles.module.js';

/**
 * Cycles and QA timelines (spec admin-config/cycle-timelines, design 3). The
 * timelines module joins here when it exists.
 */
@Module({ imports: [CyclesModule] })
export class AdminConfigModule {}
