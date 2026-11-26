// @akili-spec escalation/round-2
import { snapshotKeyOf } from '../../src/ingestion/load-rules.js';
import type { AssessmentApp } from './assessment-app.js';
import { seedTimeline } from './assessment-seed.js';
import { runRealLoad, type RealLoad } from './real-load-writer.js';

// The shared world of the round-2 e2e suites (P2-3912): one result in two
// rounds, round 1 -> returned -> re-submitted, built by the REAL load runner
// (never a hand-typed `snapshot_sk`). The loads run once per file and are
// copied into each test's app; the comment and program-response rows a test
// needs are planted with the two helpers below. Steps: assessors 12-20 Nov,
// programs 21-23 Nov, lead assessors 24-27 Nov 2026.

/** A clock inside step 3 (the Lead's step). */
export const IN_LEAD_STEP = new Date('2026-11-25T10:00:00Z');
/** A clock inside step 4 (the TPB's step, P2-3916). */
export const IN_TPB_STEP = new Date('2026-11-30T10:00:00Z');
/** A clock after step 4 closed. */
export const AFTER_TPB_STEP = new Date('2026-12-05T10:00:00Z');

const minute = (value: string) => value as never;
export const roundTwoSteps = () => [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors' as const,
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    name: 'Step 2',
    audience: 'programs' as const,
    opensAt: minute('2026-11-21T09:00'),
    closesAt: minute('2026-11-23T17:30'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors' as const,
    opensAt: minute('2026-11-24T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
];

interface BuiltLoads {
  one: RealLoad['memberships'][number];
  two: RealLoad['memberships'][number];
  snapshots: Awaited<ReturnType<RealLoad['snapshots']['history']>>;
}

// Built once per file: the real runner is the slow part of a round-2 world.
const loads = new Map<string, Promise<BuiltLoads>>();

function buildLoads(resultId: number, base: number): Promise<BuiltLoads> {
  const key = `${resultId}:${base}`;
  let built = loads.get(key);
  if (built === undefined) {
    built = (async () => {
      const first = await runRealLoad(
        [{ resultId, values: { 'general.title': 'First submission' } }],
        { loadId: base * 10 + 1 },
      );
      const second = await runRealLoad(
        [{ resultId, values: { 'general.title': 'Re-submitted' } }],
        { loadId: base * 10 + 2 },
      );
      const one = first.memberships[0]!;
      const two = second.memberships[0]!;
      const snapshots = [
        ...(await first.snapshots.history(one.resultCode)),
        ...(await second.snapshots.history(two.resultCode)),
      ];
      return { one, two, snapshots };
    })();
    loads.set(key, built);
  }
  return built;
}

export interface RoundTwoResult {
  code: number;
  roundOneId: number;
  roundTwoId: number;
  /** The snapshot key of the round-2 membership (`SNAP#` stripped). */
  snapKey: string;
}

/**
 * One result in two rounds: a round-1 membership ended `returned` with its
 * step-1 assessment, and the round-2 membership that follows it (`previous`
 * false: a new round-2 result with no round-1 one).
 */
export async function addTwoRounds(
  a: AssessmentApp,
  options: { resultId: number; previous: boolean },
  changedFields: string[] | null,
): Promise<RoundTwoResult> {
  const next =
    a.world.memberships.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  const { one, two, snapshots } = await buildLoads(options.resultId, next);
  for (const snapshot of snapshots) await a.snapshots.put(snapshot);
  const base = {
    timelineId: 1,
    resultCode: one.resultCode,
    programId: 1,
    resultTypeKey: 'policy_change',
  };
  const roundOneId = next;
  const roundTwoId = next + 1;
  a.world.memberships.push(
    {
      ...base,
      id: roundOneId,
      title: 'First submission',
      round: 1,
      ended: true,
      endReason: 'returned',
      snapshotSk: one.snapshotSk,
    },
    {
      ...base,
      id: roundTwoId,
      title: 'Re-submitted',
      round: 2,
      changedFields,
      previousMembershipId: options.previous ? roundOneId : null,
      snapshotSk: two.snapshotSk,
    },
  );
  a.world.assessments.push({
    id: roundOneId,
    membershipId: roundOneId,
    stepPosition: 1,
    status: 'returned',
  });
  return {
    code: one.resultCode,
    roundOneId,
    roundTwoId,
    snapKey: snapshotKeyOf(two.snapshotSk),
  };
}

/**
 * Timeline 1 with the three steps, a Lead of policy change on it (all
 * programs) and result 1001 in two rounds. `roundOneGreens` are the fields the
 * assessor validated in round 1; `core` are the core fields of the pinned
 * configuration.
 */
export async function seedRoundTwoWorld(
  a: AssessmentApp,
  options: {
    core: readonly string[];
    changedFields: string[] | null;
    roundOneGreens: readonly string[];
  },
): Promise<RoundTwoResult> {
  seedTimeline(a, options.core);
  a.world.timelines[0]!.steps = roundTwoSteps();
  a.world.timelineUsers.push({
    timelineId: 1,
    userId: a.users.lead.id,
    roleCode: 'LEAD_ASSESSOR',
  });
  await a.programScope(a.users.lead.id, [1]);
  const built = await addTwoRounds(
    a,
    { resultId: 1001, previous: true },
    options.changedFields,
  );
  a.world.validations.push(
    ...options.roundOneGreens.map((fieldKey) => ({
      assessmentId: built.roundOneId,
      fieldKey,
      validated: true,
    })),
  );
  return built;
}

/** A round-1 comment of the step-1 assessment `assessmentId`. */
export function plantRoundOneComment(
  a: AssessmentApp,
  assessmentId: number,
  id: number,
  over: Partial<AssessmentApp['world']['comments'][number]> = {},
) {
  return a.world.comments.push({
    id,
    assessmentId,
    authorId: a.users.policy.id,
    state: 'open',
    fieldKey: 'general.title',
    body: `Round-1 comment ${id}`,
    createdAt: new Date(`2026-11-1${id % 10}T09:00:00Z`),
    valueCopy: { value: `Value when ${id} was written` },
    ...over,
  });
}

/** A Science Program response to a round-1 comment, on `day` of November 2026. */
export function plantProgramResponse(
  a: AssessmentApp,
  id: number,
  commentId: number,
  kind: 'request_clarification' | 'disagree' | 'accept',
  body: string | null,
  day: number,
) {
  return a.world.spResponses.push({
    id,
    commentId,
    kind,
    body,
    responderName: 'Pat Program',
    responderEmail: 'pat.program@example.org',
    programId: 1,
    createdAt: new Date(`2026-11-${day}T09:00:00Z`),
  });
}

/** Step 4, the TPB's (P2-3916): 28 Nov - 2 Dec 2026. */
export const tpbStep = () => ({
  position: 4,
  name: 'Step 4',
  audience: 'tpb' as const,
  opensAt: minute('2026-11-28T09:00'),
  closesAt: minute('2026-12-02T17:30'),
});

/** One comment the Lead escalated, as its end left it (`escalated`, with the Lead's `escalate` decision). */
export interface EscalatedComment {
  id: number;
  fieldKey: string;
  /** `lead`: the Lead's own round-2 comment on its step-3 assessment; default a round-1 comment. */
  origin?: 'round_one' | 'lead';
  reason?: string;
}

/**
 * The TPB's world (P2-3916): the round-2 world with step 4, the TPB (`tpb`, a global
 * role, all programs) assigned, and the Lead's step-3
 * assessment ended `escalated` on `escalated`, as the Lead's end leaves it
 * (DD-7: the comments in `escalated`, the Lead's `escalate` decisions kept).
 * `sidedProgram` are round-1 comments the Lead closed (`lead_sided_program`);
 * `leadGreens` the Lead's own green marks.
 */
export async function seedTpbWorld(
  a: AssessmentApp,
  options: {
    core: readonly string[];
    roundOneGreens?: readonly string[];
    escalated: readonly EscalatedComment[];
    sidedProgram?: readonly { id: number; fieldKey: string }[];
    leadGreens?: readonly string[];
    changedFields?: string[] | null;
  },
): Promise<RoundTwoResult & { leadAssessmentId: number }> {
  const built = await seedRoundTwoWorld(a, {
    core: options.core,
    changedFields: options.changedFields ?? null,
    roundOneGreens: options.roundOneGreens ?? [],
  });
  a.world.timelines[0]!.steps = [...roundTwoSteps(), tpbStep()];
  a.world.timelineUsers.push({
    timelineId: 1,
    userId: a.users.tpb.id,
    roleCode: 'TPB',
  });
  await a.programScope(a.users.tpb.id, []);
  const leadAssessmentId = 900 + built.roundTwoId;
  // The `users` rows the reads join for nicknames (the Lead ended step 3).
  for (const u of [a.users.lead, a.users.tpb]) {
    if (!a.world.users.some((x) => x.id === u.id)) {
      a.world.users.push({ id: u.id, nickname: u.nickname });
    }
  }
  a.world.assessments.push({
    id: leadAssessmentId,
    membershipId: built.roundTwoId,
    stepPosition: 3,
    status: 'escalated',
    roleCode: 'LEAD_ASSESSOR',
    finishedBy: a.users.lead.id,
    finishedAt: new Date('2026-11-26T10:00:00Z'),
  });
  for (const item of options.escalated) {
    if (item.origin === 'lead') {
      a.world.comments.push({
        id: item.id,
        assessmentId: leadAssessmentId,
        authorId: a.users.lead.id,
        state: 'escalated',
        fieldKey: item.fieldKey,
        body: `Lead comment ${item.id}`,
        stepPosition: 3,
        round: 2,
        createdAt: new Date('2026-11-25T09:00:00Z'),
        valueCopy: { value: 'Re-submitted value' },
      });
    } else {
      plantRoundOneComment(a, built.roundOneId, item.id, {
        state: 'escalated',
        fieldKey: item.fieldKey,
      });
    }
    a.world.commentDecisions.push({
      commentId: item.id,
      assessmentId: leadAssessmentId,
      roleCode: 'LEAD_ASSESSOR',
      decision: 'escalate',
      body: item.reason ?? `Escalated ${item.id}`,
      decidedAt: new Date('2026-11-25T12:00:00Z'),
      decidedBy: a.users.lead.id,
    });
  }
  for (const item of options.sidedProgram ?? []) {
    plantRoundOneComment(a, built.roundOneId, item.id, {
      state: 'lead_sided_program',
      fieldKey: item.fieldKey,
    });
    a.world.commentDecisions.push({
      commentId: item.id,
      assessmentId: leadAssessmentId,
      roleCode: 'LEAD_ASSESSOR',
      decision: 'agree_program',
      body: `Sided ${item.id}`,
      decidedAt: new Date('2026-11-25T12:00:00Z'),
      decidedBy: a.users.lead.id,
    });
  }
  a.world.validations.push(
    ...(options.leadGreens ?? []).map((fieldKey) => ({
      assessmentId: leadAssessmentId,
      fieldKey,
      validated: true,
    })),
  );
  return { ...built, leadAssessmentId };
}
