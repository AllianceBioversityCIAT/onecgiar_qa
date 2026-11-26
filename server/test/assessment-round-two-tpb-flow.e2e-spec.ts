// @akili-spec escalation/round-2-tpb
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  IN_LEAD_STEP,
  IN_TPB_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  seedRoundTwoWorld,
  tpbStep,
} from './support/round-two-fixture.js';
import type {
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// Round 2 through step 4 over real HTTP (P2-3916 T-8): one result built by the
// real load runner (`round-two-fixture.ts`) goes from a round-1 `returned`
// assessment and two program disagreements, through the Lead's escalation in
// step 3, to the TPB's end in step 4. Two flows, one per TPB end. Every branch
// is pinned in `assessment-round-two-tpb.e2e-spec.ts`; here only the path.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!; // grey, a disagreed round-1 comment
const FIRST = ASSESSED[3]!; // grey, a disagreed round-1 comment
const lead = () => bearer('sub-lead');
const tpb = () => bearer('sub-tpb');
const admin = () => bearer('sub-admin');

describe('Lead escalates, TPB decides (e2e, P2-3916)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const decide = (token: string, commentId: number, decision: string) =>
    a.send('put', resultPath(`/decisions/${commentId}`, code), {
      token,
      body: { decision, body: 'Reason given' },
    });
  const finish = (token: string) =>
    a.send('post', resultPath('/finish', code), { token });
  const statusFor = async (token: string) =>
    (await a.send('get', resultPath('', code), { token })).body.data.header
      .status;

  /** Round 1 returned with FIRST and SECOND disagreed; steps 1-4; the Lead and a TPB assigned. */
  const seed = async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core: [CARRIED, SECOND, FIRST],
      changedFields: null,
      roundOneGreens: [CARRIED],
    });
    a.world.timelines[0]!.steps.push(tpbStep());
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.tpb.id,
      roleCode: 'TPB',
    });
    code = built.code;
    roundTwoId = built.roundTwoId;
    [FIRST, SECOND].forEach((fieldKey, i) => {
      plantRoundOneComment(a, built.roundOneId, 7001 + i, {
        state: 'disagreed',
        fieldKey,
      });
      plantProgramResponse(a, 1 + i, 7001 + i, 'disagree', 'Not so', 22);
    });
  };

  /** Step 3: the Lead escalates both disagreements and finishes; then the clock moves into step 4. */
  const leadEscalatesBoth = async () => {
    expect((await decide(lead(), 7001, 'escalate')).status).toBe(200);
    expect((await decide(lead(), 7002, 'escalate')).status).toBe(200);
    const done = await finish(lead());
    expect(done.body.data.status).toBe('escalated');
    // Before step 4 the TPB already sees it, read-only (OQ-2).
    expect(await statusFor(tpb())).toBe('pending_tpb_review');
    a.setClock(IN_TPB_STEP);
  };

  afterEach(async () => {
    await a.app.close();
  });

  it('TPB sides with the program on both: Quality Assessed, one qaed, the ack ends released_qaed', async () => {
    await seed();
    a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
      phaseYear: q.phaseYear,
      released: q.items.map((item) => ({
        resultId: item.resultId,
        resultCode: code,
        outcome: item.outcome,
      })),
      notReleased: [],
    }));
    await leadEscalatesBoth();

    const listed = await a.send('get', '/timelines/1/worklist', {
      token: tpb(),
    });
    expect(
      listed.body.data.rows.map((r: any) => [r.membershipId, r.status]),
    ).toEqual([[roundTwoId, 'pending_tpb_review']]);

    expect((await decide(tpb(), 7001, 'tpb_agree_program')).status).toBe(200);
    expect((await decide(tpb(), 7002, 'tpb_agree_program')).status).toBe(200);
    // DD-T1: still pending until Finish.
    expect(await statusFor(tpb())).toBe('pending_tpb_review');
    expect(a.world.releases).toEqual([]);

    const done = await finish(tpb());
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('quality_assessed');
    expect(a.world.releases).toHaveLength(1);
    expect(a.world.releases[0]).toMatchObject({
      timelineResultId: roundTwoId,
      outcome: 'qaed',
    });
    await vi.waitFor(() => expect(roundTwo().endReason).toBe('released_qaed'));
    expect(
      a.world.comments
        .filter((c) => (c.id ?? 0) >= 7001)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'tpb_sided_program'],
      [7002, 'tpb_sided_program'],
    ]);
    expect(await statusFor(admin())).toBe('quality_assessed');
  });

  it('TPB sides with the assessor on one: Pending PPU, no release, the membership stays in QA', async () => {
    await seed();
    await leadEscalatesBoth();

    expect((await decide(tpb(), 7001, 'tpb_agree_assessor')).status).toBe(200);
    expect((await decide(tpb(), 7002, 'tpb_agree_program')).status).toBe(200);
    const done = await finish(tpb());
    expect(done.body.data.status).toBe('escalated');
    expect(a.world.releases).toEqual([]);
    expect(a.feed.callsOf('release')).toEqual([]);
    expect(roundTwo().ended).toBeFalsy();
    expect(
      a.world.comments
        .filter((c) => (c.id ?? 0) >= 7001)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'tpb_sided_assessor'],
      [7002, 'tpb_sided_program'],
    ]);
    expect(await statusFor(admin())).toBe('pending_ppu');
    const filtered = await a.send(
      'get',
      '/timelines/1/worklist?status=pending_ppu',
      { token: admin() },
    );
    expect(
      filtered.body.data.rows.map((r: any) => r.membershipId),
    ).toEqual([roundTwoId]);
    // The Lead still reads its own review, and the current status.
    expect(await statusFor(lead())).toBe('pending_ppu');
  });
});
