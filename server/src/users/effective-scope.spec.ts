import {
  ALL_RESULT_TYPES,
  coversProgram,
  coversResultType,
  resultTypeKeysOverlap,
  type ProgramExclusionView,
} from './effective-scope.js';
import { GRANTABLE_ROLES, isGrantableRole, RoleCode } from './permissions.js';

// Expected values come from the glossary (Result type scope, Program scope,
// Exclusion, Effective scope) and FR-3 / FR-4, as literals.

describe('coversResultType (FR-3, DD-1)', () => {
  it.each<[string, string | null, string | null | undefined, boolean]>([
    ['exact key', 'KP', 'KP', true],
    ['another key', 'KP', 'IDEV', false],
    ['all covers any key', ALL_RESULT_TYPES, 'KP', true],
    ['all covers a type added later', ALL_RESULT_TYPES, 'NEXT_YEAR_TYPE', true],
    [
      'all with no resource type fails closed',
      ALL_RESULT_TYPES,
      undefined,
      false,
    ],
    [
      'all with an empty resource type fails closed',
      ALL_RESULT_TYPES,
      '',
      false,
    ],
    [
      'all with a null resource type fails closed',
      ALL_RESULT_TYPES,
      null,
      false,
    ],
    ['no grant key (global role row)', null, 'KP', false],
    ['an empty grant key', '', 'KP', false],
    ['a key is not a pattern', 'K*', 'KP', false],
  ])('%s', (_label, grant, resultType, expected) => {
    expect(coversResultType(grant, resultType)).toBe(expected);
  });
});

describe('resultTypeKeysOverlap (FR-3)', () => {
  it.each<[string, string, string, boolean]>([
    ['same key', 'KP', 'KP', true],
    ['different keys', 'KP', 'IDEV', false],
    ['all vs a key', '*', 'KP', true],
    ['a key vs all', 'KP', '*', true],
    ['all vs all', '*', '*', true],
  ])('%s', (_label, a, b, expected) => {
    expect(resultTypeKeysOverlap(a, b)).toBe(expected);
  });
});

describe('coversProgram (D5, FR-4)', () => {
  const active = (programId: number): ProgramExclusionView => ({
    programId,
    status: 'active',
  });

  it.each<
    [
      string,
      Parameters<typeof coversProgram>[0],
      number | null | undefined,
      boolean,
    ]
  >([
    [
      'no program rows = all programs',
      { programScope: [], exclusions: [] },
      5,
      true,
    ],
    ['listed program', { programScope: [5, 6], exclusions: [] }, 5, true],
    ['unlisted program', { programScope: [5, 6], exclusions: [] }, 7, false],
    [
      'no program on the target fails closed',
      { programScope: [], exclusions: [] },
      null,
      false,
    ],
    [
      'undefined program fails closed',
      { programScope: [], exclusions: [] },
      undefined,
      false,
    ],
    [
      'active exclusion beats all programs',
      { programScope: [], exclusions: [active(5)] },
      5,
      false,
    ],
    [
      'active exclusion beats a listed program',
      { programScope: [5], exclusions: [active(5)] },
      5,
      false,
    ],
    [
      'exclusion of another program',
      { programScope: [], exclusions: [active(6)] },
      5,
      true,
    ],
    [
      'removed exclusion does not exclude',
      { programScope: [], exclusions: [{ programId: 5, status: 'removed' }] },
      5,
      true,
    ],
    [
      'dismissed exclusion does not exclude',
      {
        programScope: [],
        exclusions: [{ programId: 5, status: 'dismissed' }],
      },
      5,
      true,
    ],
    [
      'an ended row beside an active one: the active one wins',
      {
        programScope: [],
        exclusions: [{ programId: 5, status: 'removed' }, active(5)],
      },
      5,
      false,
    ],
  ])('%s', (_label, scope, programId, expected) => {
    expect(coversProgram(scope, programId)).toBe(expected);
  });
});

describe('grantable roles (FR-2, D6)', () => {
  it('are ADMIN, LEAD_ASSESSOR, ASSESSOR, TPB and PPU: never PROGRAM', () => {
    expect(GRANTABLE_ROLES.map((role) => role.code).sort()).toEqual([
      'ADMIN',
      'ASSESSOR',
      'LEAD_ASSESSOR',
      'PPU',
      'TPB',
    ]);
    expect(isGrantableRole(RoleCode.PROGRAM)).toBe(false);
    expect(isGrantableRole('SUPERUSER')).toBe(false);
    expect(isGrantableRole(RoleCode.TPB)).toBe(true);
  });
});
