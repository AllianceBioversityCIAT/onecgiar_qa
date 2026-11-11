// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applicableFields,
  shapeCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { FieldCatalogSource } from '../admin-config/field-config/field-catalog.ports.js';
import type { RomeMinute } from '../admin-config/rome-date.js';
import { AuthorizationService } from '../users/authorization.service.js';
import type { AssignmentView } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import {
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
  InMemoryAssessmentWriteStore,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { AssessmentService } from './assessment.service.js';
import type { WorklistStep } from './worklist.store.js';

// The validation write over the fake unit of work (T-10 part A; FR-2, FR-10,
// FR-16, FR-21; design 5, 7.5). Expected values come from the scenarios of
// requirements.md and are written out. The clock of every test is pinned to an
// instant, and the step minutes of the clock tests are 09:00 and 17:30, which
// are NOT the fake's default step (a whole month, 00:00 to 23:59): a default
// step would let every boundary pass.

const catalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        '../admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const applicable = applicableFields(catalog, 'policy_change').map((f) => f.key);
// 12 Assessed, 5 View only, the rest Hidden (FR-10 *Check all skips other fields*).
const ASSESSED = applicable.slice(0, 12);
const VIEW_ONLY = applicable.slice(12, 17);
const HIDDEN = applicable.slice(17);

const items = (): ConfigItem[] =>
  applicable.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: ASSESSED.includes(fieldKey)
      ? 'assessed'
      : VIEW_ONLY.includes(fieldKey)
        ? 'view_only'
        : 'hidden',
    isCore: false,
    isAiInput: false,
  }));

const assignment = (
  roleCode: string,
  resultTypeKey: string | null,
): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey,
  programId: null,
});
const userOf = (
  id: number,
  assignments: AssignmentView[],
  programScope: number[] = [],
): AuthenticatedUser =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname: null,
    authSource: 'custom',
    isActive: true,
    assignments,
    programScope,
    exclusions: [],
  }) as AuthenticatedUser;
const assessorA = () =>
  userOf(10, [assignment('ASSESSOR', 'policy_change')], [1]);
const admin = () => userOf(99, [assignment('ADMIN', null)]);

const minute = (value: string) => value as RomeMinute;
/** Step 1 of the timeline, on the minutes a test names; steps 2 and 3 follow it. */
function stepsOf(opensAt: string, closesAt: string): WorklistStep[] {
  return [
    {
      position: 1,
      name: 'Step 1',
      audience: 'assessors',
      opensAt: minute(opensAt),
      closesAt: minute(closesAt),
    },
    {
      position: 2,
      name: 'Step 2',
      audience: 'programs',
      opensAt: minute('2027-01-01T00:00'),
      closesAt: minute('2027-01-31T23:59'),
    },
    {
      position: 3,
      name: 'Step 3',
      audience: 'lead_assessors',
      opensAt: minute('2027-02-01T00:00'),
      closesAt: minute('2027-02-28T23:59'),
    },
  ];
}

// Winter step: 09:00 Rome on 12 Nov to 17:30 Rome on 20 Nov 2026 (CET, UTC+1).
const WINTER = stepsOf('2026-11-12T09:00', '2026-11-20T17:30');
// A step open across the spring change (Rome moves to CEST at 02:00 on 29 Mar 2026).
const ACROSS_DST = stepsOf('2026-03-27T09:00', '2026-03-30T17:30');

let nextId = 1;
function setup(
  now: Date,
  steps: WorklistStep[] = WINTER,
  clockCalls: { count: number } = { count: 0 },
) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push({ id: 1, name: 'Official', kind: 'official', steps });
  world.timelineUsers.push({ timelineId: 1, userId: 10, roleCode: 'ASSESSOR' });
  world.users.push({ id: 10, nickname: 'Ana' }, { id: 99, nickname: 'Ada' });
  world.fieldConfigItems['policy_change'] = items();
  world.versionItems[1] = { policy_change: items() };
  const catalogs = {
    forYear: vi.fn(() => Promise.resolve(catalog)),
  } satisfies FieldCatalogSource;
  const service = new AssessmentService(
    new InMemoryAssessmentStore(world),
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    new FakeSnapshotStore(),
    catalogs,
    new FakeFieldConfigEffective(world),
    {
      listSciencePrograms: () => Promise.resolve([]),
      listResultTypes: () => Promise.resolve([]),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => {
      clockCalls.count += 1;
      return now;
    },
    new InMemoryAssessmentUnitOfWork(world),
  );
  const add = (
    resultCode: number,
    extra: Partial<FakeMembership> = {},
  ): FakeMembership => {
    const membership: FakeMembership = {
      id: nextId++,
      timelineId: 1,
      resultCode,
      title: `Title ${resultCode}`,
      programId: 1,
      resultTypeKey: 'policy_change',
      ...extra,
    };
    world.memberships.push(membership);
    return membership;
  };
  return { world, service, add, clockCalls };
}

