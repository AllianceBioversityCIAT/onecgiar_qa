// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import type { AssignmentView } from '../users/authorization.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import {
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
} from '../../test/support/in-memory-assessment.js';
import { QuickCommentsService } from './quick-comments.service.js';

// Quick comments shared by role (T-11; FR-12, FR-21; design 6, 7.7). Expected
// values are written out: the sha-256 below is that of the trimmed text,
// computed outside the code under test.

const SHA_EVIDENCE =
  '92bfd21568107f2bc74f3637703dd8cd052536c35d4bb3ee11ecec4504c69a4b';

const grant = (roleCode: string, live = true): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: live ? null : new Date('2026-01-01T00:00:00Z'),
  resultTypeKey: null,
  programId: null,
});
const userOf = (id: number, assignments: AssignmentView[]) =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname: `User${id}`,
    authSource: 'custom',
    isActive: true,
    assignments,
    programScope: [],
    exclusions: [],
  }) as AuthenticatedUser;

const assessorA = () => userOf(10, [grant('ASSESSOR')]);
const assessorB = () => userOf(11, [grant('ASSESSOR')]);
const tpb = () => userOf(12, [grant('TPB')]);

function setup(now = new Date('2026-11-13T10:00:00.500Z')) {
  const world = new InMemoryAssessmentWorld();
  const clock = { at: now, calls: 0 };
  const service = new QuickCommentsService(
    new InMemoryAssessmentStore(world),
    new InMemoryAssessmentUnitOfWork(world),
    () => {
      clock.calls += 1;
      return clock.at;
    },
  );
  return { world, service, clock };
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

describe('FR-12: shared by role', () => {
  it('assessor A saves a text, assessor B sees it in the ASSESSOR list, and a TPB user must NOT', async () => {
    const { service } = setup();

    const saved = await service.save(
      assessorA(),
      'ASSESSOR',
      'Please add the evidence link',
      'req-1',
    );
    const seenByB = await service.list(assessorB(), 'ASSESSOR');

    expect(saved.created).toBe(true);
    expect(seenByB).toEqual([
      {
        id: saved.comment.id,
        body: 'Please add the evidence link',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    ]);
    expect(
      await refusal(service.list(tpb(), 'ASSESSOR')),
    ).toMatchObject({ status: 403, body: { code: 'AUTH_PERMISSION_DENIED' } });
    // The TPB user reads their own role's list, which is empty.
    expect(await service.list(tpb(), 'TPB')).toEqual([]);
  });

  it('a TPB user cannot save into the ASSESSOR list either, and nothing is stored', async () => {
    const { world, service } = setup();
    expect(
      await refusal(service.save(tpb(), 'ASSESSOR', 'A text', 'req-1')),
    ).toMatchObject({ status: 403, body: { code: 'AUTH_PERMISSION_DENIED' } });
    expect(world.quickComments).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('a revoked grant, a user with no grant and a role that is not a reviewer role are all refused', async () => {
    const { service } = setup();
    expect(
      await refusal(
        service.list(userOf(20, [grant('ASSESSOR', false)]), 'ASSESSOR'),
      ),
    ).toMatchObject({ status: 403 });
    expect(await refusal(service.list(userOf(21, []), 'ASSESSOR'))).toMatchObject({
      status: 403,
    });
    expect(
      await refusal(service.list(userOf(22, [grant('ADMIN')]), 'ADMIN')),
    ).toMatchObject({ status: 403 });
    expect(
      await refusal(service.list(userOf(22, [grant('ADMIN')]), 'ASSESSOR')),
    ).toMatchObject({ status: 403 });
  });

  it('lists newest first', async () => {
    const { clock, service } = setup(new Date('2026-11-13T10:00:00Z'));
    await service.save(assessorA(), 'ASSESSOR', 'First text', 'r1');
    clock.at = new Date('2026-11-13T10:05:00Z');
    await service.save(assessorB(), 'ASSESSOR', 'Second text', 'r2');
    clock.at = new Date('2026-11-13T10:10:00Z');
    await service.save(assessorA(), 'ASSESSOR', 'Third text', 'r3');
    expect((await service.list(assessorA(), 'ASSESSOR')).map((q) => q.body)).toEqual([
      'Third text',
      'Second text',
      'First text',
    ]);
  });
});

describe('FR-12: the same text twice keeps one entry', () => {
  it('a second save of the same trimmed text returns the existing row, created false, and writes no second audit row', async () => {
    const { world, service } = setup();
    const first = await service.save(
      assessorA(),
      'ASSESSOR',
      'Please add the evidence link',
      'req-1',
    );
    const second = await service.save(
      assessorB(),
      'ASSESSOR',
      '   Please add the evidence link  ',
      'req-2',
    );

    expect(first.created).toBe(true);
    expect(second).toEqual({ comment: first.comment, created: false });
    expect(world.quickComments).toHaveLength(1);
    expect(world.quickComments[0]).toMatchObject({
      roleCode: 'ASSESSOR',
      body: 'Please add the evidence link',
      bodyHash: SHA_EVIDENCE,
      createdBy: 10,
    });
    expect(world.audits).toHaveLength(1);
  });

  it('is case-sensitive, and the same text under two roles is two rows', async () => {
    const { world, service } = setup();
    const both = userOf(30, [grant('ASSESSOR'), grant('TPB')]);
    await service.save(both, 'ASSESSOR', 'Same text', 'r1');
    await service.save(both, 'ASSESSOR', 'same text', 'r2');
    await service.save(both, 'TPB', 'Same text', 'r3');
    expect(world.quickComments.map((q) => [q.roleCode, q.body])).toEqual([
      ['ASSESSOR', 'Same text'],
      ['ASSESSOR', 'same text'],
      ['TPB', 'Same text'],
    ]);
  });
});

describe('FR-21: the audit of a quick-comment save', () => {
  it('writes one row per saved text: actor, action, request id, no assessment, no comment id, and never the text', async () => {
    const { world, service } = setup();
    await service.save(assessorA(), 'ASSESSOR', 'A text to reuse', 'req-77');
    expect(world.audits).toEqual([
      {
        assessmentId: null,
        actorId: 10,
        action: 'quick_comment_save',
        fieldKeys: null,
        commentId: null,
        requestId: 'req-77',
        at: new Date('2026-11-13T10:00:00.500Z'),
      },
    ]);
    expect(JSON.stringify(world.audits)).not.toContain('A text to reuse');
  });

  it('reads the clock once per save and stores the whole second', async () => {
    const { world, service, clock } = setup();
    const saved = await service.save(assessorA(), 'ASSESSOR', 'A text', 'r1');
    expect(clock.calls).toBe(1);
    expect(saved.comment.createdAt).toBe('2026-11-13T10:00:00.000Z');
    expect(world.quickComments[0]!.createdAt).toEqual(
      new Date('2026-11-13T10:00:00.000Z'),
    );
  });
});
