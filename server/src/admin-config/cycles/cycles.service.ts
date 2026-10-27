import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.store.js';
import { FieldValidationError } from '../../users/users.errors.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';
import type {
  AdminConfigAction,
  AdminConfigContext,
} from '../admin-config.context.js';
import {
  CycleActivationBusyError,
  CycleNotDraftError,
  CycleNotFoundError,
  CycleYearTakenError,
} from '../admin-config.errors.js';
import { toCycleView, type CycleView } from './cycle-view.js';
import { CYCLE_YEAR_MAX, CYCLE_YEAR_MIN } from './dto/create-cycle.dto.js';
import { CYCLES_STORE, type CyclesStore } from './cycles.store.js';
import {
  CYCLES_UNIT_OF_WORK,
  type CyclesUnitOfWork,
} from './cycles.unit-of-work.js';

/** What a write answers: the cycle it touched. The controller reads the view after the commit. */
export interface CycleChange {
  cycleId: number;
}

/** The year as the client sent it; the pipe judges the shape, the service re-checks it (FR-1). */
export interface CreateCycleCommand {
  year: unknown;
}

/**
 * Attempts of one activation. The lock order serializes activations only on
 * an active row; with none active they are not serialized, and
 * `uq_cycles_active_key` refuses the loser with 1062 (design 7.3, NFR-3), or
 * InnoDB picks it as a deadlock victim (1213). The loser rolls back fully and
 * starts over from the committed state, where it finds the winner's cycle
 * active and closes it (the serial outcome). A retry can be refused again, by
 * a third activation committing meanwhile: on TEST, 5 concurrent activations
 * with one retry answered 4 times 200 and once 500. Ten attempts make an
 * exhausted request a sign of sustained contention, answered 503
 * `SERVICE_UNAVAILABLE` (retryable) instead of a 500. No wait between
 * attempts: each one starts with a locking read that already waits for the
 * transactions it conflicts with.
 */
const ACTIVATION_ATTEMPTS = 10;

const ACTIVE_KEY = 'uq_cycles_active_key';

/**
 * True when `error` (or a `cause` up to two levels down, where the query
 * builder wraps the driver error) is a refusal that a new attempt can resolve:
 * MySQL 1062 on `uq_cycles_active_key` (named in the driver message), or 1213
 * `ER_LOCK_DEADLOCK`. A 1062 on any other key is a different problem and is
 * not retried.
 */
function isActivationRace(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno } = current as Error & {
      code?: unknown;
      errno?: unknown;
    };
    if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) return true;
    if (
      (code === 'ER_DUP_ENTRY' || errno === 1062) &&
      current.message.includes(ACTIVE_KEY)
    ) {
      return true;
    }
  }
  return false;
}

/** FR-1: a missing, non-integer or out-of-range year is a 400 naming `year`. */
function validYear(year: unknown): number {
  if (year === undefined || year === null) {
    throw new FieldValidationError([{ field: 'year', code: 'REQUIRED' }]);
  }
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    throw new FieldValidationError([{ field: 'year', code: 'INVALID_TYPE' }]);
  }
  if (year < CYCLE_YEAR_MIN || year > CYCLE_YEAR_MAX) {
    throw new FieldValidationError([{ field: 'year', code: 'OUT_OF_RANGE' }]);
  }
  return year;
}

/**
 * Cycles: create, list, activate (cycle-timelines FR-1…FR-3, design 7.3).
 * Every write runs in `CYCLES_UNIT_OF_WORK` and logs one decision line.
 */
@Injectable()
export class CyclesService {
  private readonly logger = new Logger(CyclesService.name);

