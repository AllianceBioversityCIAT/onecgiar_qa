// @akili-spec escalation/round-2
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  IN_LEAD_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';
import type {
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// The whole of round 2 over real HTTP (P2-3912 T-12; proposal § 13, FR-2): one
// result, built by the real load runner (`round-two-fixture.ts`), goes from a
// round-1 `returned` assessment and two program disagreements to the Lead's end.
// Two flows, one per end. Every branch of the rules is pinned in the suites
// beside it; here only the path through all of them. Expected values are
// written out from the scenarios.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!; // grey, a disagreed round-1 comment
const FIRST = ASSESSED[3]!; // grey, a disagreed round-1 comment
const lead = () => bearer('sub-lead');
const admin = () => bearer('sub-admin');

describe('Round 2 end to end (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const decide = (commentId: number, decision: string) =>
    a.send('put', resultPath(`/decisions/${commentId}`, code), {
      token: lead(),
      body: { decision, body: 'Reason given' },
    });
  const view = async () =>
    (await a.send('get', resultPath('', code), { token: lead() })).body.data;
  const fieldOf = (data: any, key: string) =>
    data.sections
      .flatMap((s: { fields: Array<{ key: string }> }) => s.fields)
      .find((f: { key: string }) => f.key === key);

  /** Round 1 returned, the program disagreed with each commented field, re-submitted. */
  const seed = async (core: string[], commented: string[]) => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core,
      changedFields: null,
      roundOneGreens: [CARRIED],
    });
    code = built.code;
    roundTwoId = built.roundTwoId;
    commented.forEach((fieldKey, i) => {
      plantRoundOneComment(a, built.roundOneId, 7001 + i, {
        state: 'disagreed',
        fieldKey,
      });
      plantProgramResponse(a, 1 + i, 7001 + i, 'disagree', 'Not so', 22);
    });
  };

  afterEach(async () => {
    await a.app.close();
  });

  it('agree on one, escalate the other, finish: Pending for TPB review, no release', async () => {
    await seed([CARRIED, SECOND, FIRST], [FIRST, SECOND]);

    const opened = await view();
    expect(opened.round).toBe(2);
    expect(fieldOf(opened, CARRIED)).toMatchObject({
      effectiveValidated: true,
      carried: true,
    });
    expect(fieldOf(opened, FIRST).thread).toMatchObject([
      {
        commentId: 7001,
        response: { kind: 'disagree' },
        decidable: true,
        choices: ['agree_program', 'escalate'],
      },
    ]);

    expect((await decide(7001, 'escalate')).body.data.status).toBe('pending');
    expect((await decide(7002, 'agree_program')).body.data.status).toBe(
      'pending',
    );
    // T-9 pointer: the validations answer carries the effective state, sorted by key.
    const put = await a.send('put', resultPath('/validations', code), {
      token: lead(),
      body: { validated: true, fieldKeys: [CARRIED] },
    });
    expect(put.status).toBe(200);
    expect(put.body.data.effectiveValidated).toEqual(
      [
        { fieldKey: CARRIED, validated: true },
        { fieldKey: SECOND, validated: true },
        { fieldKey: FIRST, validated: false },
      ].sort((x, y) => (x.fieldKey < y.fieldKey ? -1 : 1)),
    );

    const done = await a.send('post', resultPath('/finish', code), {
      token: lead(),
    });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('escalated');
    expect(a.world.releases).toEqual([]);
    expect(a.feed.callsOf('release')).toEqual([]);
    expect(roundTwo().ended).toBeFalsy();
    expect(
      a.world.comments
        .filter((c) => c.id >= 7001)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'escalated'],
      [7002, 'lead_sided_program'],
    ]);
    expect((await view()).header.status).toBe('pending_tpb_review');
    const listed = await a.send(
      'get',
      '/timelines/1/worklist?status=pending_tpb_review',
      { token: admin() },
    );
    expect(listed.body.data.rows.map((r: any) => r.membershipId)).toEqual([
      roundTwoId,
    ]);
  });

  it('agree on the only disagreement: Quality Assessed, one qaed, the ack ends released_qaed', async () => {
    await seed([CARRIED, FIRST], [FIRST]);
    a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
      phaseYear: q.phaseYear,
      released: q.items.map((item) => ({
        resultId: item.resultId,
        resultCode: code,
        outcome: item.outcome,
      })),
      notReleased: [],
    }));

    const res = await decide(7001, 'agree_program');

    expect(res.body.data.status).toBe('quality_assessed');
    expect(a.world.releases).toHaveLength(1);
    expect(a.world.releases[0]).toMatchObject({
      timelineResultId: roundTwoId,
      outcome: 'qaed',
    });
    await vi.waitFor(() => expect(roundTwo().endReason).toBe('released_qaed'));
    expect(a.feed.callsOf('release')).toHaveLength(1);
    expect((await view()).header.status).toBe('quality_assessed');
  });
});
