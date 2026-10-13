import { InMemoryRoleAssignmentsStore } from '../../test/support/in-memory-stores.js';
import { ROLE_DEFINITIONS, RoleCode } from './permissions.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import {
  AssignmentNotFoundError,
  DuplicateActiveAssignmentError,
  ScopeMismatchError,
  UnknownRoleError,
} from './users.errors.js';

function setup() {
  const store = new InMemoryRoleAssignmentsStore();
  for (const role of ROLE_DEFINITIONS) {
    store.addRole({
      code: role.code,
      name: role.name,
      scopeType: role.scopeType,
      isActive: true,
    });
  }
  return { store, repo: new RoleAssignmentsRepository(store) };
}

const USER = 7;
const ACTOR = 1;

describe('RoleAssignmentsRepository.create — scope integrity (FR-1, DD-8)', () => {
  it('stores a result-type assignment as active with created_at and created_by', async () => {
    const { repo, store } = setup();
    const created = await repo.create({
      userId: USER,
      roleCode: RoleCode.ASSESSOR,
      resultTypeKey: 'KP',
      createdBy: ACTOR,
    });
    expect(created.isActive).toBe(true);
    expect(created.resultTypeKey).toBe('KP');
    expect(created.programId).toBeNull();
    expect(created.createdBy).toBe(ACTOR);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.revokedAt).toBeNull();
    expect(store.rows).toHaveLength(1);
  });

  it('stores a program assignment', async () => {
    const { repo } = setup();
    const created = await repo.create({
      userId: USER,
      roleCode: RoleCode.PROGRAM,
      programId: 12,
    });
    expect(created.programId).toBe(12);
    expect(created.resultTypeKey).toBeNull();
    expect(created.createdBy).toBeNull();
  });

  it.each([RoleCode.ADMIN, RoleCode.TPB, RoleCode.PPU])(
    'stores global role %s with no scope',
    async (roleCode) => {
      const { repo } = setup();
      const created = await repo.create({ userId: USER, roleCode });
      expect(created.isActive).toBe(true);
      expect(created.resultTypeKey).toBeNull();
      expect(created.programId).toBeNull();
    },
  );

  it('accepts explicit nulls as "no scope" for a global role', async () => {
    const { repo } = setup();
    const created = await repo.create({
      userId: USER,
      roleCode: RoleCode.ADMIN,
      resultTypeKey: null,
      programId: null,
    });
    expect(created.isActive).toBe(true);
  });

  type Rejected = [
    label: string,
    roleCode: string,
    scope: { resultTypeKey?: string | null; programId?: number | null },
  ];
  const rejected: Rejected[] = [
    [
      'result-type role with a program id',
      RoleCode.ASSESSOR,
      { programId: 12 },
    ],
    ['result-type role with no key at all', RoleCode.ASSESSOR, {}],
    [
      'result-type role with a null key',
      RoleCode.ASSESSOR,
      { resultTypeKey: null },
    ],
    [
      'result-type role with an empty-string key',
      RoleCode.ASSESSOR,
      { resultTypeKey: '' },
    ],
    [
      'result-type role with a whitespace-only key',
      RoleCode.ASSESSOR,
      { resultTypeKey: '   ' },
    ],
    [
      'result-type role with a non-canonical (padded) key',
      RoleCode.ASSESSOR,
      { resultTypeKey: ' KP' },
    ],
    [
      'result-type role with a key longer than the column',
      RoleCode.ASSESSOR,
      { resultTypeKey: 'K'.repeat(65) },
    ],
    [
      'result-type role with a key and a program id',
      RoleCode.ASSESSOR,
      { resultTypeKey: 'KP', programId: 12 },
    ],
    ['lead role with a program id', RoleCode.LEAD_ASSESSOR, { programId: 12 }],
    ['lead role with no key', RoleCode.LEAD_ASSESSOR, {}],
    [
      'lead role with an empty-string key',
      RoleCode.LEAD_ASSESSOR,
      { resultTypeKey: '' },
    ],
    ['program role with no program', RoleCode.PROGRAM, {}],
    [
      'program role with a result type key',
      RoleCode.PROGRAM,
      { resultTypeKey: 'KP' },
    ],
    [
      'program role with an empty-string key',
      RoleCode.PROGRAM,
      { resultTypeKey: '' },
    ],
    [
      'program role with a key and a program id',
      RoleCode.PROGRAM,
      { resultTypeKey: 'KP', programId: 12 },
    ],
    ['program role with program id 0', RoleCode.PROGRAM, { programId: 0 }],
    [
      'program role with a negative program id',
      RoleCode.PROGRAM,
      { programId: -3 },
    ],
    [
      'program role with a fractional program id',
      RoleCode.PROGRAM,
      { programId: 1.5 },
    ],
    [
      'program role with a program id above the unsigned int range',
      RoleCode.PROGRAM,
      { programId: 4294967296 },
    ],
    ['ADMIN with a result type key', RoleCode.ADMIN, { resultTypeKey: 'KP' }],
    ['ADMIN with a program id', RoleCode.ADMIN, { programId: 12 }],
    ['ADMIN with an empty-string key', RoleCode.ADMIN, { resultTypeKey: '' }],
    ['ADMIN with program id 0', RoleCode.ADMIN, { programId: 0 }],
    ['TPB with a result type key', RoleCode.TPB, { resultTypeKey: 'KP' }],
    ['TPB with a program id', RoleCode.TPB, { programId: 12 }],
    ['PPU with a result type key', RoleCode.PPU, { resultTypeKey: 'KP' }],
    ['PPU with a program id', RoleCode.PPU, { programId: 12 }],
  ];

  it.each(rejected)(
    'rejects %s with a scope mismatch and writes nothing',
    async (_label, roleCode, scope) => {
      const { repo, store } = setup();
      await expect(
        repo.create({ userId: USER, roleCode, ...scope }),
      ).rejects.toBeInstanceOf(ScopeMismatchError);
      expect(store.rows).toHaveLength(0);
      expect(store.writes).toBe(0);
    },
  );

  it('rejects an unknown role code', async () => {
    const { repo, store } = setup();
    await expect(
      repo.create({ userId: USER, roleCode: 'SUPERUSER' }),
    ).rejects.toBeInstanceOf(UnknownRoleError);
    expect(store.rows).toHaveLength(0);
  });
});

