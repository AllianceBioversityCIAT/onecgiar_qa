// @akili-spec assessment/step-1-assessment
/**
 * Step-1 assessment API (worklist, assessment view, writes, quick comments), as the QA server sends it.
 * Contract: `docs/specs/assessment/step-1-assessment/front-contract.md` (source of truth: the server's
 * `server/src/assessment/models/*.model.ts`). Copied by hand: keep it in sync.
 */

/** The 8 QA statuses (contract § 3.1), in display order. The set is closed. */
export const QA_STATUSES = [
  'pending',
  'returned_to_program',
  'clarification_requested',
  'pending_tpb_review',
  'pending_ppu',
  'unresolved',
  'quality_assessed',
  'auto_validated',
] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

/** Labels of FR-5, the same words the server sends in `options.statuses`. */
export const QA_STATUS_LABELS: Readonly<Record<QaStatus, string>> = {
  pending: 'Pending',
  returned_to_program: 'Returned to program',
  clarification_requested: 'Clarification requested',
  pending_tpb_review: 'Pending for TPB review',
  pending_ppu: 'Pending PPU',
  unresolved: 'Unresolved',
  quality_assessed: 'Quality Assessed',
  auto_validated: 'Auto-validated',
};

export function isQaStatus(value: string): value is QaStatus {
  return (QA_STATUSES as readonly string[]).includes(value);
}

/** Why a row or a view is read-only (contract § 3.2); `finished` only on the view. `null`: the caller can write. */
export type ReadOnlyReason = 'admin_read_only' | 'step_upcoming' | 'step_closed' | 'no_step' | 'finished';

export type StepState = 'upcoming' | 'in_progress' | 'closed';
export type AssessmentStatus = 'pending' | 'quality_assessed' | 'returned';
export type FieldMode = 'view' | 'assessed';
export type CommentState =
  | 'open'
  | 'withdrawn'
  | 'clarification_requested'
  | 'accepted'
  | 'accepted_with_comment'
  | 'disagreed'
  | 'escalated'
  | 'tpb_sided_program'
  | 'tpb_sided_assessor'
  | 'done';
export type QuickCommentRole = 'ASSESSOR' | 'LEAD_ASSESSOR' | 'TPB' | 'PPU';

export interface ProgramRef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

export interface KeyLabel {
  readonly key: string;
  readonly label: string;
}

/** A user as the module shows one: by nickname only (FR-6, FR-11). */
export interface UserRef {
  readonly id: number;
  readonly nickname: string | null;
}

// ---------- Worklist (contract § 4) ----------

export interface WorklistStep {
  readonly position: number;
  readonly name: string;
  /** Rome wall-clock minute, `YYYY-MM-DDTHH:mm`. */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly state: StepState;
}

export interface WorklistTimeline {
  readonly id: number;
  readonly name: string;
  readonly kind: 'official' | 'additional';
  /** The caller's enabled reviewer roles, plus `'ADMIN'` for an admin. */
  readonly roles: readonly string[];
  readonly step: WorklistStep | null;
}

export interface WorklistTimelines {
  readonly timelines: readonly WorklistTimeline[];
  readonly defaultTimelineId: number | null;
  readonly timeZone: string;
}

