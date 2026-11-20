/**
 * Shapes of the step-1 assessment API (`server/src/assessment`), copied by hand from the frozen
 * front contract (`docs/specs/assessment/step-1-assessment/front-contract.md`, branch
 * `feat/assessment-step-1`). If the server and this file disagree, the server wins: fix this file.
 *
 * Round 2 (Lead Assessor, P2-3912) adds to it from `docs/specs/escalation/round-2/front-contract.md`
 * (branch `feat/P2-3912-lead-assessor-round-2`). Every round-2 property is optional here, so a step-1
 * server that does not send it still type-checks: absent means the round-1 meaning.
 */

/** The 8 QA statuses (contract § 3.1). Closed set, in display order. */
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

/** Why a row cannot be written now (§ 3.2). */
export type WorklistReadOnlyReason =
  'admin_read_only' | 'step_upcoming' | 'step_closed' | 'no_step' | 'auto_validated';
/** The view adds `finished` (the assessment ended). */
export type AssessmentReadOnlyReason = WorklistReadOnlyReason | 'finished';

export type StepState = 'upcoming' | 'in_progress' | 'closed';
/** `returned` ends round 1 only; `escalated` ends round 2 only (Pending for TPB review). */
export type AssessmentStatus = 'pending' | 'quality_assessed' | 'returned' | 'escalated';
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
  | 'done'
  /** Round 2: the Lead agreed with the program (set at the end of the Lead's review). */
  | 'lead_sided_program';
export type QuickCommentRole = 'ASSESSOR' | 'LEAD_ASSESSOR' | 'TPB' | 'PPU';

