import { drizzle } from 'drizzle-orm/mysql2';
import { InMemoryRoleAssignmentsStore } from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import { ROLE_DEFINITIONS, RoleCode } from './permissions.js';
import {
  DrizzleRoleAssignmentsStore,
  RoleAssignmentsRepository,
} from './role-assignments.repository.js';
import {
  AssignmentNotFoundError,
  DuplicateActiveAssignmentError,
  RoleConflictError,
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

  // DD-11 (reversion, C6): this test used to also grant LEAD_ASSESSOR on KP to
  // the same user and expect four rows. Assessor + Lead on one result type is
  // now forbidden; that case lives in the exclusivity table below.
  it('accepts the same role for another result type or another user', async () => {
    const { repo, store } = setup();
    await repo.create(assessorKp);
    await repo.create({ ...assessorKp, resultTypeKey: 'INNOVATION_DEV' });
    await repo.create({ ...assessorKp, userId: USER + 1 });
    expect(store.rows).toHaveLength(3);
  });

  it('refuses a Lead Assessor on the result type where the user is Assessor (DD-11)', async () => {
    const { repo, store } = setup();
    await repo.create(assessorKp);
    await expect(
      repo.create({ ...assessorKp, roleCode: RoleCode.LEAD_ASSESSOR }),
    ).rejects.toBeInstanceOf(RoleConflictError);
    expect(store.rows).toHaveLength(1);
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

describe('DrizzleRoleAssignmentsStore.findActiveViewsByUserId (the real adapter over a stub driver)', () => {
  // Rows come back as arrays, in the column order of the table.
  const assignmentRow = [
    1,
    7,
    3,
    null,
    null,
    1,
    '2026-01-01 00:00:00',
    null,
    null,
    null,
    '7:3::',
  ];
  const roleRow = [3, 'ADMIN', 'Admin', 'global', 1];

  function adapter(replies: unknown[][]) {
    const statements: string[] = [];
    const client = {
      query: (query: { sql: string }) => {
        statements.push(query.sql);
        return Promise.resolve([replies[statements.length - 1] ?? [], []]);
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleRoleAssignmentsStore(db), statements };
  }

  it('a locking read is SELECT ... FOR SHARE on the assignment rows, then on their roles by primary key (DD-10 lock order)', async () => {
    const { store, statements } = adapter([[assignmentRow], [roleRow]]);

    const views = await store.findActiveViewsByUserId(7, { forShare: true });

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(
      /^select .* from `role_assignments` where .* for share$/,
    );
    expect(statements[0]).not.toMatch(/join|`roles`/);
    expect(statements[1]).toMatch(
      /^select .* from `roles` where `roles`\.`id` in \(\?\) for share$/,
    );
    expect(views).toEqual([
      {
        roleCode: 'ADMIN',
        roleIsActive: true,
        isActive: true,
        revokedAt: null,
        resultTypeKey: null,
        programId: null,
      },
    ]);
  });

  it('a user without active assignments reads the roles of no one', async () => {
    const { store, statements } = adapter([[]]);

    await expect(
      store.findActiveViewsByUserId(7, { forShare: true }),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(1);
  });

  it('a plain read is one joined SELECT with no lock', async () => {
    const { store, statements } = adapter([[]]);

    await store.findActiveViewsByUserId(7);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/inner join `roles`/);
    expect(statements[0]).not.toMatch(/for update|for share/);
  });
});

// FR-3 / DD-2: Assessor and Lead Assessor are exclusive per result type, and `*`
// (all result types, DD-1) overlaps every key. The rule lives in the repository
// so the seed and every future writer get it.
describe('RoleAssignmentsRepository.create — Assessor/Lead exclusivity (FR-3, DD-2)', () => {
  const A = RoleCode.ASSESSOR;
  const L = RoleCode.LEAD_ASSESSOR;
  type Grant = [role: RoleCode, key: string];

  // existing active grants, the grant being added, and whether it is refused
  const shapes: Array<[string, Grant[], Grant, 'refused' | 'allowed']> = [
    ['A KP then L KP (same key)', [[A, 'KP']], [L, 'KP'], 'refused'],
    [
      'L KP then A KP (same key, other order)',
      [[L, 'KP']],
      [A, 'KP'],
      'refused',
    ],
    ['A KP then L * (all covers KP)', [[A, 'KP']], [L, '*'], 'refused'],
    ['L KP then A * (all covers KP)', [[L, 'KP']], [A, '*'], 'refused'],
    ['A * then L KP (all covers KP)', [[A, '*']], [L, 'KP'], 'refused'],
    ['L * then A KP (all covers KP)', [[L, '*']], [A, 'KP'], 'refused'],
    ['L * then A * (all vs all)', [[L, '*']], [A, '*'], 'refused'],
    ['A * then L * (all vs all, other order)', [[A, '*']], [L, '*'], 'refused'],
    [
      'the third grant of a mixed set overlaps the second',
      [
        [A, 'KP'],
        [L, 'IDEV'],
      ],
      [A, 'IDEV'],
      'refused',
    ],
    ['A KP then L IDEV (different keys)', [[A, 'KP']], [L, 'IDEV'], 'allowed'],
    ['L KP then A IDEV (different keys)', [[L, 'KP']], [A, 'IDEV'], 'allowed'],
    [
      'A KP then A * (same role, no exclusivity)',
      [[A, 'KP']],
      [A, '*'],
      'allowed',
    ],
    [
      'L KP then L * (same role, no exclusivity)',
      [[L, 'KP']],
      [L, '*'],
      'allowed',
    ],
    [
      'A KP then A IDEV (same role, other key)',
      [[A, 'KP']],
      [A, 'IDEV'],
      'allowed',
    ],
  ];

  it.each(shapes)('%s', async (_label, existing, added, outcome) => {
    const { repo, store } = setup();
    for (const [roleCode, resultTypeKey] of existing) {
      await repo.create({ userId: USER, roleCode, resultTypeKey });
    }
    const writesBefore = store.writes;
    const attempt = repo.create({
      userId: USER,
      roleCode: added[0],
      resultTypeKey: added[1],
    });
    if (outcome === 'refused') {
      await expect(attempt).rejects.toBeInstanceOf(RoleConflictError);
      expect(store.writes).toBe(writesBefore);
      expect(store.rows).toHaveLength(existing.length);
    } else {
      await expect(attempt).resolves.toMatchObject({ resultTypeKey: added[1] });
      expect(store.rows).toHaveLength(existing.length + 1);
    }
  });

  it('refuses the same shape for the same user only: another user is unaffected', async () => {
    const { repo } = setup();
    await repo.create({ userId: USER, roleCode: A, resultTypeKey: '*' });
    await expect(
      repo.create({ userId: USER + 1, roleCode: L, resultTypeKey: 'KP' }),
    ).resolves.toMatchObject({ userId: USER + 1 });
  });

  it('ignores a revoked grant: Lead * after the Assessor KP was revoked', async () => {
    const { repo } = setup();
    const assessor = await repo.create({
      userId: USER,
      roleCode: A,
      resultTypeKey: 'KP',
    });
    await repo.revoke(assessor.id, ACTOR);
    await expect(
      repo.create({ userId: USER, roleCode: L, resultTypeKey: '*' }),
    ).resolves.toMatchObject({ resultTypeKey: '*' });
  });

  it('ignores a revoked wildcard: Assessor KP after the Lead * was revoked', async () => {
    const { repo } = setup();
    const lead = await repo.create({
      userId: USER,
      roleCode: L,
      resultTypeKey: '*',
    });
    await repo.revoke(lead.id, ACTOR);
    await expect(
      repo.create({ userId: USER, roleCode: A, resultTypeKey: 'KP' }),
    ).resolves.toMatchObject({ resultTypeKey: 'KP' });
  });

  it('does not let a global role grant interfere with the check', async () => {
    const { repo } = setup();
    await repo.create({ userId: USER, roleCode: RoleCode.TPB });
    await repo.create({ userId: USER, roleCode: A, resultTypeKey: '*' });
    await expect(
      repo.create({ userId: USER, roleCode: L, resultTypeKey: 'KP' }),
    ).rejects.toBeInstanceOf(RoleConflictError);
  });
});

describe('RoleAssignmentsRepository.create — the all-result-types sentinel (DD-1)', () => {
  it.each([RoleCode.ASSESSOR, RoleCode.LEAD_ASSESSOR])(
    'stores * for %s',
    async (roleCode) => {
      const { repo } = setup();
      const created = await repo.create({
        userId: USER,
        roleCode,
        resultTypeKey: '*',
      });
      expect(created.resultTypeKey).toBe('*');
    },
  );

  it.each([
    ['ADMIN', RoleCode.ADMIN, { resultTypeKey: '*' }],
    ['TPB', RoleCode.TPB, { resultTypeKey: '*' }],
    ['PPU', RoleCode.PPU, { resultTypeKey: '*' }],
    ['PROGRAM', RoleCode.PROGRAM, { resultTypeKey: '*', programId: null }],
  ])(
    'refuses * for %s (not a result-type role)',
    async (_l, roleCode, scope) => {
      const { repo, store } = setup();
      await expect(
        repo.create({ userId: USER, roleCode, ...scope }),
      ).rejects.toBeInstanceOf(ScopeMismatchError);
      expect(store.rows).toHaveLength(0);
    },
  );
});