describe('RoleAssignmentsRepository.create — duplicate active assignment (FR-1)', () => {
  const assessorKp = {
    userId: USER,
    roleCode: RoleCode.ASSESSOR,
    resultTypeKey: 'KP',
  };

  it('rejects the same active assignment stored twice', async () => {
    const { repo, store } = setup();
    await repo.create(assessorKp);
    await expect(repo.create(assessorKp)).rejects.toBeInstanceOf(
      DuplicateActiveAssignmentError,
    );
    expect(store.rows).toHaveLength(1);
  });

  it('rejects a duplicate global assignment', async () => {
    const { repo } = setup();
    await repo.create({ userId: USER, roleCode: RoleCode.ADMIN });
    await expect(
      repo.create({ userId: USER, roleCode: RoleCode.ADMIN }),
    ).rejects.toBeInstanceOf(DuplicateActiveAssignmentError);
  });

  it('accepts the same role for another result type, another user, or another role', async () => {
    const { repo, store } = setup();
    await repo.create(assessorKp);
    await repo.create({ ...assessorKp, resultTypeKey: 'INNOVATION_DEV' });
    await repo.create({ ...assessorKp, userId: USER + 1 });
    await repo.create({ ...assessorKp, roleCode: RoleCode.LEAD_ASSESSOR });
    expect(store.rows).toHaveLength(4);
  });

  it('accepts a new active assignment once the previous one was revoked', async () => {
    const { repo, store } = setup();
    const first = await repo.create(assessorKp);
    await repo.revoke(first.id, ACTOR);
    const second = await repo.create(assessorKp);
    expect(second.id).not.toBe(first.id);
    expect(second.isActive).toBe(true);
    expect(store.rows).toHaveLength(2);
  });
});

describe('RoleAssignmentsRepository.revoke (FR-1)', () => {
  it('deactivates with revoked_at and revoked_by, and keeps the row', async () => {
    const { repo, store } = setup();
    const created = await repo.create({
      userId: USER,
      roleCode: RoleCode.ASSESSOR,
      resultTypeKey: 'KP',
    });
    await repo.revoke(created.id, ACTOR);

    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.id).toBe(created.id);
    expect(row.isActive).toBe(false);
    expect(row.revokedBy).toBe(ACTOR);
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.resultTypeKey).toBe('KP');
  });

  it('rejects revoking an assignment that is already revoked', async () => {
    const { repo } = setup();
    const created = await repo.create({
      userId: USER,
      roleCode: RoleCode.ADMIN,
    });
    await repo.revoke(created.id, ACTOR);
    await expect(repo.revoke(created.id, ACTOR)).rejects.toBeInstanceOf(
      AssignmentNotFoundError,
    );
  });

  it('rejects revoking an assignment that does not exist', async () => {
    const { repo } = setup();
    await expect(repo.revoke(999, ACTOR)).rejects.toBeInstanceOf(
      AssignmentNotFoundError,
    );
  });
});
