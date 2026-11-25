/**
 * Shapes of the Science Program view API (P2-3911, `server/src/assessment/sp-view/models`), copied by
 * hand. If the server and this file disagree, the server wins: fix this file. No shape here carries an
 * assessor: the SP view never names who wrote a comment.
 */
import type { QaStatus, StepState } from './assessment.models';

export interface SpProgram {
  /** CLARISA id: what `programId` sends. */
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

/** `POST /sp-access/session`. */
export interface SpSessionData {
  readonly accessToken: string;
  /** ISO date-time, 8 h after the exchange. */
  readonly expiresAt: string;
  readonly user: { readonly name: string };
  /** The code's program; null for an admin who sent none. */
  readonly program: SpProgram | null;
  readonly isReportingAdmin: boolean;
}

/** `GET /sp/me`. */
export interface SpMe {
  readonly user: { readonly name: string };
  readonly isReportingAdmin: boolean;
  readonly program: SpProgram | null;
  /** Every Science Program for an admin, else just its own. */
  readonly programs: readonly SpProgram[];
}

export interface SpStep {
  readonly position: number;
  readonly name: string;
  /** Rome wall-clock minute, `YYYY-MM-DDTHH:mm`. */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly state: StepState;
}

export interface SpTimeline {
  readonly id: number;
  readonly name: string;
  readonly kind: 'official' | 'additional';
  /** The step whose audience is the programs; null when none. */
  readonly step: SpStep | null;
}

/** `GET /sp/timelines`. */
export interface SpTimelines {
  readonly timelines: readonly SpTimeline[];
  readonly defaultTimelineId: number | null;
}

export interface SpKeyLabel {
  readonly key: string;
  readonly label: string;
}

export interface SpResultRow {
  readonly resultCode: number;
  readonly title: string | null;
  /** Resubmitted with changes (round 2). */
  readonly updated: boolean;
  readonly resultType: SpKeyLabel;
  /** QA comments visible to the program. */
  readonly comments: number;
  /** Accepted, accepted with a comment, or disagreed. */
  readonly answered: number;
  readonly status: QaStatus | null;
}

/** `GET /sp/timelines/:id/results`. */
export interface SpResults {
  readonly rows: readonly SpResultRow[];
  readonly options: {
    readonly statuses: readonly SpKeyLabel[];
    readonly resultTypes: readonly SpKeyLabel[];
  };
  readonly step: SpStep | null;
}

export interface SpResultsQuery {
  readonly programId?: number | null;
  readonly status?: readonly string[];
  readonly resultTypeKey?: readonly string[];
}

export const SP_RESPONSE_KINDS = ['accept', 'accept_with_comment', 'disagree', 'request_clarification'] as const;
export type SpResponseKind = (typeof SP_RESPONSE_KINDS)[number];

export interface SpResponse {
  readonly id: number;
  readonly kind: SpResponseKind;
  readonly body: string | null;
  readonly respondedBy: { readonly name: string };
  readonly respondedAt: string;
}

export interface SpClarification {
  /** Id of the `request_clarification` response. */
  readonly requestId: number;
  readonly question: string;
  readonly requestedAt: string;
  readonly answer: { readonly body: string; readonly answeredAt: string } | null;
}

export type SpFieldLabels = Readonly<Record<string, Readonly<Record<string, string | null>>>>;

export interface SpComment {
  readonly id: number;
  readonly fieldKey: string;
  readonly body: string;
  readonly state: string;
  readonly createdAt: string;
  /** The field as it was when commented. */
  readonly valueCopy: { readonly value: unknown; readonly labels?: SpFieldLabels | null };
  readonly valueTruncated: boolean;
  /** The latest response, or null. */
  readonly response: SpResponse | null;
  /** Every response, oldest first (the latest included). */
  readonly history: readonly SpResponse[];
  readonly clarifications: readonly SpClarification[];
}

export interface SpField {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly type: string;
  readonly mode: 'view' | 'assessed';
  readonly core: boolean;
  readonly value: unknown;
  readonly labels: SpFieldLabels | null;
  readonly validated: boolean;
  readonly comments: readonly SpComment[];
  readonly notApplicable: boolean;
}

export interface SpSection {
  readonly key: string;
  readonly label: string;
  readonly fields: readonly SpField[];
}

export interface SpCounts {
  readonly comments: number;
  readonly answered: number;
}

export type SpReadOnlyReason = 'step_not_open' | 'step_closed';

/** `GET /sp/timelines/:tid/results/:code`. */
export interface SpResult {
  readonly header: {
    readonly resultCode: number;
    readonly title: string | null;
    readonly program: SpProgram;
    readonly resultType: SpKeyLabel;
    readonly timeline: { readonly id: number; readonly name: string };
    readonly status: QaStatus | null;
    /** "Open in Reporting" link; null when not configured. */
    readonly reportingUrl: string | null;
  };
  readonly step: SpStep | null;
  readonly sections: readonly SpSection[];
  readonly other: readonly SpField[];
  /** The programs step is in progress. */
  readonly writable: boolean;
  readonly readOnlyReason: SpReadOnlyReason | null;
  readonly counts: SpCounts;
}

/** `PUT /sp/comments/:id/response` body: `accept` carries no text, every other kind does. */
export type SpRespondBody =
  | { readonly kind: 'accept' }
  | { readonly kind: Exclude<SpResponseKind, 'accept'>; readonly body: string };

export interface SpRespondAnswer {
  readonly comment: SpComment;
  /** The result's counts after the response. */
  readonly counts: SpCounts;
}

/** The `SP_*` codes the page branches on (`server/src/common/error-codes.ts`). */
export const SP_ERROR = {
  CODE_INVALID: 'SP_CODE_INVALID',
  SESSION_INVALID: 'SP_SESSION_INVALID',
  NOT_FOUND: 'SP_NOT_FOUND',
  STEP_CLOSED: 'SP_STEP_CLOSED',
  COMMENT_NOT_RESPONDABLE: 'SP_COMMENT_NOT_RESPONDABLE',
} as const;

/** Text limit of a response (`SP_TEXT_MAX`), counted in characters (code points). */
export const SP_TEXT_MAX = 2000;

/** Comment states a program may answer (or change its answer from). */
export const SP_RESPONDABLE_STATES: readonly string[] = [
  'open',
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'clarification_requested',
];

/** Why the page asks Reporting to load it again (contract § 3). */
export type SpReloadReason = 'code_invalid' | 'session_expired';
