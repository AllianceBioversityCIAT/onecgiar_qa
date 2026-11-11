// @akili-spec assessment/step-1-assessment
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  addMembership,
  ASSESSED,
  IN_STEP_1,
  resultPath,
  seedTimeline,
} from './support/assessment-seed.js';

// FR-17 over real HTTP (T-14): of several parallel ends exactly one wins and
// the database decides. The fake has no row lock, so `holdLockUntil` parks every
// request at the lock until all of them arrived: each then reads the row as
// `pending` and they reach the conditional end UPDATE together, the one path
// where "exactly one" is decided. Each test asserts that the UPDATE really was
// attempted by every request (`writeLog`), so a green run cannot mean the
// requests never raced.

const CORE = ASSESSED[0]!;
const policy = () => bearer('sub-policy');
const policy2 = () => bearer('sub-policy2');

describe('FR-17: concurrent ends over HTTP (e2e)', () => {
  let a: AssessmentApp;

  afterEach(async () => {
    await a.app.close();
  });

  const pendingRow = () =>
    a.world.assessments.push({
      id: 1,
      membershipId: 1,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 1,
    });
  const endAttempts = () =>
    a.world.writeLog.filter((entry) => entry === 'endAssessment').length;

  it('five parallel finishes: one 200, four 409 ASSESSMENT_FINISHED, one release row, one end audit row', async () => {
    a = await buildAssessmentApp(IN_STEP_1);
    seedTimeline(a, []);
    addMembership(a);
    pendingRow();
    a.world.holdLockUntil = 5;

    const responses = await Promise.all(
      [policy(), policy2(), policy(), policy2(), policy()].map((token) =>
        a.send('post', resultPath('/finish'), { token }),
      ),
    );

    // Every request reached the conditional UPDATE and the database let one through.
    expect(endAttempts()).toBe(5);
    expect(a.world.endUpdatesMatched).toBe(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    const refused = responses.filter((r) => r.status === 409);
    expect(refused).toHaveLength(4);
    for (const res of refused) {
      expect(res.body.error.code).toBe('ASSESSMENT_FINISHED');
    }
    expect(a.world.releases).toHaveLength(1);
    expect(
      a.world.audits.filter((x) => x.action.startsWith('end_')),
    ).toHaveLength(1);
    // The assessment ended once, by the caller who got the 200.
    const winner = responses.find((r) => r.status === 200)!;
    expect(a.world.assessments[0]!.status).toBe('quality_assessed');
    expect(winner.body.data.assessedBy.id).toBe(
      a.world.assessments[0]!.finishedBy,
    );
  });

  it('a finish racing the validation that turns the last core field green: one end, the other 409, and the loser leaves nothing', async () => {
    a = await buildAssessmentApp(IN_STEP_1);
    seedTimeline(a, [CORE]);
    addMembership(a);
    pendingRow();
    // The core field is grey and commented: a finish would end it `returned`, the validation `quality_assessed`.
    a.world.comments.push({
      id: 4001,
      assessmentId: 1,
      authorId: a.users.policy.id,
      state: 'open',
      fieldKey: CORE,
      body: 'Vague',
    });
    a.world.holdLockUntil = 2;

    const [validated, finished] = await Promise.all([
      a.send('put', resultPath('/validations'), {
        token: policy(),
        body: { validated: true, fieldKeys: [CORE] },
      }),
      a.send('post', resultPath('/finish'), { token: policy2() }),
    ]);

    expect(endAttempts()).toBe(2);
    expect(a.world.endUpdatesMatched).toBe(1);
    expect([validated.status, finished.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const loser = validated.status === 409 ? validated : finished;
    expect(loser.body.error.code).toBe('ASSESSMENT_FINISHED');
    expect(a.world.releases).toHaveLength(1);
    expect(
      a.world.audits.filter((x) => x.action.startsWith('end_')),
    ).toHaveLength(1);
    // One coherent end: the status, the release outcome and the audit action agree on the winner.
    const status = a.world.assessments[0]!.status;
    expect(status).toBe(
      validated.status === 200 ? 'quality_assessed' : 'returned',
    );
    expect(a.world.releases[0]!.outcome).toBe(
      validated.status === 200 ? 'qaed' : 'not_qaed',
    );
    // A losing validation was rolled back whole: no green core row and no `validate` audit row.
    if (finished.status === 200) {
      expect(
        a.world.audits.filter((x) => x.action === 'validate'),
      ).toHaveLength(0);
    }
  });
});
