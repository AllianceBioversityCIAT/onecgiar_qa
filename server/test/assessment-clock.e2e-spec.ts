// @akili-spec assessment/step-1-assessment
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  addSnapshotMembership,
  ASSESSED,
  IN_STEP_1,
  resultPath,
  seedTimeline,
} from './support/assessment-seed.js';

// FR-2 over real HTTP with the clock moved (T-14): step 1 opens 2026-11-12T09:00
// Rome and closes 2026-11-20T17:30 Rome (UTC+1 on those days: 08:00 and 16:30
// UTC). Every write route is refused with 409 `ASSESSMENT_STEP_CLOSED` outside
// the window and nothing is stored; the reads still answer. The clock is the
// `ADMIN_CONFIG_CLOCK` override of the app (`setClock`), never the host clock.

const FIELD = ASSESSED[1]!;
const policy = () => bearer('sub-policy');

/** UTC instants around the window of step 1. */
const BEFORE_OPEN = new Date('2026-11-12T07:59:00Z'); // 08:59 Rome
const AT_OPEN = new Date('2026-11-12T08:00:00Z'); // 09:00 Rome
const AT_CLOSE = new Date('2026-11-20T16:30:59Z'); // 17:30:59 Rome
const AFTER_CLOSE = new Date('2026-11-20T16:31:00Z'); // 17:31 Rome
const LONG_AFTER = new Date('2026-12-15T10:00:00Z');

describe('FR-2: the clock locks every write over HTTP (e2e)', () => {
  let a: AssessmentApp;

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_STEP_1);
    seedTimeline(a, []);
    await addSnapshotMembership(a, { [FIELD]: 'A value' });
  });

  afterEach(async () => {
    await a.app.close();
  });

  const write = {
    validate: () =>
      a.send('put', resultPath('/validations'), {
        token: policy(),
        body: { validated: true, fieldKeys: [FIELD] },
      }),
    comment: () =>
      a.send('post', resultPath('/comments'), {
        token: policy(),
        key: `clock-${Math.random()}`,
        body: { fieldKey: FIELD, body: 'A comment' },
      }),
    finish: () => a.send('post', resultPath('/finish'), { token: policy() }),
    withdraw: (id: number) =>
      a.send('post', `/assessment-comments/${id}/withdraw`, {
        token: policy(),
      }),
  };

  /** A comment written while the step is open, so a withdraw has something to refuse. */
  async function openComment(): Promise<number> {
    a.setClock(IN_STEP_1);
    const res = await write.comment();
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  it.each([
    ['before it opens (08:59 Rome)', BEFORE_OPEN],
    ['after it closes (17:31 Rome)', AFTER_CLOSE],
    ['long after the window', LONG_AFTER],
  ])(
    'every write route is 409 ASSESSMENT_STEP_CLOSED %s, and nothing is stored',
    async (_label, at) => {
      const commentId = await openComment();
      const before = {
        audits: a.world.audits.length,
        comments: a.world.comments.length,
        assessments: JSON.stringify(a.world.assessments),
        transactions: a.world.transactions,
      };
      a.setClock(at);

      for (const [name, call] of [
        ['validate', write.validate],
        ['comment', write.comment],
        ['finish', write.finish],
        ['withdraw', () => write.withdraw(commentId)],
      ] as const) {
        const res = await call();
        expect(res.status, name).toBe(409);
        expect(res.body.error.code, name).toBe('ASSESSMENT_STEP_CLOSED');
      }

      expect(a.world.audits).toHaveLength(before.audits);
      expect(a.world.comments).toHaveLength(before.comments);
      expect(JSON.stringify(a.world.assessments)).toBe(before.assessments);
      expect(a.world.comments[0]!.state).toBe('open');
      expect(a.world.releases).toEqual([]);
      // Refused before any transaction opened.
      expect(a.world.transactions).toBe(before.transactions);
    },
  );

  it('reads still answer outside the window, and say they are read-only', async () => {
    a.setClock(AFTER_CLOSE);
    for (const path of ['/timelines/1/worklist', resultPath('')]) {
      const res = await a.send('get', path, { token: policy() });
      expect(res.status, path).toBe(200);
      expect(res.body.data.writable, path).toBe(false);
    }
    const view = await a.send('get', resultPath(''), { token: policy() });
    expect(view.body.data.readOnlyReason).not.toBeNull();
    for (const path of ['/worklist/timelines', '/timelines/1/worklist/options']) {
      expect((await a.send('get', path, { token: policy() })).status, path).toBe(
        200,
      );
    }
    // Inside the window the same reads say writable.
    a.setClock(IN_STEP_1);
    for (const path of ['/timelines/1/worklist', resultPath('')]) {
      const res = await a.send('get', path, { token: policy() });
      expect(res.body.data.writable, path).toBe(true);
    }
  });

  it('the window is inclusive: the write succeeds at 09:00 and at 17:30 Rome', async () => {
    for (const at of [AT_OPEN, AT_CLOSE]) {
      a.setClock(at);
      const res = await write.validate();
      expect(res.status, at.toISOString()).toBe(200);
      // Back to grey so the second instant is a change too.
      a.setClock(IN_STEP_1);
      await a.send('put', resultPath('/validations'), {
        token: policy(),
        body: { validated: false, fieldKeys: [FIELD] },
      });
    }
  });

  it('judges the moment with the app clock, not the host clock', async () => {
    // The host clock (the real now) is far outside the window; only the override decides.
    a.setClock(IN_STEP_1);
    expect((await write.validate()).status).toBe(200);
    a.setClock(BEFORE_OPEN);
    const res = await a.send('put', resultPath('/validations'), {
      token: policy(),
      body: { validated: false, fieldKeys: [FIELD] },
    });
    expect(res.status).toBe(409);
  });
});
