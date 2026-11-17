// @akili-spec assessment/ai-suggestions
import { Logger } from '@nestjs/common';
import {
  FakeAiJobsPublisher,
  FakeAiRunStore,
  FakeFieldConfigEffective,
} from '../../test/support/fake-ai-jobs.js';
import type { LoadsStore } from './loads.store.js';
import {
  AiEnqueueService,
  AiTally,
  type AiLotMembership,
} from './ai-enqueue.service.js';
import { AiJobsDisabledError } from '../ai-suggestions/ai-errors.js';
import { LoadNotFoundError } from './loads.errors.js';

// Expected values are FR-1, FR-2, FR-3 and NFR-1 of spec
// assessment/ai-suggestions written out as literals.

const LOAD = { id: 7, cycleId: 1, timelineId: 11 };
const SNAP = 'SNAP#2026#000001#00000011#0000000007';
const KEY = '2026#000001#00000011#0000000007';

const member = (
  resultCode: number,
  resultTypeKey = 'policy_change',
  status = 'pending',
): AiLotMembership => ({ resultCode, resultTypeKey, snapshotSk: SNAP, status });

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

function build(memberships: AiLotMembership[] = [], loadExists = true) {
  const publisher = new FakeAiJobsPublisher();
  const runs = new FakeAiRunStore();
  const fieldConfig = new FakeFieldConfigEffective();
  const loads = {
    findLoad: vi.fn(async (timelineId: number, loadId: number) =>
      loadExists && timelineId === 11 && loadId === 7
        ? {
            load: { id: 7, cycleId: 1, timelineId: 11 },
            startedBy: { id: 1, nickname: null },
          }
        : undefined,
    ),
    listAiJobMemberships: vi.fn(async () =>
      memberships.filter((m) => m.status === 'pending'),
    ),
  } as unknown as LoadsStore;
  const service = new AiEnqueueService(
    publisher,
    runs,
    fieldConfig,
    loads,
    () => new Date('2026-11-20T10:00:00Z'),
  );
  return { service, publisher, runs, fieldConfig };
}

const aiLines = () =>
  logged
    .filter((l) => l.includes('"ai_enqueue"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('enqueueLot (FR-2)', () => {
  it('sends one job per pending membership and eligible field, then SETs expected', async () => {
    const { service, publisher, runs } = build();
    await service.enqueueLot(
      LOAD,
      [
        member(1001),
        member(1002, 'innovation_development'),
        member(1003, 'knowledge_product', 'not_in_qa'),
        member(1004, 'knowledge_product', 'auto_validated'),
      ],
      new AiTally(),
    );
    expect(publisher.sent).toEqual([
      {
        runId: 'load-7',
        resultCode: '1001',
        snapKey: KEY,
        fieldKey: 'general.gender_tag',
        promptVersion: 'v2-1.0.0',
      },
      {
        runId: 'load-7',
        resultCode: '1001',
        snapKey: KEY,
        fieldKey: 'general.poverty_tag',
        promptVersion: 'v2-1.0.0',
      },
      {
        runId: 'load-7',
        resultCode: '1002',
        snapKey: KEY,
        fieldKey: 'general.gender_tag',
        promptVersion: 'v2-1.0.0',
      },
      {
        runId: 'load-7',
        resultCode: '1002',
        snapKey: KEY,
        fieldKey: 'general.climate_tag',
        promptVersion: 'v2-1.0.0',
      },
      {
        runId: 'load-7',
        resultCode: '1002',
        snapKey: KEY,
        fieldKey: 'innovation_dev.readiness_level',
        promptVersion: 'v2-1.0.0',
      },
    ]);
    expect(runs.writes).toEqual([{ runId: 'load-7', expected: 5 }]);
    expect(aiLines()).toEqual([
      expect.objectContaining({
        event: 'ai_enqueue',
        route: 'lot',
        loadId: 7,
        outcome: 'ok',
        jobs: 5,
        sent: 5,
        expected: 5,
      }),
    ]);
  });

  it('adds lots up and does not double a lot sent twice (SET, DD-1)', async () => {
    const { service, publisher, runs } = build();
    const tally = new AiTally();
    await service.enqueueLot(LOAD, [member(1001), member(1002)], tally);
    await service.enqueueLot(LOAD, [member(1003)], tally);
    // The same lot again (a retried lot): same bodies, expected unchanged.
    await service.enqueueLot(LOAD, [member(1003)], tally);
    expect(runs.writes.map((w) => w.expected)).toEqual([4, 6, 6]);
    expect(runs.expected.get('load-7')).toBe(6);
    expect(publisher.sent.slice(4, 6)).toEqual(publisher.sent.slice(6));
  });

  it('reads the configuration once per result type and load', async () => {
    const { service, fieldConfig } = build();
    const tally = new AiTally();
    await service.enqueueLot(LOAD, [member(1001), member(1002)], tally);
    await service.enqueueLot(LOAD, [member(1003)], tally);
    expect(fieldConfig.calls).toEqual(['policy_change']);
  });

  it('a type whose configuration cannot be read gets no job; the rest go and the lot is not failed', async () => {
    const { service, publisher, fieldConfig } = build();
    fieldConfig.failing.add('innovation_development');
    await expect(
      service.enqueueLot(
        LOAD,
        [member(1001), member(1002, 'innovation_development')],
        new AiTally(),
      ),
    ).resolves.toBeUndefined();
    expect(publisher.sent.map((j) => j.resultCode)).toEqual(['1001', '1001']);
    expect(aiLines()).toEqual([
      expect.objectContaining({ outcome: 'failed', skippedTypes: 1, jobs: 2 }),
    ]);
  });

  it('never throws when SQS or DynamoDB fail (NFR-1): one failed line, ids and counts only', async () => {
    const { service, publisher, runs } = build();
    publisher.throwing = true;
    await expect(
      service.enqueueLot(LOAD, [member(1001)], new AiTally()),
    ).resolves.toBeUndefined();
    publisher.throwing = false;
    runs.throwing = true;
    await expect(
      service.enqueueLot(LOAD, [member(1002)], new AiTally()),
    ).resolves.toBeUndefined();
    const lines = aiLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ outcome: 'failed', error: 'Error' });
    expect(lines[1]).toMatchObject({
      outcome: 'failed',
      counterFailed: 1,
      sent: 2,
    });
  });

  it('counts the jobs SQS refused as failed', async () => {
    const { service, publisher } = build();
    publisher.failPerCall = 1;
    await service.enqueueLot(LOAD, [member(1001)], new AiTally());
    expect(aiLines()).toEqual([
      expect.objectContaining({ outcome: 'failed', sent: 1, failed: 1 }),
    ]);
  });

  it('disabled: sends nothing, writes no counter, reads no configuration, logs `disabled`', async () => {
    const { service, publisher, runs, fieldConfig } = build();
    publisher.enabled = false;
    await service.enqueueLot(LOAD, [member(1001)], new AiTally());
    expect(publisher.sent).toEqual([]);
    expect(runs.writes).toEqual([]);
    expect(fieldConfig.calls).toEqual([]);
    expect(aiLines()).toEqual([
      expect.objectContaining({ route: 'lot', outcome: 'disabled' }),
    ]);
  });
});

