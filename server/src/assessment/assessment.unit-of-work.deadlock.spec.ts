// @akili-spec assessment/step-1-assessment
import { describe, expect, it, vi } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DrizzleAssessmentUnitOfWork } from './assessment.unit-of-work.js';

// A MySQL deadlock (1213) rolls the victim transaction back whole, so running
// the work again is safe: concurrent first writes (ON DUPLICATE KEY UPDATE)
// and concurrent ends can deadlock (T-10 pointer 2, design 5). The retry is
// bounded: a deadlock that keeps coming is the caller's 500, not a loop.

const deadlock = () =>
  Object.assign(new Error('Deadlock found when trying to get lock'), {
    code: 'ER_LOCK_DEADLOCK',
    errno: 1213,
  });
/** drizzle-orm 0.45 wraps a driver error as the `cause` of its own. */
const wrapped = (cause: Error) =>
  Object.assign(new Error('Failed query'), { cause });

/** A database whose transaction fails with `failure` the first `failures` times. */
function database(failures: number, failure: () => Error = deadlock) {
  const calls = { count: 0 };
  const db = {
    transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => {
      calls.count += 1;
      if (calls.count <= failures) throw failure();
      return await callback({});
    }),
  };
  const unit = new DrizzleAssessmentUnitOfWork(
    db as unknown as DrizzleDB,
    () => new Date('2026-11-13T10:00:00Z'),
  );
  return { unit, calls };
}

describe('DrizzleAssessmentUnitOfWork deadlock retry', () => {
  it('runs the work again after a deadlock and answers what the second run answered', async () => {
    const { unit, calls } = database(1);
    const work = vi.fn(() => Promise.resolve('ended'));
    expect(await unit.run(work)).toBe('ended');
    expect(calls.count).toBe(2);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('finds the deadlock under a wrapper error, as drizzle raises it', async () => {
    const { unit, calls } = database(1, () => wrapped(deadlock()));
    expect(await unit.run(() => Promise.resolve('ok'))).toBe('ok');
    expect(calls.count).toBe(2);
  });

  it('retries a deadlock raised by the work itself, inside the transaction', async () => {
    const { unit, calls } = database(0);
    let first = true;
    const result = await unit.run(() => {
      if (first) {
        first = false;
        return Promise.reject(deadlock());
      }
      return Promise.resolve('ok');
    });
    // The fake `transaction` rethrows what the callback throws, as a driver does after the rollback.
    expect(result).toBe('ok');
    expect(calls.count).toBe(2);
  });

  it('gives up after 3 attempts and throws the deadlock', async () => {
    const { unit, calls } = database(10);
    await expect(unit.run(() => Promise.resolve('never'))).rejects.toMatchObject(
      { errno: 1213 },
    );
    expect(calls.count).toBe(3);
  });

  it.each([
    ['a duplicate key', () => Object.assign(new Error('dup'), { errno: 1062 })],
    ['a plain error', () => new Error('boom')],
    [
      'a lock wait timeout',
      () => Object.assign(new Error('wait'), { errno: 1205 }),
    ],
  ])('does not retry %s', async (_name, failure) => {
    const { unit, calls } = database(10, failure);
    await expect(unit.run(() => Promise.resolve('never'))).rejects.toBeInstanceOf(
      Error,
    );
    expect(calls.count).toBe(1);
  });

  it('reads the isolation level once per attempt: READ COMMITTED each time', async () => {
    const options: unknown[] = [];
    const db = {
      transaction: vi.fn(
        async (
          callback: (tx: object) => Promise<unknown>,
          config: unknown,
        ) => {
          options.push(config);
          if (options.length === 1) throw deadlock();
          return await callback({});
        },
      ),
    };
    const unit = new DrizzleAssessmentUnitOfWork(
      db as unknown as DrizzleDB,
      () => new Date(),
    );
    await unit.run(() => Promise.resolve(1));
    expect(options).toEqual([
      { isolationLevel: 'read committed' },
      { isolationLevel: 'read committed' },
    ]);
  });
});
