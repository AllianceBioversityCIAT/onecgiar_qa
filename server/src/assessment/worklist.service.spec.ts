// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { TimelineNotFoundError } from '../admin-config/admin-config.errors.js';
import { AuthorizationService } from '../users/authorization.service.js';
import type { AssignmentView } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { InvalidListQueryError } from '../users/users.errors.js';
import {
  defaultFakeSteps,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { WorklistService, type WorklistQuery } from './worklist.service.js';
import type { WorklistSortKey } from './worklist.store.js';

const MARCH = new Date('2026-03-10T10:00:00Z'); // step 1 (assessors) open
const APRIL = new Date('2026-04-10T10:00:00Z'); // step 2 (programs) open

// Names deliberately not in id order, so a sort by name differs from a sort by id.
const PROGRAMS = [
  { id: 1, code: 'SP01', name: 'Mango' },
  { id: 2, code: 'SP02', name: 'Zebra' },
  { id: 3, code: 'SP03', name: 'Apple' },
  { id: 4, code: 'SP04', name: 'Quince' },
  { id: 5, code: 'SP05', name: 'Berry' },
];
const RESULT_TYPES = [
  { key: 'policy_change', name: 'Policy change' },
  { key: 'innovation_use', name: 'Innovation use' },
];

function assignment(
  roleCode: string,
  resultTypeKey: string | null,
  extra: Partial<AssignmentView> = {},
): AssignmentView {
  return {
    roleCode,
    roleIsActive: true,
    isActive: true,
    revokedAt: null,
    resultTypeKey,
    programId: null,
    ...extra,
  };
}

function userOf(
  id: number,
  assignments: AssignmentView[],
  programScope: number[] = [],
): AuthenticatedUser {
  return {
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
  } as AuthenticatedUser;
}

const assessorA = () =>
  userOf(10, [assignment('ASSESSOR', 'policy_change')], [1]);
const admin = () => userOf(99, [assignment('ADMIN', null)]);

function setup(now: Date = MARCH) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push(
    {
      id: 1,
      name: 'Official',
      kind: 'official',
      steps: defaultFakeSteps(),
    },
    {
      id: 2,
      name: 'Additional B',
      kind: 'additional',
      steps: defaultFakeSteps(),
    },
  );
  const catalog = {
    listSciencePrograms: () => Promise.resolve(PROGRAMS),
    listResultTypes: () => Promise.resolve(RESULT_TYPES),
  } as unknown as CatalogService;
  const service = new WorklistService(
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    catalog,
    new AuthorizationService(),
    () => now,
  );
  return { world, service };
}

let nextId = 1;
function membership(
  extra: Partial<FakeMembership> & Pick<FakeMembership, 'resultCode'>,
): FakeMembership {
  const id = nextId++;
  return {
    id,
    timelineId: 1,
    title: `Title ${extra.resultCode}`,
    programId: 1,
    resultTypeKey: 'policy_change',
    ...extra,
  };
}

const codes = (page: { rows: Array<{ resultCode: number }> }) =>
  page.rows.map((row) => row.resultCode);