export interface ProgramRef {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

export interface KeyLabel<K extends string = string> {
  readonly key: K;
  readonly label: string;
}

export interface Person {
  readonly id: number;
  readonly nickname: string | null;
}

// ── Worklist (§ 4) ──────────────────────────────────────────────────────────

export interface WorklistStep {
  readonly position: number;
  readonly name: string;
  /** Rome wall-clock minutes, `YYYY-MM-DDTHH:mm`, no offset. */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly state: StepState;
}

export interface WorklistTimeline {
  readonly id: number;
  readonly name: string;
  readonly kind: 'official' | 'additional';
  /** The caller's enabled reviewer roles here, plus `'ADMIN'` for an admin (beyond § 6). */
  readonly roles: readonly string[];
  /** The step of the caller's role; `null` when the timeline has none. */
  readonly step: WorklistStep | null;
}

export interface WorklistTimelines {
  readonly timelines: readonly WorklistTimeline[];
  readonly defaultTimelineId: number | null;
  readonly timeZone: 'Europe/Rome';
}

export type WorklistSort =
  'code' | 'title' | 'program' | 'resultType' | 'comments' | 'answered' | 'assessedBy' | 'status';

export interface WorklistQuery {
  readonly status?: readonly QaStatus[];
  readonly programId?: readonly number[];
  readonly resultTypeKey?: readonly string[];
  /** Result code (exact or prefix) or title (contains), at most 200 characters. */
  readonly q?: string;
  readonly sort?: WorklistSort;
  readonly dir?: 'asc' | 'desc';
  /** 1 to 100, default 25. */
  readonly limit?: number;
  /** The previous `nextCursor`; valid only with the same `sort` and `dir`. */
  readonly cursor?: string;
}

export interface WorklistRow {
  readonly membershipId: number;
  readonly resultCode: number;
  readonly title: string | null;
  /** A round-2 re-entry whose fields changed since the previous round. */
  readonly updated: boolean;
  readonly program: ProgramRef;
  readonly resultType: KeyLabel;
  /** Open comments. */
  readonly comments: number;
  /** Always 0 for now. */
  readonly answeredBySp: number;
  readonly assessedBy: Person | null;
  readonly status: QaStatus;
  readonly canOpen: true;
  readonly readOnlyReason: WorklistReadOnlyReason | null;
}

export interface WorklistCounters {
  readonly pending: number;
  /** `quality_assessed` + `returned_to_program` + `clarification_requested`, and `pending_tpb_review` (round 2). */
  readonly finished: number;
  /** Every membership in scope (Auto-validated hidden). Beyond § 6. */
  readonly total: number;
}

export interface Worklist {
  readonly rows: readonly WorklistRow[];
  /** Ignore the filters and the page. */
  readonly counters: WorklistCounters;
  readonly writable: boolean;
  /** Assigned to the timeline, but no enabled role of theirs has a worklist. Beyond § 6. */
  readonly noActiveRole: boolean;
}

/** One worklist page plus the cursor of the next one (`null` on the last page). */
export interface WorklistPage extends Worklist {
  readonly nextCursor: string | null;
}

export interface WorklistOptions {
  readonly programs: readonly ProgramRef[];
  readonly resultTypes: readonly KeyLabel[];
  readonly statuses: readonly KeyLabel<QaStatus>[];
}

// ── Assessment view (§ 5) ───────────────────────────────────────────────────

/** `{ [controlList]: { [id]: label | null } }`; a `null` label is an id with no row. */
export type FieldLabels = Readonly<Record<string, Readonly<Record<string, string | null>>>>;

export interface AssessmentComment {
  readonly id: number;
  readonly fieldKey: string;
  readonly author: Person;
  readonly body: string;
  readonly state: CommentState;
  readonly stepPosition: number;
  readonly round: number;
  /** The field value as the author saw it. */
  readonly valueCopy: { readonly value: unknown; readonly labels?: FieldLabels | null };
  readonly valueTruncated: boolean;
  readonly createdAt: string;
  readonly withdrawnAt: string | null;
  /** Only on the answer of the delete route (round 2): when the Lead deleted it. */
  readonly deletedAt?: string;
  /** Only on the answer of the delete route (round 2): the user id of the Lead who deleted it. */
  readonly deletedBy?: number;
  // Round 2, Lead only (round-2 contract § 3.2): present on the Lead's OWN round-2 comments, absent on every other
  // comment (round 1, the Assessor's view, ADMIN, a comment another user wrote) and on a step-1 server.
  /** The Lead's live decision on its own comment (`escalate`); `null` when none, or when the comment is withdrawn. */
  readonly decision?: LeadDecision | null;
  /**
   * Takes a decision now. Already folds in the end of the review, a withdrawn comment and a read-only view: gate the
   * controls on it alone, never combined with `writable`.
   */
  readonly decidable?: boolean;
  /** `['escalate']` while decidable (no `agree_program` on one's own comment); `[]` otherwise and after the end. */
  readonly choices?: readonly LeadDecisionKind[];
}

// ── Round 2: the Lead's decisions and the round-1 thread (round-2 contract § 3.1, § 4.1) ──

/** What a Lead decides on a comment. TPB and PPU decisions are designed only, not accepted by the server. */
export type LeadDecisionKind = 'agree_program' | 'escalate';

/** Body of `PUT …/assessment/decisions/:commentId`. `body` is trimmed by the server, 1 to 2,000 characters. */
export interface LeadDecisionBody {
  readonly decision: LeadDecisionKind;
  readonly body: string;
}

/** A Lead's decision on a comment as the server stored it (thread items, own comments, the decision answer). */
export interface LeadDecision {
  readonly decision: LeadDecisionKind;
  readonly body: string | null;
  readonly decidedAt: string;
}

/** The program's latest response inside a round-2 thread: the responder is named, never an email. */
export interface ThreadResponse {
  readonly id: number;
  readonly kind: ProgramResponseKind;
  readonly body: string | null;
  readonly respondedBy: { readonly name: string };
  readonly respondedAt: string;
}

/** A round-1 comment of a core field as the Lead reads it (neither withdrawn nor deleted), ordered by comment. */
export interface ThreadItem {
  readonly commentId: number;
  readonly author: Person;
  readonly createdAt: string;
  readonly body: string;
  /** The value when the assessor wrote the comment; the value now is the field's own `value`. */
  readonly valueCopy: { readonly value: unknown; readonly labels?: FieldLabels | null };
  readonly valueTruncated: boolean;
  /** Changes only at the end of the Lead's review; until then the thread shows `decision`. */
  readonly state: CommentState;
  /** Absent when the program never responded. */
  readonly response?: ThreadResponse;
  /** Every request with its answer, oldest first. */
  readonly clarifications: readonly CommentClarification[];
  /** The Lead's current decision; absent when none (kept after the end). */
  readonly decision?: LeadDecision;
  /**
   * This caller may decide it now. Already folds in the end of the review and a read-only view (`false` then): gate
   * every decision control on it alone, never combined with `writable`.
   */
  readonly decidable: boolean;
  /**
   * Exactly the decisions to offer: `[]` when not decidable, always for an ADMIN and after the end; `['escalate']`
   * while ANOTHER live comment on the field carries an `escalate`. Never add `agree_program` back (409).
   */
  readonly choices: readonly LeadDecisionKind[];
}

export interface AssessmentField {
  readonly key: string;
  readonly label: string;
  /** `unknown` under `other`. */
  readonly type: string;
  readonly mode: FieldMode;
  /** Only meaningful on an `assessed` field. */
  readonly core: boolean;
  /** Any JSON value; `null` when `notApplicable`. */
  readonly value: unknown;
  readonly labels: FieldLabels | null;
  /** Subfield key -> the list in `labels` its option ids belong to (e.g. `actor_type` -> `actor_types`). Absent when none. */
  readonly subfieldLists?: Readonly<Record<string, string>>;
  /** Always `false` on a `view` field. */
  readonly validated: boolean;
  readonly comments: readonly AssessmentComment[];
  readonly notApplicable: boolean;
  /** Reporting's help text for the field tooltip. Absent when the catalog has none, and always under `other`. */
  readonly description?: string;
  // Round 2 (absent on a step-1 server; read absent as the round-1 value noted on each).
  /** The key changed since round 1. Round 1: `false`. */
  readonly updated?: boolean;
  /** Takes a validation, comment or decision. Round 2: an Assessed core field only. Round 1: any Assessed field. */
  readonly actionable?: boolean;
  /** The stored mark, else the green carried from round 1: draw the check from it. Round 1: equals `validated`. */
  readonly effectiveValidated?: boolean;
  /** The green is the round-1 one, because the Lead stored nothing ("Green in round 1, unchanged"). Round 1: `false`. */
  readonly carried?: boolean;
  /** The round-1 thread of a core field. Round 1: `[]`. */
  readonly thread?: readonly ThreadItem[];
}

/** Key of the Theory of Change section: always sent complete, whatever the field configuration (FR-9). */
export const TOC_SECTION_KEY = 'theory_of_change';

export interface AssessmentSection {
  /** `theory_of_change` for the ToC group. */
  readonly key: string;
  readonly label: string;
  readonly fields: readonly AssessmentField[];
}

export interface AssessmentSummary {
  readonly status: AssessmentStatus;
  readonly assessedBy: Person | null;
  readonly finishedAt: string | null;
}

export interface AssessmentView {
  /** The membership's round: 1 for an assessor, 2 for a Lead Assessor (an ADMIN reads the latest). Absent = 1. */
  readonly round?: 1 | 2;
  readonly header: {
    readonly resultCode: number;
    readonly title: string | null;
    readonly program: ProgramRef;
    readonly resultType: KeyLabel;
    readonly timeline: { readonly id: number; readonly name: string };
    readonly step: { readonly position: number; readonly name: string } | null;
    readonly status: QaStatus;
  };
  readonly sections: readonly AssessmentSection[];
  /** Snapshot keys missing from the catalog, read only. */
  readonly other: readonly AssessmentField[];
  readonly writable: boolean;
  readonly readOnlyReason: AssessmentReadOnlyReason | null;
  /** `null` until the first write creates the assessment. */
  readonly assessment: AssessmentSummary | null;
}

// ── Writes (§ 6) ────────────────────────────────────────────────────────────

/** Send exactly one of `fieldKeys` and `all`. */
export type ValidationsBody =
  | { readonly validated: boolean; readonly fieldKeys: readonly string[] }
  | { readonly validated: boolean; readonly all: true };

/** Answer of `PUT …/validations` and `POST …/finish`. */
export interface ValidationSummary extends AssessmentSummary {
  /** Every row the assessment holds; empty when it does not exist yet. */
  readonly validations: readonly { readonly fieldKey: string; readonly validated: boolean }[];
  /** Round 2 only: the effective state of every core field (stored mark, else carried green), sorted by key. */
  readonly effectiveValidated?: readonly { readonly fieldKey: string; readonly validated: boolean }[];
}

/**
 * Answer of `PUT` and `DELETE …/assessment/decisions/:commentId`: the summary plus the decision as stored
 * (`null` after a clear). `status` tells whether the call ended the review; `effectiveValidated` is absent here.
 */
export interface DecisionResult extends ValidationSummary {
  readonly decision: LeadDecision | null;
}

// ── Quick comments (§ 7) ────────────────────────────────────────────────────

export interface QuickComment {
  readonly id: number;
  readonly body: string;
  readonly createdAt: string;
}

// ── Release outbox (§ 8, admin) ─────────────────────────────────────────────

export interface AssessmentRelease {
  readonly id: number;
  readonly timeline: { readonly id: number; readonly name: string };
  readonly resultCode: number;
  readonly outcome: 'qaed' | 'not_qaed';
  readonly status: 'pending' | 'sent' | 'refused';
  readonly attempts: number;
  /** On a refused row, Reporting's word (`not_found`, `other_phase`, `not_submitted`). */
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface ReleaseRetryResult {
  readonly attempted: number;
  readonly sent: number;
  readonly refused: number;
  /** Only claimed rows; call again until `attempted` is 0. */
  readonly stillPending: number;
}

// ── The program's responses, as the assessor reads them (P2-3911, `docs/sp-view/README.md`) ──

/** What a Science Program answered to a comment in step 2. */
export type ProgramResponseKind = 'accept' | 'accept_with_comment' | 'disagree' | 'request_clarification';

export interface ProgramResponse {
  readonly id: number;
  readonly kind: ProgramResponseKind;
  /** No text on a plain `accept`. */
  readonly body: string | null;
  readonly respondedBy: { readonly name: string; readonly email: string };
  readonly respondedAt: string;
}

export interface CommentClarification {
  /** Id of the `request_clarification` response it belongs to. */
  readonly requestId: number;
  readonly question: string;
  readonly requestedAt: string;
  /** The comment author's answer, or null while it is pending. */
  readonly answer: { readonly body: string; readonly answeredAt: string } | null;
}

/** One comment's thread with the program (`GET …/sp-responses`, `POST …/clarification-answer`). */
export interface CommentThread {
  readonly commentId: number;
  readonly fieldKey: string;
  readonly state: CommentState;
  /** The latest response, or null. */
  readonly response: ProgramResponse | null;
  /** Every response, oldest first (the latest included). */
  readonly history: readonly ProgramResponse[];
  readonly clarifications: readonly CommentClarification[];
  /**
   * The caller can answer the pending clarification now: they wrote the comment, can write on the timeline, the
   * comment is `clarification_requested` and the programs step is in progress (the checks of the answer POST).
   * Absent on a server older than 2026-11-19.
   */
  readonly answerable?: boolean;
}

// ── Error codes (§ 9.1) ─────────────────────────────────────────────────────

export const ASSESSMENT_ERROR = {
  /** The timeline does not exist or the caller is not on it (worklist and assessment routes). */
  TIMELINES_NOT_FOUND: 'TIMELINES_NOT_FOUND',
  NOT_FOUND: 'ASSESSMENT_NOT_FOUND',
  READ_ONLY: 'ASSESSMENT_READ_ONLY',
  STEP_CLOSED: 'ASSESSMENT_STEP_CLOSED',
  FINISHED: 'ASSESSMENT_FINISHED',
  NO_FIELD_CONFIG: 'ASSESSMENT_NO_FIELD_CONFIG',
  /** `ApiError.fieldKeys` names the core fields still to validate or comment on. */
  CORE_UNCOMMENTED: 'ASSESSMENT_CORE_UNCOMMENTED',
  NOT_COMMENT_AUTHOR: 'ASSESSMENT_NOT_COMMENT_AUTHOR',
  COMMENT_NOT_OPEN: 'ASSESSMENT_COMMENT_NOT_OPEN',
  /** The clarification was already answered, or the program responded again. */
  CLARIFICATION_NOT_PENDING: 'CLARIFICATION_NOT_PENDING',
  // Round 2 (Lead Assessor), all 409.
  /** A validation or comment on an Assessed field that is not core: context only for the Lead. */
  FIELD_NOT_CORE: 'ASSESSMENT_FIELD_NOT_CORE',
  /** Validating an escalated field, an agree on a field another comment escalated, or Check all with one escalated. */
  FIELD_ESCALATED: 'ASSESSMENT_FIELD_ESCALATED',
  /** Validating green a core field with an undecided round-1 comment; `ApiError.fieldKeys` names them. */
  CORE_COMMENT_UNDECIDED: 'ASSESSMENT_CORE_COMMENT_UNDECIDED',
  /** The comment is not decidable, or the choice is not in its `choices`. */
  DECISION_INVALID: 'ASSESSMENT_DECISION_INVALID',
  /** Finish with grey core fields and no `escalate` on them; `ApiError.fieldKeys` names them. */
  CORE_UNDECIDED: 'ASSESSMENT_CORE_UNDECIDED',
  /** The Lead's own comment (withdraw it), one already deleted or withdrawn, or one the program answered. */
  COMMENT_NOT_DELETABLE: 'ASSESSMENT_COMMENT_NOT_DELETABLE',
} as const;
