// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import {
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
} from '../../test/support/in-memory-assessment.js';

// The fake unit of work is the model every concurrency test of this module
// stands on, so its rollback is pinned here. It used to restore a copy of the
// WHOLE world, which also reverted what another transaction committed while
// this one was open: a test that interleaved a failing writer with a winner
// would have shown the winner's rows disappearing, a behavior MySQL never has.

const AT = new Date('2026-11-13T10:00:00Z');
const audit = (assessmentId: number) => ({
  assessmentId,
  actorId: 10,
  action: 'validate' as const,
  fieldKeys: ['k'],
  commentId: null,
  requestId: 'r',
  at: AT,
});

describe('InMemoryAssessmentUnitOfWork rollback', () => {
  it('undoes only what its own transaction wrote, never another transaction that committed meanwhile', async () => {
    const world = new InMemoryAssessmentWorld();
    const unit = new InMemoryAssessmentUnitOfWork(world);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const failing = unit.run(async ({ assessments }) => {
      await assessments.insertAudit(audit(1));
      await gate; // the other transaction commits here
      throw new Error('boom');
    });
    const winner = unit.run(async ({ assessments }) => {
      await assessments.insertAudit(audit(2));
    });
    await winner;
    release();
    await expect(failing).rejects.toThrow('boom');

    expect(world.audits.map((a) => a.assessmentId)).toEqual([2]);
  });

  it('puts back a flipped validation and a withdrawn comment, and keeps the rows of the other transaction', async () => {
    const world = new InMemoryAssessmentWorld();
    world.assessments.push({
      id: 5,
      membershipId: 1,
      stepPosition: 1,
      status: 'pending',
    });
    world.validations.push({ assessmentId: 5, fieldKey: 'k', validated: true });
    world.comments.push({ id: 9, assessmentId: 5, authorId: 10, state: 'open' });
    const unit = new InMemoryAssessmentUnitOfWork(world);

    await expect(
      unit.run(async ({ assessments }) => {
        await assessments.upsertValidations(
          5,
          [{ fieldKey: 'k', validated: false }],
          10,
          AT,
        );
        await assessments.withdrawComment(9, AT);
        await assessments.insertCommentEvent({
          commentId: 9,
          actorId: 10,
          actorRole: 'ASSESSOR',
          fromState: 'open',
          toState: 'withdrawn',
          at: AT,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(world.validations).toEqual([
      { assessmentId: 5, fieldKey: 'k', validated: true },
    ]);
    expect(world.comments[0]).toMatchObject({ state: 'open' });
    expect(world.commentEvents).toEqual([]);
  });

  it('keeps everything when the work resolves', async () => {
    const world = new InMemoryAssessmentWorld();
    const unit = new InMemoryAssessmentUnitOfWork(world);
    await unit.run(async ({ assessments }) => {
      await assessments.insertAudit(audit(1));
    });
    expect(world.audits).toHaveLength(1);
  });
});
