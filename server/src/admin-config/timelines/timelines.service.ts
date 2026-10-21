import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.store.js';
import type {
  Timeline,
  TimelineKind,
} from '../../database/drizzle/schema/timelines.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { isLiveAssignment } from '../../users/current-user.cache.js';
import { UserNotFoundError } from '../../users/users.errors.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';
import type {
  AdminConfigAction,
  AdminConfigContext,
} from '../admin-config.context.js';
import {
  CycleClosedError,
  CycleNotFoundError,
  TimelineAssignmentNotFoundError,
  TimelineNameTakenError,
  TimelineNotFoundError,
  TimelineUserNotEligibleError,
  TimelineValidationError,
} from '../admin-config.errors.js';
import { todayInRome } from '../rome-date.js';
import {
  DEFAULT_STEPS,
  type DefaultStep,
  type StepAudience,
} from './default-steps.js';
import { TIMELINE_LOADS, type TimelineLoads } from './timeline-loads.js';
import {
  toTimelineResponse,
  toTimelineUserResponse,
  type AssignableRole,
  type TimelineDetailResponse,
  type TimelineResponse,
  type TimelineUserResponse,
} from './timeline-response.js';
import {
  validateTimelineCreate,
  type TimelineCreateInput,
} from './timeline-rules.js';
import {
  TIMELINES_STORE,
  type TimelineInsertOutcome,
  type TimelinesStore,
} from './timelines.store.js';
import {
  TIMELINES_UNIT_OF_WORK,
  type TimelinesUnitOfWork,
} from './timelines.unit-of-work.js';

/** What a write answers: the timeline it touched. The controller reads the model after the commit. */
export interface TimelineChange {
  timelineId: number;
}

/** The request as the pipe left it: the shape is right, the rules are not yet judged. */
export type CreateTimelineCommand = TimelineCreateInput;

/** The body of an assign, as the pipe left it: the role is one of the four. */
export interface AssignUserCommand {
  userId: number;
  role: AssignableRole;
}

/** What an assign answers: the assignment, and whether this request created it (201) or found it (200). */
export interface AssignResult {
  created: boolean;
  assignment: TimelineUserResponse;
}

/** A create request once cleaned: both scope lists are lists, whatever the client sent. */
type NormalizedCreate = Omit<
  TimelineCreateInput,
  'programIds' | 'resultTypeKeys'
> & { programIds: number[]; resultTypeKeys: string[] };

/**
 * The clean copy a create writes: trimmed texts, each id or key once (a set,
 * not a list). A scope list the client left out (absent or null; the pipe lets
 * it through, design 7.2) is the empty list, which the rules refuse unless the
 * request says "all".
 */
function normalized(command: CreateTimelineCommand): NormalizedCreate {
  return {
    ...command,
    name: command.name.trim(),
    programIds: [...new Set(command.programIds ?? [])],
    resultTypeKeys: [...new Set(command.resultTypeKeys ?? [])],
    steps: command.steps.map((step) => ({ ...step, name: step.name.trim() })),
  };
}

/** After the rules ran a date is a real date string; the type cannot know it. */
const asDate = (value: string | null | undefined): string => value as string;

/**
 * A copy cut to the whole second. `timeline_users.assigned_at` is a `datetime`
 * without fractions, so MySQL would round a millisecond value on its own; cut
 * here, the value inserted, the value the first answer carries and the value
 * every later read gives are the same one.
 */
function wholeSecond(date: Date): Date {
  const cut = new Date(date);
  cut.setUTCMilliseconds(0);
  return cut;
}

/**
 * Timelines: the default steps and the create (cycle-timelines FR-4 to FR-6,
 * FR-11, FR-17; design 6, 7.2, 7.3). The create runs in
 * `TIMELINES_UNIT_OF_WORK` and logs one decision line.
 */
@Injectable()
export class TimelinesService {
  private readonly logger = new Logger(TimelinesService.name);

  constructor(
    @Inject(TIMELINES_UNIT_OF_WORK)
    private readonly unitOfWork: TimelinesUnitOfWork,
    @Inject(TIMELINES_STORE) private readonly store: TimelinesStore,
    @Inject(CatalogService) private readonly catalogs: CatalogService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Inject(TIMELINE_LOADS) private readonly loads: TimelineLoads,
  ) {}

  /** FR-4: the steps every client proposes for a new timeline. */
  defaultSteps(): DefaultStep[] {
    return DEFAULT_STEPS.map((step) => ({ ...step }));
  }

  /** One timeline as the API shows it, with status and readiness from today in Rome (FR-12). */
  async get(id: number): Promise<TimelineResponse> {
    const row = await this.store.findById(id);
    if (!row) throw new TimelineNotFoundError(id);
    const [response] = await this.respond([row]);
    return response;
  }

