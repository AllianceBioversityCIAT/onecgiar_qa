// @akili-spec escalation/round-2-ppu
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
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
import { DrizzleWorklistStore, type WorklistScope } from './worklist.store.js';

// Expected values are literals from P2-3917 AC2 and the brief (FR-2, FR-12,
// DD-P1, DD-P4): a PPU covers a round-2 membership in its program scope once
// the TPB ended it `escalated`, every result type (global role), and writes
// with no date window. Step 5 here is open 2026-12-03T09:00 .. 2026-12-06T17:30.

const minute = (value: string) => value as RomeMinute;
const steps: TimelineViewStep[] = [
  {
    position: 4,
    audience: 'tpb',
    opensAt: minute('2026-11-28T09:00'),
    closesAt: minute('2026-12-02T17:30'),
  },
  {
    position: 5,
    audience: 'ppu',
    opensAt: minute('2026-12-03T09:00'),
    closesAt: minute('2026-12-06T17:30'),
  },
];
const timing = (utc: string, withSteps = steps) => ({
  steps: withSteps,
  now: nowInRome(new Date(utc)),
  hasLoad: true,
});

const grant = (roleCode: string): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey: null,
  programId: null,
});
const subject = (
  assignments: AssignmentView[],
  programScope: number[] = [],
): AuthorizationSubject => ({ assignments, programScope, exclusions: [] });
const authorization = new AuthorizationService();
const accessOf = (
  user: AuthorizationSubject,
  timelineRoles: readonly string[],
  actingRole?: RoleCode,
) =>
  resolveAccess(
    user,
    timelineRoles,
    authorization.can(user, Permission.ADMIN_ACCESS),
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
  tpbEscalated: true,
  ...change,
});

const ppu = accessOf(subject([grant('PPU')], [1]), ['PPU']);

describe('the PPU row (FR-2)', () => {
  it('is one round-2 row of the ppu step, every result type, the program scope', () => {
    expect(ppu.reviewerRows).toEqual([
      {
        role: 'PPU',
        round: 2,
        audience: 'ppu',
        resultTypes: 'all',
        programs: { mode: 'in', ids: [1] },
      },
    ]);
  });
});

describe('a PPU covers what reached step 5 (DD-P4)', () => {
  const row = ppu.reviewerRows[0]!;

  it.each<[string, Partial<MembershipFacts>, boolean]>([
    ['the TPB ended it escalated', {}, true],
    ['the TPB has not ended it', { tpbEscalated: false }, false],
    ['the fact left out', { tpbEscalated: undefined }, false],
    ['a round-1 membership', { round: 1 }, false],
    ['any result type', { resultType: 'innovation_use' }, true],
    ['another program', { programId: 2 }, false],
  ])('%s', (_name, change, expected) => {
    expect(rowCovers(row, membership(change))).toBe(expected);
    expect(inScope(ppu, membership(change))).toBe(expected);
  });

  it('keeps a result it ended listed', () => {
    expect(
      listedFor(ppu, membership({ ended: true, endReason: 'released_qaed' })),
    ).toBe(true);
  });
});

describe('the PPU has no date window (DD-P1)', () => {
  it.each([
    ['before step 5', '2026-11-30T10:00:00Z'],
    ['in step 5', '2026-12-04T10:00:00Z'],
    ['after step 5 closed', '2026-12-20T10:00:00Z'],
  ])('writable %s, at position 5', (_name, utc) => {
    expect(writeDecision(ppu, membership(), timing(utc))).toEqual({
      writable: true,
      row: ppu.reviewerRows[0],
      stepPosition: 5,
    });
  });

  it('needs the timeline to have the ppu step (no_step otherwise)', () => {
    expect(
      writeDecision(
        ppu,
        membership(),
        timing('2026-12-04T10:00:00Z', [steps[0]!]),
      ),
    ).toEqual({ writable: false, reason: 'no_step' });
  });
});

describe('an Admin acting as PPU (FR-12)', () => {
  const acting = accessOf(subject([grant('ADMIN')]), [], RoleCode.PPU);

  it('writes on a result in step 5, read-only on one that is not (R6)', () => {
    expect(
      writeDecision(acting, membership(), timing('2026-12-20T10:00:00Z')),
    ).toMatchObject({ writable: true, stepPosition: 5 });
    expect(
      writeDecision(
        acting,
        membership({ tpbEscalated: false }),
        timing('2026-12-04T10:00:00Z'),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
  });
});

describe('the PPU row as SQL (DD-P4) and Unresolved in the CASE (DD-P5)', () => {
  const store = new DrizzleWorklistStore(
    drizzle.mock() as unknown as DrizzleDB,
  );
  const scope = (
    access: WorklistScope['access'],
    ppuStepClosed?: boolean,
  ): WorklistScope => ({
    timelineId: 7,
    userId: 10,
    access,
    assessmentStepPosition: 1,
    roundTwoStepPositions: [3, 4, 5],
    clarificationWindowOpen: false,
    hideAutoValidated: false,
    ppuStepClosed,
  });

  it('adds the TPB-escalated EXISTS to the PPU row', () => {
    const { sql } = store.buildCountQuery(scope(ppu)).toSQL();
    expect(sql).toContain(
      "`tpb_esc_step`.`audience` = 'tpb' AND `tpb_esc`.`status` = 'escalated'",
    );
  });

  it('binds the closed step 5 as a literal: 1 when closed, 0 otherwise', () => {
    const closed = store.buildCountQuery(scope(ppu, true)).toSQL().sql;
    const open = store.buildCountQuery(scope(ppu, false)).toSQL().sql;
    expect(closed).toContain("AND 1 = 1 AND (SELECT `cur_step`.`audience`");
    expect(open).toContain("AND 0 = 1 AND (SELECT `cur_step`.`audience`");
  });
});
