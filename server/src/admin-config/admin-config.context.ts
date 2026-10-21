import type { IdempotencyHandle } from '../common/idempotency/idempotency.context.js';

/** The writes that log one decision line each (design 7.6, NFR-7). */
export type AdminConfigAction =
  | 'cycle_create'
  | 'cycle_activate'
  | 'timeline_create'
  | 'timeline_user_assign'
  | 'timeline_user_remove';

/**
 * Who acts and under which request: every decision line carries both (NFR-7).
 * A keyed request also carries its reservation from the interceptor (design
 * 7.3, P-1); without the header there is none and nothing is marked.
 */
export interface AdminConfigContext {
  actorId: number;
  requestId: string | null;
  idempotency?: IdempotencyHandle;
}
