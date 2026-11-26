// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import {
  AuthorizationService,
  type AssignmentView,
  type AuthorizationSubject,
} from '../users/authorization.service.js';
import {
  coversProgram,
  coversResultType,
  type ProgramExclusionView,
} from '../users/effective-scope.js';
import { Permission } from '../users/permissions.js';
import {
  actingRoleOf,
  actsAsAdmin,
  clarificationOpen,
  inScope,
  listedFor,
  resolveAccess,
  rowCovers,
  writeDecision,
  type MembershipFacts,
} from './scope.js';

// Expected values are literals from FR-1 and FR-2 (requirements.md) and from
// design 7.1. SP01, SP02, SP03 are the program ids 1, 2, 3. Rome is UTC+1 on
// the dates used; step 1 is open 2026-11-12T09:00 .. 2026-11-20T17:30 and step
// 2 (programs) 2026-11-23T09:00 .. 2026-11-27T17:30.

const SP01 = 1;
const SP02 = 2;
const SP03 = 3;

const minute = (value: string) => value as RomeMinute;
const steps: TimelineViewStep[] = [
  {
    position: 1,
    audience: 'assessors',
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    audience: 'programs',
    opensAt: minute('2026-11-23T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
];
const timing = (utc: string, hasLoad = true) => ({
  steps,
  now: nowInRome(new Date(utc)),
  hasLoad,
});
const STEP1_OPEN = '2026-11-15T10:00:00Z';
const STEP2_OPEN = '2026-11-24T10:00:00Z';

function grant(
  roleCode: string,
  resultTypeKey: string | null,
  change: Partial<AssignmentView> = {},
): AssignmentView {
  return {
    roleCode,
    roleIsActive: true,
    isActive: true,
    revokedAt: null,
    resultTypeKey,
    programId: null,
    ...change,
  };
}

function user(
  assignments: AssignmentView[],
  programScope: number[] = [],
  exclusions: ProgramExclusionView[] = [],
): AuthorizationSubject {
  return { assignments, programScope, exclusions };
}

// `scope.ts` holds no permission check: its caller answers `ADMIN_ACCESS`. The
// specs ask a local `AuthorizationService`, as the users specs do, so the
// ADMIN rows still run the real permission rule.
const authorization = new AuthorizationService();
const accessOf = (
  subject: AuthorizationSubject,
  timelineRoles: readonly string[],
) =>
  resolveAccess(
    subject,
    timelineRoles,
    authorization.can(subject, Permission.ADMIN_ACCESS),
  );

const membership = (
  change: Partial<MembershipFacts> = {},
): MembershipFacts => ({
  resultType: 'policy_change',
  programId: SP01,
  round: 1,
  status: 'pending',
  ended: false,
  endReason: null,
  ...change,
});

/** Assessor A: live ASSESSOR grant for `policy_change`, program scope {SP01}. */
const assessorA = user([grant('ASSESSOR', 'policy_change')], [SP01]);

describe('FR-1 Assessor sees only their scope', () => {
  const access = accessOf(assessorA, ['ASSESSOR']);
  const memberships = [
    membership({ resultType: 'policy_change', programId: SP01 }),
    membership({ resultType: 'policy_change', programId: SP02 }),
    membership({ resultType: 'innovation_use', programId: SP01 }),
  ];

  it('lists only the (policy_change, SP01) membership', () => {
    expect(memberships.map((m) => listedFor(access, m))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('builds one ASSESSOR row on round 1 with the covered type and program', () => {
    expect(access).toEqual({
      reviewerRows: [
        {
          role: 'ASSESSOR',
          round: 1,
          audience: 'assessors',
          resultTypes: ['policy_change'],
          programs: { mode: 'in', ids: [SP01] },
        },
      ],
      admin: false,
      disabledRoles: [],
    });
  });

  it('works only on round-1 memberships', () => {
    expect(listedFor(access, membership({ round: 1 }))).toBe(true);
    expect(listedFor(access, membership({ round: 2 }))).toBe(false);
  });

  it('lists nothing of a timeline the user is not assigned to, even if the grant covers it', () => {
    const notAssigned = accessOf(assessorA, []);
    expect(listedFor(notAssigned, membership())).toBe(false);
    expect(notAssigned.reviewerRows).toEqual([]);
  });

  it('drops the membership once the assignment is removed (the rows are read fresh)', () => {
    expect(listedFor(accessOf(assessorA, ['ASSESSOR']), membership())).toBe(
      true,
    );
    expect(listedFor(accessOf(assessorA, []), membership())).toBe(false);
  });

  it('drops the membership once the grant is revoked', () => {
    const revoked = user(
      [
        grant('ASSESSOR', 'policy_change', {
          revokedAt: new Date('2026-11-10T00:00:00Z'),
        }),
      ],
      [SP01],
    );
    expect(listedFor(accessOf(revoked, ['ASSESSOR']), membership())).toBe(
      false,
    );
  });
});

describe('FR-1 Revoked grant with a stale assignment', () => {
  it.each<[string, Partial<AssignmentView>]>([
    ['revoked', { revokedAt: new Date('2026-11-10T00:00:00Z') }],
    ['not active', { isActive: false }],
    ['role inactive', { roleIsActive: false }],
    ['role unknown to the catalog', { roleCode: 'NO_SUCH_ROLE' }],
  ])('a %s grant with an active assignment lists nothing', (_name, change) => {
    const stale = user([grant('ASSESSOR', 'policy_change', change)], [SP01]);
    const access = accessOf(stale, ['ASSESSOR']);
    expect(access.reviewerRows).toEqual([]);
    expect(listedFor(access, membership())).toBe(false);
    expect(inScope(access, membership())).toBe(false);
  });

  it('an assignment alone, without any grant row, lists nothing', () => {
    const access = accessOf(user([]), ['ASSESSOR']);
    expect(access.reviewerRows).toEqual([]);
    expect(listedFor(access, membership())).toBe(false);
  });
});

describe('FR-1 result type: exact key or *', () => {
  it('an exact key covers only that type', () => {
    const access = accessOf(assessorA, ['ASSESSOR']);
    expect(listedFor(access, membership({ resultType: 'policy_change' }))).toBe(
      true,
    );
    expect(
      listedFor(access, membership({ resultType: 'innovation_use' })),
    ).toBe(false);
  });

  it('* covers every type, current and future (DD-1)', () => {
    const all = user([grant('ASSESSOR', '*')], [SP01]);
    const access = accessOf(all, ['ASSESSOR']);
    expect(access.reviewerRows[0].resultTypes).toBe('all');
    expect(listedFor(access, membership({ resultType: 'policy_change' }))).toBe(
      true,
    );
    expect(
      listedFor(access, membership({ resultType: 'brand_new_type' })),
    ).toBe(true);
  });

  it('two exact grants cover both types and no third', () => {
    const two = user(
      [grant('ASSESSOR', 'policy_change'), grant('ASSESSOR', 'innovation_use')],
      [SP01],
    );
    const access = accessOf(two, ['ASSESSOR']);
    expect(access.reviewerRows[0].resultTypes).toEqual([
      'innovation_use',
      'policy_change',
    ]);
    expect(
      listedFor(access, membership({ resultType: 'innovation_use' })),
    ).toBe(true);
    expect(
      listedFor(access, membership({ resultType: 'capacity_sharing' })),
    ).toBe(false);
  });

  it('a revoked grant among live ones covers nothing of its own', () => {
    const mixed = user(
      [
        grant('ASSESSOR', 'policy_change'),
        grant('ASSESSOR', 'innovation_use', {
          revokedAt: new Date('2026-11-10T00:00:00Z'),
        }),
      ],
      [SP01],
    );
    const access = accessOf(mixed, ['ASSESSOR']);
    expect(listedFor(access, membership({ resultType: 'policy_change' }))).toBe(
      true,
    );
    expect(
      listedFor(access, membership({ resultType: 'innovation_use' })),
    ).toBe(false);
  });

  it('a LEAD_ASSESSOR grant gives no ASSESSOR row (disabled, separate role)', () => {
    const lead = user([grant('LEAD_ASSESSOR', 'policy_change')], [SP01]);
    expect(accessOf(lead, ['ASSESSOR']).reviewerRows).toEqual([]);
  });
});

describe('FR-1 program scope: in scope, out of scope, excluded', () => {
  const exclude = (
    programId: number,
    status: ProgramExclusionView['status'] = 'active',
  ) => ({
    programId,
    status,
  });

  it.each<[string, number[], ProgramExclusionView[], number, boolean]>([
    ['scope {SP01}, SP01 is in scope', [SP01], [], SP01, true],
    ['scope {SP01}, SP02 is out of scope', [SP01], [], SP02, false],
    ['no scope rows = all programs, SP03 listed', [], [], SP03, true],
    ['no scope rows, SP02 actively excluded', [], [exclude(SP02)], SP02, false],
    [
      'no scope rows, SP03 not excluded beside SP02',
      [],
      [exclude(SP02)],
      SP03,
      true,
    ],
    [
      'scope {SP01, SP02}, SP02 actively excluded',
      [SP01, SP02],
      [exclude(SP02)],
      SP02,
      false,
    ],
    [
      'scope {SP01, SP02}, SP01 left in beside the excluded SP02',
      [SP01, SP02],
      [exclude(SP02)],
      SP01,
      true,
    ],
    [
      'scope {SP01}, SP01 actively excluded',
      [SP01],
      [exclude(SP01)],
      SP01,
      false,
    ],
    [
      'a removed exclusion excludes nothing',
      [],
      [exclude(SP02, 'removed')],
      SP02,
      true,
    ],
    [
      'a dismissed exclusion excludes nothing',
      [],
      [exclude(SP02, 'dismissed')],
      SP02,
      true,
    ],
  ])('%s', (_name, scope, exclusions, programId, listed) => {
    const subject = user([grant('ASSESSOR', '*')], scope, exclusions);
    const access = accessOf(subject, ['ASSESSOR']);
    expect(listedFor(access, membership({ programId }))).toBe(listed);
  });

  it('turns exclusions into the sets the query binds', () => {
    const allButTwo = accessOf(
      user(
        [grant('ASSESSOR', '*')],
        [],
        [exclude(SP02), exclude(SP02), exclude(SP03, 'removed')],
      ),
      ['ASSESSOR'],
    );
    expect(allButTwo.reviewerRows[0].programs).toEqual({
      mode: 'all',
      excluded: [SP02],
    });
    const scopedMinusOne = accessOf(
      user([grant('ASSESSOR', '*')], [SP02, SP01], [exclude(SP02)]),
      ['ASSESSOR'],
    );
    expect(scopedMinusOne.reviewerRows[0].programs).toEqual({
      mode: 'in',
      ids: [SP01],
    });
  });
});

describe('FR-1 the SQL-ready sets agree with the shared scope helpers', () => {
  const scopes: [number[], ProgramExclusionView[]][] = [
    [[], []],
    [[SP01], []],
    [[], [{ programId: SP02, status: 'active' }]],
    [[SP01, SP02], [{ programId: SP02, status: 'active' }]],
    [[SP01], [{ programId: SP01, status: 'active' }]],
    [[], [{ programId: SP02, status: 'removed' }]],
  ];
  const grantKeys = ['policy_change', '*', 'innovation_use'];

  it('rowCovers equals coversResultType and coversProgram for every case', () => {
    let compared = 0;
    for (const [scope, exclusions] of scopes) {
      for (const key of grantKeys) {
        const subject = user([grant('ASSESSOR', key)], scope, exclusions);
        const row = accessOf(subject, ['ASSESSOR']).reviewerRows[0];
        for (const resultType of ['policy_change', 'innovation_use', 'other']) {
          for (const programId of [SP01, SP02, SP03]) {
            const expected =
              coversResultType(key, resultType) &&
              coversProgram(subject, programId);
            expect(
              rowCovers(row, membership({ resultType, programId })),
              `${key} ${resultType} sp${programId} scope=${scope.join(',')} excl=${exclusions.length}`,
            ).toBe(expected);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(6 * 3 * 3 * 3);
  });
});

describe('FR-1 membership status and the ended filter', () => {
  const access = accessOf(assessorA, ['ASSESSOR']);

  it.each<[string, Partial<MembershipFacts>, boolean]>([
    ['pending', { status: 'pending' }, true],
    ['auto_validated', { status: 'auto_validated' }, true],
    ['not_in_qa', { status: 'not_in_qa' }, false],
    ['ended by release', { ended: true, endReason: 'released_qaed' }, true],
    ['ended by return', { ended: true, endReason: 'returned' }, true],
    [
      'ended by the timeline closing',
      { ended: true, endReason: 'timeline_closed' },
      false,
    ],
  ])('%s', (_name, change, listed) => {
    expect(listedFor(access, membership(change))).toBe(listed);
  });
});

describe('FR-1 Admin sees all', () => {
  const admin = user([grant('ADMIN', null)]);
  const access = accessOf(admin, []);

  it('has the admin row and no reviewer row', () => {
    expect(access).toEqual({
      reviewerRows: [],
      admin: true,
      disabledRoles: [],
    });
  });

  it('lists every pending and auto_validated membership, any type, program and round', () => {
    for (const m of [
      membership({ status: 'pending' }),
      membership({
        status: 'auto_validated',
        resultType: 'innovation_use',
        programId: SP03,
      }),
      membership({ round: 2, programId: SP02 }),
    ]) {
      expect(listedFor(access, m)).toBe(true);
    }
  });

  it('does not list a not_in_qa membership', () => {
    expect(listedFor(access, membership({ status: 'not_in_qa' }))).toBe(false);
    expect(inScope(access, membership({ status: 'not_in_qa' }))).toBe(false);
  });

  it('is read-only on every membership, in an open step too (DD-2, FR-2)', () => {
    expect(writeDecision(access, membership(), timing(STEP1_OPEN))).toEqual({
      writable: false,
      reason: 'admin_read_only',
    });
  });

  it('with a live ADMIN grant that is revoked, loses the admin row', () => {
    const revoked = user([
      grant('ADMIN', null, { revokedAt: new Date('2026-11-10T00:00:00Z') }),
    ]);
    const lost = accessOf(revoked, []);
    expect(lost.admin).toBe(false);
    expect(listedFor(lost, membership())).toBe(false);
  });

  it('an ADMIN also assigned as ASSESSOR gets the reviewer row where it covers, read-only elsewhere', () => {
    const both = user(
      [grant('ADMIN', null), grant('ASSESSOR', 'policy_change')],
      [SP01],
    );
    const bothAccess = accessOf(both, ['ASSESSOR']);
    expect(bothAccess.admin).toBe(true);
    expect(bothAccess.reviewerRows).toHaveLength(1);
    expect(
      writeDecision(bothAccess, membership(), timing(STEP1_OPEN)),
    ).toMatchObject({
      writable: true,
      stepPosition: 1,
    });
    expect(
      writeDecision(
        bothAccess,
        membership({ programId: SP02 }),
        timing(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
  });
});

describe('FR-1 the admin answer comes from the caller', () => {
  const assessorOnly = user([grant('ASSESSOR', 'policy_change')], [SP01]);
  const adminOnly = user([grant('ADMIN', null)]);

  it('takes the answer as given: true for a user without the grant, false for an ADMIN', () => {
    expect(resolveAccess(assessorOnly, ['ASSESSOR'], true).admin).toBe(true);
    expect(resolveAccess(adminOnly, [], false).admin).toBe(false);
  });

  it('lists every pending membership when told admin, and none when told not', () => {
    const told = resolveAccess(user([]), [], true);
    const notTold = resolveAccess(adminOnly, [], false);
    expect(listedFor(told, membership({ programId: SP03 }))).toBe(true);
    expect(listedFor(notTold, membership({ programId: SP03 }))).toBe(false);
  });

  it('does not change the reviewer rows', () => {
    expect(
      resolveAccess(assessorOnly, ['ASSESSOR'], true).reviewerRows,
    ).toEqual(resolveAccess(assessorOnly, ['ASSESSOR'], false).reviewerRows);
  });
});

describe('FR-1 A role with no active row', () => {
  // Every reviewer row is enabled since P2-3917: an assignment with no live grant is now the only roleless case.
  const assignedOnly = user([], [SP01]);
  const access = accessOf(assignedOnly, ['PPU']);

  it('has no row and reports no disabled role (none is declared disabled any more)', () => {
    expect(access).toEqual({
      reviewerRows: [],
      admin: false,
      disabledRoles: [],
    });
  });

  it('lists no step-1 result', () => {
    expect(listedFor(access, membership())).toBe(false);
    expect(listedFor(access, membership({ round: 2 }))).toBe(false);
  });

  it.each(['TPB', 'PPU'] as const)(
    'a %s assignment with a live grant gets its round-2 row, every result type (global role)',
    (role) => {
      const subject = user([grant(role, null)]);
      expect(accessOf(subject, [role]).reviewerRows).toMatchObject([
        { role, round: 2, resultTypes: 'all' },
      ]);
    },
  );

  it('a disabled role without a live grant is not reported', () => {
    const subject = user([
      grant('PPU', null, { revokedAt: new Date('2026-11-10T00:00:00Z') }),
    ]);
    expect(accessOf(subject, ['PPU']).disabledRoles).toEqual([]);
  });
});

describe('FR-1 Out-of-scope result by URL', () => {
  const access = accessOf(assessorA, ['ASSESSOR']);

  it('is not in scope, the same answer as an unknown code', () => {
    expect(inScope(access, membership({ programId: SP02 }))).toBe(false);
    expect(
      writeDecision(
        access,
        membership({ programId: SP02 }),
        timing(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'not_in_scope' });
  });

  it('an ended membership of the scope stays in scope, so it can still be read', () => {
    expect(
      inScope(
        access,
        membership({ ended: true, endReason: 'timeline_closed' }),
      ),
    ).toBe(true);
  });
});

describe('FR-2 write decision by the clock', () => {
  const access = accessOf(assessorA, ['ASSESSOR']);

  it('never lets a reviewer write on an auto-validated result, even with the step open (DD-P4)', () => {
    expect(
      writeDecision(
        access,
        membership({ status: 'auto_validated' }),
        timing(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'auto_validated' });
    // A pending one in the same open step stays writable.
    expect(
      writeDecision(access, membership(), timing(STEP1_OPEN)).writable,
    ).toBe(true);
  });

  it.each<[string, string, boolean]>([
    ['08:59 on the opening day', '2026-11-12T07:59:00Z', false],
    ['09:00:00 on the opening day', '2026-11-12T08:00:00Z', true],
    ['09:00:59 on the opening day', '2026-11-12T08:00:59Z', true],
    ['17:30:59 on the closing day', '2026-11-20T16:30:59Z', true],
    ['17:31:00 on the closing day', '2026-11-20T16:31:00Z', false],
  ])('at %s the write is allowed: %s', (_name, utc, writable) => {
    expect(writeDecision(access, membership(), timing(utc)).writable).toBe(
      writable,
    );
  });

  it('says why: not yet open, then closed', () => {
    expect(
      writeDecision(access, membership(), timing('2026-11-12T07:59:00Z')),
    ).toEqual({ writable: false, reason: 'step_upcoming' });
    expect(
      writeDecision(access, membership(), timing('2026-11-20T16:31:00Z')),
    ).toEqual({ writable: false, reason: 'step_closed' });
  });

  it('is read-only on hold: step 1 opened but the timeline has no load', () => {
    expect(
      writeDecision(access, membership(), timing(STEP1_OPEN, false)),
    ).toEqual({ writable: false, reason: 'step_upcoming' });
  });

  it('names the step the row writes in', () => {
    expect(writeDecision(access, membership(), timing(STEP1_OPEN))).toEqual({
      writable: true,
      row: access.reviewerRows[0],
      stepPosition: 1,
    });
  });

  it('refuses when the timeline has no step for the audience', () => {
    const noStep = {
      steps: steps.filter((step) => step.audience !== 'assessors'),
      now: nowInRome(new Date(STEP1_OPEN)),
      hasLoad: true,
    };
    expect(writeDecision(access, membership(), noStep)).toEqual({
      writable: false,
      reason: 'no_step',
    });
  });
});

describe('FR-19 clarification predicate', () => {
  const access = accessOf(assessorA, ['ASSESSOR']);
  const endedByClosing = membership({
    ended: true,
    endReason: 'timeline_closed',
  });

  it('holds during step 2 for a clarification the user wrote', () => {
    expect(clarificationOpen(timing(STEP2_OPEN), true)).toBe(true);
  });

  it.each<[string, string, boolean]>([
    ['step 2 not yet open', '2026-11-22T10:00:00Z', true],
    ['step 2 closed', '2026-11-30T10:00:00Z', true],
    ['step 1 open, step 2 not', STEP1_OPEN, true],
    ['step 2 open but no clarification of the user', STEP2_OPEN, false],
  ])('does not hold: %s', (_name, utc, authored) => {
    expect(clarificationOpen(timing(utc), authored)).toBe(false);
  });

  it('does not hold on a timeline on hold', () => {
    expect(clarificationOpen(timing(STEP2_OPEN, false), true)).toBe(false);
  });

  it('lists the membership during step 2 when the user wrote a clarification', () => {
    expect(listedFor(access, endedByClosing)).toBe(false);
    expect(
      listedFor(access, endedByClosing, {
        timing: timing(STEP2_OPEN),
        authoredClarification: true,
      }),
    ).toBe(true);
  });

  it('keeps the membership out when no clarification of the user, or step 2 is not open', () => {
    expect(
      listedFor(access, endedByClosing, {
        timing: timing(STEP2_OPEN),
        authoredClarification: false,
      }),
    ).toBe(false);
    expect(
      listedFor(access, endedByClosing, {
        timing: timing(STEP1_OPEN),
        authoredClarification: true,
      }),
    ).toBe(false);
  });

  it('never lists outside the reviewer row scope', () => {
    expect(
      listedFor(
        access,
        membership({
          programId: SP02,
          ended: true,
          endReason: 'timeline_closed',
        }),
        { timing: timing(STEP2_OPEN), authoredClarification: true },
      ),
    ).toBe(false);
  });

  it('is read-only in this spec: step 1 is closed while step 2 is open', () => {
    expect(writeDecision(access, membership(), timing(STEP2_OPEN))).toEqual({
      writable: false,
      reason: 'step_closed',
    });
  });
});

// FR-1 (P2-3912): the Lead row is enabled. Round 2 only, the Lead's result types and programs.
describe('FR-1 Lead sees only round-2 memberships in their scope', () => {
  const leadA = user(
    [grant('LEAD_ASSESSOR', 'innovation_development')],
    [SP01],
  );
  const access = accessOf(leadA, ['LEAD_ASSESSOR']);
  const round2 = (change: Partial<MembershipFacts> = {}) =>
    membership({ resultType: 'innovation_development', round: 2, ...change });

  it('builds one LEAD_ASSESSOR row on round 2, audience lead_assessors, with the covered type and program', () => {
    expect(access).toEqual({
      reviewerRows: [
        {
          role: 'LEAD_ASSESSOR',
          round: 2,
          audience: 'lead_assessors',
          resultTypes: ['innovation_development'],
          programs: { mode: 'in', ids: [SP01] },
        },
      ],
      admin: false,
      disabledRoles: [],
    });
  });

  it('lists the round-2 membership of their type and program, and nothing else', () => {
    expect(listedFor(access, round2())).toBe(true);
    // Round-1 membership of the same result, another type, another program.
    expect(listedFor(access, round2({ round: 1 }))).toBe(false);
    expect(listedFor(access, round2({ resultType: 'policy_change' }))).toBe(
      false,
    );
    expect(listedFor(access, round2({ programId: SP02 }))).toBe(false);
  });

  it('an ASSESSOR of the same scope does not reach round 2 (the assessment 404)', () => {
    const assessorAccess = accessOf(
      user([grant('ASSESSOR', 'innovation_development')], [SP01]),
      ['ASSESSOR'],
    );
    expect(inScope(assessorAccess, round2())).toBe(false);
    expect(writeDecision(assessorAccess, round2(), timing(STEP1_OPEN))).toEqual(
      { writable: false, reason: 'not_in_scope' },
    );
  });

  it('writes only while step 3 is in progress; upcoming and closed are refused (step window)', () => {
    const withLead = (utc: string) => ({
      ...timing(utc),
      steps: [
        ...steps,
        {
          position: 3,
          audience: 'lead_assessors' as const,
          opensAt: minute('2026-11-30T09:00'),
          closesAt: minute('2026-12-04T17:30'),
        },
      ],
    });
    expect(
      writeDecision(access, round2(), withLead('2026-12-01T10:00:00Z')),
    ).toMatchObject({
      writable: true,
      stepPosition: 3,
    });
    expect(writeDecision(access, round2(), withLead(STEP2_OPEN))).toEqual({
      writable: false,
      reason: 'step_upcoming',
    });
    expect(
      writeDecision(access, round2(), withLead('2026-12-05T10:00:00Z')),
    ).toEqual({
      writable: false,
      reason: 'step_closed',
    });
  });
});

describe('admin/acts-as-reviewer: a QA Admin acting as a reviewer role', () => {
  const admin = user([grant('ADMIN', null)]);
  const adminAs = (role: 'ASSESSOR' | 'LEAD_ASSESSOR' | 'GUEST') =>
    resolveAccess(
      admin,
      [],
      authorization.can(admin, Permission.ADMIN_ACCESS),
      role as never,
    );
  const withLead = (utc: string) => ({
    ...timing(utc),
    steps: [
      ...steps,
      {
        position: 3,
        audience: 'lead_assessors' as const,
        opensAt: minute('2026-11-30T09:00'),
        closesAt: minute('2026-12-04T17:30'),
      },
    ],
  });

  it('gets ONE row of the role, every type and program, flagged byAdmin, with no assignment or grant', () => {
    const access = adminAs('ASSESSOR');
    expect(access).toEqual({
      reviewerRows: [
        {
          role: 'ASSESSOR',
          round: 1,
          audience: 'assessors',
          resultTypes: 'all',
          programs: { mode: 'all', excluded: [] },
          byAdmin: true,
        },
      ],
      admin: true,
      disabledRoles: [],
    });
    expect(actsAsAdmin(access)).toBe(true);
    expect(actingRoleOf(access)).toBe('ASSESSOR');
  });

  it('writes as Assessor before step 1 opens and after it closes (R2), in the step of the role', () => {
    const access = adminAs('ASSESSOR');
    for (const utc of ['2026-11-01T10:00:00Z', STEP1_OPEN, STEP2_OPEN]) {
      expect(writeDecision(access, membership(), timing(utc))).toMatchObject({
        writable: true,
        stepPosition: 1,
      });
    }
  });

  it('writes as Lead on round 2 whatever the state of step 3 (R2)', () => {
    const access = adminAs('LEAD_ASSESSOR');
    const round2 = membership({ round: 2 });
    for (const utc of [
      STEP2_OPEN,
      '2026-12-01T10:00:00Z',
      '2026-12-05T10:00:00Z',
    ]) {
      expect(writeDecision(access, round2, withLead(utc))).toMatchObject({
        writable: true,
        stepPosition: 3,
      });
    }
  });

  it('keeps the flow (R6): the role must fit the round, the timeline must have its step, auto-validated stays read-only', () => {
    // Lead on a round-1 result, Assessor on a round-2 one: in scope (ADMIN), no covering row, 403.
    expect(
      writeDecision(
        adminAs('LEAD_ASSESSOR'),
        membership(),
        withLead(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
    expect(
      writeDecision(
        adminAs('ASSESSOR'),
        membership({ round: 2 }),
        withLead(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
    // No step 3 on the timeline.
    expect(
      writeDecision(
        adminAs('LEAD_ASSESSOR'),
        membership({ round: 2 }),
        timing(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'no_step' });
    expect(
      writeDecision(
        adminAs('ASSESSOR'),
        membership({ status: 'auto_validated' }),
        timing(STEP1_OPEN),
      ),
    ).toEqual({ writable: false, reason: 'auto_validated' });
  });

  it('ignores the acting role of a non-admin and of a disabled role row', () => {
    const asReviewer = resolveAccess(
      assessorA,
      ['ASSESSOR'],
      false,
      'LEAD_ASSESSOR' as never,
    );
    expect(asReviewer).toEqual(accessOf(assessorA, ['ASSESSOR']));
    expect(actsAsAdmin(asReviewer)).toBe(false);
    // A role with no reviewer row (GUEST): no acting row, the Admin stays read-only.
    const ppu = adminAs('GUEST');
    expect(ppu.reviewerRows).toEqual([]);
    expect(writeDecision(ppu, membership(), timing(STEP1_OPEN))).toEqual({
      writable: false,
      reason: 'admin_read_only',
    });
  });
});
