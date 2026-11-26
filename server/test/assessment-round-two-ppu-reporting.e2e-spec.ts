// @akili-spec escalation/round-2-ppu
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import { IN_PPU_STEP, seedPpuWorld } from './support/round-two-fixture.js';
import type {
  FeedDetails,
  FeedDetailsQuery,
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// P2-3917 AC6 over real HTTP (FR-9, DD-P6): when the PPU opens a result with
// open cases, the case fields are read from Reporting and compared with the
// round-2 snapshot; the first date a difference is seen is stored and shown as
// `changedInReporting`. A Reporting failure never breaks the view (NFR-4).

const SECOND = ASSESSED[2]!;
const FIRST = ASSESSED[3]!;
const ppu = () => bearer('sub-ppu');
const tpb = () => bearer('sub-tpb');

describe('Changed in Reporting Tool (e2e, P2-3917 AC6)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  const seed = async () => {
    a = await buildAssessmentApp(IN_PPU_STEP);
    const built = await seedPpuWorld(a, {
      core: [SECOND, FIRST],
      decided: [
        { id: 7001, fieldKey: FIRST },
        { id: 7002, fieldKey: SECOND },
      ],
    });
    code = built.code;
    roundTwoId = built.roundTwoId;
  };
  /** Reporting answers the case fields with `values` (the snapshot holds neither key). */
  const reportingHas = (values: Record<string, unknown>) =>
    a.feed.script('details', (q: FeedDetailsQuery): FeedDetails => ({
      phase: q.phaseYear,
      catalogVersion: '1',
      results: q.resultIds.map((resultId) => ({
        resultId,
        resultCode: code,
        resultTypeKey: 'policy_change',
        values,
      })),
      notEligible: [],
    }));
  const fieldOf = (data: any, key: string) =>
    data.sections
      .flatMap((s: { fields: Array<{ key: string }> }) => s.fields)
      .find((f: { key: string }) => f.key === key);
  const open = async (token = ppu()) =>
    (await a.send('get', resultPath('', code), { token })).body.data;

  afterEach(async () => {
    await a.app.close();
  });

  it('marks the changed case field with the date first seen, and keeps that date on a later open', async () => {
    await seed();
    reportingHas({ [FIRST]: 'Corrected in Reporting' });

    const first = await open();
    expect(fieldOf(first, FIRST).changedInReporting).toEqual({
      detectedAt: '2026-12-04T10:00:00.000Z',
    });
    expect(fieldOf(first, SECOND).changedInReporting).toBeUndefined();
    // One details call, for this result and the open cases' fields only.
    expect(a.feed.callsOf('details')).toEqual([
      {
        phaseYear: expect.any(Number),
        resultIds: [expect.any(Number)],
        fieldKeys: [SECOND, FIRST].sort(),
      },
    ]);
    expect(a.world.reportingChanges).toEqual([
      {
        timelineResultId: roundTwoId,
        fieldKey: FIRST,
        detectedAt: new Date('2026-12-04T10:00:00.000Z'),
      },
    ]);

    a.setClock(new Date('2026-12-05T09:00:00Z'));
    const later = await open();
    expect(fieldOf(later, FIRST).changedInReporting).toEqual({
      detectedAt: '2026-12-04T10:00:00.000Z',
    });
    // Other readers of a result in step 5 see the mark too, without asking Reporting.
    const calls = a.feed.callsOf('details').length;
    expect(fieldOf(await open(tpb()), FIRST).changedInReporting).toEqual({
      detectedAt: '2026-12-04T10:00:00.000Z',
    });
    expect(a.feed.callsOf('details')).toHaveLength(calls);
  });

  it('marks nothing when Reporting holds the snapshot values', async () => {
    await seed();
    // A first open with Reporting down shows the snapshot values the TPB judged.
    a.feed.script('details', new Error('reporting down'));
    const before = await open();
    const snapshotValues = Object.fromEntries(
      [FIRST, SECOND]
        .filter((key) => !fieldOf(before, key).notApplicable)
        .map((key) => [key, fieldOf(before, key).value]),
    );
    a.feed.calls.length = 0;
    reportingHas(snapshotValues);
    const opened = await open();
    expect(a.feed.callsOf('details')).toHaveLength(1);
    expect(fieldOf(opened, FIRST).changedInReporting).toBeUndefined();
    expect(fieldOf(opened, SECOND).changedInReporting).toBeUndefined();
    expect(a.world.reportingChanges).toEqual([]);
  });

  it('opens the view when Reporting fails, with no mark', async () => {
    await seed();
    a.feed.script('details', new Error('reporting down'));
    const res = await a.send('get', resultPath('', code), { token: ppu() });
    expect(res.status).toBe(200);
    expect(fieldOf(res.body.data, FIRST).changedInReporting).toBeUndefined();
  });

  it('stops asking Reporting once the result is Quality Assessed, and keeps the marks', async () => {
    await seed();
    reportingHas({ [FIRST]: 'Corrected' });
    a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
      phaseYear: q.phaseYear,
      released: [],
      notReleased: [],
    }));
    await open();
    for (const id of [7001, 7002]) {
      await a.send('put', resultPath(`/decisions/${id}`, code), {
        token: ppu(),
        body: { decision: 'ppu_done' },
      });
    }
    const calls = a.feed.callsOf('details').length;
    const after = await open();
    expect(after.header.status).toBe('quality_assessed');
    expect(a.feed.callsOf('details')).toHaveLength(calls);
    expect(fieldOf(after, FIRST).changedInReporting).toEqual({
      detectedAt: '2026-12-04T10:00:00.000Z',
    });
  });
});