describe('FR-1: scope by role row', () => {
  it('Assessor sees only their scope, and nothing of a timeline they are not assigned to', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(
      membership({
        resultCode: 1,
        programId: 1,
        resultTypeKey: 'policy_change',
      }),
      membership({
        resultCode: 2,
        programId: 2,
        resultTypeKey: 'policy_change',
      }),
      membership({
        resultCode: 3,
        programId: 1,
        resultTypeKey: 'innovation_use',
      }),
      membership({ resultCode: 4, timelineId: 2, programId: 1 }),
    );

    expect(codes(await service.list(assessorA(), 1))).toEqual([1]);
    // Timeline 2 holds an in-scope membership, but A is not assigned to it.
    await expect(service.list(assessorA(), 2)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
  });

  it('drops the membership once the assignment is removed or the grant revoked', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(membership({ resultCode: 1 }));
    expect(codes(await service.list(assessorA(), 1))).toEqual([1]);

    const revoked = userOf(
      10,
      [assignment('ASSESSOR', 'policy_change', { revokedAt: new Date() })],
      [1],
    );
    expect(codes(await service.list(revoked, 1))).toEqual([]);

    world.timelineUsers[0].removed = true;
    await expect(service.list(assessorA(), 1)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
  });

  it('Revoked grant with a stale assignment: nothing is listed, and the answer says no role has a worklist', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(membership({ resultCode: 1 }));
    const revoked = userOf(
      10,
      [assignment('ASSESSOR', 'policy_change', { isActive: false })],
      [1],
    );

    const page = await service.list(revoked, 1);

    expect(page.rows).toEqual([]);
    expect(page.noActiveRole).toBe(true);
  });

  it('Admin sees every pending and auto-validated membership, but not not_in_qa', async () => {
    const { world, service } = setup();
    world.memberships.push(
      membership({ resultCode: 1, status: 'pending' }),
      membership({ resultCode: 2, status: 'auto_validated' }),
      membership({ resultCode: 3, status: 'not_in_qa' }),
      membership({
        resultCode: 4,
        programId: 4,
        resultTypeKey: 'innovation_use',
      }),
    );

    const page = await service.list(admin(), 1);
    expect(codes(page)).toEqual([1, 4]);

    const withAuto = await service.list(admin(), 1, {
      statuses: ['auto_validated'],
    });
    expect(codes(withAuto)).toEqual([2]);
    // Whatever the filter, not_in_qa never shows.
    const all = await service.list(admin(), 1, {
      statuses: ['pending', 'auto_validated'],
    });
    expect(codes(all)).not.toContain(3);
  });

  it('A role with no active row (LEAD_ASSESSOR only): empty 200 that says so, never an error and never step-1 results', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 11,
      roleCode: 'LEAD_ASSESSOR',
    });
    world.memberships.push(membership({ resultCode: 1 }));
    const lead = userOf(11, [assignment('LEAD_ASSESSOR', 'policy_change')]);

    const page = await service.list(lead, 1);

    expect(page.rows).toEqual([]);
    expect(page.noActiveRole).toBe(true);
    expect(page.counters).toEqual({ pending: 0, finished: 0, total: 0 });
  });
});