/** What the filter and the interceptor would send: status and body of an HTTP exception. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const http = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    return { status: http.getStatus?.(), body: http.getResponse?.() };
  }
  throw new Error('expected a refusal');
}

const check = (fieldKeys: string[], validated = true) => ({
  validated,
  fieldKeys,
});
const RID = 'req-1';

/** Nothing was stored: no assessment row, no validation, no audit row, no transaction. */
function expectNothingStored(world: InMemoryAssessmentWorld) {
  expect(world.assessments).toEqual([]);
  expect(world.validations).toEqual([]);
  expect(world.audits).toEqual([]);
  expect(world.transactions).toBe(0);
}

describe('FR-2: the step window, judged by the injected clock', () => {
  // 09:00 and 17:30 Rome are accepted; 08:59 and 17:31 are refused.
  it.each([
    ['08:59 on the opening day', '2026-11-12T07:59:00Z', false],
    ['09:00 on the opening day', '2026-11-12T08:00:00Z', true],
    ['17:30 on the closing day', '2026-11-20T16:30:00Z', true],
    ['17:31 on the closing day', '2026-11-20T16:31:00Z', false],
  ])('%s (Rome, winter)', async (_name, instant, accepted) => {
    const { world, service, add } = setup(new Date(instant));
    add(5001);
    const run = service.validate(
      assessorA(),
      1,
      5001,
      check([ASSESSED[0]!]),
      RID,
    );
    if (accepted) {
      await run;
      expect(world.validations).toEqual([
        { assessmentId: 1000, fieldKey: ASSESSED[0], validated: true },
      ]);
    } else {
      expect(await refusal(run)).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_STEP_CLOSED' },
      });
      expectNothingStored(world);
    }
  });

  // The step is open across the change (offset +1 before, +2 after): the same
  // wall-clock minutes are different instants.
  it.each([
    ['08:59 CET, the minute before it opens', '2026-03-27T07:59:00Z', false],
    ['09:00 CET, when it opens', '2026-03-27T08:00:00Z', true],
    ['01:30 CET, before the change', '2026-03-29T00:30:00Z', true],
    ['03:30 CEST, after the change', '2026-03-29T01:30:00Z', true],
    ['17:30 CEST, when it closes', '2026-03-30T15:30:00Z', true],
    ['17:31 CEST, the minute after it closes', '2026-03-30T15:31:00Z', false],
  ])('a step open across the DST change: %s', async (_n, instant, accepted) => {
    const { world, service, add } = setup(new Date(instant), ACROSS_DST);
    add(5001);
    const run = service.validate(
      assessorA(),
      1,
      5001,
      check([ASSESSED[0]!]),
      RID,
    );
    if (accepted) {
      await run;
      expect(world.validations).toHaveLength(1);
    } else {
      expect(await refusal(run)).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_STEP_CLOSED' },
      });
      expectNothingStored(world);
    }
  });

  it('reads the clock once per request', async () => {
    const calls = { count: 0 };
    const { service, add } = setup(
      new Date('2026-11-12T08:00:00Z'),
      WINTER,
      calls,
    );
    add(5001);
    await service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID);
    expect(calls.count).toBe(1);
  });

  it('judges the step again under the timeline lock with the same minute: a step closed by an edit in between refuses and stores nothing', async () => {
    const { world, service, add } = setup(new Date('2026-11-12T08:00:00Z'));
    add(5001);
    world.beforeLockTimeline = () => {
      world.timelines[0]!.steps = stepsOf('2026-11-12T09:01', '2026-11-20T17:30');
    };
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expect(world.validations).toEqual([]);
    expect(world.audits).toEqual([]);
  });
});

