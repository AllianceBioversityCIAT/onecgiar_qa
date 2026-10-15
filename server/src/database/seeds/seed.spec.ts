import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from '../../../test/support/in-memory-stores.js';
import { ROLE_DEFINITIONS } from '../../users/permissions.js';
import { RoleAssignmentsRepository } from '../../users/role-assignments.repository.js';
import { UsersRepository } from '../../users/users.repository.js';
import { formatReport, runSeed, type RoleSeedStore } from './seed.js';

function harness() {
  const assignmentsStore = new InMemoryRoleAssignmentsStore();
  const usersStore = new InMemoryUsersStore();
  let roleWrites = 0;
  const roles: RoleSeedStore = {
    findByCode: (code) => assignmentsStore.findRoleByCode(code),
    insert: async (role) => {
      roleWrites++;
      assignmentsStore.addRole({ ...role, isActive: true });
    },
  };
  const deps = {
    roles,
    users: new UsersRepository(usersStore),
    assignments: new RoleAssignmentsRepository(assignmentsStore),
  };
  const snapshot = () =>
    JSON.stringify({
      roles: assignmentsStore.roles,
      users: usersStore.rows,
      assignments: assignmentsStore.rows,
    });
  const writes = () => roleWrites + usersStore.writes + assignmentsStore.writes;
  return { assignmentsStore, usersStore, deps, snapshot, writes };
}

const ALL_ROLES = [
  'ADMIN',
  'LEAD_ASSESSOR',
  'ASSESSOR',
  'TPB',
  'PPU',
  'PROGRAM',
];

describe('seed — roles (FR-2)', () => {
  it('creates the six roles with their scope types on an empty database', async () => {
    const { deps, assignmentsStore } = harness();
    const report = await runSeed(deps, {});
    expect(report.rolesCreated.sort()).toEqual([...ALL_ROLES].sort());
    const byCode = Object.fromEntries(
      assignmentsStore.roles.map((r) => [r.code, r.scopeType]),
    );
    expect(byCode).toEqual({
      ADMIN: 'global',
      LEAD_ASSESSOR: 'result_type',
      ASSESSOR: 'result_type',
      TPB: 'global',
      PPU: 'global',
      PROGRAM: 'program',
    });
    expect(assignmentsStore.roles.every((r) => r.isActive)).toBe(true);
    expect(ROLE_DEFINITIONS).toHaveLength(6);
  });

  it('changes nothing when run again', async () => {
    const { deps, snapshot, writes } = harness();
    await runSeed(deps, {});
    const before = snapshot();
    const writesBefore = writes();

    const report = await runSeed(deps, {});
    expect(report.rolesCreated).toEqual([]);
    expect(report.rolesExisting.sort()).toEqual([...ALL_ROLES].sort());
    expect(snapshot()).toBe(before);
    expect(writes()).toBe(writesBefore);
  });

  it('leaves an administrator-deactivated role deactivated', async () => {
    const { deps, assignmentsStore } = harness();
    await runSeed(deps, {});
    assignmentsStore.roles.find((r) => r.code === 'PPU')!.isActive = false;
    await runSeed(deps, {});
    expect(assignmentsStore.roles.find((r) => r.code === 'PPU')!.isActive).toBe(
      false,
    );
  });

  it('refuses to run over a role stored with a different scope type', async () => {
    const { deps, assignmentsStore } = harness();
    assignmentsStore.addRole({
      code: 'ADMIN',
      name: 'Administrator',
      scopeType: 'program',
      isActive: true,
    });
    await expect(runSeed(deps, {})).rejects.toThrow(/ADMIN.*program.*global/);
  });
});

describe('seed — first ADMIN (FR-2)', () => {
  it('creates a pre-registered user (lowercase email, no sub, sso) with an active ADMIN', async () => {
    const { deps, usersStore, assignmentsStore } = harness();
    const report = await runSeed(deps, {
      adminEmail: ' First.Admin@CGIAR.org ',
    });

    expect(report.admin).toEqual({
      status: 'done',
      email: 'first.admin@cgiar.org',
      userCreated: true,
      assignmentCreated: true,
    });
    expect(usersStore.rows).toHaveLength(1);
    const user = usersStore.rows[0];
    expect(user.email).toBe('first.admin@cgiar.org');
    expect(user.cognitoSub).toBeNull();
    expect(user.authSource).toBe('sso');
    expect(user.createdBy).toBeNull();

    expect(assignmentsStore.rows).toHaveLength(1);
    const assignment = assignmentsStore.rows[0];
    const admin = assignmentsStore.roles.find((r) => r.code === 'ADMIN')!;
    expect(assignment.userId).toBe(user.id);
    expect(assignment.roleId).toBe(admin.id);
    expect(assignment.isActive).toBe(true);
    expect(assignment.resultTypeKey).toBeNull();
    expect(assignment.programId).toBeNull();
  });

  it('does not duplicate the user or the assignment when run again', async () => {
    const { deps, snapshot, writes } = harness();
    await runSeed(deps, { adminEmail: 'first.admin@cgiar.org' });
    const before = snapshot();
    const writesBefore = writes();

    const report = await runSeed(deps, { adminEmail: 'First.Admin@cgiar.org' });
    expect(report.admin).toEqual({
      status: 'done',
      email: 'first.admin@cgiar.org',
      userCreated: false,
      assignmentCreated: false,
    });
    expect(snapshot()).toBe(before);
    expect(writes()).toBe(writesBefore);
  });

  it('keeps an existing user untouched and only adds the missing ADMIN', async () => {
    const { deps, usersStore, assignmentsStore } = harness();
    await deps.users.findOrCreateByEmail('first.admin@cgiar.org', {
      cognitoSub: 'sub-1',
      authSource: 'custom',
    });
    const report = await runSeed(deps, { adminEmail: 'first.admin@cgiar.org' });
    expect(report.admin).toMatchObject({
      userCreated: false,
      assignmentCreated: true,
    });
    expect(usersStore.rows).toHaveLength(1);
    expect(usersStore.rows[0].cognitoSub).toBe('sub-1');
    expect(usersStore.rows[0].authSource).toBe('custom');
    expect(assignmentsStore.rows).toHaveLength(1);
  });

  it.each([undefined, null, '', '   '])(
    'does not touch users or assignments when SEED_ADMIN_EMAIL is %j, and says so',
    async (adminEmail) => {
      const { deps, usersStore, assignmentsStore } = harness();
      const report = await runSeed(deps, { adminEmail });
      expect(report.admin.status).toBe('skipped');
      expect(usersStore.rows).toHaveLength(0);
      expect(usersStore.writes).toBe(0);
      expect(assignmentsStore.rows).toHaveLength(0);
      expect(assignmentsStore.writes).toBe(0);
      expect(formatReport(report).join('\n')).toContain('SEED_ADMIN_EMAIL');
    },
  );

  it('rejects a malformed admin email without writing a user', async () => {
    const { deps, usersStore } = harness();
    await expect(
      runSeed(deps, { adminEmail: 'not-an-email' }),
    ).rejects.toThrow();
    expect(usersStore.rows).toHaveLength(0);
  });
});
