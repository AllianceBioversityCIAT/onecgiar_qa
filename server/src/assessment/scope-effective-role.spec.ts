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
  effectiveRow,
  resolveAccess,
  writeDecision,
  type MembershipFacts,
  type WorklistAccess,
} from './scope.js';

// DD-T11 (round-2 contract adjustments): one effective reviewer role per
// membership, whatever the order of the caller's rows. Expected values are the
// brief's mapping: pending → LEAD_ASSESSOR, pending_tpb_review → TPB,
// pending_ppu → PPU; X-Acting-Role sends its role; ADMIN without it, none.
// Steps (Rome, UTC+1): 3 open 11-24..11-27, 4 open 11-28..12-02, 5 after.

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
  {
    position: 5,
    audience: 'ppu',
    opensAt: minute('2026-12-03T09:00'),
    closesAt: minute('2026-12-08T17:30'),
  },
];
const timing = (utc: string) => ({
  steps,
  now: nowInRome(new Date(utc)),
  hasLoad: true,
});
const IN_STEP_3 = '2026-11-25T10:00:00Z';
const IN_STEP_4 = '2026-11-30T10:00:00Z';

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
const user = (assignments: AssignmentView[]): AuthorizationSubject => ({
  assignments,
  programScope: [1],
  exclusions: [],
});
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
const reversed = (access: WorklistAccess): WorklistAccess => ({
  ...access,
  reviewerRows: [...access.reviewerRows].reverse(),
});

const membership = (
  change: Partial<MembershipFacts> = {},
): MembershipFacts => ({
  resultType: 'policy_change',
  programId: 1,
  round: 2,
  status: 'pending',
  ended: false,
  endReason: null,
  leadEscalated: false,
  tpbEscalated: false,
  ...change,
});
/** Status `pending`: the Lead's step. */
const AT_LEAD = membership();
/** Status `pending_tpb_review`: the Lead ended it escalated. */
const AT_TPB = membership({ leadEscalated: true });
/** Status `pending_ppu`: the TPB sided with the assessor. */
const AT_PPU = membership({ leadEscalated: true, tpbEscalated: true });

/** A Lead of policy_change who is also TPB (a global role), both on the timeline. */
const leadAndTpb = accessOf(
  user([grant('LEAD_ASSESSOR', 'policy_change'), grant('TPB', null)]),
  ['LEAD_ASSESSOR', 'TPB'],
);
const admin = user([grant('ADMIN', null)]);

describe('effectiveRow (DD-T11)', () => {
  it('a Lead who is also TPB: LEAD_ASSESSOR while pending, TPB once pending_tpb_review, whatever the row order', () => {
    expect(leadAndTpb.reviewerRows.map((row) => row.role)).toEqual([
      'LEAD_ASSESSOR',
      'TPB',
    ]);
    for (const access of [leadAndTpb, reversed(leadAndTpb)]) {
      expect(effectiveRow(access, AT_LEAD)?.role).toBe('LEAD_ASSESSOR');
      expect(effectiveRow(access, AT_TPB)?.role).toBe('TPB');
    }
  });

  it('pending_ppu reads PPU for a person holding the three round-2 roles; a result the Lead ended without escalating stays the Lead', () => {
    const all = accessOf(
      user([
        grant('LEAD_ASSESSOR', 'policy_change'),
        grant('TPB', null),
        grant('PPU', null),
      ]),
      ['LEAD_ASSESSOR', 'TPB', 'PPU'],
    );
    expect(effectiveRow(all, AT_PPU)?.role).toBe('PPU');
    expect(effectiveRow(reversed(all), AT_PPU)?.role).toBe('PPU');
    expect(effectiveRow(all, AT_TPB)?.role).toBe('TPB');
    expect(
      effectiveRow(all, membership({ ended: true, endReason: 'released_qaed' }))
        ?.role,
    ).toBe('LEAD_ASSESSOR');
  });

  it('the furthest role the person holds: a Lead and TPB on a pending_ppu result reads as TPB', () => {
    expect(effectiveRow(leadAndTpb, AT_PPU)?.role).toBe('TPB');
  });

  it('X-Acting-Role sends its role when it fits the round, even before the result reached that step', () => {
    for (const facts of [AT_LEAD, AT_TPB]) {
      expect(effectiveRow(accessOf(admin, [], RoleCode.TPB), facts)?.role).toBe(
        'TPB',
      );
      expect(
        effectiveRow(accessOf(admin, [], RoleCode.LEAD_ASSESSOR), facts)?.role,
      ).toBe('LEAD_ASSESSOR');
    }
    // ASSESSOR is a round-1 role: on a round-2 result it is not honored.
    expect(
      effectiveRow(accessOf(admin, [], RoleCode.ASSESSOR), AT_TPB),
    ).toBeUndefined();
  });

  it('ADMIN without X-Acting-Role has no reviewer role', () => {
    for (const facts of [AT_LEAD, AT_TPB, AT_PPU]) {
      expect(effectiveRow(accessOf(admin, []), facts)).toBeUndefined();
    }
  });
});

describe('writeDecision follows the effective row (DD-T11)', () => {
  it('a Lead who is also TPB writes as the Lead in step 3 on a pending result', () => {
    for (const access of [leadAndTpb, reversed(leadAndTpb)]) {
      expect(writeDecision(access, AT_LEAD, timing(IN_STEP_3))).toMatchObject({
        writable: true,
        row: { role: 'LEAD_ASSESSOR' },
        stepPosition: 3,
      });
    }
  });

  it('and as the TPB in step 4 once it is pending_tpb_review, whatever the row order', () => {
    for (const access of [leadAndTpb, reversed(leadAndTpb)]) {
      expect(writeDecision(access, AT_TPB, timing(IN_STEP_4))).toMatchObject({
        writable: true,
        row: { role: 'TPB' },
        stepPosition: 4,
      });
    }
  });

  it('never falls back to the Lead row on an escalated result: step 4 not open yet is step_upcoming', () => {
    for (const access of [leadAndTpb, reversed(leadAndTpb)]) {
      expect(writeDecision(access, AT_TPB, timing(IN_STEP_3))).toEqual({
        writable: false,
        reason: 'step_upcoming',
      });
    }
  });

  it('an Admin acting as TPB on a result the Lead has not escalated is read-only; acting as the Lead it writes', () => {
    expect(
      writeDecision(
        accessOf(admin, [], RoleCode.TPB),
        AT_LEAD,
        timing(IN_STEP_3),
      ),
    ).toEqual({ writable: false, reason: 'admin_read_only' });
    expect(
      writeDecision(
        accessOf(admin, [], RoleCode.LEAD_ASSESSOR),
        AT_LEAD,
        timing(IN_STEP_4),
      ),
    ).toMatchObject({
      writable: true,
      row: { role: 'LEAD_ASSESSOR', byAdmin: true },
    });
  });
});