describe('FR-3: timeline choice', () => {
  it('defaults to the official timeline and offers only the assigned ones', async () => {
    const { world, service } = setup();
    world.timelines.push({
      id: 3,
      name: 'Other C',
      kind: 'additional',
      steps: defaultFakeSteps(),
    });
    world.timelineUsers.push(
      { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
      { timelineId: 2, userId: 10, roleCode: 'ASSESSOR' },
    );
    // A loaded timeline: without a load the steps would read as on hold.
    world.memberships.push(membership({ resultCode: 1 }));

    const offered = await service.timelines(assessorA());

    expect(offered.timelines.map((t) => t.id)).toEqual([1, 2]);
    expect(offered.defaultTimelineId).toBe(1);
    expect(offered.timelines[0]).toMatchObject({
      name: 'Official',
      kind: 'official',
      roles: ['ASSESSOR'],
      step: { position: 1, state: 'in_progress' },
    });
    expect(offered.timeZone).toBe('Europe/Rome');
    // A timeline the user is not assigned to answers 404, never another timeline's data.
    await expect(service.list(assessorA(), 3)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
  });

  it.each(['draft', 'closed'] as const)(
    'a timeline of a %s cycle is neither offered nor readable, for an admin and for an assigned assessor',
    async (cycleStatus) => {
      const { world, service } = setup();
      world.timelines[1].cycleStatus = cycleStatus;
      world.timelineUsers.push(
        { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
        { timelineId: 2, userId: 10, roleCode: 'ASSESSOR' },
      );
      world.memberships.push(
        membership({ resultCode: 1 }),
        membership({ resultCode: 2, timelineId: 2 }),
      );

      expect(
        (await service.timelines(admin())).timelines.map((t) => t.id),
      ).toEqual([1]);
      expect(
        (await service.timelines(assessorA())).timelines.map((t) => t.id),
      ).toEqual([1]);
      await expect(service.list(admin(), 2)).rejects.toBeInstanceOf(
        TimelineNotFoundError,
      );
      await expect(service.list(assessorA(), 2)).rejects.toBeInstanceOf(
        TimelineNotFoundError,
      );
      // The active cycle's timeline still answers.
      expect(codes(await service.list(assessorA(), 1))).toEqual([1]);
    },
  );

  it('defaults to the first timeline by step-1 opening time when none is official', async () => {
    const { world, service } = setup();
    world.timelines[0].kind = 'additional';
    world.timelines[0].steps[0].opensAt = '2026-03-05T00:00' as never;
    world.timelines[1].steps[0].opensAt = '2026-03-02T00:00' as never;
    world.timelineUsers.push(
      { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
      { timelineId: 2, userId: 10, roleCode: 'ASSESSOR' },
    );

    expect((await service.timelines(assessorA())).defaultTimelineId).toBe(2);
  });

  it('offers every timeline to an admin and none, with no default, to a user with no assignment', async () => {
    const { service } = setup();
    expect((await service.timelines(admin())).timelines).toHaveLength(2);
    const nobody = await service.timelines(assessorA());
    expect(nobody.timelines).toEqual([]);
    expect(nobody.defaultTimelineId).toBeNull();
  });
});

describe('FR-4: filters and search', () => {
  function tenPendingThreeAuto() {
    const ctx = setup();
    ctx.world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    for (let i = 1; i <= 10; i += 1) {
      ctx.world.memberships.push(membership({ resultCode: i }));
    }
    for (let i = 11; i <= 13; i += 1) {
      ctx.world.memberships.push(
        membership({ resultCode: i, status: 'auto_validated' }),
      );
    }
    return ctx;
  }

  it('hides Auto-validated by default and applies the same hiding to the counters', async () => {
    const { service } = tenPendingThreeAuto();

    const page = await service.list(assessorA(), 1);
    expect(page.rows).toHaveLength(10);
    expect(page.counters).toEqual({ pending: 10, finished: 0, total: 10 });

    const auto = await service.list(assessorA(), 1, {
      statuses: ['auto_validated'],
    });
    expect(auto.rows).toHaveLength(3);
    // Named in the filter, so the counters stop hiding them too.
    expect(auto.counters).toEqual({ pending: 10, finished: 0, total: 13 });
  });

  it('searches the title case-insensitively and the result code by prefix; no match is an empty page', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(
      membership({ resultCode: 5001, title: 'Seed systems for maize' }),
      membership({ resultCode: 6002, title: 'Other' }),
    );

    expect(
      codes(await service.list(assessorA(), 1, { q: 'seed sys' })),
    ).toEqual([5001]);
    expect(codes(await service.list(assessorA(), 1, { q: '60' }))).toEqual([
      6002,
    ]);
    const none = await service.list(assessorA(), 1, { q: 'nothing like it' });
    expect(none.rows).toEqual([]);
    expect(none.nextCursor).toBeNull();
  });

  it('treats search wildcards as text', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(
      membership({ resultCode: 1, title: 'plain' }),
      membership({ resultCode: 2, title: '100% done' }),
    );
    expect(codes(await service.list(assessorA(), 1, { q: '%' }))).toEqual([2]);
  });

  it('filters by program and result type', async () => {
    const { world, service } = setup();
    const lead = userOf(10, [assignment('ASSESSOR', '*')]);
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(
      membership({
        resultCode: 1,
        programId: 1,
        resultTypeKey: 'policy_change',
      }),
      membership({
        resultCode: 2,
        programId: 2,
        resultTypeKey: 'policy_change',
      }),
      membership({
        resultCode: 3,
        programId: 2,
        resultTypeKey: 'innovation_use',
      }),
    );
    expect(codes(await service.list(lead, 1, { programIds: [2] }))).toEqual([
      2, 3,
    ]);
    expect(
      codes(
        await service.list(lead, 1, {
          programIds: [2],
          resultTypeKeys: ['innovation_use'],
        }),
      ),
    ).toEqual([3]);
  });
});

describe('FR-5: status', () => {
  it('accepts the three values this spec never produces', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(membership({ resultCode: 1 }));
    for (const status of [
      'pending_tpb_review',
      'pending_ppu',
      'unresolved',
    ] as const) {
      const page = await service.list(assessorA(), 1, { statuses: [status] });
      expect(page.rows).toEqual([]);
    }
  });
});

describe('FR-6: columns', () => {
  it('shows Updated only for a round-2 membership with changed fields, and never the keys', async () => {
    const { world, service } = setup();
    world.memberships.push(
      membership({
        resultCode: 1,
        round: 2,
        changedFields: ['general.title'],
      }),
      membership({ resultCode: 2, round: 2, changedFields: [] }),
      membership({ resultCode: 3, round: 1, changedFields: null }),
    );

    const page = await service.list(admin(), 1);

    expect(page.rows.map((row) => [row.resultCode, row.updated])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
    expect(JSON.stringify(page)).not.toContain('general.title');
    expect(JSON.stringify(page)).not.toContain('changedFields');
  });

  it('Assessed by with no nickname carries no name or email', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.users.push({ id: 7, nickname: null }, { id: 8, nickname: 'Nick' });
    world.memberships.push(
      membership({ id: 71, resultCode: 1 }),
      membership({ id: 72, resultCode: 2 }),
      membership({ id: 73, resultCode: 3 }),
    );
    world.assessments.push(
      {
        id: 1,
        membershipId: 71,
        stepPosition: 1,
        status: 'quality_assessed',
        finishedBy: 7,
      },
      {
        id: 2,
        membershipId: 72,
        stepPosition: 1,
        status: 'quality_assessed',
        finishedBy: 8,
      },
    );

    const page = await service.list(admin(), 1);

    expect(page.rows.map((row) => row.assessedBy)).toEqual([
      { id: 7, nickname: null },
      { id: 8, nickname: 'Nick' },
      null,
    ]);
    expect(JSON.stringify(page)).not.toMatch(/example\.org|First|Last/);
  });

  it('shows the documented columns only: no Action Area, no Export', async () => {
    const { world, service } = setup();
    world.memberships.push(membership({ resultCode: 1 }));
    const [row] = (await service.list(admin(), 1)).rows;
    expect(Object.keys(row).sort()).toEqual(
      [
        'answeredBySp',
        'assessedBy',
        'canOpen',
        'comments',
        'membershipId',
        'program',
        'readOnlyReason',
        'resultCode',
        'resultType',
        'status',
        'title',
        'updated',
      ].sort(),
    );
    expect(row).toMatchObject({
      answeredBySp: 0,
      program: { id: 1, code: 'SP01', name: 'Mango' },
      resultType: { key: 'policy_change', label: 'Policy change' },
      status: 'pending',
    });
  });

  it('counts only non-withdrawn comments, and marks admin rows read-only and assessor rows writable', async () => {
    const { world, service } = setup();
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(membership({ id: 81, resultCode: 1 }));
    world.assessments.push({
      id: 5,
      membershipId: 81,
      stepPosition: 1,
      status: 'pending',
    });
    world.comments.push(
      { assessmentId: 5, authorId: 10, state: 'open' },
      { assessmentId: 5, authorId: 10, state: 'open' },
      { assessmentId: 5, authorId: 10, state: 'withdrawn' },
    );

    const mine = await service.list(assessorA(), 1);
    expect(mine.rows[0]).toMatchObject({
      comments: 2,
      canOpen: true,
      readOnlyReason: null,
    });
    expect(mine.writable).toBe(true);
    const theirs = await service.list(admin(), 1);
    expect(theirs.rows[0].readOnlyReason).toBe('admin_read_only');
    expect(theirs.writable).toBe(false);
  });
});

describe('FR-7: sort, paging, counters', () => {
  const programNameDesc = ['Zebra', 'Quince', 'Mango', 'Berry', 'Apple'];

  function manyRows(count: number) {
    const ctx = setup();
    ctx.world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    ctx.world.users.push(
      { id: 7, nickname: 'Zed' },
      { id: 8, nickname: 'Amy' },
    );
    for (let i = 0; i < count; i += 1) {
      const id = 1000 + i;
      ctx.world.memberships.push(
        membership({
          id,
          // Codes interleave the programs, so a program sort is not a code sort.
          resultCode: 5000 + ((i * 7) % count),
          programId: (i % 5) + 1,
          resultTypeKey: i % 2 === 0 ? 'policy_change' : 'innovation_use',
          title: `T${(i * 13) % count}`,
        }),
      );
      if (i % 3 === 0) {
        ctx.world.assessments.push({
          id,
          membershipId: id,
          stepPosition: 1,
          status: i % 6 === 0 ? 'quality_assessed' : 'pending',
          finishedBy: i % 6 === 0 ? (i % 4 === 0 ? 7 : 8) : null,
        });
        for (let c = 0; c < i % 4; c += 1) {
          ctx.world.comments.push({
            assessmentId: id,
            authorId: 10,
            state: 'open',
          });
        }
      }
    }
    return ctx;
  }

  const assessorAll = () => userOf(10, [assignment('ASSESSOR', '*')]);

  async function pageAll(service: WorklistService, query: WorklistQuery) {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await service.list(assessorAll(), 1, { ...query, cursor });
      seen.push(...codes(page));
      if (page.nextCursor === null) return seen;
      cursor = page.nextCursor;
    }
    throw new Error('paging did not end');
  }

  it('Sort by Science Program descending: 120 rows over 5 programs, every row once, in program-name order then code order', async () => {
    const { world, service } = manyRows(120);
    expect(world.memberships).toHaveLength(120);
    expect(new Set(world.memberships.map((m) => m.programId)).size).toBe(5);

    const seen = await pageAll(service, { sort: 'program', dir: 'desc' });

    const nameOf = (programId: number) =>
      PROGRAMS.find((p) => p.id === programId)!.name;
    const expected = [...world.memberships]
      .sort(
        (a, b) =>
          programNameDesc.indexOf(nameOf(a.programId)) -
            programNameDesc.indexOf(nameOf(b.programId)) ||
          a.resultCode - b.resultCode,
      )
      .map((m) => m.resultCode);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(expected);
  });

  it('answers the first page of 25 by default and 100 at most', async () => {
    const { service } = manyRows(120);
    const first = await service.list(assessorAll(), 1);
    expect(first.rows).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    expect(
      (await service.list(assessorAll(), 1, { limit: 100 })).rows,
    ).toHaveLength(100);
  });

  it.each<[WorklistSortKey, 'asc' | 'desc']>([
    ['code', 'asc'],
    ['code', 'desc'],
    ['title', 'asc'],
    ['title', 'desc'],
    ['program', 'asc'],
    ['resultType', 'desc'],
    ['comments', 'desc'],
    ['answered', 'asc'],
    ['assessedBy', 'asc'],
    ['assessedBy', 'desc'],
    ['status', 'asc'],
    ['status', 'desc'],
  ])('pages every row exactly once when sorted by %s %s', async (sort, dir) => {
    const { service } = manyRows(120);
    const seen = await pageAll(service, { sort, dir, limit: 25 });
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });

  it('keeps the counters on the whole scope whatever the other filters say', async () => {
    const { world, service } = manyRows(120);
    const plain = await service.list(assessorAll(), 1);
    expect(plain.counters.total).toBe(120);
    expect(plain.counters.finished).toBeGreaterThan(0);
    const filtered = await service.list(assessorAll(), 1, {
      programIds: [1],
      q: 'T1',
      statuses: ['pending'],
    });
    expect(filtered.rows.length).toBeLessThan(120);
    expect(filtered.counters).toEqual(plain.counters);
    expect(
      world.assessments.filter((a) => a.status === 'quality_assessed').length,
    ).toBe(plain.counters.finished);
  });

  it('answers a page with a fixed number of statements, the same at 30 and at 1,000 rows (NFR-1)', async () => {
    const small = manyRows(30);
    small.world.resetStatements();
    // limit 100: the 30-row world answers 30 rows and the 1,000-row world 100, so a cost per row shows.
    await small.service.list(assessorAll(), 1, { limit: 100 });
    const atThirty = small.world.statements;

    const large = manyRows(1000);
    large.world.resetStatements();
    await large.service.list(assessorAll(), 1, { limit: 100 });
    const atThousand = large.world.statements;

    // The 1,000-row page asked for the maximum page too.
    large.world.resetStatements();
    await large.service.list(assessorAll(), 1, {
      limit: 100,
      sort: 'comments',
    });
    const biggestPage = large.world.statements;

    expect(atThirty).toBeLessThanOrEqual(8);
    expect(atThousand).toBe(atThirty);
    expect(biggestPage).toBe(atThirty);
  });

  describe('Bad cursor', () => {
    async function rejects(query: WorklistQuery, field = 'cursor') {
      const { service } = manyRows(60);
      let error: unknown;
      try {
        await service.list(assessorAll(), 1, query);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(InvalidListQueryError);
      expect((error as InvalidListQueryError).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [{ field }],
      });
    }

    const forge = (payload: unknown) =>
      Buffer.from(JSON.stringify(payload)).toString('base64url');

    it('rejects a tampered value, a cursor from another sort or direction, and malformed text', async () => {
      const { service } = manyRows(60);
      const page = await service.list(assessorAll(), 1, {
        sort: 'program',
        limit: 10,
      });
      const good = page.nextCursor!;
      expect(good).toBeTruthy();

      await rejects({ sort: 'code', cursor: good });
      await rejects({ sort: 'program', dir: 'desc', cursor: good });
      await rejects({ sort: 'program', cursor: `${good}!` });
      await rejects({ cursor: 'not a cursor' });
      await rejects({ cursor: forge([1, 2]) });
      await rejects({
        cursor: forge({ s: 'code', d: 'asc', v: 'abc', c: 1, i: 1 }),
      });
      await rejects({
        cursor: forge({ s: 'code', d: 'asc', v: 5, c: 'x', i: 1 }),
      });
      await rejects({ cursor: forge({ s: 'code', d: 'asc', v: 5, c: 1 }) });
      await rejects({
        cursor: forge({ s: 'nope', d: 'asc', v: 5, c: 1, i: 1 }),
      });
      await rejects({
        sort: 'title',
        cursor: forge({ s: 'title', d: 'asc', v: 7, c: 1, i: 1 }),
      });
    });

    it('accepts a cursor the service itself issued, for the same sort and direction', async () => {
      const { service } = manyRows(60);
      const first = await service.list(assessorAll(), 1, {
        sort: 'program',
        dir: 'desc',
        limit: 10,
      });
      const second = await service.list(assessorAll(), 1, {
        sort: 'program',
        dir: 'desc',
        limit: 10,
        cursor: first.nextCursor!,
      });
      expect(codes(second)).not.toEqual(codes(first));
    });

    it('rejects a limit outside 1 to 100', async () => {
      await rejects({ limit: 0 }, 'limit');
      await rejects({ limit: 101 }, 'limit');
    });
  });
});

