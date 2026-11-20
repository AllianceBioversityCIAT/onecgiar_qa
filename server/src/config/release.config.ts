import { registerAs } from '@nestjs/config';

/** The default pause between two release sweeps. */
export const DEFAULT_RELEASE_SWEEP_INTERVAL_MS = 60_000;

/**
 * The release outbox sweep (P2-3910): `RELEASE_SWEEP_INTERVAL_MS` is the pause
 * between two sweeps, in milliseconds (default 60000); `0` turns the sweeper
 * off (unit and e2e tests, local work). The format is checked in `validateEnv`.
 */
export const releaseConfig = registerAs('release', () => ({
  sweepIntervalMs: process.env.RELEASE_SWEEP_INTERVAL_MS
    ? Number(process.env.RELEASE_SWEEP_INTERVAL_MS)
    : DEFAULT_RELEASE_SWEEP_INTERVAL_MS,
}));
