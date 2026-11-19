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

// Delete another reviewer's comment over real HTTP (P2-3912 T-10; FR-10, FR-11,
// OQ-8): the HTTP path only. Every branch of the rules is a unit spec over the
// in-memory stores (`assessment-delete.service.spec.ts`). Expected values are
// written out from the scenarios.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!; // grey, a disagreed round-1 comment
const FIRST = ASSESSED[3]!; // grey, a disagreed round-1 comment
const CORE = [CARRIED, SECOND, FIRST];
const lead = () => bearer('sub-lead');

interface ViewField {
  key: string;
  thread: Array<{ commentId: number }>;
}
const threadOf = (
  body: {
    data: { sections: Array<{ fields: ViewField[] }>; other: ViewField[] };
  },
  fieldKey: string,
) =>
  [...body.data.sections.flatMap((s) => s.fields), ...body.data.other]
    .find((f) => f.key === fieldKey)!
    .thread.map((item) => item.commentId);

describe('Delete another reviewer comment (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundOneId: number;
  let roundTwoId: number;

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core: CORE,
      changedFields: null,
      roundOneGreens: [CARRIED],
    });
    code = built.code;
    roundOneId = built.roundOneId;
    roundTwoId = built.roundTwoId;
    plantRoundOneComment(a, roundOneId, 7001, {
      state: 'open',
      fieldKey: FIRST,
    });
    plantRoundOneComment(a, roundOneId, 7003, {
      state: 'open',
      fieldKey: FIRST,
    });
    plantRoundOneComment(a, roundOneId, 7002, {
      state: 'disagreed',
      fieldKey: SECOND,
    });
  });

  afterEach(async () => {
    await a.app.close();
  });

  const remove = (commentId: number) =>
    a.send('post', `/assessment-comments/${commentId}/delete`, {
      token: lead(),
    });
  const open = () => a.send('get', resultPath('', code), { token: lead() });

  it('FR-10 Delete: the answer says who and when, the thread no longer lists the comment, and the comment history shows the deletion', async () => {
    expect(threadOf((await open()).body, FIRST)).toEqual([7001, 7003]);

    const res = await remove(7001);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 7001,
      state: 'open',
      deletedAt: '2026-11-25T10:00:00.000Z',
      deletedBy: a.users.lead.id,
    });
    expect(threadOf((await open()).body, FIRST)).toEqual([7003]);
    // The row stays, and its history names the Lead and the time.
    expect(a.world.comments.find((c) => c.id === 7001)).toMatchObject({
      state: 'open',
      deletedBy: a.users.lead.id,
    });
    expect(a.world.commentEvents).toEqual([
      expect.objectContaining({
        commentId: 7001,
        actorId: a.users.lead.id,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'open',
        toState: 'open',
        at: new Date('2026-11-25T10:00:00Z'),
      }),
    ]);
    expect(a.world.audits.map((x) => x.action)).toEqual(['comment_delete']);
  });

  it('FR-10 BUT a comment the program already answered is 409 ASSESSMENT_COMMENT_NOT_DELETABLE and stays in the thread', async () => {
    plantProgramResponse(a, 3001, 7002, 'disagree', 'We disagree', 22);

    const res = await remove(7002);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMMENT_NOT_DELETABLE');
    expect(a.world.comments.find((c) => c.id === 7002)!.deletedAt ?? null).toBe(
      null,
    );
    expect(a.world.commentEvents).toEqual([]);
    expect(threadOf((await open()).body, SECOND)).toEqual([7002]);
  });

  it('FR-10 BUT the Lead own comment is 409 ASSESSMENT_COMMENT_NOT_DELETABLE and nothing is written', async () => {
    const created = await a.send('post', resultPath('/comments', code), {
      token: lead(),
      body: { fieldKey: CARRIED, body: 'Noting this field' },
      key: 'own-comment-to-delete-1',
    });
    expect(created.status).toBe(201);
    const ownId = created.body.data.id as number;
    const before = JSON.stringify([
      a.world.comments,
      a.world.commentEvents,
      a.world.audits,
    ]);

    const res = await remove(ownId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMMENT_NOT_DELETABLE');
    expect(
      JSON.stringify([a.world.comments, a.world.commentEvents, a.world.audits]),
    ).toBe(before);
  });

  it('FR-10 BUT a comment outside the result types of the Lead is the same 404 body as a comment that does not exist, and nothing is written', async () => {
    const missing = await remove(987654);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ASSESSMENT_NOT_FOUND');

    // The same comment, on a result of a type the Lead does not review.
    a.world.memberships.find((m) => m.id === roundTwoId)!.resultTypeKey =
      'innovation_development';
    const outside = await remove(7001);

    expect(outside.status).toBe(404);
    expect(outside.body.error).toEqual(missing.body.error);
    expect(a.world.comments.every((c) => (c.deletedAt ?? null) === null)).toBe(
      true,
    );
    expect(a.world.commentEvents).toEqual([]);
    expect(a.world.audits).toEqual([]);
  });

  it('FR-11 BUT after the Lead review ended every delete is 409 ASSESSMENT_FINISHED and nothing is deleted', async () => {
    const decide = (commentId: number, decision: string) =>
      a.send('put', resultPath(`/decisions/${commentId}`, code), {
        token: lead(),
        body: { decision, body: 'Reason given' },
      });
    expect((await decide(7001, 'escalate')).status).toBe(200);
    expect((await decide(7002, 'agree_program')).status).toBe(200);
    const finished = await a.send('post', resultPath('/finish', code), {
      token: lead(),
    });
    expect(finished.status).toBe(200);
    expect(
      a.world.assessments.find((x) => x.membershipId === roundTwoId)!.status,
    ).toBe('escalated');

    const res = await remove(7003);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_FINISHED');
    expect(a.world.comments.every((c) => (c.deletedAt ?? null) === null)).toBe(
      true,
    );
  });
});
