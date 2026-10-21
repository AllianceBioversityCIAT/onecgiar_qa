import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.store.js';
import type { TimelineKind } from '../../database/drizzle/schema/timelines.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
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
  TimelineNameTakenError,
  TimelineNotFoundError,
  TimelineValidationError,
} from '../admin-config.errors.js';
import { todayInRome } from '../rome-date.js';
import {
  DEFAULT_STEPS,
  type DefaultStep,
  type StepAudience,
} from './default-steps.js';
import {
  toTimelineResponse,
  type TimelineResponse,
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
  ) {}

  /** FR-4: the steps every client proposes for a new timeline. */
  defaultSteps(): DefaultStep[] {
    return DEFAULT_STEPS.map((step) => ({ ...step }));
  }

  /** One timeline as the API shows it, with status and readiness from today in Rome (FR-12). */
  async get(id: number): Promise<TimelineResponse> {
    const bundle = await this.store.findBundle(id);
    if (!bundle) throw new TimelineNotFoundError(id);
    return toTimelineResponse(bundle, todayInRome(this.clock()));
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
