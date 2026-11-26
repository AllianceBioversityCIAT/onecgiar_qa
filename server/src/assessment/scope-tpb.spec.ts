// @akili-spec escalation/round-2-tpb
import { describe, expect, it } from 'vitest';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import {
  AuthorizationService,
  type AssignmentView,
  type AuthorizationSubject,
} from '../users/authorization.service.js';
import { Permission, RoleCode } from '../users/permissions.js';
import {
  inScope,
  listedFor,
  resolveAccess,
  rowCovers,
  writeDecision,
  type MembershipFacts,
} from './scope.js';
import { drizzle } from 'drizzle-orm/mysql2';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DrizzleWorklistStore, type WorklistScope } from './worklist.store.js';

// Expected values are literals from P2-3916 AC2 (FR-2, DD-T2): a TPB covers a
// round-2 membership of its types and programs only once the Lead ended it
// `escalated`, and writes while step 4 is open. Step 4 here is open
// 2026-11-28T09:00 .. 2026-12-02T17:30 (Rome, UTC+1).

const minute = (value: string) => value as RomeMinute;
const steps: TimelineViewStep[] = [
  {
    position: 3,
    audience: 'lead_assessors',
    opensAt: minute('2026-11-24T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
  {
    position: 4,
    audience: 'tpb',
    opensAt: minute('2026-11-28T09:00'),
    closesAt: minute('2026-12-02T17:30'),
  },
];
const timing = (utc: string) => ({
  steps,
  now: nowInRome(new Date(utc)),
  hasLoad: true,
});
const IN_STEP_4 = '2026-11-30T10:00:00Z';
const AFTER_STEP_4 = '2026-12-05T10:00:00Z';

const grant = (
  roleCode: string,
  resultTypeKey: string | null,
): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey,
  programId: null,
});
const user = (
  assignments: AssignmentView[],
  programScope: number[] = [],
): AuthorizationSubject => ({ assignments, programScope, exclusions: [] });
const authorization = new AuthorizationService();
const accessOf = (
  subject: AuthorizationSubject,
  timelineRoles: readonly string[],
  actingRole?: RoleCode,
) =>
  resolveAccess(
    subject,
    timelineRoles,
    authorization.can(subject, Permission.ADMIN_ACCESS),
    actingRole,
  );

const membership = (change: Partial<MembershipFacts> = {}): MembershipFacts => ({
  resultType: 'policy_change',
  programId: 1,
  round: 2,
  status: 'pending',
  ended: false,
  endReason: null,
  leadEscalated: true,
  ...change,
});

/** A TPB (a global role: no result type on its grant), program scope {1}, assigned to the timeline. */
const tpb = accessOf(user([grant('TPB', null)], [1]), ['TPB']);

describe('the TPB row (FR-2)', () => {
  it('is one round-2 row of the tpb step, every result type (global role, DD-T9) and the program scope', () => {
    expect(tpb).toEqual({
      reviewerRows: [
        {
          role: 'TPB',
          round: 2,
          audience: 'tpb',
          resultTypes: 'all',
          programs: { mode: 'in', ids: [1] },
        },
      ],
      admin: false,
      disabledRoles: [],
    });
  });

  it('gives no row to a TPB assignment without a live grant, nor to a grant without the assignment', () => {
    expect(accessOf(user([], [1]), ['TPB']).reviewerRows).toEqual([]);
    expect(
      accessOf(user([grant('TPB', null)], [1]), []).reviewerRows,
    ).toEqual([]);
  });
});

describe('a TPB covers what reached step 4 (DD-T2)', () => {
  const row = tpb.reviewerRows[0]!;

  it.each<[string, Partial<MembershipFacts>, boolean]>([
    ['escalated by the Lead', {}, true],
    ['the Lead has not ended it', { leadEscalated: false }, false],
    ['the fact left out', { leadEscalated: undefined }, false],
    ['a round-1 membership', { round: 1 }, false],
    ['any result type (global role)', { resultType: 'innovation_use' }, true],
    ['another program', { programId: 2 }, false],
  ])('%s', (_name, change, expected) => {
    expect(rowCovers(row, membership(change))).toBe(expected);
    expect(inScope(tpb, membership(change))).toBe(expected);
  });

  it('keeps a finished result listed (OQ-2): only the end reason filter applies', () => {
    expect(listedFor(tpb, membership())).toBe(true);
    expect(
      listedFor(tpb, membership({ ended: true, endReason: 'released_qaed' })),
    ).toBe(true);
  });

  it('never needs the fact for the Lead row', () => {
    const lead = accessOf(
      user([grant('LEAD_ASSESSOR', 'policy_change')], [1]),
      ['LEAD_ASSESSOR'],
    );
    expect(inScope(lead, membership({ leadEscalated: false }))).toBe(true);
  });
});

