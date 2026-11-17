// P2-3911: the world of the SP view suites. Timeline 1 (official) with step 1
// (assessors) 1-10 Nov 2026, step 2 (programs) 11-20 Nov and step 3 21-30 Nov,
// Rome time. Result A (program 1, SP01) was assessed and returned with
// comments; the others exercise the scope and the listed predicate.
import type { RomeMinute } from '../../src/admin-config/rome-date.js';
import type { WorklistStep } from '../../src/assessment/worklist.store.js';
import type { AssessmentApp } from './assessment-app.js';
import { ASSESSED, seedTimeline } from './assessment-seed.js';
import { runRealLoad } from './real-load-writer.js';

const minute = (v: string) => v as RomeMinute;

export const spSteps = (): WorklistStep[] => [
  {
    position: 1,
    name: 'Assessors review',
    audience: 'assessors',
    opensAt: minute('2026-11-01T00:00'),
    closesAt: minute('2026-11-10T23:59'),
  },
  {
    position: 2,
    name: 'Programs review',
    audience: 'programs',
    opensAt: minute('2026-11-11T00:00'),
    closesAt: minute('2026-11-20T23:59'),
  },
  {
    position: 3,
    name: 'Lead review',
    audience: 'lead_assessors',
    opensAt: minute('2026-11-21T00:00'),
    closesAt: minute('2026-11-30T23:59'),
  },
];

/** Inside step 1 (programs step upcoming). */
export const IN_STEP_1 = new Date('2026-11-05T10:00:00Z');
/** Inside step 2 (programs). */
export const IN_STEP_2 = new Date('2026-11-15T10:00:00Z');
/** After step 2 (programs step closed). */
export const AFTER_STEP_2 = new Date('2026-11-25T10:00:00Z');

export const FIELD_A = ASSESSED[0]!;
export const FIELD_B = ASSESSED[1]!;

/** Distinctive assessor identities: none may appear in any /sp answer. */
export const PLANTED = {
  nickname: 'Zorblax-Nickplant',
  nickname2: 'Quarnix-Nickplant',
  first: 'Velmorath',
  last: 'Plantedsurname',
};

export interface SpWorld {
  /** Result code of result A (program 1, with comments). */
  codeA: number;
  /** Comment ids of result A. */
  open: number;
  accepted: number;
  withdrawn: number;
  hidden: number;
}

/**
 * Seeds timelines 1-3, result A with a real snapshot and its comments, and the
 * memberships around it. The assessment of A is `returned` and its comments
 * were made visible at its end (except the hidden one and the withdrawn one).
 */
export async function seedSpWorld(a: AssessmentApp): Promise<SpWorld> {
  seedTimeline(a, []);
  a.world.timelines[0]!.steps = spSteps();
  a.world.timelines.push(
    {
      id: 2,
      name: 'Additional for SP02',
      kind: 'additional',
      steps: spSteps(),
      allPrograms: false,
      programIds: [2],
    },
    {
      id: 3,
      name: 'Additional for all',
      kind: 'additional',
      steps: spSteps(),
      allPrograms: true,
    },
  );
  const real = await runRealLoad([
    {
      resultId: 1001,
      values: { [FIELD_A]: 'Value A', [FIELD_B]: 'Value B' },
    },
  ]);
  const written = real.memberships[0]!;
  for (const snapshot of await real.snapshots.history(written.resultCode)) {
    await a.snapshots.put(snapshot);
  }
  const codeA = written.resultCode;
  a.world.memberships.push(
    {
      id: 1,
      timelineId: 1,
      resultCode: codeA,
      title: 'Result A',
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
    },
    // The same result resubmitted with changes (round 2): A is "updated".
    {
      id: 2,
      timelineId: 1,
      resultCode: codeA,
      title: 'Result A',
      programId: 1,
      resultTypeKey: 'policy_change',
      round: 2,
      changedFields: [FIELD_A],
      snapshotSk: written.snapshotSk,
    },
    // Another program's result in the same timeline.
    {
      id: 3,
      timelineId: 1,
      resultCode: 7002,
      title: 'Result of SP02',
      programId: 2,
      resultTypeKey: 'policy_change',
    },
    // Program 1, not assessed yet, another type.
    {
      id: 4,
      timelineId: 1,
      resultCode: 7003,
      title: 'Result C',
      programId: 1,
      resultTypeKey: 'KP',
    },
    // Program 1, not in QA: never listed.
    {
      id: 5,
      timelineId: 1,
      resultCode: 7004,
      title: 'Not in QA',
      programId: 1,
      resultTypeKey: 'KP',
      status: 'not_in_qa',
    },
    // Program 1, ended when the timeline closed: never listed.
    {
      id: 6,
      timelineId: 1,
      resultCode: 7005,
      title: 'Ended',
      programId: 1,
      resultTypeKey: 'KP',
      ended: true,
      endReason: 'timeline_closed',
    },
    // Program 1 in timeline 3.
    {
      id: 7,
      timelineId: 3,
      resultCode: 7006,
      title: 'In timeline 3',
      programId: 1,
      resultTypeKey: 'KP',
    },
  );
  a.world.assessments.push({
    id: 100,
    membershipId: 1,
    stepPosition: 1,
    status: 'returned',
    finishedBy: a.users.policy.id,
    finishedAt: new Date('2026-11-09T10:00:00Z'),
  });
  const visibleAt = new Date('2026-11-09T10:00:00Z');
  a.world.comments.push(
    {
      id: 11,
      assessmentId: 100,
      authorId: a.users.policy.id,
      state: 'open',
      fieldKey: FIELD_A,
      body: 'Please add the evidence link',
      createdAt: new Date('2026-11-05T09:00:00Z'),
      valueCopy: { value: 'Value A' },
      visibleToProgramAt: visibleAt,
    },
    {
      id: 12,
      assessmentId: 100,
      authorId: a.users.policy2.id,
      state: 'accepted',
      fieldKey: FIELD_B,
      body: 'The date looks wrong',
      createdAt: new Date('2026-11-06T09:00:00Z'),
      valueCopy: { value: 'Value B' },
      visibleToProgramAt: visibleAt,
    },
    {
      id: 13,
      assessmentId: 100,
      authorId: a.users.policy.id,
      state: 'withdrawn',
      fieldKey: FIELD_A,
      body: 'Withdrawn text never shown',
      createdAt: new Date('2026-11-07T09:00:00Z'),
      withdrawnAt: new Date('2026-11-08T09:00:00Z'),
      visibleToProgramAt: null,
    },
    {
      id: 14,
      assessmentId: 100,
      authorId: a.users.policy.id,
      state: 'open',
      fieldKey: FIELD_B,
      body: 'Not visible text never shown',
      createdAt: new Date('2026-11-08T09:00:00Z'),
      visibleToProgramAt: null,
    },
  );
  a.world.spResponses.push({
    id: 3000,
    commentId: 12,
    kind: 'accept',
    body: null,
    responderName: 'Earlier Responder',
    responderEmail: 'earlier-responder@example.org',
    programId: 1,
    createdAt: new Date('2026-11-12T09:00:00Z'),
  });
  a.world.nextSpResponseId = 3001;
  return { codeA, open: 11, accepted: 12, withdrawn: 13, hidden: 14 };
}
