// @akili-spec assessment/step-1-assessment
import { Logger } from '@nestjs/common';
import { FakeResultsFeed } from './fake-results-feed.js';
import { FakeSnapshotStore } from './fake-snapshot-store.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from './in-memory-loads.js';
import type { FieldCatalogSource } from '../../src/admin-config/field-config/field-catalog.ports.js';
import type { RomeMinute } from '../../src/admin-config/rome-date.js';
import type { Cycle } from '../../src/database/drizzle/schema/cycles.js';
import type { TimelineLoad } from '../../src/database/drizzle/schema/timeline-loads.js';
import type { TimelineResult } from '../../src/database/drizzle/schema/timeline-results.js';
import { DEFAULT_KP_RULES } from '../../src/ingestion/kp-classifier.js';
import { LoadRunner } from '../../src/ingestion/load-runner.js';
import { LoadsUnitOfWork } from '../../src/ingestion/loads.unit-of-work.js';
import type {
  FeedDetailsQuery,
  FeedIntakeQuery,
  FeedLabels,
} from '../../src/ingestion/results-feed.port.js';

// The real writer of `timeline_results.snapshot_sk` (KZ-ingestion--timeline-sync-1):
// a real `LoadRunner` over the in-memory loads world and the in-memory snapshot
// store. The key a test reads is the one the runner wrote (`SNAP#…`), never a
// hand typed one: a literal key without the prefix is the blindness this closes.

const NOW = new Date('2026-11-10T08:00:00.000Z');
const minute = (value: string) => value as RomeMinute;

export interface RealLoad {
  /** The memberships the runner wrote, with their real `snapshotSk`. */
  memberships: TimelineResult[];
  /** The store the runner wrote the snapshots to. */
  snapshots: FakeSnapshotStore;
}

export interface RealLoadItem {
  resultId: number;
  /** The result code is `resultId + 4000`, the fake feed's rule. */
  values: Record<string, unknown>;
  labels?: FeedLabels;
  resultTypeKey?: string;
}

/**
 * Runs load `loadId` (default 1) of timeline 11 (cycle 1, year 2026) over
 * `items` to its end and returns what the runner wrote. Two runs with different
 * load ids write different snapshot keys, like two rounds of one result. Uses
 * fake timers for the run and restores them.
 */
export async function runRealLoad(
  items: RealLoadItem[],
  options: { loadId?: number } = {},
): Promise<RealLoad> {
  const loadId = options.loadId ?? 1;
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
  vi.setSystemTime(NOW);
  // The runner logs each lot; the run is not what the test reads.
  const quiet = (['log', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
  try {
    const world = new InMemoryLoadsDatabase();
    const created = new Date('2026-10-01T09:00:00.000Z');
    const cycle: Cycle = {
      id: 1,
      year: 2026,
      status: 'active',
      activeKey: 1,
      createdAt: created,
      createdBy: 1,
      activatedAt: created,
      activatedBy: 1,
      closedAt: null,
      closedBy: null,
    };
    world.admin.cycles.push(cycle);
    world.admin.timelines.push({
      id: 11,
      cycleId: 1,
      name: 'July 2026',
      kind: 'additional',
      officialKey: null,
      allPrograms: true,
      allResultTypes: true,
      createdAt: created,
      createdBy: 1,
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });
    world.admin.steps.push({
      id: 111,
      timelineId: 11,
      position: 1,
      name: 'Step 1',
      audience: 'assessors',
      opensAt: minute('2026-11-02T09:00'),
      closesAt: minute('2026-11-20T17:30'),
      round: 1,
      requiresLoad: true,
    });
    const load: TimelineLoad = {
      id: loadId,
      cycleId: 1,
      timelineId: 11,
      timelineStepId: 111,
      stepPosition: 1,
      round: 1,
      phaseYear: 2026,
      scope: {
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
      },
      status: 'running',
      runningKey: 1,
      total: null,
      processed: 0,
      summary: null,
      failureReason: null,
      startedBy: 9,
      startedAt: NOW,
      heartbeatAt: NOW,
      finishedAt: null,
      requestId: 'req-1',
    };
    world.loads.push(load);

    const byId = new Map(items.map((i) => [i.resultId, i]));
    const feed = new FakeResultsFeed();
    feed.script('list', {
      phase: 2026,
      page: 1,
      pageSize: 200,
      total: items.length,
      breakdown: { byProgram: [], byResultType: [] },
      items: items.map((i) => ({
        resultId: i.resultId,
        resultCode: i.resultId + 4000,
        program: { clarisaId: 3, code: 'SP03' },
        resultTypeKey: i.resultTypeKey ?? 'policy_change',
        submittedAt: null,
      })),
    });
    feed.script('intake', (q: FeedIntakeQuery) => ({
      phaseYear: q.phaseYear,
      taken: q.resultIds.map((id) => ({
        resultId: id,
        resultCode: id + 4000,
        changed: true,
      })),
      notTaken: [],
    }));
    feed.script('details', (q: FeedDetailsQuery) => ({
      phase: q.phaseYear,
      catalogVersion: '2026.30',
      results: q.resultIds.map((id) => ({
        resultId: id,
        resultCode: id + 4000,
        resultTypeKey: byId.get(id)!.resultTypeKey ?? 'policy_change',
        values: byId.get(id)!.values,
        ...(byId.get(id)!.labels ? { labels: byId.get(id)!.labels } : {}),
      })),
      notEligible: [],
    }));

    const snapshots = new FakeSnapshotStore();
    const catalogs = {
      forYear: vi.fn(async () => ({ catalogVersion: '2026.30' }) as never),
      refresh: vi.fn(async () => ({ catalogVersion: '2026.30' }) as never),
    } satisfies FieldCatalogSource;
    const runner = new LoadRunner(
      new LoadsUnitOfWork(new InMemoryLoadsTransactions(world)),
      world.store,
      feed,
      snapshots,
      catalogs,
      DEFAULT_KP_RULES,
      () => new Date(),
    );
    runner.run(loadId);
    for (let i = 0; i < 3000 && world.loads[0]!.status === 'running'; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (world.loads[0]!.status !== 'completed') {
      throw new Error(`the real load ended ${world.loads[0]!.status}`);
    }
    return { memberships: [...world.results], snapshots };
  } finally {
    for (const spy of quiet) spy.mockRestore();
    vi.useRealTimers();
  }
}
