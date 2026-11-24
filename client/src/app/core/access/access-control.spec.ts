import { Assignment } from '../auth/auth.models';
import { can, canAny } from './access-control';
import { Permission, ROLE_DEFINITIONS } from './role-definitions';

const lead: Assignment[] = [{ role: 'LEAD_ASSESSOR', resultTypeKey: 'KP' }];
const program: Assignment[] = [{ role: 'PROGRAM', programId: 10 }];

describe('permission evaluation (mirror of the server AuthorizationService)', () => {
  it('a lead assessor gets lead + assessor access only in their result type', () => {
    expect(can(lead, Permission.LEAD_ACCESS, { resultType: 'KP' })).toBe(true);
    expect(can(lead, Permission.ASSESSOR_ACCESS, { resultType: 'KP' })).toBe(true);
    expect(can(lead, Permission.LEAD_ACCESS, { resultType: 'POLICY' })).toBe(false);
  });

  it('fails closed when a scoped check has no context', () => {
    expect(can(lead, Permission.LEAD_ACCESS)).toBe(false);
    expect(canAny(lead, Permission.LEAD_ACCESS)).toBe(true);
  });

  it('a program role only matches its own program', () => {
    expect(can(program, Permission.PROGRAM_ACCESS, { programId: 10 })).toBe(true);
    expect(can(program, Permission.PROGRAM_ACCESS, { programId: 11 })).toBe(false);
  });

  it('ADMIN grants ADMIN_ACCESS only, never the other roles (same as the server)', () => {
    const admin: Assignment[] = [{ role: 'ADMIN' }];
    expect(canAny(admin, Permission.ADMIN_ACCESS)).toBe(true);
    expect(canAny(admin, Permission.ASSESSOR_ACCESS)).toBe(false);
    expect(canAny(admin, Permission.TPB_ACCESS)).toBe(false);
  });

  it('a guest (no assignments) only reads', () => {
    for (const p of Object.values(Permission)) {
      expect(canAny([], p)).toBe(p === Permission.READ);
    }
  });

  it('an unknown role grants nothing', () => {
    expect(canAny([{ role: 'SUPERUSER' as never }], Permission.ADMIN_ACCESS)).toBe(false);
  });
});

describe('ROLE_DEFINITIONS (pinned to server/src/users/permissions.ts, 15-Oct-2026)', () => {
  it('matches the server catalog', () => {
    expect(ROLE_DEFINITIONS.map((r) => [r.code, r.scopeType, [...r.grants]])).toEqual([
      ['ADMIN', 'global', ['ADMIN_ACCESS']],
      ['LEAD_ASSESSOR', 'result_type', ['LEAD_ACCESS', 'ASSESSOR_ACCESS']],
      ['ASSESSOR', 'result_type', ['ASSESSOR_ACCESS']],
      ['TPB', 'global', ['TPB_ACCESS']],
      ['PPU', 'global', ['PPU_ACCESS']],
      ['PROGRAM', 'program', ['PROGRAM_ACCESS']],
    ]);
  });
});
