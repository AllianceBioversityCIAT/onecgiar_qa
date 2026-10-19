import {
  AuthorizationService,
  type AssignmentView,
  type AuthorizationSubject,
  type PermissionContext,
} from './authorization.service.js';
import { Permission, RoleCode } from './permissions.js';

// Expected values come from the FR-3 role table and scenarios of the spec, as
// literals; nothing here recomputes the role map.

function assignment(
  roleCode: string,
  scope: { resultTypeKey?: string; programId?: number } = {},
  overrides: Partial<AssignmentView> = {},
): AssignmentView {
  return {
    roleCode,
    roleIsActive: true,
    isActive: true,
    revokedAt: null,
    resultTypeKey: scope.resultTypeKey ?? null,
    programId: scope.programId ?? null,
    ...overrides,
  };
}

function subject(...assignments: AssignmentView[]): AuthorizationSubject {
  return { assignments };
}

const REVOKED = {
  isActive: false,
  revokedAt: new Date('2026-10-01T00:00:00Z'),
};

type Row = [
  label: string,
  user: AuthorizationSubject,
  permission: Permission,
  ctx: PermissionContext,
  expected: boolean,
];

const service = new AuthorizationService();

const canRows: Row[] = [
  // Global roles
  [
    'ADMIN holds admin, no context',
    subject(assignment(RoleCode.ADMIN)),
    Permission.ADMIN_ACCESS,
    {},
    true,
  ],
  [
    'ADMIN holds admin, any context',
    subject(assignment(RoleCode.ADMIN)),
    Permission.ADMIN_ACCESS,
    { resultType: 'KP', programId: 13 },
    true,
  ],
  [
    'ADMIN holds TPB too (FR-14: every permission)',
    subject(assignment(RoleCode.ADMIN)),
    Permission.TPB_ACCESS,
    {},
    true,
  ],
  [
    'ADMIN holds assessor on any result type (FR-14)',
    subject(assignment(RoleCode.ADMIN)),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    true,
  ],
  [
    'TPB holds TPB',
    subject(assignment(RoleCode.TPB)),
    Permission.TPB_ACCESS,
    {},
    true,
  ],
  [
    'TPB does not hold PPU',
    subject(assignment(RoleCode.TPB)),
    Permission.PPU_ACCESS,
    {},
    false,
  ],
  [
    'TPB does not hold admin',
    subject(assignment(RoleCode.TPB)),
    Permission.ADMIN_ACCESS,
    {},
    false,
  ],
  [
    'PPU holds PPU',
    subject(assignment(RoleCode.PPU)),
    Permission.PPU_ACCESS,
    {},
    true,
  ],
  [
    'PPU does not hold TPB',
    subject(assignment(RoleCode.PPU)),
    Permission.TPB_ACCESS,
    {},
    false,
  ],

  // ASSESSOR of KP
  [
    'ASSESSOR(KP) holds assessor for KP',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    true,
  ],
  [
    'ASSESSOR(KP) denied assessor for another result type',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'INNOVATION_DEV' },
    false,
  ],
  [
    'ASSESSOR(KP) denied assessor without a result type (fail closed)',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    {},
    false,
  ],
  [
    'ASSESSOR(KP) denied assessor with an empty-string result type',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    { resultType: '' },
    false,
  ],
  [
    'ASSESSOR(KP) denied assessor with a null result type',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    { resultType: null },
    false,
  ],
  [
    'ASSESSOR(KP) denied assessor when only a program is given',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    { programId: 12 },
    false,
  ],
  [
    'ASSESSOR(KP) denied lead for KP',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.LEAD_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'ASSESSOR(KP) denied admin',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ADMIN_ACCESS,
    { resultType: 'KP' },
    false,
  ],

  // LEAD_ASSESSOR of INNOVATION_DEV
  [
    'LEAD(ID) holds lead for ID',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    { resultType: 'INNOVATION_DEV' },
    true,
  ],
  [
    'LEAD(ID) holds assessor for ID (implied)',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'INNOVATION_DEV' },
    true,
  ],
  [
    'LEAD(ID) no lead on KP',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'LEAD(ID) no implied assessor on KP',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'LEAD(ID) denied lead without context',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    {},
    false,
  ],
  [
    'LEAD(ID) denied implied assessor without context',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    {},
    false,
  ],

  // Union of scoped roles (FR-3: ASSESSOR of KP + LEAD_ASSESSOR of INNOVATION_DEV)
  [
    'union: lead granted for INNOVATION_DEV',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    { resultType: 'INNOVATION_DEV' },
    true,
  ],
  [
    'union: assessor granted for KP',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    true,
  ],
  [
    'union: assessor granted for INNOVATION_DEV',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'INNOVATION_DEV' },
    true,
  ],
  [
    'union: no lead on KP',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'union: nothing for a third result type',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'POLICY' },
    false,
  ],

  // PROGRAM 12
  [
    'PROGRAM(12) holds program 12',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    { programId: 12 },
    true,
  ],
  [
    'PROGRAM(12) denied program 13',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    { programId: 13 },
    false,
  ],
  [
    'PROGRAM(12) denied without a program (fail closed)',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    {},
    false,
  ],
  [
    'PROGRAM(12) denied with a null program',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    { programId: null },
    false,
  ],
  [
    'PROGRAM(12) denied with program 0',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    { programId: 0 },
    false,
  ],
  [
    'PROGRAM(12) denied when only a result type is given',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'PROGRAM(12) denied assessor',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP', programId: 12 },
    false,
  ],

  // GUEST (no assignments)
  ['GUEST holds READ', subject(), Permission.READ, {}, true],
  ['GUEST denied admin', subject(), Permission.ADMIN_ACCESS, {}, false],
  ['GUEST denied TPB', subject(), Permission.TPB_ACCESS, {}, false],
  ['GUEST denied PPU', subject(), Permission.PPU_ACCESS, {}, false],
  [
    'GUEST denied assessor with context',
    subject(),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'GUEST denied lead with context',
    subject(),
    Permission.LEAD_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'GUEST denied program with context',
    subject(),
    Permission.PROGRAM_ACCESS,
    { programId: 12 },
    false,
  ],

  // Revoked or inactive grant nothing
  [
    'revoked ASSESSOR(KP) denied',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }, REVOKED)),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'revoked ADMIN denied',
    subject(assignment(RoleCode.ADMIN, {}, REVOKED)),
    Permission.ADMIN_ACCESS,
    {},
    false,
  ],
  [
    'revoked LEAD(KP) denied lead and implied assessor',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'KP' }, REVOKED),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'revoked flag via revokedAt alone denied',
    subject(
      assignment(
        RoleCode.TPB,
        {},
        { revokedAt: new Date('2026-10-01T00:00:00Z') },
      ),
    ),
    Permission.TPB_ACCESS,
    {},
    false,
  ],
  [
    'inactive-flag-only assignment denied',
    subject(assignment(RoleCode.TPB, {}, { isActive: false })),
    Permission.TPB_ACCESS,
    {},
    false,
  ],
  [
    'inactive role ASSESSOR(KP) denied',
    subject(
      assignment(
        RoleCode.ASSESSOR,
        { resultTypeKey: 'KP' },
        { roleIsActive: false },
      ),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'inactive role PROGRAM(12) denied',
    subject(
      assignment(RoleCode.PROGRAM, { programId: 12 }, { roleIsActive: false }),
    ),
    Permission.PROGRAM_ACCESS,
    { programId: 12 },
    false,
  ],
  [
    'inactive role does not block another active assignment',
    subject(
      assignment(
        RoleCode.ASSESSOR,
        { resultTypeKey: 'KP' },
        { roleIsActive: false },
      ),
      assignment(RoleCode.TPB),
    ),
    Permission.TPB_ACCESS,
    {},
    true,
  ],
  [
    'revoked row does not block an active re-grant',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }, REVOKED),
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
    ),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    true,
  ],

  // Defensive: an unknown role code or a scoped row missing its key grants nothing
  [
    'unknown role code denied',
    subject(assignment('SUPERUSER')),
    Permission.ADMIN_ACCESS,
    {},
    false,
  ],
  [
    'scoped role row without a stored key denied',
    subject(assignment(RoleCode.ASSESSOR)),
    Permission.ASSESSOR_ACCESS,
    {},
    false,
  ],
  [
    'scoped role row without a stored key denied even for a given key',
    subject(assignment(RoleCode.ASSESSOR)),
    Permission.ASSESSOR_ACCESS,
    { resultType: 'KP' },
    false,
  ],
  [
    'scoped role row with an empty stored key denied for an empty context key',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: '' })),
    Permission.ASSESSOR_ACCESS,
    { resultType: '' },
    false,
  ],
  [
    'program role row without a stored program denied',
    subject(assignment(RoleCode.PROGRAM)),
    Permission.PROGRAM_ACCESS,
    { programId: 0 },
    false,
  ],
];

