import { Injectable } from '@nestjs/common';

export const TIMELINE_LOADS = Symbol('TIMELINE_LOADS');

/**
 * "Does this timeline have a load?" (timeline-edit design 7.4, DD-3). The view
 * needs it for the hold (FR-6) and, later, the edit rules for the scope lock
 * (FR-4). Batched: one call answers every timeline of a read, at most one
 * statement, so the list stays a fixed number of queries (NFR-5).
 */
export interface TimelineLoads {
  /** The ids, among `timelineIds`, that have a load. */
  withLoad(timelineIds: readonly number[]): Promise<ReadonlySet<number>>;
}

/**
 * The adapter until the load stories exist (P2-3905; `timeline_loads` is not
 * created, P-8): no timeline has a load, and answering costs no query (S-1),
 * so the list count stays at six (NFR-5). P2-3905 swaps this provider for a
 * query over `timeline_loads`; the view and the rules do not change (NFR-6).
 */
@Injectable()
export class NoTimelineLoads implements TimelineLoads {
  async withLoad(): Promise<ReadonlySet<number>> {
    return new Set<number>();
  }
}
