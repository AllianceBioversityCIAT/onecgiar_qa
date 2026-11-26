// @akili-spec assessment/step-1-assessment
import { RoleCode } from '../users/permissions.js';
import { pickDefaultTimeline } from './default-timeline.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import { TimelineNotFoundError } from '../admin-config/admin-config.errors.js';
import { nowInRome, QA_TIME_ZONE } from '../admin-config/rome-date.js';
import {
  TIMELINE_LOADS,
  type TimelineLoads,
} from '../admin-config/timelines/timeline-loads.js';
import type { TimelineKind } from '../database/drizzle/schema/timelines.js';
import { AuthorizationService } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { Permission } from '../users/permissions.js';
import { InvalidListQueryError } from '../users/users.errors.js';
import { QA_STATUS_LABELS, QA_STATUSES, type QaStatus } from './qa-status.js';
import {
  audienceStepState,
  currentStepPositionsOf,
  enabledReviewerRows,
  roleStepState,
  type StepTiming,
} from './role-steps.js';
import { reviewerAuthor, type ReviewerAuthor } from './assessment-view.js';
import { resolveAccess, writeDecision, type WorklistAccess } from './scope.js';
import {
  decodeWorklistCursor,
  encodeWorklistCursor,
} from './worklist-cursor.js';
import {
  WORKLIST_STORE,
  type SortDirection,
  type WorklistRecord,
  type WorklistSortKey,
  type WorklistStore,
} from './worklist.store.js';

export const DEFAULT_WORKLIST_LIMIT = 25;
export const MAX_WORKLIST_LIMIT = 100;

export interface WorklistTimelineOption {
  id: number;
  name: string;
  kind: TimelineKind;
  roles: string[];
  step: {
    position: number;
    name: string;
    opensAt: string;
    closesAt: string;
    state: string;
  } | null;
}

export interface WorklistTimelines {
  timelines: WorklistTimelineOption[];
  defaultTimelineId: number | null;
  timeZone: string;
}

export interface WorklistQuery {
  statuses?: readonly QaStatus[];
  programIds?: readonly number[];
  resultTypeKeys?: readonly string[];
  q?: string;
  sort?: WorklistSortKey;
  dir?: SortDirection;
  limit?: number;
  cursor?: string;
}

export interface WorklistRow {
  membershipId: number;
  resultCode: number;
  title: string | null;
  /** FR-6: a round-2 re-entry with changed fields; the keys never leave the store (DD-11). */
  updated: boolean;
  program: { id: number; code: string; name: string };
  resultType: { key: string; label: string };
  comments: number;
  /** P2-3911: non-withdrawn comments the Science Program accepted, accepted with a comment, or disagreed with. */
  answeredBySp: number;
  /** `admin: true` when a QA Admin ended it acting as the role (admin/acts-as-reviewer R4). */
  assessedBy: ReviewerAuthor | null;
  status: QaStatus | null;
  canOpen: boolean;
  readOnlyReason: string | null;
}

export interface WorklistCounters {
  /** QA status `pending`. */
  pending: number;
  /** `quality_assessed`, `returned_to_program` and `clarification_requested`. */
  finished: number;
  /** Every membership of the scope, Auto-validated included (F-010); filters ignored. */
  total: number;
  /** F-010: the Auto-validated memberships among `total` (not assessed, never pending nor finished). */
  autoValidated: number;
}

export interface WorklistPage {
  rows: WorklistRow[];
  nextCursor: string | null;
  counters: WorklistCounters;
  writable: boolean;
  /** FR-1: the caller is assigned but no enabled role of theirs has a worklist. */
  noActiveRole: boolean;
}

export interface WorklistOptions {
  programs: Array<{ id: number; code: string; name: string }>;
  resultTypes: Array<{ key: string; label: string }>;
  statuses: Array<{ key: QaStatus; label: string }>;
}

const FINISHED_STATUSES: readonly QaStatus[] = [
  'quality_assessed',
  'returned_to_program',
  'clarification_requested',
  // Round-2 FR-14: the Lead's review has ended.
  'pending_tpb_review',
  // P2-3916: the TPB's review has ended too.
  'pending_ppu',
  // P2-3917: so has an Unresolved one's (only the PPU's work is left).
  'unresolved',
];