describe('paging a result code held in two rounds (admin reads both)', () => {
  it('lists each membership once even when the page boundary falls between them', async () => {
    const { world, service } = setup();
    world.memberships.push(
      membership({
        id: 501,
        resultCode: 7,
        round: 1,
        ended: true,
        endReason: 'returned',
      }),
      membership({ id: 502, resultCode: 7, round: 2 }),
      membership({ id: 503, resultCode: 8, round: 1 }),
    );
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await service.list(admin(), 1, { limit: 1, cursor });
      seen.push(...page.rows.map((row) => row.membershipId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([501, 502, 503]);
  });
});

describe('FR-19: clarification predicate', () => {
  it('lists a membership whose clarification_requested comment the user wrote, as clarification_requested and read-only', async () => {
    const { world, service } = setup(APRIL);
    world.timelineUsers.push({
      timelineId: 1,
      userId: 10,
      roleCode: 'ASSESSOR',
    });
    world.memberships.push(membership({ id: 91, resultCode: 1 }));
    world.assessments.push({
      id: 9,
      membershipId: 91,
      stepPosition: 1,
      status: 'returned',
      finishedBy: 10,
    });
    world.users.push({ id: 10, nickname: 'Ann' });
    world.comments.push({
      assessmentId: 9,
      authorId: 10,
      state: 'clarification_requested',
    });

    const page = await service.list(assessorA(), 1);

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      status: 'clarification_requested',
      readOnlyReason: 'step_closed',
    });
    expect(page.writable).toBe(false);
    expect(page.counters.finished).toBe(1);
  });

  it('keeps an ended membership listed during step 2 only for the author of the clarification', async () => {
    const { world, service } = setup(APRIL);
    world.timelineUsers.push(
      { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
      { timelineId: 1, userId: 12, roleCode: 'ASSESSOR' },
    );
    world.memberships.push(
      membership({
        id: 92,
        resultCode: 1,
        ended: true,
        endReason: 'timeline_closed',
      }),
    );
    world.assessments.push({
      id: 10,
      membershipId: 92,
      stepPosition: 1,
      status: 'returned',
    });
    world.comments.push({
      assessmentId: 10,
      authorId: 10,
      state: 'clarification_requested',
    });
    const other = userOf(12, [assignment('ASSESSOR', 'policy_change')], [1]);

    expect(codes(await service.list(assessorA(), 1))).toEqual([1]);
    expect(codes(await service.list(other, 1))).toEqual([]);
    // Outside step 2 the ended membership drops out again.
    const march = setup(MARCH);
    march.world.timelines = world.timelines;
    march.world.timelineUsers = world.timelineUsers;
    march.world.memberships = world.memberships;
    march.world.assessments = world.assessments;
    march.world.comments = world.comments;
    expect(codes(await march.service.list(assessorA(), 1))).toEqual([]);
  });
});
