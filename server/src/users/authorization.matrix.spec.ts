import {
  AuthorizationService,
  type AssignmentView,
  type PermissionContext,
} from './authorization.service.js';
import { Permission, ROLE_DEFINITIONS } from './permissions.js';

// NFR-2: `can()` is covered for every role x scope. `authorization.service.spec.ts`
// holds the scenario rows of FR-3; this file closes the grid. Every cell below
// comes from the FR-3 role table, written out as literals (not read from
// `ROLE_DEFINITIONS`), and a completeness check fails when a role or a
// permission exists that the grid does not know.

type ScopeType = 'global' | 'result_type' | 'program';

/** FR-3: what each role grants, within the scope of its own assignment. */
const FR3: Record<string, { scope: ScopeType; grants: readonly Permission[] }> =
  {
    ADMIN: { scope: 'global', grants: [Permission.ADMIN_ACCESS] },
    TPB: { scope: 'global', grants: [Permission.TPB_ACCESS] },
    PPU: { scope: 'global', grants: [Permission.PPU_ACCESS] },
    ASSESSOR: { scope: 'result_type', grants: [Permission.ASSESSOR_ACCESS] },
    LEAD_ASSESSOR: {
      scope: 'result_type',
      grants: [Permission.LEAD_ACCESS, Permission.ASSESSOR_ACCESS],
    },
    PROGRAM: { scope: 'program', grants: [Permission.PROGRAM_ACCESS] },
  };

/** The permissions that are actions (`READ` is the marker of every user). */
const ACTIONS = Object.values(Permission).filter((p) => p !== Permission.READ);

const KEY = 'KP';
const PROGRAM = 12;

function assignmentOf(roleCode: string, scope: ScopeType): AssignmentView {
  return {
    roleCode,
    roleIsActive: true,
    isActive: true,
    revokedAt: null,
    resultTypeKey: scope === 'result_type' ? KEY : null,
    programId: scope === 'program' ? PROGRAM : null,
  };
}

/** The contexts a check can come with, and whether each lies inside the scope. */
function contextsOf(
  scope: ScopeType,
): Array<[string, PermissionContext, boolean]> {
  return [
    ['no context', {}, scope === 'global'],
    [
      'its own result type',
      { resultType: KEY },
      scope === 'global' || scope === 'result_type',
    ],
    ['another result type', { resultType: 'OTHER' }, scope === 'global'],
    [
      'its own program',
      { programId: PROGRAM },
      scope === 'global' || scope === 'program',
    ],
    ['another program', { programId: 13 }, scope === 'global'],
  ];
}

const service = new AuthorizationService();

describe('AuthorizationService.can: role x permission x scope grid (NFR-2)', () => {
  it('knows every role and every permission of the system', () => {
    expect(Object.keys(FR3).sort()).toEqual(
      ROLE_DEFINITIONS.map((role) => role.code).sort(),
    );
    expect(ACTIONS.length).toBeGreaterThan(0);
    for (const { code, scopeType } of ROLE_DEFINITIONS) {
      expect(FR3[code].scope, `${code} scope`).toBe(scopeType);
    }
    // Every action permission is granted by some role: none is left untested.
    const granted = new Set(Object.values(FR3).flatMap((role) => role.grants));
    expect([...granted].sort()).toEqual([...ACTIONS].sort());
  });

  describe.each(Object.entries(FR3))('%s', (role, { scope, grants }) => {
    it('grants exactly its permissions, and only inside its scope', () => {
      const user = { assignments: [assignmentOf(role, scope)] };
      const wrong: string[] = [];
      for (const permission of ACTIONS) {
        for (const [label, context, inside] of contextsOf(scope)) {
          const expected = grants.includes(permission) && inside;
          if (service.can(user, permission, context) !== expected) {
            wrong.push(
              `${permission} with ${label}: expected ${String(expected)}`,
            );
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('grants through canAny exactly its permissions, whatever the scope', () => {
      const user = { assignments: [assignmentOf(role, scope)] };
      for (const permission of ACTIONS) {
        expect(service.canAny(user, permission), permission).toBe(
          grants.includes(permission),
        );
      }
    });
  });

  it('GUEST holds no action permission in any context', () => {
    for (const permission of ACTIONS) {
      expect(service.canAny({ assignments: [] }, permission), permission).toBe(
        false,
      );
      for (const scope of ['global', 'result_type', 'program'] as const) {
        for (const [label, context] of contextsOf(scope)) {
          expect(
            service.can({ assignments: [] }, permission, context),
            `${permission} with ${label}`,
          ).toBe(false);
        }
      }
    }
  });
});
