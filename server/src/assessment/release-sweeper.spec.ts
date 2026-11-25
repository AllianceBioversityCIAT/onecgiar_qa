// @akili-spec bugfix/release-sweep
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseSweeper } from './release-sweeper.js';
import type { ReleaseService } from './release.service.js';

// The sweeper's timer (P2-3910 bug) over a fake `ReleaseService` and fake
// timers: no clock, no feed, no store. What it dispatches is the service's own
// spec; here it is when and how often, and what a failure does to the timer.

const INTERVAL = 60_000;

function setup(
  options: {
    dispatch?: () => Promise<unknown>;
    reportStuck?: () => Promise<unknown>;
    intervalMs?: number;
  } = {},
) {
  const dispatch = vi.fn(options.dispatch ?? (() => Promise.resolve({})));
  const reportStuck = vi.fn(options.reportStuck ?? (() => Promise.resolve(0)));
  const sweeper = new ReleaseSweeper(
    { dispatch, reportStuck } as unknown as ReleaseService,
    { sweepIntervalMs: options.intervalMs ?? INTERVAL },
  );
  return { sweeper, dispatch, reportStuck };
}

describe('ReleaseSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('arms nothing when the interval is 0', () => {
    const { sweeper, dispatch } = setup({ intervalMs: 0 });
    sweeper.onApplicationBootstrap();
    vi.advanceTimersByTime(10 * INTERVAL);
    expect(vi.getTimerCount()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches and then reports the stuck rows once per interval, and re-arms', async () => {
    const { sweeper, dispatch, reportStuck } = setup();
    sweeper.onApplicationBootstrap();
    expect(dispatch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reportStuck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(3);
    await sweeper.beforeApplicationShutdown();
  });

  it('spreads each pause 20 % up or down', async () => {
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms: number,
    ) => {
      delays.push(ms);
      return real(fn, ms);
    }) as never);
    const random = vi.spyOn(Math, 'random');
    const { sweeper } = setup({
      // The next pause is armed when this sweep ends.
      dispatch: () => {
        random.mockReturnValue(1);
        return Promise.resolve({});
      },
    });

    random.mockReturnValue(0);
    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    // The first pause is armed at 0 (-20 %), the second, after the first sweep, at 1 (+20 %).
    expect(delays).toEqual([INTERVAL * 0.8, INTERVAL * 1.2]);
    await sweeper.beforeApplicationShutdown();
  });

  it('unrefs the timer so it never keeps the process alive', async () => {
    const { sweeper } = setup();
    const unref = vi.fn();
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms: number,
    ) => Object.assign(real(fn, ms), { unref })) as never);
    sweeper.onApplicationBootstrap();
    expect(unref).toHaveBeenCalledTimes(1);
    await sweeper.beforeApplicationShutdown();
  });

  it('logs a failure with a fixed word, never its message, and keeps sweeping', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    let calls = 0;
    const { sweeper, dispatch } = setup({
      dispatch: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('secret detail'))
          : Promise.resolve({});
      },
    });
    sweeper.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      {
        event: 'assessment_release',
        outcome: 'sweep_failed',
        kind: 'Error',
      },
    ]);
    expect(lines.join('')).not.toContain('secret detail');
    await sweeper.beforeApplicationShutdown();
  });

  it('never overlaps: the next pause starts after a slow sweep ends, and a manual sweep joins the one in flight', async () => {
    let release: () => void = () => undefined;
    const { sweeper, dispatch } = setup({
      dispatch: () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    });
    sweeper.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // A slow sweep spans three intervals: no second dispatch, no new timer.
    await vi.advanceTimersByTimeAsync(3 * INTERVAL);
    void sweeper.sweepOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    release();
    await vi.advanceTimersByTimeAsync(0);
    // Armed again from the END of the sweep.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(2);
    release();
    await sweeper.beforeApplicationShutdown();
  });

  it('shutdown clears the pending timer, so no sweep runs afterwards', async () => {
    const { sweeper, dispatch } = setup();
    sweeper.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(1);

    await sweeper.beforeApplicationShutdown();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shutdown waits for a sweep in flight and does not re-arm after it', async () => {
    let release: () => void = () => undefined;
    const { sweeper, dispatch } = setup({
      dispatch: () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    });
    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);

    let closed = false;
    const shutdown = sweeper.beforeApplicationShutdown().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);

    release();
    await shutdown;
    expect(closed).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sweeps one batch per dispatch while rows are claimed, and stops when none is', async () => {
    let left = 3;
    const { sweeper, dispatch } = setup({
      dispatch: () => Promise.resolve({ attempted: left-- > 0 ? 50 : 0 }),
    });
    sweeper.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL);

    // Three batches of rows, then the call that finds nothing.
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(dispatch).toHaveBeenCalledWith({ maxRounds: 1 });
    await sweeper.beforeApplicationShutdown();
  });

  it('shutdown during a multi-batch sweep waits for the batch in hand only', async () => {
    const releases: Array<() => void> = [];
    const { sweeper, dispatch, reportStuck } = setup({
      dispatch: () =>
        new Promise((resolve) => {
          releases.push(() => resolve({ attempted: 50 }));
        }),
    });
    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);

    let closed = false;
    const shutdown = sweeper.beforeApplicationShutdown().then(() => {
      closed = true;
    });
    releases[0]!();
    await shutdown;

    // The batch in hand finished; the sweep claimed no second one.
    expect(closed).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(reportStuck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