  /**
   * FR-12: `Timeline` plus its active assignments joined with `users` (design
   * 7.4): one more statement than `get`, whatever the number of users. The
   * counts and readiness of `get` come from the same active rows (FR-13).
   */
  async detail(id: number): Promise<TimelineDetailResponse> {
    const [timeline, assigned] = await Promise.all([
      this.get(id),
      this.store.listActiveAssignments(id),
    ]);
    return { ...timeline, users: assigned.map(toTimelineUserResponse) };
  }

  /**
   * FR-12: the timelines of a cycle, the official one first and then the
   * additional ones newest first. A fixed number of statements however many
   * timelines there are (NFR-5, design 7.4); nothing is written or locked (DD-2).
   */
  async listByCycle(cycleId: number): Promise<TimelineResponse[]> {
    if (!(await this.store.cycleExists(cycleId))) {
      throw new CycleNotFoundError(cycleId);
    }
    const rows = await this.store.listByCycle(cycleId);
    return this.respond(
      [...rows].sort(
        (a, b) =>
          Number(b.kind === 'official') - Number(a.kind === 'official') ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id - a.id,
      ),
    );
  }

  /** The read models of these timelines, in this order: one statement per table, whatever the count. */
  private async respond(rows: Timeline[]): Promise<TimelineResponse[]> {
    if (rows.length === 0) return [];
    const today = todayInRome(this.clock());
    const ids = rows.map((row) => row.id);
    const [steps, programs, resultTypes, assigned, loaded] = await Promise.all([
      this.store.listSteps(ids),
      this.store.listPrograms(ids),
      this.store.listResultTypes(ids),
      this.store.countAssigned(ids),
      // One batched call for every timeline: the hold needs it (timeline-edit
      // FR-6, design 7.4), and the list stays a fixed number of queries (NFR-5).
      this.loads.withLoad(ids),
    ]);
    return rows.map((timeline) => {
      const counts: Partial<Record<AssignableRole, number>> = {};
      for (const row of assigned) {
        if (row.timelineId === timeline.id) {
          counts[row.roleCode as AssignableRole] = row.count;
        }
      }
      return toTimelineResponse(
        {
          timeline,
          steps: steps.filter((r) => r.timelineId === timeline.id),
          programIds: programs
            .filter((r) => r.timelineId === timeline.id)
            .map((r) => r.programId),
          resultTypeKeys: resultTypes
            .filter((r) => r.timelineId === timeline.id)
            .map((r) => r.resultTypeKey),
        },
        today,
        counts,
        loaded.has(timeline.id),
      );
    });
  }

  // @akili-spec admin-config/cycle-timelines
  /**
   * FR-5, FR-6, FR-11: a timeline in a `draft` or `active` cycle. The server
   * decides official or additional; the client never does. Order (design 7.2,
   * 7.3): every rule first, over both catalogs, BEFORE any transaction opens,
   * so a refusal writes nothing and lists every problem at once. Then one
   * transaction: the cycle `FOR UPDATE` (missing 404, closed 409), the kind,
   * the timeline, its scope, its steps, the idempotency mark.
   */
  create(
    ctx: AdminConfigContext,
    cycleId: number,
    command: CreateTimelineCommand,
  ): Promise<TimelineChange> {
    return this.logged(
      'timeline_create',
      ctx,
      async () => {
        const now = this.clock();
        const request = normalized(command);
        await this.assertValid(request, todayInRome(now));
        return this.unitOfWork.run(
          async ({ cycles, timelines, idempotency }) => {
            const cycle = await cycles.findById(cycleId, { forUpdate: true });
            if (!cycle) throw new CycleNotFoundError(cycleId);
            if (cycle.status === 'closed') throw new CycleClosedError();

            // @akili-spec admin-config/cycle-timelines
            // The kind is decided HERE, under the cycle lock (DD-3): creates in
            // one cycle serialize on that row, so the first sees no official and
            // the second sees the first's. Read before the lock, two creates
            // would both pick `official`.
            const kind: TimelineKind = (await timelines.hasOfficial(cycleId))
              ? 'additional'
              : 'official';
            const header = {
              cycleId,
              name: request.name,
              allPrograms: request.allPrograms,
              allResultTypes: request.allResultTypes,
              createdAt: now,
              createdBy: ctx.actorId,
            };
            let outcome: TimelineInsertOutcome = await timelines.insert({
              ...header,
              kind,
            });
            // The backstop (`uq_timelines_official_key`) should not fire while
            // the cycle is locked; if it does, this is the additional one.
            if (outcome.kind === 'official_taken') {
              outcome = await timelines.insert({
                ...header,
                kind: 'additional',
              });
            }
            if (outcome.kind === 'name_taken')
              throw new TimelineNameTakenError();
            if (outcome.kind === 'official_taken') {
              throw new Error('An additional timeline was refused as official');
            }
            const { timelineId } = outcome;

            // Flag false <=> rows (DD-6); the rules refused any other mix.
            if (!request.allPrograms) {
              await timelines.insertPrograms(timelineId, request.programIds);
            }
            if (!request.allResultTypes) {
              await timelines.insertResultTypes(
                timelineId,
                request.resultTypeKeys,
              );
            }
            await timelines.insertSteps(
              timelineId,
              request.steps.map((step, index) => ({
                position: index + 1,
                name: step.name,
                // The rules refused any audience outside the enum.
                audience: step.audience as StepAudience,
                opensOn: asDate(step.opensOn),
                closesOn: asDate(step.closesOn),
                round: step.round,
                requiresLoad: step.requiresLoad,
              })),
            );
            await this.markExecuted(idempotency, ctx, timelineId);
            return { timelineId };
          },
        );
      },
      (result) => result.timelineId,
    );
  }