const OPEN = new Date('2026-11-13T10:00:00Z');

describe('FR-10: validate, undo, check all', () => {
  it('has 12 Assessed, 5 View only and the rest Hidden fields in the fixture', () => {
    expect([ASSESSED.length, VIEW_ONLY.length]).toEqual([12, 5]);
    expect(HIDDEN.length).toBeGreaterThan(0);
  });

  it('check all sets exactly the 12 Assessed fields green and skips the others', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);

    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );

    expect(
      world.validations
        .filter((v) => v.validated)
        .map((v) => v.fieldKey)
        .sort(),
    ).toEqual([...ASSESSED].sort());
    expect(world.validations).toHaveLength(12);
    expect(summary.validations.map((v) => v.fieldKey).sort()).toEqual(
      [...ASSESSED].sort(),
    );
    expect(summary.validations.every((v) => v.validated)).toBe(true);
    expect(summary.status).toBe('pending');
  });

  it('uncheck all sets every Assessed field back to grey', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );

    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      { validated: false, all: true },
      RID,
    );

    expect(world.validations.every((v) => !v.validated)).toBe(true);
    expect(summary.validations.every((v) => !v.validated)).toBe(true);
    expect(summary.validations).toHaveLength(12);
  });

  it.each([
    ['a View only field', () => VIEW_ONLY[0]!],
    ['a Hidden field', () => HIDDEN[0]!],
    ['an unknown field', () => 'not.a_field'],
  ])(
    'a request naming %s answers 400 VALIDATION_FAILED naming it, and stores nothing',
    async (_name, key) => {
      const { world, service, add } = setup(OPEN);
      add(5001);
      const wrong = key();

      const got = await refusal(
        service.validate(
          assessorA(),
          1,
          5001,
          check([ASSESSED[0]!, wrong]),
          RID,
        ),
      );

      expect(got.status).toBe(400);
      expect(got.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [{ field: wrong, code: 'INVALID' }],
      });
      expectNothingStored(world);
    },
  );

  it('names every wrong key of the request, in the order sent', async () => {
    const { service, add } = setup(OPEN);
    add(5001);
    const got = await refusal(
      service.validate(
        assessorA(),
        1,
        5001,
        check([VIEW_ONLY[1]!, ASSESSED[0]!, 'nope']),
        RID,
      ),
    );
    expect(
      (got.body as { fields: Array<{ field: string }> }).fields.map(
        (f) => f.field,
      ),
    ).toEqual([VIEW_ONLY[1], 'nope']);
  });

  it('validates one field, undoes it, and audits each change once with the right action', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    const key = ASSESSED[2]!;

    await service.validate(assessorA(), 1, 5001, check([key]), 'req-a');
    await service.validate(assessorA(), 1, 5001, check([key], false), 'req-b');

    expect(world.validations).toEqual([
      { assessmentId: 1000, fieldKey: key, validated: false },
    ]);
    expect(world.audits).toEqual([
      {
        assessmentId: 1000,
        actorId: 10,
        action: 'validate',
        fieldKeys: [key],
        commentId: null,
        requestId: 'req-a',
        at: OPEN,
      },
      {
        assessmentId: 1000,
        actorId: 10,
        action: 'unvalidate',
        fieldKeys: [key],
        commentId: null,
        requestId: 'req-b',
        at: OPEN,
      },
    ]);
  });

  it('audits a check all and an uncheck all as one row each, naming the keys it changed and no value', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);

    await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      'req-a',
    );
    await service.validate(
      assessorA(),
      1,
      5001,
      { validated: false, all: true },
      'req-b',
    );

    expect(world.audits.map((a) => a.action)).toEqual([
      'check_all',
      'uncheck_all',
    ]);
    expect(world.audits[0]!.fieldKeys).toEqual(ASSESSED);
    expect(world.audits[1]!.fieldKeys).toEqual(ASSESSED);
    expect(Object.keys(world.audits[0]!).sort()).toEqual([
      'action',
      'actorId',
      'assessmentId',
      'at',
      'commentId',
      'fieldKeys',
      'requestId',
    ]);
  });

  describe('writing the state a field already has', () => {
    it('is a no-op: it succeeds, writes no validation and no audit row', async () => {
      const { world, service, add } = setup(OPEN);
      add(5001);
      const key = ASSESSED[0]!;
      await service.validate(assessorA(), 1, 5001, check([key]), RID);
      const before = {
        validations: structuredClone(world.validations),
        audits: structuredClone(world.audits),
      };
      world.writeLog = [];

      const summary = await service.validate(
        assessorA(),
        1,
        5001,
        check([key]),
        RID,
      );

      expect(world.validations).toEqual(before.validations);
      expect(world.audits).toEqual(before.audits);
      expect(world.writeLog).not.toContain('upsertValidations');
      expect(world.writeLog).not.toContain('insertAudit');
      expect(summary.validations).toEqual([{ fieldKey: key, validated: true }]);
    });

    it('applies and audits only the fields that change', async () => {
      const { world, service, add } = setup(OPEN);
      add(5001);
      const [green, grey] = [ASSESSED[0]!, ASSESSED[1]!];
      await service.validate(assessorA(), 1, 5001, check([green]), RID);

      await service.validate(assessorA(), 1, 5001, check([green, grey]), 'r2');

      expect(world.audits).toHaveLength(2);
      expect(world.audits[1]).toMatchObject({
        action: 'validate',
        fieldKeys: [grey],
      });
    });

    it('is a no-op for a grey field on an assessment with no validation row', async () => {
      const { world, service, add } = setup(OPEN);
      const membership = add(5001);
      world.assessments.push({
        id: 7,
        membershipId: membership.id,
        stepPosition: 1,
        status: 'pending',
      });

      await service.validate(
        assessorA(),
        1,
        5001,
        check([ASSESSED[0]!], false),
        RID,
      );

      expect(world.validations).toEqual([]);
      expect(world.audits).toEqual([]);
    });

    it('does not even create the assessment row when there is no row and the request only greys fields', async () => {
      const { world, service, add } = setup(OPEN);
      add(5001);

      const summary = await service.validate(
        assessorA(),
        1,
        5001,
        { validated: false, all: true },
        RID,
      );

      expect(summary).toEqual({
        status: 'pending',
        assessedBy: null,
        finishedAt: null,
        validations: [],
      });
      expectNothingStored(world);
    });
  });

  it('creates the assessment row at the first write, pinning the version and the role of the step', async () => {
    const { world, service, add } = setup(OPEN);
    const membership = add(5001);

    await service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID);

    expect(world.assessments).toEqual([
      {
        id: 1000,
        membershipId: membership.id,
        stepPosition: 1,
        status: 'pending',
        fieldConfigVersion: 1,
        roleCode: 'ASSESSOR',
        createdBy: 10,
      },
    ]);
  });

  it('judges the keys against the PINNED version, not the latest one', async () => {
    const { world, service, add } = setup(OPEN);
    const membership = add(5001);
    // The assessment pinned version 2, where VIEW_ONLY[0] is Assessed; the
    // latest items (version 1) read it View only.
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 2,
    });
    world.versionItems[2] = {
      policy_change: items().map((item) =>
        item.fieldKey === VIEW_ONLY[0]
          ? { ...item, visibility: 'assessed' as const }
          : item,
      ),
    };

    await service.validate(assessorA(), 1, 5001, check([VIEW_ONLY[0]!]), RID);

    expect(world.validations).toEqual([
      { assessmentId: 7, fieldKey: VIEW_ONLY[0], validated: true },
    ]);
  });

  it('answers 409 ASSESSMENT_NO_FIELD_CONFIG when the timeline resolves to no version, and stores nothing', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    world.noFieldConfigVersion = true;
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_NO_FIELD_CONFIG' },
    });
    expectNothingStored(world);
  });
});

