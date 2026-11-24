import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  catchError,
  from,
  mergeMap,
  type Observable,
  of,
  throwError,
} from 'rxjs';
import {
  errorBody,
  FIELD_ERRORS,
  type FieldErrorCode,
} from '../error-codes.js';
import { errorFacts, toErrorBody } from '../http-exception.filter.js';
import { requestIdOf, type RequestWithId } from '../request-id.js';
import { requestFingerprint } from './fingerprint.js';
import {
  type IdempotencyHandle,
  setIdempotencyHandle,
} from './idempotency.context.js';
import {
  IdempotencyFenceLostError,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
} from './idempotency.errors.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
  type IdempotencyClock,
  type IdempotencyStore,
  type Reservation,
} from './idempotency.store.js';

export const IDEMPOTENCY_REPLAY_READER = Symbol('IDEMPOTENCY_REPLAY_READER');

/**
 * Port for the crash window of FR-2: a key left `executed` without a stored
 * answer (the process died between the commit and `complete`). The replay
 * answers the route's success status with this fresh read of the person the
 * change touched. The feature module binds it (users-admin: `UserDetail` of
 * `targetUserId`), so `common/` imports nothing from a feature (design 7,
 * Reserve). Any failure of the reader is a store failure: 503.
 */
export interface IdempotencyReplayReader {
  read(targetUserId: number): Promise<unknown>;
}

const KEY_HEADER = 'idempotency-key';
const KEY_FIELD = 'Idempotency-Key';
const REPLAYED_HEADER = 'Idempotency-Replayed';
const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^[A-Za-z0-9\-_.:]+$/;

type KeyedRequest = Request &
  RequestWithId & {
    /** Set by `AuthGuard` on every non-public route (P-1). */
    user?: { id?: unknown };
  };

interface LineFacts {
  actorId: number;
  requestId: string;
}

/** What the request got from the store before the handler may run. */
type Claim =
  | {
      kind: 'run';
      reservation: Reservation;
      outcome: IdempotencyHandle['outcome'];
    }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'reused' }
  | { kind: 'in_progress' };

/** `{ code, fields? }` of a remembered refusal: all the filter reads (P-3). */
interface StoredRefusal {
  code: string;
  fields?: unknown;
}

/** FR-6: why the header value is not a valid key, or `undefined` when it is. */
function keyProblem(raw: unknown): FieldErrorCode | undefined {
  // A repeated header reaches us joined with a comma, which no key contains.
  if (typeof raw !== 'string') return 'INVALID';
  if (raw === '') return 'REQUIRED';
  if (raw.length > MAX_KEY_LENGTH) return 'TOO_LONG';
  return KEY_PATTERN.test(raw) ? undefined : 'INVALID';
}

/**
 * DD-5: a deterministic refusal (4xx) is remembered; 5xx and anything unknown
 * is not. A lost fence is a 409 too, but it means another request owns the
 * key: it is never this key's answer.
 */
const isRefusal = (error: unknown): error is HttpException =>
  error instanceof HttpException &&
  !(error instanceof IdempotencyFenceLostError) &&
  error.getStatus() >= 400 &&
  error.getStatus() < 500;