describe('AuthorizationService.can', () => {
  it.each(canRows)('%s', (_label, user, permission, ctx, expected) => {
    expect(service.can(user, permission, ctx)).toBe(expected);
  });

  it('defaults the context to empty', () => {
    expect(
      service.can(
        subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
        Permission.ASSESSOR_ACCESS,
      ),
    ).toBe(false);
    expect(
      service.can(subject(assignment(RoleCode.ADMIN)), Permission.ADMIN_ACCESS),
    ).toBe(true);
  });
});

type AnyRow = [
  label: string,
  user: AuthorizationSubject,
  permission: Permission,
  expected: boolean,
];

const canAnyRows: AnyRow[] = [
  [
    'ADMIN has admin in some scope',
    subject(assignment(RoleCode.ADMIN)),
    Permission.ADMIN_ACCESS,
    true,
  ],
  [
    'ADMIN has TPB (FR-14: every permission)',
    subject(assignment(RoleCode.ADMIN)),
    Permission.TPB_ACCESS,
    true,
  ],
  [
    'ASSESSOR(KP) has assessor in some scope',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.ASSESSOR_ACCESS,
    true,
  ],
  [
    'ASSESSOR(KP) has no lead in any scope',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })),
    Permission.LEAD_ACCESS,
    false,
  ],
  [
    'LEAD(ID) has lead in some scope',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.LEAD_ACCESS,
    true,
  ],
  [
    'LEAD(ID) has implied assessor in some scope',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'INNOVATION_DEV' }),
    ),
    Permission.ASSESSOR_ACCESS,
    true,
  ],
  [
    'PROGRAM(12) has program in some scope',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.PROGRAM_ACCESS,
    true,
  ],
  [
    'PROGRAM(12) has no assessor',
    subject(assignment(RoleCode.PROGRAM, { programId: 12 })),
    Permission.ASSESSOR_ACCESS,
    false,
  ],
  [
    'TPB has TPB',
    subject(assignment(RoleCode.TPB)),
    Permission.TPB_ACCESS,
    true,
  ],
  [
    'PPU has PPU',
    subject(assignment(RoleCode.PPU)),
    Permission.PPU_ACCESS,
    true,
  ],
  [
    'union: any one assignment is enough',
    subject(
      assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }),
      assignment(RoleCode.TPB),
    ),
    Permission.TPB_ACCESS,
    true,
  ],
  ['GUEST has READ', subject(), Permission.READ, true],
  ['GUEST has no admin', subject(), Permission.ADMIN_ACCESS, false],
  ['GUEST has no assessor', subject(), Permission.ASSESSOR_ACCESS, false],
  ['GUEST has no program', subject(), Permission.PROGRAM_ACCESS, false],
  [
    'revoked ADMIN has nothing',
    subject(assignment(RoleCode.ADMIN, {}, REVOKED)),
    Permission.ADMIN_ACCESS,
    false,
  ],
  [
    'revoked ASSESSOR has nothing',
    subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }, REVOKED)),
    Permission.ASSESSOR_ACCESS,
    false,
  ],
  [
    'revoked LEAD has no implied assessor',
    subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: 'KP' }, REVOKED),
    ),
    Permission.ASSESSOR_ACCESS,
    false,
  ],
  [
    'inactive role has nothing',
    subject(
      assignment(RoleCode.PROGRAM, { programId: 12 }, { roleIsActive: false }),
    ),
    Permission.PROGRAM_ACCESS,
    false,
  ],
  [
    'unknown role code has nothing',
    subject(assignment('SUPERUSER')),
    Permission.ADMIN_ACCESS,
    false,
  ],
];

