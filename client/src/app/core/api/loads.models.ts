/**
 * Step-1 loads of a QA timeline (ADMIN only), as the QA server sends them.
 * Contract: `docs/specs/archive/2026-11-04-ingestion--step-1-loads/front-contract.md`
 * (source of truth `server/src/ingestion/models/load.model.ts`). Copied by hand: keep it in sync.
 */

/** `closed` when the cycle is closed or step 1's closing minute has passed: a start would be refused. */
export type LoadWindow = 'open' | 'closed';

export type LoadStatus = 'running' | 'completed' | 'failed';

export interface LoadProgramCount {
  /** CLARISA id of the Science Program. */
  readonly programId: number;
  /** Program code (SP01…); the summary may leave it out. */
  readonly code?: string;
  readonly count: number;
}

export interface LoadTypeCount {
  /** Result type key of the Reporting catalog. */
  readonly key: string;
  readonly count: number;
}

/** Knowledge Products to load, by group. Counts only. */
export interface LoadKpGroups {
  /** Not in QA: released to Reporting as QAed when the load completes. */
  readonly notInQa: number;
  /** Auto-checked: released to Reporting as QAed when the load completes. */
  readonly autoChecked: number;
  /** To review: assessed in step 1 like any result. */
  readonly review: number;
}

export interface LoadSkip {
  /**
   * QA's own (`ACTIVE_IN_OTHER_TIMELINE`, `ALREADY_IN_THIS_TIMELINE`, `DUPLICATE_RESULT_CODE`) or Reporting's,
   * passed through as given. The list grows: an unknown reason is shown as plain text, never an error.
   */
  readonly reason: string;
  readonly count: number;
  /** Only on `ACTIVE_IN_OTHER_TIMELINE`: which timelines hold them. */
  readonly timelines?: readonly { readonly id: number; readonly name: string; readonly count: number }[];
}

/** `GET /timelines/:id/loads/preview`: nothing is written. An estimate: the run can skip more. */
export interface LoadPreview {
  readonly phaseYear: number;
  readonly window: LoadWindow;
  readonly toLoad: {
    readonly total: number;
    readonly byProgram: readonly LoadProgramCount[];
    readonly byResultType: readonly LoadTypeCount[];
  };
  readonly kpGroups: LoadKpGroups;
  readonly skipped: readonly LoadSkip[];
}

/** Closed list, never a secret. */
export type LoadFailureReason =
  | 'REPORTING_UNAUTHORIZED'
  | 'REPORTING_REJECTED'
  | 'REPORTING_UNAVAILABLE'
  | 'CATALOG_VERSION_MISMATCH'
  | 'STORE_UNAVAILABLE'
  | 'ABANDONED'
  | 'INTERNAL';

/** `GET /timelines/:id/loads` row (newest first). */
export interface LoadItem {
  readonly id: number;
  readonly status: LoadStatus;
  /** `null` until the run has listed the whole feed: show an indeterminate state. */
  readonly total: number | null;
  /** Loaded or skipped so far. May exceed `total` (known gap G-2): never an error to the user. */
  readonly processed: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly startedBy: { readonly id: number; readonly nickname: string | null };
  readonly failureReason: LoadFailureReason | null;
}

export interface LoadSummary {
  readonly loaded: number;
  readonly byProgram: readonly LoadProgramCount[];
  readonly byResultType: readonly LoadTypeCount[];
  readonly kpGroups: LoadKpGroups;
  readonly skipped: readonly LoadSkip[];
}

/** `GET /timelines/:id/loads/:loadId`. A failed load keeps the summary of what it recorded. */
export interface LoadDetail extends LoadItem {
  readonly summary: LoadSummary;
}

/** `POST /timelines/:id/loads`: 202, the run goes on in the server. */
export interface LoadStarted {
  readonly id: number;
  readonly status: 'running';
}

/** Error codes of the load routes the screen branches on (shared ones in `error-codes.ts`). */
export const LOAD_ERROR = {
  WINDOW_CLOSED: 'LOADS_WINDOW_CLOSED',
  ALREADY_RUNNING: 'LOADS_ALREADY_RUNNING',
  NOT_FOUND: 'LOADS_NOT_FOUND',
  CYCLES_CLOSED: 'CYCLES_CLOSED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMELINES_NOT_FOUND: 'TIMELINES_NOT_FOUND',
} as const;
