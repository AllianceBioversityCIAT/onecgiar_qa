// @akili-spec escalation/round-2
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
import { runRealLoad } from '../../test/support/real-load-writer.js';
import {
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  noReleaseDispatch,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { AssessmentService } from './assessment.service.js';
import type { WorklistStep } from './worklist.store.js';

// Round-2 writes touch Assessed core fields only (round-2 FR-3, FR-17; design
// 6, 7). Expected values are the literals of the FR-3 scenario: a validation or
// a comment on a non-core field is a 409 `ASSESSMENT_FIELD_NOT_CORE` and
// nothing is stored; Check all and Uncheck all act on core fields only.

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
// 12 Assessed, of which the first 4 are core; the next 2 View only; the rest Hidden.
const ASSESSED = applicable.slice(0, 12);
const CORE = ASSESSED.slice(0, 4);
const NON_CORE = ASSESSED.slice(4);
const VIEW_ONLY = applicable.slice(12, 14);

const items = (): ConfigItem[] =>
  applicable.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: ASSESSED.includes(fieldKey)
      ? 'assessed'
      : VIEW_ONLY.includes(fieldKey)
        ? 'view_only'
        : 'hidden',
    isCore: CORE.includes(fieldKey),
    isAiInput: false,
  }));

const assignment = (roleCode: string): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey: 'policy_change',
  programId: null,
});
const userOf = (id: number, roleCode: string): AuthenticatedUser =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname: null,
    authSource: 'custom',
    isActive: true,
    assignments: [assignment(roleCode)],
    programScope: [1],
    exclusions: [],
  }) as AuthenticatedUser;
const lead = () => userOf(20, 'LEAD_ASSESSOR');
const assessor = () => userOf(10, 'ASSESSOR');

const minute = (value: string) => value as RomeMinute;
const STEPS: WorklistStep[] = [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors',
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    name: 'Step 2',
    audience: 'programs',
    opensAt: minute('2026-12-01T00:00'),
    closesAt: minute('2026-12-31T23:59'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors',
    opensAt: minute('2027-02-01T00:00'),
    closesAt: minute('2027-02-28T23:59'),
  },
];
const STEP_ONE_OPEN = new Date('2026-11-13T10:00:00Z');
const STEP_THREE_OPEN = new Date('2027-02-10T10:00:00Z');
const RID = 'req-1';