/**
 * P2-3916 (FR-2): a TPB's counters. Its work is the results Pending for TPB
 * review; it has finished one once it ends Quality Assessed or Pending PPU.
 */
const TPB_PENDING_STATUSES: readonly QaStatus[] = ['pending_tpb_review'];
const TPB_FINISHED_STATUSES: readonly QaStatus[] = [
  'quality_assessed',
  'pending_ppu',
  'unresolved',
];

/**
 * P2-3917 (FR-10): a PPU's counters. Its work is Pending PPU and Unresolved;
 * it has finished a result once it ends Quality Assessed.
 */
const PPU_PENDING_STATUSES: readonly QaStatus[] = ['pending_ppu', 'unresolved'];
const PPU_FINISHED_STATUSES: readonly QaStatus[] = ['quality_assessed'];

@Injectable()
export class WorklistService {
  constructor(
    @Inject(WORKLIST_STORE) private readonly store: WorklistStore,
    @Inject(TIMELINE_LOADS) private readonly loads: TimelineLoads,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    private readonly authorization: AuthorizationService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /**
   * FR-3: the timelines of the active cycle the caller may read a worklist
   * from (ADMIN: all; otherwise those with an enabled reviewer row), and the
   * default (the official one, else the earliest step-1 opening). Two
   * statements: the timelines, then which of them hold a load.
   */
  async timelines(user: AuthenticatedUser): Promise<WorklistTimelines> {
    const all = await this.store.findTimelines(user.id);
    const admin = this.authorization.can(user, Permission.ADMIN_ACCESS);
    const offered = all
      .map((timeline) => ({
        timeline,
        access: resolveAccess(user, timeline.roleCodes, admin),
      }))
      .filter(({ access }) => admin || access.reviewerRows.length > 0);
    const withLoad =
      offered.length === 0
        ? new Set<number>()
        : await this.loads.withLoad(offered.map(({ timeline }) => timeline.id));
    const now = nowInRome(this.clock());

    const options = offered.map(({ timeline, access }) => {
      const timing: StepTiming = {
        steps: timeline.steps,
        now,
        hasLoad: withLoad.has(timeline.id),
      };
      const audience =
        access.reviewerRows[0]?.audience ??
        enabledReviewerRows()[0]?.audience ??
        null;
      const step = timeline.steps.find((s) => s.audience === audience);
      const roleRow = enabledReviewerRows().find(
        (row) => row.audience === audience,
      );
      const state =
        step === undefined || roleRow === undefined
          ? null
          : roleStepState(roleRow, timing);
      const option: WorklistTimelineOption = {
        id: timeline.id,
        name: timeline.name,
        kind: timeline.kind,
        roles: [
          ...access.reviewerRows.map((row) => row.role as string),
          ...(admin ? ['ADMIN'] : []),
        ],
        step:
          step === undefined || state === null
            ? null
            : {
                position: step.position,
                name: step.name,
                opensAt: step.opensAt,
                closesAt: step.closesAt,
                state: state.state,
              },
      };
      return { option, opensAt: timeline.steps[0]?.opensAt ?? '' };
    });
    options.sort(
      (a, b) =>
        (a.opensAt < b.opensAt ? -1 : a.opensAt > b.opensAt ? 1 : 0) ||
        a.option.id - b.option.id,
    );
    const timelines = options.map(({ option }) => option);
    return {
      timelines,
      defaultTimelineId: pickDefaultTimeline(timelines),
      timeZone: QA_TIME_ZONE,
    };
  }

  /**
   * FR-1, FR-3..FR-7, FR-19: one page of the worklist. Statements: the
   * timeline and the caller's rows, whether it holds a load, the page, the
   * counters; four, whatever the page or the size (NFR-1). Nothing is counted
   * or fetched per row.
   */
  async list(
    user: AuthenticatedUser,
    timelineId: number,
    query: WorklistQuery = {},
  ): Promise<WorklistPage> {
    const sort = query.sort ?? 'code';
    const dir = query.dir ?? 'asc';
    const limit = query.limit ?? DEFAULT_WORKLIST_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WORKLIST_LIMIT) {
      throw new InvalidListQueryError('limit');
    }
    const cursor =
      query.cursor === undefined
        ? null
        : decodeWorklistCursor(query.cursor, { sort, dir });

    const { timeline, admin, access } = await this.offered(user, timelineId);
    if (!admin && access.reviewerRows.length === 0) {
      // Assigned, but no enabled role with a live grant (FR-1): empty, not 403.
      return {
        rows: [],
        nextCursor: null,
        counters: { pending: 0, finished: 0, total: 0, autoValidated: 0 },
        writable: false,
        noActiveRole: true,
      };
    }

    const hasLoad = (await this.loads.withLoad([timeline.id])).has(timeline.id);
    const timing: StepTiming = {
      steps: timeline.steps,
      now: nowInRome(this.clock()),
      hasLoad,
    };
    const [programs, resultTypes] = await Promise.all([
      this.catalog.listSciencePrograms(),
      this.catalog.listResultTypes(),
    ]);
    const programOrder = [...programs]
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
          a.id - b.id,
      )
      .map((program) => program.id);
    const resultTypeOrder = [...resultTypes]
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
          a.key.localeCompare(b.key),
      )
      .map((type) => type.key);

    const statuses = query.statuses ?? [];
    const scope = {
      timelineId: timeline.id,
      userId: user.id,
      access,
      ...currentStepPositionsOf(timeline.steps),
      clarificationWindowOpen:
        audienceStepState('programs', timing) === 'in_progress',
      // P2-3917 (DD-P5): Pending PPU reads Unresolved once step 5 is closed.
      ppuStepClosed: audienceStepState('ppu', timing) === 'closed',
      // FR-4 as amended by F-010: listed with no status filter; a status filter
      // that does not name it leaves it out like any other status.
      hideAutoValidated:
        statuses.length > 0 && !statuses.includes('auto_validated'),
    };
    const q = query.q?.trim();
    const [records, groups] = await Promise.all([
      this.store.findPage({
        ...scope,
        filters: {
          statuses,
          programIds: query.programIds ?? [],
          resultTypeKeys: query.resultTypeKeys ?? [],
          q: q ? q : null,
        },
        sort: { key: sort, dir, programOrder, resultTypeOrder },
        after:
          cursor === null
            ? null
            : {
                value: cursor.v,
                resultCode: cursor.c,
                membershipId: cursor.i,
              },
        take: limit + 1,
      }),
      // F-010: the counters ignore the filters, Auto-validated included.
      this.store.countByStatus({ ...scope, hideAutoValidated: false }),
    ]);

    const page = records.slice(0, limit);
    // P2-3916: a caller whose only rows are TPB rows counts its own work (an Admin keeps the general counters).
    const tpbOnly =
      !admin &&
      access.reviewerRows.length > 0 &&
      access.reviewerRows.every((row) => row.role === RoleCode.TPB);
    // P2-3917: likewise for a PPU.
    const ppuOnly =
      !admin &&
      access.reviewerRows.length > 0 &&
      access.reviewerRows.every((row) => row.role === RoleCode.PPU);
    const last = page[page.length - 1];
    const programById = new Map(programs.map((p) => [p.id, p]));
    const typeByKey = new Map(resultTypes.map((t) => [t.key, t]));
    const sum = (wanted: readonly (QaStatus | null)[]) =>
      groups
        .filter((group) => wanted.includes(group.status))
        .reduce((total, group) => total + group.count, 0);
    return {
      rows: page.map((record) =>
        this.toRow(record, access, timing, programById, typeByKey),
      ),
      nextCursor:
        records.length > limit && last !== undefined
          ? encodeWorklistCursor({
              s: sort,
              d: dir,
              v: last.sortValue,
              c: last.resultCode,
              i: last.membershipId,
            })
          : null,
      counters: {
        pending: sum(
          ppuOnly
            ? PPU_PENDING_STATUSES
            : tpbOnly
              ? TPB_PENDING_STATUSES
              : ['pending'],
        ),
        finished: sum(
          ppuOnly
            ? PPU_FINISHED_STATUSES
            : tpbOnly
              ? TPB_FINISHED_STATUSES
              : FINISHED_STATUSES,
        ),
        total: groups.reduce((total, group) => total + group.count, 0),
        autoValidated: sum(['auto_validated']),
      },
      writable: access.reviewerRows.some((row) =>
        enabledReviewerRows().some(
          (candidate) =>
            candidate.role === row.role &&
            roleStepState(candidate, timing)?.state === 'in_progress',
        ),
      ),
      noActiveRole: false,
    };
  }

  /**
   * The filter options of the worklist (FR-4): the programs and result types
   * inside the caller's scope, and every status. Scope only, no row is read:
   * the catalog lookups, no per-row work. An assigned caller with no enabled
   * role gets empty lists, like the page.
   */
  async options(
    user: AuthenticatedUser,
    timelineId: number,
  ): Promise<WorklistOptions> {
    const { admin, access } = await this.offered(user, timelineId);
    const [programs, resultTypes] = await Promise.all([
      this.catalog.listSciencePrograms(),
      this.catalog.listResultTypes(),
    ]);
    const rows = access.reviewerRows;
    if (!admin && rows.length === 0) {
      return { programs: [], resultTypes: [], statuses: [] };
    }
    const programAllowed = (id: number) =>
      admin ||
      rows.some((row) =>
        row.programs.mode === 'all'
          ? !row.programs.excluded.includes(id)
          : row.programs.ids.includes(id),
      );
    const typeAllowed = (key: string) =>
      admin ||
      rows.some(
        (row) => row.resultTypes === 'all' || row.resultTypes.includes(key),
      );
    return {
      programs: programs
        .filter((program) => programAllowed(program.id))
        .map(({ id, code, name }) => ({ id, code, name })),
      resultTypes: resultTypes
        .filter((type) => typeAllowed(type.key))
        .map((type) => ({ key: type.key, label: type.name })),
      statuses: QA_STATUSES.map((key) => ({
        key,
        label: QA_STATUS_LABELS[key],
      })),
    };
  }

  /** FR-3: the timeline when it is offered to the caller (ADMIN: any of the active cycle; otherwise one they are assigned to), else the 404. */
  private async offered(user: AuthenticatedUser, timelineId: number) {
    const [timeline] = await this.store.findTimelines(user.id, timelineId);
    if (!timeline) throw new TimelineNotFoundError(timelineId);
    const admin = this.authorization.can(user, Permission.ADMIN_ACCESS);
    // No assignment and no admin right: the timeline is not offered (FR-3).
    if (!admin && timeline.roleCodes.length === 0) {
      throw new TimelineNotFoundError(timelineId);
    }
    return {
      timeline,
      admin,
      access: resolveAccess(user, timeline.roleCodes, admin),
    };
  }

  private toRow(
    record: WorklistRecord,
    access: WorklistAccess,
    timing: StepTiming,
    programs: Map<number, { id: number; code: string; name: string }>,
    types: Map<string, { key: string; name: string }>,
  ): WorklistRow {
    const program = programs.get(record.programId);
    const decision = writeDecision(
      access,
      {
        resultType: record.resultTypeKey,
        programId: record.programId,
        round: record.round,
        status: record.membershipStatus,
        ended: record.ended,
        endReason: record.endReason,
        leadEscalated: record.leadEscalated,
        tpbEscalated: record.tpbEscalated,
      },
      timing,
    );
    return {
      membershipId: record.membershipId,
      resultCode: record.resultCode,
      title: record.title,
      updated: record.updated,
      program: {
        id: record.programId,
        code: program?.code ?? String(record.programId),
        name: program?.name ?? String(record.programId),
      },
      resultType: {
        key: record.resultTypeKey,
        label: types.get(record.resultTypeKey)?.name ?? record.resultTypeKey,
      },
      comments: record.comments,
      answeredBySp: record.answeredBySp,
      assessedBy:
        record.assessedById === null
          ? null
          : reviewerAuthor(
              record.assessedById,
              record.assessedByNickname,
              record.assessedByAdmin,
            ),
      status: record.status,
      canOpen: true,
      readOnlyReason: decision.writable ? null : decision.reason,
    };
  }
}