describe('the TPB writes while step 4 is open (FR-2)', () => {
  it('writable in step 4, at position 4', () => {
    expect(writeDecision(tpb, membership(), timing(IN_STEP_4))).toEqual({
      writable: true,
      row: tpb.reviewerRows[0],
      stepPosition: 4,
    });
  });

  it('step_closed after step 4, step_upcoming before it', () => {
    expect(writeDecision(tpb, membership(), timing(AFTER_STEP_4))).toEqual({
      writable: false,
      reason: 'step_closed',
    });
    expect(
      writeDecision(tpb, membership(), timing('2026-11-25T10:00:00Z')),
    ).toEqual({ writable: false, reason: 'step_upcoming' });
  });

  it('not_in_scope on a result the Lead has not escalated', () => {
    expect(
      writeDecision(
        tpb,
        membership({ leadEscalated: false }),
        timing(IN_STEP_4),
      ),
    ).toEqual({ writable: false, reason: 'not_in_scope' });
  });
});

describe('an Admin acting as TPB (FR-12)', () => {
  const admin = user([grant('ADMIN', null)]);
  const acting = accessOf(admin, [], RoleCode.TPB);

  it('gets one TPB row, every type and program, flagged byAdmin', () => {
    expect(acting.reviewerRows).toEqual([
      {
        role: 'TPB',
        round: 2,
        audience: 'tpb',
        resultTypes: 'all',
        programs: { mode: 'all', excluded: [] },
        byAdmin: true,
      },
    ]);
  });

  it('writes after step 4 closed (R2), but only on a result that reached step 4 (R6)', () => {
    expect(
      writeDecision(acting, membership(), timing(AFTER_STEP_4)),
    ).toMatchObject({ writable: true, stepPosition: 4 });
    // The Admin still reads it (admin scope), but the TPB row does not cover it: read-only.
    expect(
      writeDecision(
        acting,
        membership({ leadEscalated: false }),
        timing(IN_STEP_4),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
  });
});

describe('the TPB row as SQL (DD-T2, the twin of rowCovers)', () => {
  const store = new DrizzleWorklistStore(
    drizzle.mock() as unknown as DrizzleDB,
  );
  const scope = (access: WorklistScope['access']): WorklistScope => ({
    timelineId: 7,
    userId: 10,
    access,
    assessmentStepPosition: 1,
    roundTwoStepPositions: [3, 4],
    clarificationWindowOpen: false,
    hideAutoValidated: false,
  });
  const EXISTS =
    "EXISTS (SELECT 1 FROM `result_assessments` `lead_esc` INNER JOIN `timeline_steps` `lead_esc_step` ON `lead_esc_step`.`timeline_id` = `timeline_results`.`timeline_id` AND `lead_esc_step`.`position` = `lead_esc`.`step_position` WHERE `lead_esc`.`timeline_result_id` = `timeline_results`.`id` AND `lead_esc_step`.`audience` = 'lead_assessors' AND `lead_esc`.`status` = 'escalated')";
  const whereOf = (text: string) => text.slice(text.indexOf(' where '));

  it('adds the Lead-escalated EXISTS to the TPB row, with no bound value', () => {
    const { sql } = store.buildCountQuery(scope(tpb)).toSQL();
    expect(whereOf(sql)).toContain(EXISTS);
  });

  it('adds nothing to the Lead row', () => {
    const lead = accessOf(
      user([grant('LEAD_ASSESSOR', 'policy_change')], [1]),
      ['LEAD_ASSESSOR'],
    );
    const { sql } = store.buildCountQuery(scope(lead)).toSQL();
    expect(whereOf(sql)).not.toContain('lead_esc');
  });
});