  // @akili-spec admin-config/cycle-timelines
  /**
   * FR-14, S-7: assign a user to a timeline in one of the four roles. Design
   * 7.3, in one transaction: the cycle `FOR SHARE` (missing timeline 404, closed
   * cycle 409), the user (unknown 404, inactive 409), her LIVE grants hold the
   * role (409 otherwise), then the insert. The user and her grants are read
   * through the unit of work, on the transaction's own connection: a read on
   * the pool would hold a second connection per assign. A 1062 on
   * `uq_timeline_users_active_key` is a repeat (DD-10): the existing active row
   * is the answer, `created: false`. There is no read-then-insert race to lose:
   * the database key decides. The clock is read once, to the whole second, so
   * the first answer and the repeat carry what the table stores (FR-14).
   */
  assign(
    ctx: AdminConfigContext,
    timelineId: number,
    command: AssignUserCommand,
  ): Promise<AssignResult> {
    return this.logged(
      'timeline_user_assign',
      ctx,
      () =>
        this.unitOfWork.run(async ({ timelines, users, grants }) => {
          const timeline = await timelines.findById(timelineId);
          if (!timeline) throw new TimelineNotFoundError(timelineId);
          await this.assertCycleOpen(timelines, timeline.cycleId);

          // @akili-spec admin-config/cycle-timelines
          // Eligibility: the user exists, is active, and holds a LIVE grant of
          // exactly this role (`isLiveAssignment`: not revoked, role active and
          // known). Holding some other role never qualifies.
          const user = await users.findById(command.userId);
          if (!user) throw new UserNotFoundError(command.userId);
          if (!user.isActive) {
            throw new TimelineUserNotEligibleError('user_inactive');
          }
          const held = await grants.findActiveViewsByUserId(user.id);
          if (
            !held.some(
              (grant) =>
                grant.roleCode === command.role && isLiveAssignment(grant),
            )
          ) {
            throw new TimelineUserNotEligibleError('role_not_held');
          }

          const roleId = await timelines.findRoleId(command.role);
          if (roleId === undefined) {
            throw new TimelineUserNotEligibleError('role_unknown');
          }
          // One read of the clock, whole seconds: the column keeps no fraction.
          const assignedAt = wholeSecond(this.clock());
          // A repeat finds the row that is there; if that row is removed between
          // the refusal and the read, the next insert simply wins.
          for (let attempt = 0; attempt < 2; attempt++) {
            const outcome = await timelines.insertAssignment({
              timelineId,
              userId: user.id,
              roleId,
              assignedAt,
              assignedBy: ctx.actorId,
            });
            let stored: { id: number; assignedAt: Date } | undefined;
            if (outcome.kind === 'created') {
              stored = { id: outcome.assignmentId, assignedAt };
            } else {
              stored = await timelines.findActiveAssignment(
                timelineId,
                user.id,
                roleId,
              );
            }
            if (stored === undefined) continue;
            return {
              created: outcome.kind === 'created',
              assignment: {
                assignmentId: stored.id,
                userId: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: command.role,
                assignedAt: stored.assignedAt,
              },
            };
          }
          throw new Error('An assignment refused as a duplicate was not found');
        }),
      (result) => result.assignment.assignmentId,
    );
  }