describe('requeue and status (FR-3)', () => {
  it('resends the jobs of the pending memberships and SETs expected', async () => {
    const { service, publisher, runs } = build([
      member(1001),
      member(1002, 'policy_change', 'auto_validated'),
    ]);
    expect(await service.requeue(11, 7)).toEqual({
      expected: 2,
      sent: 2,
      failed: 0,
    });
    expect(await service.requeue(11, 7)).toEqual({
      expected: 2,
      sent: 2,
      failed: 0,
    });
    expect(publisher.sent).toHaveLength(4);
    expect(runs.expected.get('load-7')).toBe(2);
  });

  it('404 for a load not of the timeline, before anything else', async () => {
    const { service } = build();
    await expect(service.requeue(12, 7)).rejects.toBeInstanceOf(
      LoadNotFoundError,
    );
    await expect(service.status(11, 8)).rejects.toBeInstanceOf(
      LoadNotFoundError,
    );
  });

  it('409 AI_JOBS_DISABLED when no queue is configured, for both routes', async () => {
    const { service, publisher } = build([member(1001)]);
    publisher.enabled = false;
    await expect(service.requeue(11, 7)).rejects.toBeInstanceOf(
      AiJobsDisabledError,
    );
    await expect(service.status(11, 7)).rejects.toBeInstanceOf(
      AiJobsDisabledError,
    );
    expect(publisher.sent).toEqual([]);
  });

  it('status: complete only when produced + unavailable == expected and none failed', async () => {
    const { service, runs } = build();
    expect(await service.status(11, 7)).toEqual({
      runId: 'load-7',
      expected: 0,
      produced: 0,
      unavailable: 0,
      failed: 0,
      complete: false,
    });
    runs.expected.set('load-7', 5);
    runs.worker.set('load-7', { produced: 3, unavailable: 1, failed: 1 });
    expect((await service.status(11, 7)).complete).toBe(false);
    runs.worker.set('load-7', { produced: 3, unavailable: 2, failed: 0 });
    expect(await service.status(11, 7)).toEqual({
      runId: 'load-7',
      expected: 5,
      produced: 3,
      unavailable: 2,
      failed: 0,
      complete: true,
    });
  });
});
