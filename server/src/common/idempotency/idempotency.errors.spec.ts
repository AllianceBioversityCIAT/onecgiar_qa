import { describe, expect, it } from 'vitest';
import { isDuplicateKeyError } from './idempotency.errors.js';

const mysqlError = (code: string, errno: number) =>
  Object.assign(new Error(code), { code, errno });

describe('isDuplicateKeyError', () => {
  it.each([
    ['1062 raised directly', mysqlError('ER_DUP_ENTRY', 1062), true],
    [
      '1062 behind a query-error wrapper (cause)',
      Object.assign(new Error('Failed query'), {
        cause: mysqlError('ER_DUP_ENTRY', 1062),
      }),
      true,
    ],
    [
      '1062 by errno alone',
      Object.assign(new Error('dup'), { errno: 1062 }),
      true,
    ],
    ['1213 deadlock', mysqlError('ER_LOCK_DEADLOCK', 1213), false],
    [
      '1213 behind a wrapper',
      Object.assign(new Error('Failed query'), {
        cause: mysqlError('ER_LOCK_DEADLOCK', 1213),
      }),
      false,
    ],
    ['an unrelated error', new Error('boom'), false],
    ['a non-error value', 'ER_DUP_ENTRY', false],
  ])('%s -> %s', (_name, error, expected) => {
    expect(isDuplicateKeyError(error)).toBe(expected);
  });
});