/**
 * Route-scoped (`@Idempotent()`, DD-6): makes a write run at most once per
 * (admin, key) (design 3, 7). Guards run before it (P-1), so a 401/403 never
 * reserves a key; the global envelope wraps what it returns (P-2), so it sees
 * the handler's raw value and raw errors, and the filter renders a replayed
 * refusal from `{ code, fields }` and the status alone (P-3, P-4).
 *
 * - No header: untouched (FR-1).
 * - Reserve in its own short write, outside any business transaction. Any
 *   failure of the store, the purge or the replay reader answers 503 and the
 *   handler does not run: never a write without the guarantee (NFR-4).
 * - New key or taken-over lease: run the handler with the reservation on the
 *   request (`@CurrentIdempotency()`), then remember a 2xx answer or a 4xx
 *   refusal, and free the key on anything else (FR-2, DD-5).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(IDEMPOTENCY_CLOCK) private readonly clock: IdempotencyClock,
    @Inject(IDEMPOTENCY_REPLAY_READER)
    private readonly reader: IdempotencyReplayReader,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<KeyedRequest>();
    const response = http.getResponse<Response>();

    const raw = request.headers[KEY_HEADER];
    if (raw === undefined) return next.handle();

    const problem = keyProblem(raw);
    if (problem !== undefined) {
      throw new BadRequestException({
        ...errorBody('VALIDATION_FAILED'),
        fields: [
          {
            field: KEY_FIELD,
            code: problem,
            message: FIELD_ERRORS[problem](MAX_KEY_LENGTH),
          },
        ],
      });
    }
    const key = raw as string;

    // A keyed route is authenticated (P-1); without an admin there is no
    // scope to hold the key under, so refuse rather than run unguarded.
    const actorId = request.user?.id;
    if (typeof actorId !== 'number') throw new ServiceUnavailableException();
    const facts: LineFacts = { actorId, requestId: requestIdOf(request) };

    const fingerprint = requestFingerprint({
      method: request.method,
      // `originalUrl` keeps the global prefix and the ids and is the same on
      // every retry; the fingerprint drops the query string (design 7).
      path: request.originalUrl ?? request.url,
      body: request.body,
    });
    // Nest sets the route's success status before interceptors run.
    const routeStatus = response.statusCode;

    const claim = await this.storeCall(() =>
      this.claim(actorId, key, fingerprint, routeStatus),
    );

    switch (claim.kind) {
      case 'reused':
        this.decision('reused', 'refused', 422, facts);
        throw new IdempotencyKeyReusedError();
      case 'in_progress':
        this.decision('in_progress', 'refused', 409, facts);
        throw new IdempotencyInProgressError();
      case 'replay':
        return this.replay(claim, response, facts);
      case 'run':
        setIdempotencyHandle(request, {
          reservation: claim.reservation,
          outcome: claim.outcome,
        });
        return this.run(next, claim.reservation, response, facts);
    }
  }

  /** Reserve, or read what the key already holds (design 7, Reserve). */
  private async claim(
    actorId: number,
    key: string,
    fingerprint: string,
    routeStatus: number,
  ): Promise<Claim> {
    await this.store.purgeExpired();
    const reserved = await this.store.reserve({
      actorId,
      key,
      fingerprint,
      routeStatus,
    });
    if (reserved.kind === 'reserved') {
      return {
        kind: 'run',
        reservation: reserved.reservation,
        outcome: 'none',
      };
    }

    const { row } = reserved;
    if (row.fingerprint !== fingerprint) return { kind: 'reused' };
    if (row.state === 'completed') {
      return {
        kind: 'replay',
        status: row.responseStatus ?? row.routeStatus,
        body: row.responseBody,
      };
    }
    if (row.state === 'executed') {
      // The change committed, its answer was never stored (FR-2 crash clause).
      if (row.targetUserId === null) {
        throw new Error('Executed idempotency key without a target');
      }
      return {
        kind: 'replay',
        status: row.routeStatus,
        body: await this.reader.read(row.targetUserId),
      };
    }
    if (row.leaseUntil.getTime() > this.clock().getTime()) {
      return { kind: 'in_progress' };
    }
    // Abandoned: the compare-and-set lets exactly one request take the key.
    const taken = await this.store.takeOver(actorId, key, row.ownerToken);
    return taken
      ? { kind: 'run', reservation: taken, outcome: 'taken_over' }
      : { kind: 'in_progress' };
  }

  /** NFR-4: every failure of the key store, whatever its shape, is a 503. */
  private async storeCall<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw new ServiceUnavailableException(undefined, { cause: error });
    }
  }

  /** FR-3: the first answer, the handler untouched. `meta` is this request's. */
  private replay(
    claim: Extract<Claim, { kind: 'replay' }>,
    response: Response,
    facts: LineFacts,
  ): Observable<unknown> {
    response.setHeader(REPLAYED_HEADER, 'true');
    this.decision('replayed', 'replayed', claim.status, facts);
    if (claim.status >= 400) {
      const { code, fields } = claim.body as StoredRefusal;
      throw new HttpException(
        { code, ...(fields === undefined ? {} : { fields }) },
        claim.status,
      );
    }
    response.status(claim.status);
    return of(claim.body);
  }

  private run(
    next: CallHandler,
    reservation: Reservation,
    response: Response,
    facts: LineFacts,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        from(this.settleFailure(reservation, error, facts)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
      mergeMap((value: unknown) =>
        from(
          this.settleSuccess(
            reservation,
            response.statusCode,
            value,
            facts,
          ).then(() => value),
        ),
      ),
    );
  }

  /** DD-5: remember a 4xx refusal; free the key for anything else. Never changes the answer. */
  private async settleFailure(
    reservation: Reservation,
    error: unknown,
    facts: LineFacts,
  ): Promise<void> {
    try {
      if (isRefusal(error)) {
        // What the filter will render, and nothing else (P-3).
        const { status, code, fields } = toErrorBody(error);
        await this.store.complete(reservation, {
          status,
          body: { code, ...(fields === undefined ? {} : { fields }) },
        });
      } else {
        await this.store.release(reservation);
      }
    } catch (failure) {
      this.logger.error(this.line('settle_failed', 'error', facts, failure));
    }
  }

  /**
   * FR-2: store the answer right after the commit. A failure here must not
   * change what the client gets: the row stays `executed` and a replay is
   * served by the crash path (design 7, Complete / release).
   */
  private async settleSuccess(
    reservation: Reservation,
    status: number,
    data: unknown,
    facts: LineFacts,
  ): Promise<void> {
    try {
      const stored = await this.store.complete(reservation, {
        status,
        body: data,
      });
      if (!stored) {
        this.logger.warn(this.line('complete_lost', 'error', facts));
      }
    } catch (failure) {
      this.logger.error(this.line('complete_failed', 'error', facts, failure));
    }
  }

  /** The interceptor's own decision line (design 7, Decision log): ids and fixed words only. */
  private decision(
    idempotency: 'replayed' | 'in_progress' | 'reused',
    outcome: 'replayed' | 'refused',
    status: number,
    facts: LineFacts,
  ): void {
    const line = JSON.stringify({
      event: 'idempotency',
      idempotency,
      outcome,
      status,
      ...facts,
    });
    if (outcome === 'replayed') this.logger.log(line);
    else this.logger.warn(line);
  }

  private line(
    idempotency: string,
    outcome: string,
    facts: LineFacts,
    failure?: unknown,
  ): string {
    return JSON.stringify({
      event: 'idempotency',
      idempotency,
      outcome,
      ...facts,
      ...(failure === undefined ? {} : errorFacts(failure)),
    });
  }
}