describe('AuthorizationService.canAny', () => {
  it.each(canAnyRows)('%s', (_label, user, permission, expected) => {
    expect(service.canAny(user, permission)).toBe(expected);
  });
});

// FR-3 (All result types, DD-1): `*` covers every key, including types that do
// not exist yet. FR-4 / D5: effective scope = program scope minus active
// exclusions; an exclusion always wins. Expected values are the scenarios'.
describe('AuthorizationService with the all-result-types sentinel (DD-1)', () => {
  const leadAll = subject(
    assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: '*' }),
  );
  const assessorAll = subject(
    assignment(RoleCode.ASSESSOR, { resultTypeKey: '*' }),
  );

  it.each(['KP', 'INNOVATION_DEV', 'A_TYPE_ADDED_NEXT_YEAR'])(
    'a Lead for all holds lead and assessor on %s',
    (resultType) => {
      expect(service.can(leadAll, Permission.LEAD_ACCESS, { resultType })).toBe(
        true,
      );
      expect(
        service.can(leadAll, Permission.ASSESSOR_ACCESS, { resultType }),
      ).toBe(true);
    },
  );

  it('an Assessor for all holds assessor but not lead, on any type', () => {
    expect(
      service.can(assessorAll, Permission.ASSESSOR_ACCESS, {
        resultType: 'NEW_TYPE',
      }),
    ).toBe(true);
    expect(
      service.can(assessorAll, Permission.LEAD_ACCESS, { resultType: 'KP' }),
    ).toBe(false);
  });

  it('fails closed: no context, empty type, and a revoked wildcard all deny', () => {
    expect(service.can(leadAll, Permission.LEAD_ACCESS, {})).toBe(false);
    expect(
      service.can(leadAll, Permission.LEAD_ACCESS, { resultType: '' }),
    ).toBe(false);
    expect(
      service.can(leadAll, Permission.LEAD_ACCESS, { resultType: null }),
    ).toBe(false);
    const revoked = subject(
      assignment(RoleCode.LEAD_ASSESSOR, { resultTypeKey: '*' }, REVOKED),
    );
    expect(
      service.can(revoked, Permission.LEAD_ACCESS, { resultType: 'KP' }),
    ).toBe(false);
  });

  it('a listed key is still exact: KP does not cover another type', () => {
    const kp = subject(assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' }));
    expect(
      service.can(kp, Permission.ASSESSOR_ACCESS, { resultType: 'OTHER' }),
    ).toBe(false);
  });

  it('canAny sees a wildcard grant like any other', () => {
    expect(service.canAny(leadAll, Permission.LEAD_ACCESS)).toBe(true);
    expect(service.canAny(leadAll, Permission.ASSESSOR_ACCESS)).toBe(true);
    expect(service.canAny(assessorAll, Permission.LEAD_ACCESS)).toBe(false);
  });
});

