// @akili-spec bugfix/release-sweep
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { releaseConfig } from '../config/release.config.js';
import { ReleaseService } from './release.service.js';

/** Each pause is the interval spread this much up or down, so instances do not sweep in step. */
const SWEEP_JITTER = 0.2;

/** The most batches one sweep sends: the guard `dispatch()` has on its own rounds. */
const MAX_BATCHES_PER_SWEEP = 50;

/**
 * The safety net of the release outbox (P2-3910 bug). An end dispatches its row
 * once, right after the commit; if that send fails, nothing else would retry it
 * until the next end anywhere or an admin. This sweeps the outbox on a timer:
 * `ReleaseService.dispatch()` one batch at a time (the leased claim, the send with its retry, the
 * ack) and then the `release_stuck` report. The rows' own backoff (the lease)
 * decides which are due, and the lease keeps two instances from sending one row.
 *
 * A self-rescheduling `setTimeout`, never a `setInterval`: the next pause starts
 * after a sweep ends, so sweeps never overlap. The timer is `unref`ed (it never
 * keeps the process alive), an error is logged and the timer is re-armed, and
 * shutdown clears it and waits for a sweep in flight. `RELEASE_SWEEP_INTERVAL_MS=0`
 * turns it off. The requests never wait for it (NFR-6).
 */
@Injectable()
export class ReleaseSweeper
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ReleaseSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(ReleaseService) private readonly releases: ReleaseService,
    @Inject(releaseConfig.KEY)
    private readonly config: ConfigType<typeof releaseConfig>,
  ) {}

  /** Arms the first sweep and returns at once: the bootstrap never waits for it. */
  onApplicationBootstrap(): void {
    if (this.config.sweepIntervalMs <= 0) return;
    this.arm();
  }

  /**
   * Runs before every `onApplicationShutdown`, where the pool is closed, so a
   * sweep never loses its pool. Stops re-arming, clears the timer and waits for
   * the sweep in flight, which stops after the batch in hand (a sweep claims one
   * batch at a time and checks `stopped` between batches): at most one send,
   * shorter than the lease. Never rejects.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /**
   * One sweep now. A call while a sweep is in flight joins it instead of
   * starting a second one. Never rejects.
   */
  sweepOnce(): Promise<void> {
    this.running ??= this.sweep().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private arm(): void {
    if (this.stopped) return;
    const spread = 1 + (Math.random() * 2 - 1) * SWEEP_JITTER;
    const timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.sweepOnce().finally(() => this.arm());
      },
      Math.round(this.config.sweepIntervalMs * spread),
    );
    timer.unref();
    this.timer = timer;
  }

  private async sweep(): Promise<void> {
    try {
      // One batch per call, so shutdown never waits for more than one send.
      for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
        const result = await this.releases.dispatch({ maxRounds: 1 });
        if (this.stopped || !(result.attempted > 0)) break;
      }
      await this.releases.reportStuck();
    } catch (error) {
      // `dispatch` and `reportStuck` never throw; this is the last line: log a fixed word, never the message (NFR-5).
      this.logger.warn(
        JSON.stringify({
          event: 'assessment_release',
          outcome: 'sweep_failed',
          kind: error instanceof Error ? error.name : 'error',
        }),
      );
    }
  }
}
