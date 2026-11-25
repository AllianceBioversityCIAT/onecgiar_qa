// @akili-spec assessment/ai-suggestions
import type request from 'supertest';
import { assertAiSchema } from './support/ai-contract.js';
import {
  bearer,
  buildIngestionApp,
  scriptFeed,
  type IngestionApp,
} from './support/ingestion-app.js';
import { LogSpy } from './support/log-spy.js';

// Spec assessment/ai-suggestions FR-2, FR-3, NFR-1, NFR-2 over the real app:
// a real sync of timeline 11 sends its AI jobs through the fake publisher, and
// the two admin routes read and resend them. Expected values are literals: 60
// results, the first 5 KPs (books: `not_in_qa`, no job), 55 policy changes
// (pending; 2 AI-input production fields each in the fake configuration).

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ success: false, error: { status, code } });
}

describe('AI jobs of a sync (FR-2, FR-3)', () => {
  let w: IngestionApp;
  const spy = new LogSpy();

  beforeEach(async () => {
    w = await buildIngestionApp();
    spy.attach();
    from = spy.lines.length;
  });

  afterEach(async () => {
    try {
      await w.settled(11);
    } catch {
      // nothing started
    }
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  let from = 0;
  /** The `ai_enqueue` lines this test wrote (the spy keeps every test's lines). */
  const aiLines = () =>
    spy.lines.slice(from).filter((l) => l.includes('"ai_enqueue"'));

  const sync = async () => {
    scriptFeed(w.feed, { total: 60, kps: 5 });
    const started = await w.send('post', '/timelines/11/loads');
    expect(started.status).toBe(202);
    const [load] = await w.settled(11);
    expect(load).toMatchObject({ status: 'completed' });
    return started.body.data.id as number;
  };

  it('sends one job per pending result and eligible field, over two lots, and SETs expected', async () => {
    const loadId = await sync();
    expect(w.ai.publisher.sent).toHaveLength(110);
    for (const job of w.ai.publisher.sent)
      assertAiSchema('ai-job-message', job);
    expect(new Set(w.ai.publisher.sent.map((j) => j.runId))).toEqual(
      new Set([`load-${loadId}`]),
    );
    expect(w.ai.publisher.sent.map((j) => j.fieldKey).slice(0, 2)).toEqual([
      'general.gender_tag',
      'general.poverty_tag',
    ]);
    expect(w.ai.publisher.sent.some((j) => Number(j.resultCode) <= 1005)).toBe(
      false,
    );
    // Lot 1: 45 policy changes, lot 2: 10.
    expect(w.ai.runs.writes.map((x) => x.expected)).toEqual([90, 110]);
    // The snapshot each job names is the one the load wrote.
    const [job] = w.ai.publisher.sent;
    expect(
      await w.snapshots.get(Number(job!.resultCode), job!.snapKey),
    ).not.toBeNull();
  });

  it('a failing queue never fails the load (NFR-1); the line has ids and counts only (NFR-2)', async () => {
    w.ai.publisher.throwing = true;
    await sync();
    const lines = aiLines();
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ outcome: 'failed' });
      expect(line).not.toMatch(/Result title|sqs\.|https?:/);
    }
  });

  it('GET reads the run; POST resends the pending jobs and SETs the same expected', async () => {
    const loadId = await sync();
    w.ai.runs.worker.set(`load-${loadId}`, {
      produced: 100,
      unavailable: 10,
      failed: 0,
    });
    const status = await w.send('get', `/timelines/11/loads/${loadId}/ai-jobs`);
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual({
      runId: `load-${loadId}`,
      expected: 110,
      produced: 100,
      unavailable: 10,
      failed: 0,
      complete: true,
    });

    const again = await w.send('post', `/timelines/11/loads/${loadId}/ai-jobs`);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ expected: 110, sent: 110, failed: 0 });
    expect(w.ai.publisher.sent).toHaveLength(220);
    expect(w.ai.publisher.sent.slice(110)).toEqual(
      expect.arrayContaining(w.ai.publisher.sent.slice(0, 110)),
    );
    expect(w.ai.runs.expected.get(`load-${loadId}`)).toBe(110);
  });

  it('only ADMIN may call them (403 before anything runs)', async () => {
    const loadId = await sync();
    for (const sub of ['sub-assessor', 'sub-tpb', 'sub-ppu', 'sub-guest']) {
      for (const method of ['get', 'post'] as const) {
        const res = await w.send(
          method,
          `/timelines/11/loads/${loadId}/ai-jobs`,
          { token: bearer(sub) },
        );
        expectError(res, 403, 'AUTH_PERMISSION_DENIED');
      }
    }
    expect(w.ai.publisher.sent).toHaveLength(110);
  });

  it('404 for an unknown load or a load of another timeline', async () => {
    const loadId = await sync();
    for (const method of ['get', 'post'] as const) {
      expectError(
        await w.send(method, `/timelines/11/loads/999/ai-jobs`),
        404,
        'LOADS_NOT_FOUND',
      );
      expectError(
        await w.send(method, `/timelines/12/loads/${loadId}/ai-jobs`),
        404,
        'LOADS_NOT_FOUND',
      );
    }
  });

  it('disabled: the sync sends nothing and both routes answer 409 AI_JOBS_DISABLED with the fixed message', async () => {
    w.ai.publisher.enabled = false;
    const loadId = await sync();
    expect(w.ai.publisher.sent).toEqual([]);
    expect(w.ai.runs.writes).toEqual([]);
    const lines = aiLines();
    expect(lines.map((l) => JSON.parse(l).outcome)).toEqual([
      'disabled',
      'disabled',
    ]);
    for (const method of ['get', 'post'] as const) {
      const res = await w.send(method, `/timelines/11/loads/${loadId}/ai-jobs`);
      expectError(res, 409, 'AI_JOBS_DISABLED');
      expect(res.body.error.message).toBe('AI disabled: no queue configured.');
    }
  });
});