describe('AuthorizationService.canReview (D5, FR-4)', () => {
  const assessorKp = assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' });
  const assessorAll = assignment(RoleCode.ASSESSOR, { resultTypeKey: '*' });
  const active = (programId: number) => ({
    programId,
    status: 'active' as const,
  });
  const review = (
    user: AuthorizationSubject,
    resultType: string,
    programId: number,
    ...extra: Parameters<AuthorizationService['canReview']>[3][]
  ) =>
    service.canReview(
      user,
      Permission.ASSESSOR_ACCESS,
      { resultType, programId },
      ...extra,
    );

  type ReviewRow = [
    label: string,
    user: AuthorizationSubject,
    resultType: string,
    programId: number,
    expected: boolean,
  ];
  const rows: ReviewRow[] = [
    ['no program rows = all programs', subject(assessorKp), 'KP', 5, true],
    [
      'program in the list',
      { assignments: [assessorKp], programScope: [5, 6] },
      'KP',
      5,
      true,
    ],
    [
      'program outside the list',
      { assignments: [assessorKp], programScope: [5, 6] },
      'KP',
      7,
      false,
    ],
    [
      'result type outside the role scope',
      subject(assessorKp),
      'OTHER',
      5,
      false,
    ],
    [
      'wildcard covers a type and any program',
      subject(assessorAll),
      'NEW_TYPE',
      99,
      true,
    ],
    [
      'wildcard with a program list still filters the program',
      { assignments: [assessorAll], programScope: [5] },
      'NEW_TYPE',
      6,
      false,
    ],
    [
      'active exclusion wins over an empty scope (all programs)',
      { assignments: [assessorKp], exclusions: [active(5)] },
      'KP',
      5,
      false,
    ],
    [
      'active exclusion wins over a scope that lists the program',
      {
        assignments: [assessorKp],
        programScope: [5, 6],
        exclusions: [active(5)],
      },
      'KP',
      5,
      false,
    ],
    [
      'an exclusion of another program does not touch this one',
      { assignments: [assessorKp], exclusions: [active(6)] },
      'KP',
      5,
      true,
    ],
    [
      'a removed exclusion no longer excludes (DD-12)',
      {
        assignments: [assessorKp],
        exclusions: [{ programId: 5, status: 'removed' }],
      },
      'KP',
      5,
      true,
    ],
    [
      'a dismissed exclusion no longer excludes (DD-12)',
      {
        assignments: [assessorKp],
        exclusions: [{ programId: 5, status: 'dismissed' }],
      },
      'KP',
      5,
      true,
    ],
    [
      'a revoked role denies even inside the program scope',
      subject({ ...assessorKp, ...REVOKED }),
      'KP',
      5,
      false,
    ],
    [
      'ADMIN reviews anything inside the scope',
      subject(assignment(RoleCode.ADMIN)),
      'ANY',
      5,
      true,
    ],
    [
      'ADMIN is exempt from an active exclusion (DD-13)',
      { assignments: [assignment(RoleCode.ADMIN)], exclusions: [active(5)] },
      'ANY',
      5,
      true,
    ],
    [
      'ADMIN is exempt from a program scope that lacks the program (DD-13)',
      { assignments: [assignment(RoleCode.ADMIN)], programScope: [6] },
      'ANY',
      5,
      true,
    ],
    [
      'the same exclusion still blocks a non-admin who holds the permission (DD-13 guard)',
      {
        assignments: [assignment(RoleCode.ASSESSOR, { resultTypeKey: 'KP' })],
        exclusions: [active(5)],
      },
      'KP',
      5,
      false,
    ],
    [
      'a revoked ADMIN grant no longer exempts: the exclusion applies again',
      {
        assignments: [
          assignment(RoleCode.ADMIN, {}, REVOKED),
          assignment(RoleCode.ASSESSOR, { resultTypeKey: '*' }),
        ],
        exclusions: [active(5)],
      },
      'KP',
      5,
      false,
    ],
    [
      'an inactive ADMIN role no longer exempts',
      {
        assignments: [
          assignment(RoleCode.ADMIN, {}, { roleIsActive: false }),
          assignment(RoleCode.ASSESSOR, { resultTypeKey: '*' }),
        ],
        exclusions: [active(5)],
      },
      'KP',
      5,
      false,
    ],
  ];

  it.each(rows)('%s', (_label, user, resultType, programId, expected) => {
    expect(review(user, resultType, programId)).toBe(expected);
  });

  it('denies a permission the user does not hold, whatever the scope', () => {
    expect(
      service.canReview(subject(assessorKp), Permission.LEAD_ACCESS, {
        resultType: 'KP',
        programId: 5,
      }),
    ).toBe(false);
  });

  it('takes a later predicate as one more conjunct (D9 seam)', () => {
    const user = subject(assessorKp);
    expect(review(user, 'KP', 5, () => true)).toBe(true);
    expect(review(user, 'KP', 5, () => false)).toBe(false);
    expect(review(user, 'KP', 5, (_u, target) => target.programId !== 5)).toBe(
      false,
    );
  });

  it('still applies extra predicates to ADMIN: DD-13 exempts scope and exclusions only', () => {
    const admin = {
      assignments: [assignment(RoleCode.ADMIN)],
      exclusions: [active(5)],
    };
    expect(review(admin, 'KP', 5, () => true)).toBe(true);
    expect(review(admin, 'KP', 5, () => false)).toBe(false);
  });

  it('never runs a predicate to rescue a denial', () => {
    expect(review(subject(assessorKp), 'OTHER', 5, () => true)).toBe(false);
  });
});