describe('FR-16: no validation after the end', () => {
  it.each(['quality_assessed', 'returned'] as const)(
    'an assessment already %s answers 409 ASSESSMENT_FINISHED and stores nothing',
    async (status) => {
      const { world, service, add } = setup(OPEN);
      const membership = add(5001);
      world.assessments.push({
        id: 7,
        membershipId: membership.id,
        stepPosition: 1,
        status,
        finishedBy: 10,
        finishedAt: new Date('2026-11-13T09:00:00Z'),
      });

      expect(
        await refusal(
          service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
        ),
      ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
      expect(world.validations).toEqual([]);
      expect(world.audits).toEqual([]);
    },
  );

  it('re-reads the status UNDER the assessment lock: an end committed after the first read still refuses and writes nothing', async () => {
    const { world, service, add } = setup(OPEN);
    const membership = add(5001);
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
    });
    // Another request finishes the assessment between this one's reads and its lock.
    world.beforeLockAssessment = () => {
      world.assessments[0]!.status = 'returned';
    };

    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.validations).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('refuses a membership that already ended, with the same 409', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001, { ended: true, endReason: 'released_qaed' });
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expectNothingStored(world);
  });

  it('judges the step before the end: a closed step on a finished assessment is ASSESSMENT_STEP_CLOSED', async () => {
    const { world, service, add } = setup(new Date('2026-11-21T10:00:00Z'));
    const membership = add(5001);
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'returned',
    });
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
  });
});