let nextId = 1;
async function setup(now: Date, round: 1 | 2) {
  const world = new InMemoryAssessmentWorld();
  const snapshots = new FakeSnapshotStore();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: STEPS,
  });
  world.timelineUsers.push(
    { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
    { timelineId: 1, userId: 20, roleCode: 'LEAD_ASSESSOR' },
  );
  world.users.push({ id: 10, nickname: 'Ana' }, { id: 20, nickname: 'Lia' });
  world.fieldConfigItems['policy_change'] = items();
  world.versionItems[1] = { policy_change: items() };
  const service = new AssessmentService(
    new InMemoryAssessmentStore(world),
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    snapshots,
    {
      forYear: vi.fn(() => Promise.resolve(catalog)),
    } satisfies FieldCatalogSource,
    new FakeFieldConfigEffective(world),
    {
      listSciencePrograms: () => Promise.resolve([]),
      listResultTypes: () => Promise.resolve([]),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => now,
    new InMemoryAssessmentUnitOfWork(world),
    noReleaseDispatch,
  );
  const id = nextId++;
  // The snapshot is written by the real load runner, so its key is the writer's own.
  const real = await runRealLoad(
    [{ resultId: 1001, values: {}, resultTypeKey: 'policy_change' }],
    { loadId: id },
  );
  for (const snapshot of await real.snapshots.history(5001)) {
    await snapshots.put(snapshot);
  }
  const membership: FakeMembership = {
    id,
    snapshotSk: real.memberships[0]!.snapshotSk,
    timelineId: 1,
    resultCode: 5001,
    title: 'Title 5001',
    programId: 1,
    resultTypeKey: 'policy_change',
    round,
  };
  world.memberships.push(membership);
  return { world, service };
}

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

/** Nothing was stored: no assessment row, validation, comment or audit row. */
function expectNothingStored(world: InMemoryAssessmentWorld) {
  expect(world.assessments).toEqual([]);
  expect(world.validations).toEqual([]);
  expect(world.comments).toEqual([]);
  expect(world.audits).toEqual([]);
}

describe('FR-3: round 2 writes on Assessed core fields only', () => {
  it('fixture: 4 core, 8 non-core Assessed, View only and Hidden fields exist', () => {
    expect([CORE.length, NON_CORE.length, VIEW_ONLY.length]).toEqual([4, 8, 2]);
  });

  it('validate on a non-core field: 409 ASSESSMENT_FIELD_NOT_CORE and no row of any kind', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    expect(
      await refusal(
        service.validate(
          lead(),
          1,
          5001,
          { validated: true, fieldKeys: [NON_CORE[0]!] },
          RID,
        ),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_NOT_CORE' },
    });
    expectNothingStored(world);
  });

  it('a request mixing a core and a non-core field is refused whole: the core field is not written either', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    expect(
      await refusal(
        service.validate(
          lead(),
          1,
          5001,
          { validated: true, fieldKeys: [CORE[0]!, NON_CORE[0]!] },
          RID,
        ),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_NOT_CORE' },
    });
    expectNothingStored(world);
  });

  it('a core field validates', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    await service.validate(
      lead(),
      1,
      5001,
      { validated: true, fieldKeys: [CORE[0]!] },
      RID,
    );
    expect(world.validations).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
  });

  it('comment on a non-core field: 409 ASSESSMENT_FIELD_NOT_CORE and no assessment, comment or audit row', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    expect(
      await refusal(
        service.comment(
          lead(),
          1,
          5001,
          { fieldKey: NON_CORE[0]!, body: 'Not a core field' },
          RID,
        ),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_NOT_CORE' },
    });
    expectNothingStored(world);
  });

  it('comment on a core field is stored', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    await service.comment(
      lead(),
      1,
      5001,
      { fieldKey: CORE[0]!, body: 'A core comment' },
      RID,
    );
    expect(world.comments).toHaveLength(1);
    expect(world.comments[0]!.round).toBe(2);
  });

  it('a View only key is still 400 VALIDATION_FAILED, not 409 (the key is not Assessed at all)', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    expect(
      await refusal(
        service.validate(
          lead(),
          1,
          5001,
          { validated: true, fieldKeys: [VIEW_ONLY[0]!] },
          RID,
        ),
      ),
    ).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expectNothingStored(world);
  });

  it('Check all in round 2 sets the core fields only and does not fail on the non-core ones', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    const summary = await service.validate(
      lead(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );
    expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
      [...CORE].sort(),
    );
    expect(summary.validations.map((v) => v.fieldKey).sort()).toEqual(
      [...CORE].sort(),
    );
  });

  it('Uncheck all in round 2 greys the core fields only and does not fail', async () => {
    const { world, service } = await setup(STEP_THREE_OPEN, 2);
    await service.validate(
      lead(),
      1,
      5001,
      { validated: true, fieldKeys: [CORE[0]!, CORE[1]!] },
      RID,
    );
    await service.validate(
      lead(),
      1,
      5001,
      { validated: false, all: true },
      RID,
    );
    expect(world.validations).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: false },
      { assessmentId: 1000, fieldKey: CORE[1], validated: false },
    ]);
  });
});

describe('NFR-6: round 1 is unchanged', () => {
  it('Check all in round 1 still sets all 12 Assessed fields, core or not', async () => {
    const { world, service } = await setup(STEP_ONE_OPEN, 1);
    await service.validate(
      assessor(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );
    expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
      [...ASSESSED].sort(),
    );
  });

  it('a round-1 validation and comment on a non-core Assessed field are accepted', async () => {
    const { world, service } = await setup(STEP_ONE_OPEN, 1);
    await service.validate(
      assessor(),
      1,
      5001,
      { validated: true, fieldKeys: [NON_CORE[0]!] },
      RID,
    );
    await service.comment(
      assessor(),
      1,
      5001,
      { fieldKey: NON_CORE[1]!, body: 'Round one comment' },
      RID,
    );
    expect(world.validations).toHaveLength(1);
    expect(world.comments).toHaveLength(1);
  });
});
