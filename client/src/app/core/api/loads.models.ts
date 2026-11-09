/**
 * Loads (syncs) of a QA timeline (ADMIN only), as the QA server sends them. A sync can start at any step until
 * the timeline's last step closes, and enters the QA round (1 or 2) of the step in force.
 * Contract: `docs/specs/archive/2026-11-09-ingestion--timeline-sync/front-contract.md` (supersedes step-1 loads;
 * source of truth `server/src/ingestion/models/load.model.ts`). Copied by hand: keep it in sync.
 */

/** `closed` when the cycle is closed or the last step's closing minute has passed: a start would be refused. */
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
  /** To review: assessed like any result. */
  readonly review: number;
}

export interface LoadSkip {
  /**
   * QA's own (`ACTIVE_IN_OTHER_TIMELINE`, `ALREADY_IN_THIS_TIMELINE`, `RETURNED_NOT_RESUBMITTED`,
   * `DUPLICATE_RESULT_CODE`) or Reporting's,
   * passed through as given. The list grows: an unknown reason is shown as plain text, never an error.
   */
  readonly reason: string;
  readonly count: number;
  /** Only on `ACTIVE_IN_OTHER_TIMELINE`: which timelines hold them. */
  readonly timelines?: readonly { readonly id: number; readonly name: string; readonly count: number }[];
}

/**
 * Results this timeline returned in round 1 that have not entered round 2, counted under their round-1
 * program and type. `code` comes only in the preview (and only while the feed lists that program).
 * Always zero until the assessment spec can return a result (contract § 5).
 */
export interface LoadReturnedNotResubmitted {
  readonly total: number;
  readonly byProgram: readonly LoadProgramCount[];
  readonly byResultType: readonly LoadTypeCount[];
}

/** `GET /timelines/:id/loads/preview`: nothing is written. An estimate: the run can skip more. */
export interface LoadPreview {
  readonly phaseYear: number;
  readonly window: LoadWindow;
  /** Round (1 or 2) a sync started now would be recorded with. */
  readonly round: number;
  /** Position (1-based) of the step in force. */
  readonly stepPosition: number;
  readonly toLoad: {
    readonly total: number;
    /** New to the timeline. `new + resubmitted = total`. */
    readonly new: number;
    /** Returned in round 1 and submitted again since (round 2 only). */
    readonly resubmitted: number;
    readonly byProgram: readonly LoadProgramCount[];
    readonly byResultType: readonly LoadTypeCount[];
  };
  readonly returnedNotResubmitted: LoadReturnedNotResubmitted;
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
  /** Round the load entered (a load recorded before the sync reads 1). */
  readonly round: number;
  /** Position (1-based) of the step in force at the start (a load recorded before the sync reads 1). */
  readonly stepPosition: number;
}

export interface LoadSummary {
  /** `loadedNew + loadedResubmitted`. */
  readonly loaded: number;
  readonly loadedNew: number;
  readonly loadedResubmitted: number;
  readonly round: number;
  /** Counted once when the run ends (includes returned results the feed no longer lists); no `code`. */
  readonly returnedNotResubmitted: LoadReturnedNotResubmitted;
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
  /** 409 at preview or start: Reporting has no QA catalog for the cycle's year. Retrying does not help. */
  CATALOG_MISSING: 'LOADS_CATALOG_MISSING',
  NOT_FOUND: 'LOADS_NOT_FOUND',
  CYCLES_CLOSED: 'CYCLES_CLOSED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMELINES_NOT_FOUND: 'TIMELINES_NOT_FOUND',
} as const;
