import {
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  BadRequestException,
  Body,
  Controller,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  type INestApplication,
  type PipeTransform,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DrizzleQueryError } from 'drizzle-orm';
import { defer, from, lastValueFrom } from 'rxjs';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FakeClock,
  InMemoryIdempotencyStore,
} from '../../../test/support/in-memory-idempotency.js';
import { errorBody } from '../error-codes.js';
import { HttpExceptionFilter, toErrorBody } from '../http-exception.filter.js';
import { requestIdMiddleware } from '../request-id.js';
import { ResponseEnvelopeInterceptor } from '../response-envelope.interceptor.js';
import { requestFingerprint } from './fingerprint.js';
import {
  CurrentIdempotency,
  idempotencyHandleOf,
  type IdempotencyHandle,
} from './idempotency.context.js';
import { IdempotencyFenceLostError } from './idempotency.errors.js';
import {
  IDEMPOTENCY_REPLAY_READER,
  IdempotencyInterceptor,
} from './idempotency.interceptor.js';
import { IDEMPOTENCY_CLOCK, IDEMPOTENCY_STORE } from './idempotency.store.js';
import { Idempotent } from './idempotent.decorator.js';

// Decision table of the interceptor over a stub handler (design 7). Expected
// values are written out from the requirements scenarios (FR-1…FR-6, NFR-2,
// NFR-4), not derived from the code under test.

const ACTOR = 11;
const KEY = 'key-1';
const URL = '/api/v1/users/5';
const BODY = { nickname: 'ana' };
const DATA = { id: 5, nickname: 'ana', roles: ['ADMIN'] };
const FRESH = { id: 5, nickname: 'ana', roles: ['ADMIN'], fresh: true };

interface Call {
  /** Defaults to `KEY`; an explicit `undefined` sends no Idempotency-Key header. */
  key?: string;
  method?: string;
  url?: string;
  body?: unknown;
  actor?: number;
  /** The status Nest already set on the response for this route. */
  routeStatus?: number;
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  status(code: number): FakeResponse;
}

type Handler = (request: object) => unknown;

interface Sent {
  data?: unknown;
  error?: unknown;
  response: FakeResponse;
  request: object;
}

