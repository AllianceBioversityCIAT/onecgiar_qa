import {
  type ArgumentsHost,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { HttpExceptionFilter, errorFacts } from './http-exception.filter.js';

// Values an error may carry in its texts, which no log line may repeat.
const USERNAME = 'cog-username-SECRET';
const EMAIL = 'leak-marker@cgiar.org';
const SUB = 'sub-leak-marker';
const MARKERS = [USERNAME, EMAIL, SUB];

/** A failed UPDATE as drizzle-orm 0.45 raises it, over a mysql2 lock-wait error. */
function dbFailure(): DrizzleQueryError {
  const driver = Object.assign(new Error(`Lock wait timeout (${EMAIL})`), {
    code: 'ER_LOCK_WAIT_TIMEOUT',
    errno: 1205,
    sqlState: 'HY000',
    sqlMessage: `Lock wait timeout exceeded for ${USERNAME}`,
    sql: `update users set cognito_username = '${USERNAME}'`,
  });
  return new DrizzleQueryError(
    'update `users` set `cognito_username` = ?, `email` = ? where `cognito_sub` = ?',
    [USERNAME, EMAIL, SUB],
    driver,
  );
}

const LOG_LEVELS = [
  'log',
  'warn',
  'error',
  'debug',
  'verbose',
  'fatal',
] as const;

function run(exception: unknown) {
  const spies = LOG_LEVELS.map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const request = {
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: {},
    requestId: 'req-1',
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);

  const calls = spies.flatMap((spy) => spy.mock.calls);
  return {
    response,
    calls,
    /** Every argument of every log call, as one text. */
    everything: calls.flat().map(String).join('\n'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpExceptionFilter: what a 5xx log line may say (FR-9, NFR-7)', () => {
  it('logs a DrizzleQueryError by its class and driver codes, never its query, params or driver text', () => {
    const failure = dbFailure();
    // The premise: the message, and so the stack, carry the params.
    for (const marker of MARKERS) expect(failure.stack).toContain(marker);

    const { response, calls, everything } = run(failure);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      requestId: 'req-1',
    });
    // One line, one argument: no stack passed beside it.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(JSON.parse(calls[0][0] as string)).toEqual({
      event: 'unhandled_error',
      requestId: 'req-1',
      method: 'POST',
      path: '/api/v1/auth/login',
      status: 500,
      error: 'DrizzleQueryError',
      cause: 'Error',
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
      sqlState: 'HY000',
    });
    for (const text of [...MARKERS, 'Failed query', 'params', 'Lock wait']) {
      expect(everything).not.toContain(text);
    }
  });

  it('logs a plain Error by its class only, whatever its message says', () => {
    const { calls, everything } = run(
      new Error(`boom for ${USERNAME} <${EMAIL}> (${SUB})`),
    );
    expect(JSON.parse(calls[0][0] as string)).toMatchObject({
      status: 500,
      error: 'Error',
    });
    expect(JSON.parse(calls[0][0] as string)).not.toHaveProperty('code');
    for (const text of [...MARKERS, 'boom']) {
      expect(everything).not.toContain(text);
    }
  });

  it('logs a 5xx HttpException by its class and status, not its message', () => {
    const { response, calls, everything } = run(
      new ServiceUnavailableException(`upstream down for ${USERNAME}`),
    );
    expect(response.status).toHaveBeenCalledWith(503);
    expect(JSON.parse(calls[0][0] as string)).toMatchObject({
      status: 503,
      error: 'ServiceUnavailableException',
    });
    expect(everything).not.toContain(USERNAME);
  });

  it('logs nothing for a 4xx', () => {
    const { response, calls } = run(new NotFoundException(`no ${USERNAME}`));
    expect(response.status).toHaveBeenCalledWith(404);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['a string', `failed for ${USERNAME}`, 'string'],
    ['a plain object', { message: USERNAME, stack: USERNAME }, 'Object'],
    ['null', null, 'null'],
  ])(
    'logs %s thrown as a non-Error by its type only',
    (_kind, thrown, kind) => {
      const { calls, everything } = run(thrown);
      expect(JSON.parse(calls[0][0] as string)).toMatchObject({
        status: 500,
        error: kind,
      });
      expect(everything).not.toContain(USERNAME);
    },
  );
});

describe('errorFacts', () => {
  it('finds the driver fields down the cause chain, and keeps the first well-formed ones', () => {
    const driver = Object.assign(new Error('x'), {
      code: 'PROTOCOL_CONNECTION_LOST',
      errno: -54,
    });
    const wrapped = new InternalServerErrorException('outer', {
      cause: Object.assign(new TypeError('middle'), {
        code: 'not a code',
        cause: driver,
      }),
    });
    expect(errorFacts(wrapped)).toEqual({
      error: 'InternalServerErrorException',
      cause: 'TypeError',
      code: 'PROTOCOL_CONNECTION_LOST',
      errno: -54,
    });
  });

  it.each([
    ['a code with data in it', { code: `ER_${USERNAME}` }],
    ['a lowercase code', { code: 'er_lock' }],
    ['a non-integer errno', { errno: '1205' }],
    ['a sqlState of the wrong shape', { sqlState: `${USERNAME}` }],
  ])('drops %s', (_name, fields) => {
    const facts = errorFacts(Object.assign(new Error('x'), fields));
    expect(facts).toEqual({ error: 'Error' });
  });

  it('does not use `name`, which is free text', () => {
    const error = Object.assign(new Error('x'), { name: 'cogUsernameSECRET' });
    expect(errorFacts(error)).toEqual({ error: 'Error' });
  });

  it('answers UnknownError instead of throwing when a getter throws', () => {
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'cause', {
      get() {
        throw new Error(USERNAME);
      },
    });
    expect(errorFacts(hostile)).toEqual({ error: 'UnknownError' });
  });
});