  constructor(
    @Inject(CYCLES_UNIT_OF_WORK) private readonly unitOfWork: CyclesUnitOfWork,
    @Inject(CYCLES_STORE) private readonly store: CyclesStore,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /** FR-2: every cycle, newest year first, in one grouped read (design 7.4). */
  async list(): Promise<CycleView[]> {
    return (await this.store.listSummaries()).map(toCycleView);
  }

  async get(id: number): Promise<CycleView> {
    const row = await this.store.findSummary(id);
    if (!row) throw new CycleNotFoundError(id);
    return toCycleView(row);
  }

  /**
   * FR-1: a new cycle starts as `draft` and never becomes active by being
   * created. The unique `year` is the arbiter of a duplicate, also when two
   * creates arrive together: one inserts, the other gets 1062 and is refused.
   */
  create(
    ctx: AdminConfigContext,
    command: CreateCycleCommand,
  ): Promise<CycleChange> {
    return this.logged(
      'cycle_create',
      ctx,
      null,
      async () => {
        const year = validYear(command.year);
        const createdAt = this.clock();
        return this.unitOfWork.run(async ({ cycles, idempotency }) => {
          const outcome = await cycles.insert({
            year,
            status: 'draft',
            createdAt,
            createdBy: ctx.actorId,
          });
          if (outcome.kind === 'duplicate') throw new CycleYearTakenError();
          await this.markExecuted(idempotency, ctx, outcome.cycle.id);
          return { cycleId: outcome.cycle.id };
        });
      },
      (result) => result.cycleId,
    );
  }

  // @akili-spec admin-config/cycle-timelines
  /**
   * FR-3: the draft becomes the active cycle and the previous active one
   * becomes `closed`, in one transaction (S-5). Lock order (DD-9, design 7.3):
   * the target `FOR UPDATE` (missing: 404, not a draft: 409), then the active
   * row `FOR UPDATE`, then close the old row and only then activate the target,
   * so `uq_cycles_active_key` never fires on the way and a reader never sees
   * two active cycles or none.
   */
  activate(ctx: AdminConfigContext, cycleId: number): Promise<CycleChange> {
    return this.logged('cycle_activate', ctx, cycleId, async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await this.activateOnce(ctx, cycleId);
        } catch (error) {
          // A concurrent activation won the race: start over from the
          // committed state (see ACTIVATION_ATTEMPTS).
          if (!isActivationRace(error)) throw error;
          if (attempt >= ACTIVATION_ATTEMPTS) {
            throw new CycleActivationBusyError(error);
          }
        }
      }
    });
  }

  // @akili-spec admin-config/cycle-timelines
  private activateOnce(
    ctx: AdminConfigContext,
    cycleId: number,
  ): Promise<CycleChange> {
    return this.unitOfWork.run(async ({ cycles }) => {
      const target = await cycles.findById(cycleId, { forUpdate: true });
      if (!target) throw new CycleNotFoundError(cycleId);
      if (target.status !== 'draft') throw new CycleNotDraftError();

      const change = { by: ctx.actorId, at: this.clock() };
      const current = await cycles.findActive({ forUpdate: true });
      if (current) await cycles.markClosed(current.id, change);
      await cycles.markActive(target.id, change);
      return { cycleId: target.id };
    });
  }

  /**
   * The exactly-once fence (P-1): `in_progress` -> `executed` for a keyed
   * request, in the business transaction, so the mark commits with the cycle.
   * It throws `IdempotencyFenceLostError` when a take-over got the key first.
   * No handle (no `Idempotency-Key`) = nothing to mark.
   */
  private async markExecuted(
    idempotency: Pick<IdempotencyStore, 'markExecuted'>,
    ctx: AdminConfigContext,
    cycleId: number,
  ): Promise<void> {
    if (ctx.idempotency === undefined) return;
    await idempotency.markExecuted(ctx.idempotency.reservation, cycleId);
  }

  /**
   * One decision line per write, success or refusal (design 7.6, NFR-7):
   * event, action, target id, actor id, outcome, a reason code on a refusal,
   * request id. Never a year, a name or any other part of the body.
   */
  private async logged<T>(
    action: AdminConfigAction,
    ctx: AdminConfigContext,
    targetId: number | null,
    work: () => Promise<T>,
    targetOf: (result: T) => number | null = () => targetId,
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
        targetId,
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
