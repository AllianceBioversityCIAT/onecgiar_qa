// @akili-spec assessment/step-1-assessment
import type request from 'supertest';
import {
  FeedError,
  type FeedRelease,
  type FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';
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
import { InMemoryAssessmentUnitOfWork } from './support/in-memory-assessment.js';
import { LogSpy } from './support/log-spy.js';
import { runRealLoad } from './support/real-load-writer.js';

// NFR-5, FR-22 (design 7.9): over every route of the assessment module, nothing
// a person wrote or a result holds reaches any log line, and each WRITE request
// writes exactly one `assessment` line with ids and fixed words only. The spy
// captures every sink (all `Logger` instances, the static logger, `console`,
// stdout and stderr), the pattern of `ingestion-loads-privacy`. The strings are
// planted in the places the module reads: the membership title, the snapshot
// value and label of an Assessed field, a comment body, a quick comment, the
// nicknames and the e-mails of the actors. Expected values are written out from
// the design, not imported.

const TITLE = 'general.title';
const PROGRAM = 'general.primary_program';
const CORE = ASSESSED[0]!;

const PLANTED_TITLE = 'Zebra-Moon-Title-7731';
const PLANTED_VALUE = 'Walrus-Heron-Value-5520';
const PLANTED_LABEL = 'Ocelot-Birch-Label-8842';
const PLANTED_BODY = 'Tapir-Quartz-Body-4419';
const PLANTED_BODY_2 = 'Lynx-Cobalt-Second-6603';
const PLANTED_QUICK = 'Marmot-Linen-Quick-2287';
const PLANTED_NICK = 'Quokka-Nick-9915';
const PLANTED_NICK_2 = 'Dingo-Nick-3308';
const NAMES = {
  policy: { first: 'Okapi-First-1184', last: 'Sorrel-Last-2297' },
  policy2: { first: 'Gannet-First-5521', last: 'Vetch-Last-6630' },
  admin: { first: 'Ibex-First-7743', last: 'Plover-Last-8856' },
};
const PLANTED_ERROR = 'sk-live-exploded-0042';

const ALLOWED_KEYS = [
  'action',
  'actorId',
  'event',
  'membershipId',
  'outcome',
  'reason',
  'requestId',
  'timelineId',
];
const ACTIONS = [
  'validate',
  'comment',
  'withdraw',
  'finish',
  'quick_comment_save',
];

/** The ids every write on the seeded result names. */
const ROW = { timelineId: 1, membershipId: 1 };
const policy = () => bearer('sub-policy');
const admin = () => bearer('sub-admin');
const releasedAll = (q: FeedReleaseQuery): FeedRelease => ({
  phaseYear: q.phaseYear,
  released: q.items.map((item) => ({
    resultId: item.resultId,
    resultCode: 5001,
    outcome: item.outcome,
  })),
  notReleased: [],
});

describe('NFR-5 / FR-22: the assessment routes log ids and fixed words only', () => {
  let a: AssessmentApp;
  const spy = new LogSpy();
  let secrets: string[];

  beforeEach(async () => {
    spy.lines.length = 0;
    a = await buildAssessmentApp(IN_STEP_1, {
      nicknames: { policy: PLANTED_NICK, policy2: PLANTED_NICK_2 },
      names: NAMES,
    });
    seedTimeline(a, [CORE]);
    // The snapshot is written by the real runner BEFORE the spy is attached: this suite is about the module under test.
    const real = await runRealLoad([
      {
        resultId: 1001,
        values: {
          [TITLE]: PLANTED_TITLE,
          [PROGRAM]: 3,
          [ASSESSED[2]!]: PLANTED_VALUE,
        },
        labels: { initiatives: { '3': PLANTED_LABEL } },
      },
    ]);
    const written = real.memberships[0]!;
    for (const snapshot of await real.snapshots.history(written.resultCode)) {
      await a.snapshots.put(snapshot);
    }
    addMembership(a, { id: 1, resultCode: written.resultCode, title: PLANTED_TITLE });
    a.world.memberships[0]!.snapshotSk = written.snapshotSk;
    spy.attach();
    // stdout and stderr too: a `process.stdout.write` would bypass every logger.
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
        spy.lines.push(String(chunk));
        return true;
      }) as never);
    }
    secrets = [
      PLANTED_TITLE,
      PLANTED_VALUE,
      PLANTED_LABEL,
      PLANTED_BODY,
      PLANTED_BODY_2,
      PLANTED_QUICK,
      PLANTED_NICK,
      PLANTED_NICK_2,
      PLANTED_ERROR,
      ...Object.values(NAMES).flatMap((n) => [n.first, n.last]),
      'sub-policy@cgiar.org',
      'sub-policy2@cgiar.org',
      'sub-admin@cgiar.org',
      bearer('sub-policy').replace('Bearer ', ''),
    ].map((s) => s.toLowerCase());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    spy.detach();
    await a.app.close();
  });

  const idOf = (res: request.Response) => res.headers['x-request-id'] as string;

  /** The `assessment` line(s) of a request, parsed. */
  const lineOf = (res: request.Response) =>
    spy.eventsOf('assessment', idOf(res));

  /**
   * The WHOLE line, exactly (design 7.9): the keys it may carry and their values.
   * `ids` leaves `timelineId` and `membershipId` out only where the design allows:
   * a result that is not there has no membership, and a quick comment belongs to
   * no result at all.
   */
  function expectDecisionLine(
    res: request.Response,
    action: string,
    actorId: number,
    outcome: 'ok' | 'refused' | 'error',
    ids: { timelineId?: number; membershipId?: number },
    reason?: string,
  ) {
    const lines = lineOf(res);
    expect(lines, `${action}: one line`).toHaveLength(1);
    expect(ACTIONS).toContain(action);
    expect(lines[0]).toEqual({
      event: 'assessment',
      action,
      ...ids,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      requestId: idOf(res),
      actorId,
    });
    expect(Object.keys(lines[0]!).every((k) => ALLOWED_KEYS.includes(k))).toBe(
      true,
    );
  }

  it('plants strings in every place the module reads, calls every route, and none reaches a log; each write has one fixed-shape line', async () => {
    // Reporting is down for the first dispatch, then answers: both outcomes are logged.
    a.feed.script(
      'release',
      new FeedError('unavailable', 503),
      new FeedError('unavailable', 503),
      new FeedError('unavailable', 503),
      releasedAll,
    );

    // ---- reads (no `assessment` line: only writes have one) ----
    const reads = [
      await a.send('get', '/worklist/timelines', { token: policy() }),
      await a.send('get', '/timelines/1/worklist', { token: policy() }),
      await a.send('get', '/timelines/1/worklist/options', { token: policy() }),
      await a.send('get', resultPath(''), { token: policy() }),
      await a.send('get', '/quick-comments?role=ASSESSOR', { token: policy() }),
      await a.send('get', '/assessment-releases', { token: admin() }),
    ];
    for (const res of reads) {
      expect(res.status).toBe(200);
      expect(lineOf(res)).toEqual([]);
    }
    // The planted title really travels in the answer: the check is against a string in play.
    expect(JSON.stringify(reads[1]!.body)).toContain(PLANTED_TITLE);
    // The planted snapshot value really is in the view's answer too.
    expect(JSON.stringify(reads[3]!.body)).toContain(PLANTED_VALUE);

    // ---- writes ----
    const validated = await a.send('put', resultPath('/validations'), {
      token: policy(),
      body: { validated: true, fieldKeys: [ASSESSED[1]] },
    });
    expect(validated.status).toBe(200);
    expectDecisionLine(validated, 'validate', a.users.policy.id, 'ok', ROW);

    const badField = await a.send('put', resultPath('/validations'), {
      token: policy(),
      body: { validated: true, fieldKeys: [`not.a.field.${PLANTED_ERROR}`] },
    });
    expect(badField.status).toBe(400);
    expectDecisionLine(badField, 'validate', a.users.policy.id, 'refused', ROW, 'VALIDATION_FAILED');

    const commented = await a.send('post', resultPath('/comments'), {
      token: policy(),
      key: 'privacy-key-1',
      body: { fieldKey: PROGRAM, body: PLANTED_BODY },
    });
    expect(commented.status).toBe(201);
    // The comment copied the planted value and label into the answer (they are in play).
    expect(JSON.stringify(commented.body)).toContain(PLANTED_LABEL);
    expectDecisionLine(commented, 'comment', a.users.policy.id, 'ok', ROW);

    const second = await a.send('post', resultPath('/comments'), {
      token: policy(),
      key: 'privacy-key-2',
      body: { fieldKey: CORE, body: PLANTED_BODY_2 },
    });
    expect(second.status).toBe(201);
    expectDecisionLine(second, 'comment', a.users.policy.id, 'ok', ROW);

    const withdrawn = await a.send(
      'post',
      `/assessment-comments/${commented.body.data.id}/withdraw`,
      { token: policy() },
    );
    expect(withdrawn.status).toBe(200);
    expectDecisionLine(withdrawn, 'withdraw', a.users.policy.id, 'ok', ROW);
    const withdrawnAgain = await a.send(
      'post',
      `/assessment-comments/${commented.body.data.id}/withdraw`,
      { token: policy() },
    );
    expect(withdrawnAgain.status).toBe(409);
    expectDecisionLine(
      withdrawnAgain,
      'withdraw',
      a.users.policy.id,
      'refused',
      ROW,
      'ASSESSMENT_COMMENT_NOT_OPEN',
    );

    const quick = await a.send('post', '/quick-comments', {
      token: policy(),
      body: { role: 'ASSESSOR', body: PLANTED_QUICK },
    });
    expect(quick.status).toBe(201);
    expectDecisionLine(quick, 'quick_comment_save', a.users.policy.id, 'ok', {});
    // The saved text comes back in the list: its absence from the logs below is meaningful.
    const quickList = await a.send('get', '/quick-comments?role=ASSESSOR', {
      token: policy(),
    });
    expect(quickList.status).toBe(200);
    expect(JSON.stringify(quickList.body)).toContain(PLANTED_QUICK);
    const quickDenied = await a.send('post', '/quick-comments', {
      token: bearer('sub-admin'),
      body: { role: 'ASSESSOR', body: PLANTED_QUICK },
    });
    expect(quickDenied.status).toBe(403);
    expectDecisionLine(
      quickDenied,
      'quick_comment_save',
      a.users.admin.id,
      'refused',
      {},
      'AUTH_PERMISSION_DENIED',
    );

    // CORE is grey with a comment: finish ends it `returned`.
    const finished = await a.send('post', resultPath('/finish'), {
      token: policy(),
    });
    expect(finished.status).toBe(200);
    expectDecisionLine(finished, 'finish', a.users.policy.id, 'ok', ROW);
    const finishedAgain = await a.send('post', resultPath('/finish'), {
      token: policy(),
    });
    expect(finishedAgain.status).toBe(409);
    expectDecisionLine(
      finishedAgain,
      'finish',
      a.users.policy.id,
      'refused',
      ROW,
      'ASSESSMENT_FINISHED',
    );
    // A result that is not there: the line says so with the same word as the answer.
    const missing = await a.send('post', resultPath('/finish', 9999), {
      token: policy(),
    });
    expect(missing.status).toBe(404);
    // No membership to name: only the timeline of the URL.
    expectDecisionLine(missing, 'finish', a.users.policy.id, 'refused', { timelineId: 1 }, 'ASSESSMENT_NOT_FOUND');

    // ---- the dispatcher: the end's own send failed (503 x3), the admin retry sends ----
    await vi.waitFor(() => expect(a.feed.callsOf('release')).toHaveLength(3));
    await vi.waitFor(() => expect(a.world.releases[0]!.status).toBe('pending'));
    // The first dispatch gave up: the row is leased, so move the lease to the past, as a minute would.
    for (const release of a.world.releases) {
      a.world.metaOf(release).leaseUntil = new Date(0);
    }
    const listed = await a.send('get', '/assessment-releases?status=pending', {
      token: admin(),
    });
    expect(listed.status).toBe(200);
    const retry = await a.send('post', '/assessment-releases/retry', {
      token: admin(),
    });
    expect(retry.status).toBe(200);
    expect(a.world.releases[0]!.status).toBe('sent');

    // ---- the evidence ----
    const dispatcherLines = spy.lines.filter((l) =>
      l.includes('"event":"assessment_release"'),
    );
    expect(dispatcherLines.length).toBeGreaterThanOrEqual(2);
    const haystack = spy.lines.join('\n').toLowerCase();
    for (const secret of secrets) expect(haystack).not.toContain(secret);
    // Every `assessment` line of the run is one of the writes above (no stray line).
    const decisionLines = spy.lines.filter((l) =>
      l.includes('"event":"assessment"'),
    );
    expect(decisionLines).toHaveLength(11);
  });

  it('a forced 5xx (the store rejects with a message that carries a secret) is logged as error with a fixed word, and neither the logs nor the answer carry the message', async () => {
    vi.spyOn(InMemoryAssessmentUnitOfWork.prototype, 'run').mockRejectedValue(
      new Error(`connection lost near ${PLANTED_ERROR}`),
    );

    const res = await a.send('put', resultPath('/validations'), {
      token: policy(),
      body: { validated: true, fieldKeys: [ASSESSED[1]] },
    });

    expect(res.status).toBe(500);
    expectDecisionLine(
      res,
      'validate',
      a.users.policy.id,
      'error',
      ROW,
      'internal_error',
    );
    expect(res.text.toLowerCase()).not.toContain(PLANTED_ERROR.toLowerCase());
    const haystack = spy.lines.join('\n').toLowerCase();
    for (const secret of secrets) expect(haystack).not.toContain(secret);
  });
});