describe('FR-1, FR-2: who may write', () => {
  it('answers the SAME 404 for a result outside the scope, one that does not exist and a timeline that is not the caller\'s', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    add(5002, { programId: 2 }); // the assessor's scope is program 1
    const outOfScope = await refusal(
      service.validate(assessorA(), 1, 5002, check([ASSESSED[0]!]), RID),
    );
    const missing = await refusal(
      service.validate(assessorA(), 1, 9999, check([ASSESSED[0]!]), RID),
    );
    const otherTimeline = await refusal(
      service.validate(assessorA(), 2, 5001, check([ASSESSED[0]!]), RID),
    );

    expect(outOfScope.status).toBe(404);
    expect(outOfScope.body).toMatchObject({ code: 'ASSESSMENT_NOT_FOUND' });
    expect(JSON.stringify(missing)).toBe(JSON.stringify(outOfScope));
    expect(JSON.stringify(otherTimeline)).toBe(JSON.stringify(outOfScope));
    expectNothingStored(world);
  });

  it('is the same 404 the read answers for the same result', async () => {
    const { service, add } = setup(OPEN);
    add(5002, { programId: 2 });
    const read = await refusal(service.open(assessorA(), 1, 5002));
    const write = await refusal(
      service.validate(assessorA(), 1, 5002, check([ASSESSED[0]!]), RID),
    );
    expect(JSON.stringify(write)).toBe(JSON.stringify(read));
  });

  it('keeps an ADMIN read-only: 403 ASSESSMENT_READ_ONLY, nothing stored', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    expect(
      await refusal(
        service.validate(admin(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 403, body: { code: 'ASSESSMENT_READ_ONLY' } });
    expectNothingStored(world);
  });

  it('lets an ADMIN who also holds the reviewer assignment write as the reviewer', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    world.timelineUsers.push({
      timelineId: 1,
      userId: 99,
      roleCode: 'ASSESSOR',
    });
    const both = userOf(
      99,
      [assignment('ADMIN', null), assignment('ASSESSOR', 'policy_change')],
      [1],
    );

    await service.validate(both, 1, 5001, check([ASSESSED[0]!]), RID);

    expect(world.audits).toHaveLength(1);
    expect(world.audits[0]!.actorId).toBe(99);
  });
});

describe('design 5 and 7.5: lock order, one transaction, the statements', () => {
  it('locks the timeline, then the assessment row, then writes the rows under it', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);

    await service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID);

    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'ensureAssessment',
      'lockAssessment',
      'findValidations',
      'upsertValidations',
      'insertAudit',
    ]);
    expect(world.transactions).toBe(1);
  });

  it('does not create the row again once it exists (a pinned row goes straight to its lock)', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    await service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID);
    world.writeLog = [];

    await service.validate(assessorA(), 1, 5001, check([ASSESSED[1]!]), RID);

    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'lockAssessment',
      'findValidations',
      'upsertValidations',
      'insertAudit',
    ]);
  });

  it('rolls the validations back when the audit row cannot be written: they commit together', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    const spy = vi
      .spyOn(InMemoryAssessmentWriteStore.prototype, 'insertAudit')
      .mockRejectedValueOnce(new Error('audit down'));
    try {
      await expect(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ).rejects.toThrow('audit down');
    } finally {
      spy.mockRestore();
    }
    expect(world.validations).toEqual([]);
    expect(world.assessments).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('runs 15 statements for a first write (3 reads, 5 for the configuration, 7 in the transaction) and 10 for the next (the pinned items are 1, the row is not created again)', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);

    world.resetStatements();
    await service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID);
    expect(world.statements).toBe(15);

    world.resetStatements();
    await service.validate(assessorA(), 1, 5001, check([ASSESSED[1]!]), RID);
    expect(world.statements).toBe(10);
  });
});