/** Server sort keys (contract § 4.2). */
export const WORKLIST_SORTS = ['code', 'title', 'program', 'resultType', 'comments', 'answered', 'assessedBy', 'status'] as const;
export type WorklistSort = (typeof WORKLIST_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

export interface WorklistQuery {
  readonly status?: readonly string[];
  readonly programId?: readonly number[];
  readonly resultTypeKey?: readonly string[];
  readonly q?: string;
  readonly sort?: WorklistSort;
  readonly dir?: SortDirection;
  /** 1 to 100, default 25. */
  readonly limit?: number;
  /** The previous `nextCursor`; valid only with the same `sort` and `dir`. */
  readonly cursor?: string;
}

export interface WorklistRow {
  readonly membershipId: number;
  readonly resultCode: number;
  readonly title: string | null;
  /** A round-2 re-entry whose fields changed. */
  readonly updated: boolean;
  readonly program: ProgramRef;
  readonly resultType: KeyLabel;
  /** Open (non-withdrawn) comments. */
  readonly comments: number;
  /** Always 0 until P2-3911. */
  readonly answeredBySp: number;
  readonly assessedBy: UserRef | null;
  readonly status: QaStatus;
  readonly canOpen: boolean;
  readonly readOnlyReason: ReadOnlyReason | null;
}

export interface WorklistCounters {
  readonly pending: number;
  readonly finished: number;
  readonly total: number;
}

export interface WorklistData {
  readonly rows: readonly WorklistRow[];
  readonly counters: WorklistCounters;
  readonly writable: boolean;
  /** Assigned to the timeline, but no enabled role of the caller has a worklist. */
  readonly noActiveRole: boolean;
}

/** One worklist page plus the cursor of the next one (`null` on the last page). */
export interface WorklistPage extends WorklistData {
  readonly nextCursor: string | null;
}

export interface WorklistOptions {
  /** `{ id, code, name }`, unlike the two lists below (contract § 4.3). */
  readonly programs: readonly ProgramRef[];
  readonly resultTypes: readonly KeyLabel[];
  readonly statuses: readonly KeyLabel[];
}

// ---------- Assessment view (contract § 5) ----------

/** `{ [controlList]: { [id]: label | null } }`; a `null` label is an id with no row. */
export type FieldLabels = Readonly<Record<string, Readonly<Record<string, string | null>>>>;

export interface AssessmentComment {
  readonly id: number;
  readonly fieldKey: string;
  readonly author: UserRef;
  readonly body: string;
  readonly state: CommentState;
  readonly stepPosition: number;
  readonly round: number;
  readonly valueCopy: { readonly value: unknown; readonly labels?: unknown };
  readonly valueTruncated: boolean;
  readonly createdAt: string;
  readonly withdrawnAt: string | null;
}

export interface AssessmentField {
  readonly key: string;
  readonly label: string;
  /** Catalog type (`text`, `single_select`, `list`…); `unknown` under `other`. */
  readonly type: string;
  readonly mode: FieldMode;
  /** The "Core" tag; only meaningful on an `assessed` field. */
  readonly core: boolean;
  /** Any JSON value, as the snapshot holds it. `null` when `notApplicable`. */
  readonly value: unknown;
  readonly labels: FieldLabels | null;
  /** The green mark. Always `false` on a `view` field. */
  readonly validated: boolean;
  readonly comments: readonly AssessmentComment[];
  /** The catalog has the field and the snapshot has no key for it. */
  readonly notApplicable: boolean;
}

export interface AssessmentSection {
  /** `theory_of_change` for the Theory of Change group. */
  readonly key: string;
  readonly label: string;
  readonly fields: readonly AssessmentField[];
}

export const TOC_SECTION_KEY = 'theory_of_change';

export interface AssessmentHeader {
  readonly resultCode: number;
  readonly title: string | null;
  readonly program: ProgramRef;
  readonly resultType: KeyLabel;
  readonly timeline: { readonly id: number; readonly name: string };
  readonly step: { readonly position: number; readonly name: string } | null;
  readonly status: QaStatus;
}

export interface AssessmentState {
  readonly status: AssessmentStatus;
  readonly assessedBy: UserRef | null;
  readonly finishedAt: string | null;
}

export interface AssessmentView {
  readonly header: AssessmentHeader;
  readonly sections: readonly AssessmentSection[];
  readonly other: readonly AssessmentField[];
  readonly writable: boolean;
  readonly readOnlyReason: ReadOnlyReason | null;
  /** `null` until the first write creates the assessment. */
  readonly assessment: AssessmentState | null;
}

// ---------- Writes (contract § 6) ----------

/** Exactly one of `fieldKeys` and `all`. */
export type ValidateBody =
  | { readonly validated: boolean; readonly fieldKeys: readonly string[] }
  | { readonly validated: boolean; readonly all: true };

/** Answer of a validation write and of finish. */
export interface ValidationSummary extends AssessmentState {
  /** Every row the assessment holds; empty when it does not exist yet. */
  readonly validations: readonly { readonly fieldKey: string; readonly validated: boolean }[];
}

export interface CreateCommentBody {
  readonly fieldKey: string;
  /** Trimmed by the server, then 1 to 2,000 characters. */
  readonly body: string;
}

// ---------- Quick comments (contract § 7) ----------

export interface QuickComment {
  readonly id: number;
  readonly body: string;
  readonly createdAt: string;
}

// ---------- Error codes (contract § 9) ----------

export const ASSESSMENT_ERROR = {
  NOT_FOUND: 'ASSESSMENT_NOT_FOUND',
  READ_ONLY: 'ASSESSMENT_READ_ONLY',
  STEP_CLOSED: 'ASSESSMENT_STEP_CLOSED',
  FINISHED: 'ASSESSMENT_FINISHED',
  NO_FIELD_CONFIG: 'ASSESSMENT_NO_FIELD_CONFIG',
  CORE_UNCOMMENTED: 'ASSESSMENT_CORE_UNCOMMENTED',
  NOT_COMMENT_AUTHOR: 'ASSESSMENT_NOT_COMMENT_AUTHOR',
  COMMENT_NOT_OPEN: 'ASSESSMENT_COMMENT_NOT_OPEN',
  TIMELINES_NOT_FOUND: 'TIMELINES_NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