function world() {
  const clock = new FakeClock();
  const store = new InMemoryIdempotencyStore(clock.now);
  const reader = {
    read: vi.fn((_targetUserId: number): Promise<unknown> =>
      Promise.resolve(FRESH),
    ),
  };
  const interceptor = new IdempotencyInterceptor(store, clock.now, reader);

  async function send(call: Call, handler: Handler): Promise<Sent> {
    const headers: Record<string, string> = {};
    const key = 'key' in call ? call.key : KEY;
    if (key !== undefined) headers['idempotency-key'] = key;
    const req = {
      method: call.method ?? 'PATCH',
      originalUrl: call.url ?? URL,
      url: call.url ?? URL,
      headers,
      body: 'body' in call ? call.body : BODY,
      user: { id: call.actor ?? ACTOR },
      requestId: 'req-1',
    };
    const response: FakeResponse = {
      statusCode: call.routeStatus ?? 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = {
      handle: () => defer(() => from(Promise.resolve(handler(req)))),
    };
    try {
      const data = await lastValueFrom(
        await interceptor.intercept(context, next),
      );
      return { data, response, request: req };
    } catch (error) {
      return { error, response, request: req };
    }
  }

  return { clock, store, reader, interceptor, send };
}

const returns = (data: unknown) => vi.fn<Handler>(() => data);
const throws = (error: unknown) =>
  vi.fn<Handler>(() => {
    throw error;
  });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const validation400 = () =>
  new BadRequestException({
    ...errorBody('VALIDATION_FAILED'),
    fields: [
      {
        field: 'roles[0].role',
        code: 'REQUIRED',
        message: 'This field is required.',
      },
    ],
  });

const statusOf = (error: unknown) => {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
};
const codeOf = (error: unknown) => {
  expect(error).toBeInstanceOf(HttpException);
  return toErrorBody(error).code;
};

describe('IdempotencyInterceptor decision table', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('FR-1: no header', () => {
    it('runs the handler untouched and remembers nothing', async () => {
      const w = world();
      const handler = returns(DATA);

      const first = await w.send({ key: undefined }, handler);
      const second = await w.send({ key: undefined }, handler);

      expect(first.data).toEqual(DATA);
      expect(second.data).toEqual(DATA);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(w.store.writes).toBe(0);
      expect(w.store.peek(ACTOR, KEY)).toBeUndefined();
      expect(idempotencyHandleOf(first.request)).toBeUndefined();
      expect(first.response.headers['idempotency-replayed']).toBeUndefined();
    });
  });

  describe('FR-6: malformed key', () => {
    it.each([
      ['empty', '', 'REQUIRED'],
      ['129 characters', 'a'.repeat(129), 'TOO_LONG'],
      ['a space', 'has space', 'INVALID'],
      ['a slash', 'a/b', 'INVALID'],
      ['a comma (repeated header)', 'a,b', 'INVALID'],
      ['non-ascii', 'clé', 'INVALID'],
    ])(
      '%s: 400 on Idempotency-Key, nothing runs or is stored',
      async (_n, key, code) => {
        const w = world();
        const handler = returns(DATA);

        const sent = await w.send({ key }, handler);

        expect(statusOf(sent.error)).toBe(400);
        expect(toErrorBody(sent.error)).toMatchObject({
          status: 400,
          code: 'VALIDATION_FAILED',
          fields: [{ field: 'Idempotency-Key', code }],
        });
        expect(handler).not.toHaveBeenCalled();
        expect(w.store.writes).toBe(0);
      },
    );

    it.each([
      'a',
      'A-b_c.d:e',
      'Key-With-CASE',
      '1'.repeat(128),
      crypto.randomUUID(),
    ])('accepts %s', async (key) => {
      const w = world();
      const sent = await w.send({ key }, returns(DATA));
      expect(sent.error).toBeUndefined();
      expect(w.store.peek(ACTOR, key)?.state).toBe('completed');
    });
  });

  describe('FR-2: first execution', () => {
    it('new key + 2xx: runs once, remembers status and data (complete)', async () => {
      const w = world();
      let seenDuring: unknown;
      const handler = vi.fn<Handler>((req) => {
        seenDuring = w.store.peek(ACTOR, KEY)?.state;
        expect(idempotencyHandleOf(req)?.reservation).toMatchObject({
          actorId: ACTOR,
          key: KEY,
        });
        return DATA;
      });

      const sent = await w.send({ routeStatus: 201 }, handler);

      expect(sent.data).toEqual(DATA);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(seenDuring).toBe('in_progress');
      expect(sent.response.headers['idempotency-replayed']).toBeUndefined();
      expect(w.store.peek(ACTOR, KEY)).toMatchObject({
        state: 'completed',
        responseStatus: 201,
        responseBody: DATA,
        routeStatus: 201,
      });
      expect(idempotencyHandleOf(sent.request)).toMatchObject({
        outcome: 'none',
      });
    });

    it('new key + domain 4xx: rethrown as is and remembered as a refusal', async () => {
      const w = world();
      const error = new NotFoundException(errorBody('USERS_NOT_FOUND'));

      const sent = await w.send({}, throws(error));

      expect(sent.error).toBe(error);
      expect(w.store.peek(ACTOR, KEY)).toMatchObject({
        state: 'completed',
        responseStatus: 404,
        responseBody: { code: 'USERS_NOT_FOUND' },
      });
    });

    it('pipe 400: rethrown and remembered with its field errors', async () => {
      const w = world();
      const error = validation400();

      const sent = await w.send({}, throws(error));

      expect(sent.error).toBe(error);
      expect(w.store.peek(ACTOR, KEY)).toMatchObject({
        state: 'completed',
        responseStatus: 400,
        responseBody: {
          code: 'VALIDATION_FAILED',
          fields: [
            {
              field: 'roles[0].role',
              code: 'REQUIRED',
              message: 'This field is required.',
            },
          ],
        },
      });
    });

    it.each([
      ['500', () => new InternalServerErrorException()],
      ['503', () => new ServiceUnavailableException()],
      ['a plain Error', () => new Error('boom')],
      ['a non-error throw', () => 'oops'],
      [
        'a driver failure',
        () => new DrizzleQueryError('q', [], new Error('x')),
      ],
    ])(
      '%s: nothing remembered (release) and the retry runs again',
      async (_n, make) => {
        const w = world();
        const failing = throws(make());

        const first = await w.send({}, failing);
        expect(first.error).toBeDefined();
        expect(w.store.peek(ACTOR, KEY)).toBeUndefined();

        const retry = returns(DATA);
        const second = await w.send({}, retry);
        expect(second.data).toEqual(DATA);
        expect(retry).toHaveBeenCalledTimes(1);
        expect(second.response.headers['idempotency-replayed']).toBeUndefined();
      },
    );

    it('5xx after the change committed (executed) keeps the mark: the retry replays', async () => {
      const w = world();
      const handler = vi.fn<Handler>(async (req) => {
        const handle = idempotencyHandleOf(req) as IdempotencyHandle;
        await w.store.markExecuted(handle.reservation, 5);
        throw new InternalServerErrorException();
      });

      await w.send({ routeStatus: 200 }, handler);
      expect(w.store.peek(ACTOR, KEY)?.state).toBe('executed');

      const retry = returns(DATA);
      const second = await w.send({ routeStatus: 200 }, retry);
      expect(retry).not.toHaveBeenCalled();
      expect(second.data).toEqual(FRESH);
    });

    it('a lost fence (409 in progress) is never remembered as a refusal', async () => {
      const w = world();
      const sent = await w.send({}, throws(new IdempotencyFenceLostError()));

      expect(statusOf(sent.error)).toBe(409);
      const row = w.store.peek(ACTOR, KEY);
      expect(row?.responseStatus ?? null).toBeNull();
      expect(row?.state).not.toBe('completed');
    });

    it('a failure to complete after a successful handler is logged by ids and does not change the answer', async () => {
      const w = world();
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      vi.spyOn(w.store, 'complete').mockRejectedValue(
        new Error('db down for jane@cgiar.org'),
      );

      const sent = await w.send({}, returns(DATA));

      expect(sent.error).toBeUndefined();
      expect(sent.data).toEqual(DATA);
      const lines = error.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string)).toMatchObject({
        idempotency: 'complete_failed',
        actorId: ACTOR,
        requestId: 'req-1',
      });
      expect(lines.join()).not.toMatch(/jane|ana|ADMIN|key-1/);
    });
  });

  describe('FR-3: replay', () => {
    it('replays a success: handler not called, same data, marker header, stored status', async () => {
      const w = world();
      const handler = returns(DATA);
      const first = await w.send({ routeStatus: 201 }, handler);

      const replay = await w.send({ routeStatus: 200 }, handler);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(replay.error).toBeUndefined();
      expect(replay.data).toEqual(first.data);
      expect(replay.response.headers['idempotency-replayed']).toBe('true');
      expect(replay.response.statusCode).toBe(201);
      expect(first.response.headers['idempotency-replayed']).toBeUndefined();
      expect(w.reader.read).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a domain code',
        () => new NotFoundException(errorBody('USERS_NOT_FOUND')),
      ],
      ['field errors', validation400],
      ['a status with no code', () => new NotFoundException()],
      [
        'a generic 409',
        () => new HttpException({ code: 'USERS_LAST_ADMIN' }, 409),
      ],
    ])(
      'replays a refusal (%s): handler not called, same status, code and fields',
      async (_n, make) => {
        const w = world();
        const first = await w.send({}, throws(make()));
        const handler = returns(DATA);

        const replay = await w.send({}, handler);

        expect(handler).not.toHaveBeenCalled();
        expect(replay.error).toBeInstanceOf(HttpException);
        expect(statusOf(replay.error)).toBe(statusOf(first.error));
        expect(toErrorBody(replay.error)).toEqual(toErrorBody(first.error));
        expect(replay.response.headers['idempotency-replayed']).toBe('true');
      },
    );

    it('a refusal stays refused even though the handler would now succeed', async () => {
      const w = world();
      await w.send(
        {},
        throws(new NotFoundException(errorBody('USERS_NOT_FOUND'))),
      );
      const later = returns(DATA);

      const replay = await w.send({}, later);

      expect(codeOf(replay.error)).toBe('USERS_NOT_FOUND');
      expect(later).not.toHaveBeenCalled();
    });

    it('executed without an answer: route status and a fresh detail from the reader, handler not called', async () => {
      const w = world();
      const crashed = vi.fn<Handler>(async (req) => {
        const handle = idempotencyHandleOf(req) as IdempotencyHandle;
        await w.store.markExecuted(handle.reservation, 42);
        // The process dies here: no complete, no release.
        throw new Error('process died');
      });
      await w.send({ routeStatus: 201 }, crashed);
      expect(w.store.peek(ACTOR, KEY)).toMatchObject({
        state: 'executed',
        routeStatus: 201,
        targetUserId: 42,
        responseStatus: null,
      });

      const handler = returns(DATA);
      const replay = await w.send({ routeStatus: 200 }, handler);

      expect(handler).not.toHaveBeenCalled();
      expect(w.reader.read).toHaveBeenCalledWith(42);
      expect(replay.data).toEqual(FRESH);
      expect(replay.response.statusCode).toBe(201);
      expect(replay.response.headers['idempotency-replayed']).toBe('true');
    });

    it('an answer stored after retention is gone: the key is new', async () => {
      const w = world();
      await w.send({}, returns(DATA));
      w.clock.advance(24 * 60 * 60 * 1000 + 1);
      const handler = returns({ again: true });

      const sent = await w.send({}, handler);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(sent.data).toEqual({ again: true });
      expect(sent.response.headers['idempotency-replayed']).toBeUndefined();
    });
  });

  describe('FR-4: reuse', () => {
    it.each([
      ['another body', { body: { nickname: 'bob' } }],
      ['another id in the path', { url: '/api/v1/users/6' }],
      ['another method', { method: 'PUT' }],
      ['a path without the global prefix', { url: '/users/5' }],
    ])(
      '%s: 422 IDEMPOTENCY_KEY_REUSED, handler not called',
      async (_n, other) => {
        const w = world();
        await w.send({}, returns(DATA));
        const handler = returns(DATA);

        const sent = await w.send(other, handler);

        expect(statusOf(sent.error)).toBe(422);
        expect(sent.error).toBeInstanceOf(UnprocessableEntityException);
        expect(codeOf(sent.error)).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(handler).not.toHaveBeenCalled();
        expect(w.store.peek(ACTOR, KEY)?.state).toBe('completed');
      },
    );

    it('reuse is also refused while the first request is in flight', async () => {
      const w = world();
      const hold = gate();
      const first = w.send({}, async () => {
        await hold.opened;
        return DATA;
      });
      await vi.waitFor(() => expect(w.store.peek(ACTOR, KEY)).toBeDefined());

      const second = await w.send({ body: { nickname: 'bob' } }, returns(DATA));
      hold.open();
      await first;

      expect(codeOf(second.error)).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('pins the fingerprint path form: originalUrl with the global prefix, query stripped, body key order irrelevant', async () => {
      const w = world();
      await w.send({ body: { b: 1, a: { y: 2, x: 1 } } }, returns(DATA));
      expect(w.store.peek(ACTOR, KEY)?.fingerprint).toBe(
        requestFingerprint({
          method: 'PATCH',
          path: '/api/v1/users/5',
          body: { a: { x: 1, y: 2 }, b: 1 },
        }),
      );

      const retry = returns(DATA);
      const sent = await w.send(
        { url: '/api/v1/users/5?trace=1', body: { a: { x: 1, y: 2 }, b: 1 } },
        retry,
      );

      expect(sent.error).toBeUndefined();
      expect(retry).not.toHaveBeenCalled();
      expect(sent.response.headers['idempotency-replayed']).toBe('true');
    });
  });

  describe('FR-5: in flight and take-over', () => {
    it('in flight (valid lease): 409 IDEMPOTENCY_IN_PROGRESS and the handler is not called', async () => {
      const w = world();
      const hold = gate();
      const slow = vi.fn<Handler>(async () => {
        await hold.opened;
        return DATA;
      });
      const first = w.send({}, slow);
      await vi.waitFor(() => expect(slow).toHaveBeenCalled());
      const other = returns(DATA);

      const second = await w.send({}, other);

      expect(statusOf(second.error)).toBe(409);
      expect(codeOf(second.error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(other).not.toHaveBeenCalled();
      hold.open();
      expect((await first).data).toEqual(DATA);
      expect(slow).toHaveBeenCalledTimes(1);
    });

    it('two identical requests at once: exactly one executes, the other gets 409', async () => {
      const w = world();
      const hold = gate();
      const handler = vi.fn<Handler>(async () => {
        await hold.opened;
        return DATA;
      });

      const a = w.send({}, handler);
      const b = w.send({}, handler);
      // The loser is refused while the winner is still running.
      const settled = await Promise.race([
        a.then((sent) => ({ who: 'a', sent })),
        b.then((sent) => ({ who: 'b', sent })),
      ]);
      hold.open();
      const [first, second] = await Promise.all([a, b]);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(settled.sent.error).toBeDefined();
      expect(codeOf(settled.sent.error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      const winner = settled.who === 'a' ? second : first;
      expect(winner.data).toEqual(DATA);
    });

    it('expired lease: take-over, then the handler runs; the stalled first request cannot overwrite the answer', async () => {
      const w = world();
      const hold = gate();
      let firstToken: string | undefined;
      const stalled = vi.fn<Handler>(async (req) => {
        firstToken = idempotencyHandleOf(req)?.reservation.ownerToken;
        await hold.opened;
        return { who: 'A' };
      });
      const first = w.send({}, stalled);
      await vi.waitFor(() => expect(stalled).toHaveBeenCalled());
      w.clock.advance(120_001);

      let secondHandle: IdempotencyHandle | undefined;
      const second = await w.send({}, (req) => {
        secondHandle = idempotencyHandleOf(req);
        return { who: 'B' };
      });

      expect(second.data).toEqual({ who: 'B' });
      expect(secondHandle?.outcome).toBe('taken_over');
      expect(secondHandle?.reservation.ownerToken).not.toBe(firstToken);

      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      hold.open();
      const late = await first;
      expect(late.data).toEqual({ who: 'A' });
      expect(w.store.peek(ACTOR, KEY)).toMatchObject({
        state: 'completed',
        responseBody: { who: 'B' },
      });
      expect(warn.mock.calls.map((call) => String(call[0])).join()).not.toMatch(
        /who|key-1/,
      );
    });

    it('a lease still valid at the last millisecond is not taken over', async () => {
      const w = world();
      const hold = gate();
      const slow = vi.fn<Handler>(async () => {
        await hold.opened;
        return DATA;
      });
      const first = w.send({}, slow);
      await vi.waitFor(() => expect(slow).toHaveBeenCalled());
      w.clock.advance(119_999);
      const other = returns(DATA);

      const second = await w.send({}, other);
      hold.open();
      await first;

      expect(codeOf(second.error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(other).not.toHaveBeenCalled();
    });

    it('two requests racing a take-over: exactly one runs, the loser gets 409', async () => {
      const w = world();
      const hold = gate();
      const stalled = vi.fn<Handler>(async () => {
        await hold.opened;
        return DATA;
      });
      void w.send({}, stalled);
      await vi.waitFor(() => expect(stalled).toHaveBeenCalled());
      w.clock.advance(120_001);
      const handler = returns({ who: 'taker' });

      const [a, b] = await Promise.all([
        w.send({}, handler),
        w.send({}, handler),
      ]);

      expect(handler).toHaveBeenCalledTimes(1);
      const failed = [a, b].filter((sent) => sent.error !== undefined);
      expect(failed).toHaveLength(1);
      expect(codeOf(failed[0]?.error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      hold.open();
    });
  });

  describe('FR-6: per admin', () => {
    it('another admin with the same key gets a fresh execution and never the first body', async () => {
      const w = world();
      await w.send({ actor: 1 }, returns({ secret: 'admin-1-body' }));
      const handler = returns({ own: true });

      const sent = await w.send({ actor: 2 }, handler);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(sent.data).toEqual({ own: true });
      expect(JSON.stringify(sent)).not.toContain('admin-1-body');
      expect(sent.response.headers['idempotency-replayed']).toBeUndefined();
    });
  });

  describe('NFR-4: the key store is unavailable', () => {
    const unavailable = (sent: Sent, handler: ReturnType<typeof returns>) => {
      expect(sent.error).toBeInstanceOf(ServiceUnavailableException);
      expect(statusOf(sent.error)).toBe(503);
      expect(toErrorBody(sent.error).code).toBe('SERVICE_UNAVAILABLE');
      expect(handler).not.toHaveBeenCalled();
      expect(idempotencyHandleOf(sent.request)).toBeUndefined();
    };

    it('the purge fails', async () => {
      const w = world();
      w.store.failNext(new Error('down'));
      const handler = returns(DATA);
      unavailable(await w.send({}, handler), handler);
    });

    it('reserve exhausts its retries (plain Error)', async () => {
      const w = world();
      vi.spyOn(w.store, 'reserve').mockRejectedValue(
        new Error('Could not reserve the idempotency key'),
      );
      const handler = returns(DATA);
      unavailable(await w.send({}, handler), handler);
    });

    it('reserve raises a DrizzleQueryError with a cause', async () => {
      const w = world();
      vi.spyOn(w.store, 'reserve').mockRejectedValue(
        new DrizzleQueryError(
          'insert',
          [],
          Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
        ),
      );
      const handler = returns(DATA);
      unavailable(await w.send({}, handler), handler);
    });

    it('the take-over statement fails', async () => {
      const w = world();
      const hold = gate();
      void w.send({}, async () => {
        await hold.opened;
        return DATA;
      });
      await vi.waitFor(() => expect(w.store.peek(ACTOR, KEY)).toBeDefined());
      w.clock.advance(120_001);
      vi.spyOn(w.store, 'takeOver').mockRejectedValue(new Error('down'));
      const handler = returns(DATA);

      unavailable(await w.send({}, handler), handler);
      hold.open();
    });

    it('the post-crash reader fails: 503 too, the handler is not called', async () => {
      const w = world();
      await w.send({}, async (req: object) => {
        const handle = idempotencyHandleOf(req) as IdempotencyHandle;
        await w.store.markExecuted(handle.reservation, 3);
        throw new Error('died');
      });
      w.reader.read.mockRejectedValue(new Error('down'));
      const handler = returns(DATA);

      unavailable(await w.send({}, handler), handler);
    });
  });

  describe('Decision log (NFR-2)', () => {
    const lines = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map(
        (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
      );

    it('a replay writes one line with idempotency=replayed and no stored content', async () => {
      const w = world();
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      await w.send(
        {},
        returns({ email: 'leak@cgiar.org', name: 'Leaky Name' }),
      );
      log.mockClear();

      await w.send({ body: { nickname: 'ana' } }, returns(DATA));

      const written = lines(log);
      expect(written).toEqual([
        {
          event: 'idempotency',
          idempotency: 'replayed',
          outcome: 'replayed',
          status: 200,
          actorId: ACTOR,
          requestId: 'req-1',
        },
      ]);
      expect(JSON.stringify(written)).not.toMatch(/leak|Leaky|key-1|ana/);
    });

    it.each([
      ['in_progress', 409],
      ['reused', 422],
    ])(
      'a refusal %s writes one warn line with the outcome',
      async (outcome, status) => {
        const w = world();
        const hold = gate();
        const warn = vi
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => {});
        if (outcome === 'reused') {
          await w.send({}, returns(DATA));
        } else {
          void w.send({}, async () => {
            await hold.opened;
            return DATA;
          });
          await vi.waitFor(() =>
            expect(w.store.peek(ACTOR, KEY)).toBeDefined(),
          );
        }

        await w.send(
          outcome === 'reused' ? { body: { x: 1 } } : {},
          returns(DATA),
        );
        hold.open();

        expect(lines(warn)).toEqual([
          {
            event: 'idempotency',
            idempotency: outcome,
            outcome: 'refused',
            status,
            actorId: ACTOR,
            requestId: 'req-1',
          },
        ]);
      },
    );

    it('a keyed first execution writes no line of its own (the service line carries the outcome)', async () => {
      const w = world();
      const spies = (['log', 'warn', 'error'] as const).map((level) =>
        vi.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );
      await w.send({}, returns(DATA));
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    });
  });
});

// The same interceptor inside the real Nest pipeline: guards before it (P-1),
// the global envelope outside it (P-2), pipes inside it (P-4), the filter
// rendering replays (P-3).

const denyGuard: CanActivate = { canActivate: () => false };
const asAdmin: CanActivate = {
  canActivate(context) {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: { id: number };
    }>();
    req.user = { id: Number(req.headers['x-actor'] ?? ACTOR) };
    return true;
  },
};
const mustBeNumeric: PipeTransform = {
  transform(value: unknown) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw validation400();
    }
    return Number(value);
  },
};
const executions = { count: 0 };

@Controller('things')
@UseGuards(asAdmin)
class ThingsController {
  @Post()
  @Idempotent()
  create(
    @Body() body: unknown,
    @CurrentIdempotency() handle?: IdempotencyHandle,
  ) {
    executions.count++;
    return { id: 9, echo: body, keyed: handle !== undefined };
  }

  @Post('checked')
  @Idempotent()
  checked(@Body('n', mustBeNumeric) n: number) {
    executions.count++;
    return { n };
  }

  @Post('denied')
  @UseGuards(denyGuard)
  @Idempotent()
  denied() {
    executions.count++;
    return {};
  }
}

describe('IdempotencyInterceptor in the Nest pipeline', () => {
  let app: INestApplication | undefined;

  async function boot() {
    const clock = new FakeClock();
    const store = new InMemoryIdempotencyStore(clock.now);
    executions.count = 0;
    const moduleRef = await Test.createTestingModule({
      controllers: [ThingsController],
      providers: [
        { provide: IDEMPOTENCY_STORE, useValue: store },
        { provide: IDEMPOTENCY_CLOCK, useValue: clock.now },
        {
          provide: IDEMPOTENCY_REPLAY_READER,
          useValue: { read: () => Promise.resolve({}) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    return {
      store,
      server: app.getHttpServer() as Parameters<typeof request>[0],
    };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('401/403 never reach it: a refused request reserves nothing (FR-6, P-1)', async () => {
    const { store, server } = await boot();

    const res = await request(server)
      .post('/things/denied')
      .set('Idempotency-Key', KEY)
      .send({});

    expect(res.status).toBe(403);
    expect(executions.count).toBe(0);
    expect(store.writes).toBe(0);
    expect(store.peek(ACTOR, KEY)).toBeUndefined();
  });

  it('replays a 201 through the envelope: same data, new meta, marker header, one execution', async () => {
    const { server } = await boot();

    const first = await request(server)
      .post('/things')
      .set('Idempotency-Key', KEY)
      .send({ a: 1 });
    const replay = await request(server)
      .post('/things')
      .set('Idempotency-Key', KEY)
      .send({ a: 1 });

    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({ id: 9, echo: { a: 1 }, keyed: true });
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(replay.body.success).toBe(true);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.meta.requestId).toBe(replay.headers['x-request-id']);
    expect(replay.body.meta.requestId).not.toBe(first.body.meta.requestId);
    expect(executions.count).toBe(1);
  });

  it('a request without the key is untouched: no handle, executes every time', async () => {
    const { store, server } = await boot();

    const a = await request(server).post('/things').send({});
    await request(server).post('/things').send({});

    expect(a.body.data.keyed).toBe(false);
    expect(executions.count).toBe(2);
    expect(store.writes).toBe(0);
  });

  it('a pipe 400 is remembered and replayed with the same field errors (P-4)', async () => {
    const { server } = await boot();
    const send = () =>
      request(server)
        .post('/things/checked')
        .set('Idempotency-Key', KEY)
        .send({ n: 'x' });

    const first = await send();
    const replay = await send();

    expect(first.status).toBe(400);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toEqual(first.body.error);
    expect(replay.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'roles[0].role', code: 'REQUIRED' }],
    });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
  });

  it('a malformed key answers 400 on Idempotency-Key through the real filter', async () => {
    const { server } = await boot();

    const res = await request(server)
      .post('/things')
      .set('Idempotency-Key', 'bad key!')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual([
      expect.objectContaining({ field: 'Idempotency-Key', code: 'INVALID' }),
    ]);
    expect(executions.count).toBe(0);
  });

  it('the same key from another admin executes anew (FR-6)', async () => {
    const { server } = await boot();

    await request(server).post('/things').set('Idempotency-Key', KEY).send({});
    const other = await request(server)
      .post('/things')
      .set('x-actor', '99')
      .set('Idempotency-Key', KEY)
      .send({});

    expect(other.headers['idempotency-replayed']).toBeUndefined();
    expect(executions.count).toBe(2);
  });
});