describe('part-B advisories on the validation write', () => {
  it('check all on a result with zero Assessed fields and no assessment row writes nothing: no row, no transaction (DD-3)', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    // The pinned and the resolved configuration show every field View only.
    const viewOnly = items().map((i) => ({
      ...i,
      visibility: 'view_only' as const,
    }));
    world.fieldConfigItems['policy_change'] = viewOnly;
    world.versionItems[1] = { policy_change: viewOnly };

    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );

    expect(summary).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [],
    });
    expectNothingStored(world);
  });

  describe('two concurrent FIRST writes', () => {
    const assessorB = () =>
      userOf(11, [assignment('ASSESSOR', 'policy_change')], [1]);

    it('leave one row, with the version and the creator of the writer that got there first', async () => {
      const { world, service, add } = setup(OPEN);
      add(5001);
      world.timelineUsers.push({
        timelineId: 1,
        userId: 11,
        roleCode: 'ASSESSOR',
      });
      // Each writer reads the configuration as it is at ITS read: A sees 1, B sees 2.
      world.effectiveVersions = [1, 2];

      await Promise.all([
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), 'req-a'),
        service.validate(assessorB(), 1, 5001, check([ASSESSED[1]!]), 'req-b'),
      ]);

      expect(world.assessments).toHaveLength(1);
      expect(world.assessments[0]).toMatchObject({
        status: 'pending',
        fieldConfigVersion: 1,
        createdBy: 10,
      });
      // Both writes landed on that one row, each audited.
      expect(world.validations.map((v) => v.assessmentId)).toEqual([
        world.assessments[0]!.id,
        world.assessments[0]!.id,
      ]);
      expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
        [ASSESSED[0], ASSESSED[1]].sort(),
      );
      expect(world.audits.map((a) => a.actorId).sort((x, y) => x - y)).toEqual([
        10, 11,
      ]);
    });

    it('and it is the FIRST writer, not user A: started the other way round, B keeps its version and creator', async () => {
      const { world, service, add } = setup(OPEN);
      add(5001);
      world.timelineUsers.push({
        timelineId: 1,
        userId: 11,
        roleCode: 'ASSESSOR',
      });
      world.effectiveVersions = [2, 1];

      await Promise.all([
        service.validate(assessorB(), 1, 5001, check([ASSESSED[1]!]), 'req-b'),
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), 'req-a'),
      ]);

      expect(world.assessments).toHaveLength(1);
      expect(world.assessments[0]).toMatchObject({
        fieldConfigVersion: 2,
        createdBy: 11,
      });
      expect(world.validations).toHaveLength(2);
    });
  });

  it('409 ASSESSMENT_STEP_CLOSED (no_step) when the timeline has no assessors step', async () => {
    const { world, service, add } = setup(OPEN);
    add(5001);
    world.timelines[0]!.steps = WINTER.filter((s) => s.audience !== 'assessors');

    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expectNothingStored(world);
  });

  it('an out-of-scope caller on a FINISHED assessment gets the same 404 as a missing code, not the 409', async () => {
    const { world, service, add } = setup(OPEN);
    const membership = add(5001);
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'quality_assessed',
    });
    const outOfScope = userOf(
      10,
      [assignment('ASSESSOR', 'policy_change')],
      [2],
    );

    const missing = await refusal(
      service.validate(assessorA(), 1, 9999, check([ASSESSED[0]!]), RID),
    );
    const finishedOutOfScope = await refusal(
      service.validate(outOfScope, 1, 5001, check([ASSESSED[0]!]), RID),
    );

    expect(missing).toMatchObject({
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
    expect(finishedOutOfScope).toEqual(missing);
    expect(world.validations).toEqual([]);
  });
});
