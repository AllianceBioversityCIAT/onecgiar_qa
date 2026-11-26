// @akili-spec escalation/round-2-ppu
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  AFTER_PPU_STEP,
  IN_LEAD_STEP,
  IN_PPU_STEP,
  IN_TPB_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  ppuStep,
  seedRoundTwoWorld,
  tpbStep,
} from './support/round-two-fixture.js';
import type {
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// Round 2 through step 5 over real HTTP (P2-3917 T-7): one result built by the
// real load runner goes from two program disagreements in round 1, through the
// Lead's escalation (step 3) and the TPB siding with the assessor (step 4), to
// the PPU's Done (step 5). Two flows: Done inside step 5, and step 5 closed
// (Unresolved) then Done. Every branch is pinned in
// `assessment-round-two-ppu.e2e-spec.ts`; here only the path.

const CARRIED = ASSESSED[1]!;
const SECOND = ASSESSED[2]!;
const FIRST = ASSESSED[3]!;
const lead = () => bearer('sub-lead');
const tpb = () => bearer('sub-tpb');
const ppu = () => bearer('sub-ppu');
const admin = () => bearer('sub-admin');

describe('Lead escalates, TPB sides with the assessor, PPU closes (e2e, P2-3917)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const decide = (token: string, commentId: number, decision: string) =>
    a.send('put', resultPath(`/decisions/${commentId}`, code), {
      token,
      body:
        decision === 'ppu_done'
          ? { decision }
          : { decision, body: 'Reason given' },
    });
  const finish = (token: string) =>
    a.send('post', resultPath('/finish', code), { token });
  const statusFor = async (token: string) =>
    (await a.send('get', resultPath('', code), { token })).body.data.header
      .status;

  const seed = async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core: [CARRIED, SECOND, FIRST],
      changedFields: null,
      roundOneGreens: [CARRIED],
    });
    a.world.timelines[0]!.steps.push(tpbStep(), ppuStep());
    for (const [userId, roleCode] of [
      [a.users.tpb.id, 'TPB'],
      [a.users.ppu.id, 'PPU'],
    ] as const) {
      a.world.timelineUsers.push({ timelineId: 1, userId, roleCode });
    }
    code = built.code;
    roundTwoId = built.roundTwoId;
    [FIRST, SECOND].forEach((fieldKey, i) => {
      plantRoundOneComment(a, built.roundOneId, 7001 + i, {
        state: 'disagreed',
        fieldKey,
      });
      plantProgramResponse(a, 1 + i, 7001 + i, 'disagree', 'Not so', 22);
    });
    a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
      phaseYear: q.phaseYear,
      released: q.items.map((item) => ({
        resultId: item.resultId,
        resultCode: code,
        outcome: item.outcome,
      })),
      notReleased: [],
    }));
    // AC6 is not under test here: Reporting answers with no difference.
    a.feed.script('details', (q) => ({
      phase: q.phaseYear,
      catalogVersion: '1',
      results: [],
      notEligible: [],
    }));
  };

  /** Steps 3 and 4: the Lead escalates both; the TPB sides with the program on SECOND and with the assessor on FIRST. */
  const toPendingPpu = async () => {
    expect((await decide(lead(), 7001, 'escalate')).status).toBe(200);
    expect((await decide(lead(), 7002, 'escalate')).status).toBe(200);
    expect((await finish(lead())).body.data.status).toBe('escalated');
    a.setClock(IN_TPB_STEP);
    expect((await decide(tpb(), 7001, 'tpb_agree_assessor')).status).toBe(200);
    expect((await decide(tpb(), 7002, 'tpb_agree_program')).status).toBe(200);
    expect((await finish(tpb())).body.data.status).toBe('escalated');
    expect(a.world.releases).toEqual([]);
    expect(await statusFor(admin())).toBe('pending_ppu');
  };

  afterEach(async () => {
    await a.app.close();
  });

  it('PPU marks the case Done in step 5: Quality Assessed, one qaed, released', async () => {
    await seed();
    await toPendingPpu();
    a.setClock(IN_PPU_STEP);

    const listed = await a.send('get', '/timelines/1/worklist', { token: ppu() });
    expect(listed.body.data.rows.map((r: any) => [r.membershipId, r.status])).toEqual([
      [roundTwoId, 'pending_ppu'],
    ]);
    const opened = (await a.send('get', resultPath('', code), { token: ppu() })).body.data;
    const items = opened.sections
      .flatMap((s: any) => s.fields)
      .flatMap((f: any) => f.thread)
      .map((i: any) => [i.commentId, i.state, i.decidable]);
    expect(items).toEqual(
      expect.arrayContaining([
        [7001, 'tpb_sided_assessor', true],
        [7002, 'tpb_sided_program', false],
      ]),
    );

    const done = await decide(ppu(), 7001, 'ppu_done');
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('quality_assessed');
    expect(a.world.releases).toHaveLength(1);
    expect(a.world.releases[0]).toMatchObject({ timelineResultId: roundTwoId, outcome: 'qaed' });
    await vi.waitFor(() => expect(roundTwo().endReason).toBe('released_qaed'));
    expect(
      a.world.comments.filter((c) => (c.id ?? 0) >= 7001).map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'done'],
      [7002, 'tpb_sided_program'],
    ]);
    expect(await statusFor(admin())).toBe('quality_assessed');
  });

  it('step 5 closes with the case open: Unresolved for the PPU and the Admin, then Done ends it Quality Assessed', async () => {
    await seed();
    await toPendingPpu();
    a.setClock(AFTER_PPU_STEP);

    expect(await statusFor(ppu())).toBe('unresolved');
    const adminList = await a.send('get', '/timelines/1/worklist?status=unresolved', {
      token: admin(),
    });
    expect(adminList.body.data.rows.map((r: any) => r.membershipId)).toEqual([roundTwoId]);
    const ppuList = await a.send('get', '/timelines/1/worklist', { token: ppu() });
    expect(ppuList.body.data.counters).toMatchObject({ pending: 1, finished: 0 });
    expect(a.world.releases).toEqual([]);

    // No date window: the Done is accepted after step 5 closed.
    const done = await decide(ppu(), 7001, 'ppu_done');
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('quality_assessed');
    expect(a.world.releases).toHaveLength(1);
    await vi.waitFor(() => expect(roundTwo().endReason).toBe('released_qaed'));
    expect(await statusFor(admin())).toBe('quality_assessed');
  });
});