  // @akili-spec admin-config/cycle-timelines
  /**
   * FR-15: remove an assignment. The row is KEPT: `removed_at` and `removed_by`
   * are set where the id matches this timeline and the row is not removed yet.
   * Zero rows (unknown, another timeline's, or already removed) is 404, so two
   * removes at once give one 204 and one 404 (design 7.3).
   */
  async remove(
    ctx: AdminConfigContext,
    timelineId: number,
    assignmentId: number,
  ): Promise<void> {
    await this.logged(
      'timeline_user_remove',
      ctx,
      () =>
        this.unitOfWork.run(async ({ timelines }) => {
          const timeline = await timelines.findById(timelineId);
          if (!timeline) throw new TimelineNotFoundError(timelineId);
          await this.assertCycleOpen(timelines, timeline.cycleId);
          const removed = await timelines.removeAssignment({
            timelineId,
            assignmentId,
            removedAt: this.clock(),
            removedBy: ctx.actorId,
          });
          if (!removed) throw new TimelineAssignmentNotFoundError(assignmentId);
          return assignmentId;
        }),
      (id) => id,
    );
  }

  /** The cycle row held shared until the transaction ends; a closed cycle takes no assignment change (FR-14, FR-15). */
  private async assertCycleOpen(
    timelines: Pick<TimelinesStore, 'lockCycleShared'>,
    cycleId: number,
  ): Promise<void> {
    const status = await timelines.lockCycleShared(cycleId);
    if (status === undefined) throw new CycleNotFoundError(cycleId);
    if (status === 'closed') throw new CycleClosedError();
  }

  /**
   * Every rule a request breaks, or nothing (FR-11). A catalog is read only
   * when the request needs it to check an explicit list (FR-6); one that cannot
   * be read is a 503 (`UpstreamUnavailableError`) before any rule is judged.
   */
  private async assertValid(
    request: NormalizedCreate,
    today: string,
  ): Promise<void> {
    const knownProgramIds = new Set<number>();
    if (!request.allPrograms && request.programIds.length > 0) {
      for (const program of await this.catalogs.listSciencePrograms()) {
        knownProgramIds.add(program.id);
      }
    }
    const knownResultTypeKeys = new Set<string>();
    if (!request.allResultTypes && request.resultTypeKeys.length > 0) {
      for (const type of await this.catalogs.listResultTypes()) {
        knownResultTypeKeys.add(type.key);
      }
    }
    const issues = validateTimelineCreate(request, {
      today,
      knownProgramIds,
      knownResultTypeKeys,
    });
    if (issues.length > 0) throw new TimelineValidationError(issues);
  }

  /**
   * The exactly-once fence (P-1): `in_progress` -> `executed` for a keyed
   * request, in the business transaction, so the mark commits with the
   * timeline. It throws `IdempotencyFenceLostError` when a take-over got the
   * key first. No handle (no `Idempotency-Key`) = nothing to mark.
   */
  private async markExecuted(
    idempotency: Pick<IdempotencyStore, 'markExecuted'>,
    ctx: AdminConfigContext,
    timelineId: number,
  ): Promise<void> {
    if (ctx.idempotency === undefined) return;
    await idempotency.markExecuted(ctx.idempotency.reservation, timelineId);
  }

  /**
   * One decision line per write, success or refusal (design 7.6, NFR-7):
   * event, action, target id, actor id, outcome, a reason code on a refusal,
   * request id. Never a name, a scope or any other part of the body. The target
   * is the timeline, so a refusal has none.
   */
  private async logged<T>(
    action: AdminConfigAction,
    ctx: AdminConfigContext,
    work: () => Promise<T>,
    targetOf: (result: T) => number,
  ): Promise<T> {
    try {
      const result = await work();
      this.logger.log(this.line(action, ctx, targetOf(result), 'ok'));
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const body =
        error instanceof HttpException
          ? (error.getResponse() as { code?: unknown })
          : {};
      const reason =
        typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)
          ? body.code
          : status < 500
            ? `http_${status}`
            : 'internal_error';
      const refused = status < 500;
      const line = this.line(
        action,
        ctx,
        null,
        refused ? 'refused' : 'error',
        reason,
      );
      if (refused) this.logger.warn(line);
      else this.logger.error(line);
      throw error;
    }
  }

  private line(
    action: AdminConfigAction,
    ctx: AdminConfigContext,
    targetId: number | null,
    outcome: 'ok' | 'refused' | 'error',
    reason?: string,
  ): string {
    return JSON.stringify({
      event: 'admin_config',
      action,
      targetId,
      actorId: ctx.actorId,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      requestId: ctx.requestId,
      // `none` | `taken_over`: the interceptor writes no line of its own for a
      // first or taken-over execution.
      idempotency: ctx.idempotency?.outcome ?? 'none',
    });
  }
}
