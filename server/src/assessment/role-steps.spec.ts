// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import {
  audienceStepState,
  enabledReviewerRows,
  findRoleStep,
  isRoleStepOpen,
  ROLE_STEPS,
  roleStepState,
} from './role-steps.js';

// Expected values are literals from design 7.1's table and from FR-2's scenario
// *Step 1 not yet open, then closed*: step 1 opens 2026-11-12T09:00 Rome and
// closes 2026-11-20T17:30 Rome. Rome is UTC+1 on those days, so 09:00 Rome is
// 08:00 UTC. Instants go through `nowInRome`, the helper the services use.

const minute = (value: string) => value as RomeMinute;

const steps: TimelineViewStep[] = [
  {
    position: 1,
    audience: 'assessors',
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    audience: 'programs',
    opensAt: minute('2026-11-23T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
];

const assessor = findRoleStep('ASSESSOR')!;
const timing = (utc: string, hasLoad = true) => ({
  steps,
  now: nowInRome(new Date(utc)),
  hasLoad,
});

describe('role-step table (design 7.1)', () => {
  it('declares the five rows as the design lists them', () => {
    expect(
      ROLE_STEPS.map((row) => [
        row.role,
        row.permission,
        row.audience,
        row.round,
        row.enabled,
        row.access,
      ]),
    ).toEqual([
      ['ASSESSOR', 'ASSESSOR_ACCESS', 'assessors', 1, true, 'write'],
      ['LEAD_ASSESSOR', 'LEAD_ACCESS', 'lead_assessors', 2, false, 'write'],
      ['TPB', 'TPB_ACCESS', 'tpb', 2, false, 'write'],
      ['PPU', 'PPU_ACCESS', 'ppu', 2, false, 'write'],
      ['ADMIN', 'ADMIN_ACCESS', null, null, true, 'read'],
    ]);
  });

  it('enables only ASSESSOR as a writer in this spec', () => {
    expect(enabledReviewerRows().map((row) => row.role)).toEqual(['ASSESSOR']);
  });

  it('has no row for a role with no worklist (PROGRAM, GUEST)', () => {
    expect(findRoleStep('PROGRAM')).toBeUndefined();
    expect(findRoleStep('GUEST')).toBeUndefined();
  });
});

describe('step open at the clock minute (FR-2)', () => {
  it.each<[string, string, boolean]>([
    ['opensAt -1 minute (08:59)', '2026-11-12T07:59:00Z', false],
    ['opensAt exactly (09:00:00)', '2026-11-12T08:00:00Z', true],
    ['opensAt +0:59 (09:00:59)', '2026-11-12T08:00:59Z', true],
    ['closesAt :59 (17:30:59)', '2026-11-20T16:30:59Z', true],
    ['closesAt +1 minute (17:31:00)', '2026-11-20T16:31:00Z', false],
  ])('%s -> open: %s', (_name, utc, open) => {
    expect(isRoleStepOpen(assessor, timing(utc))).toBe(open);
  });

  it('reports which side of the window a closed answer is on', () => {
    expect(roleStepState(assessor, timing('2026-11-12T07:59:00Z'))).toEqual({
      position: 1,
      state: 'upcoming',
    });
    expect(roleStepState(assessor, timing('2026-11-20T16:31:00Z'))).toEqual({
      position: 1,
      state: 'closed',
    });
  });

  it('is on hold while the timeline has no load, even inside the window (DD-2)', () => {
    const inside = '2026-11-15T10:00:00Z';
    expect(isRoleStepOpen(assessor, timing(inside, true))).toBe(true);
    expect(isRoleStepOpen(assessor, timing(inside, false))).toBe(false);
    // The hold wins after every closing minute too.
    expect(
      roleStepState(assessor, timing('2026-12-30T10:00:00Z', false)),
    ).toEqual({
      position: 1,
      state: 'upcoming',
    });
  });

  it('never opens a role whose audience has no step in the timeline', () => {
    const lead = findRoleStep('LEAD_ASSESSOR')!;
    expect(roleStepState(lead, timing('2026-11-15T10:00:00Z'))).toBeNull();
    expect(isRoleStepOpen(lead, timing('2026-11-15T10:00:00Z'))).toBe(false);
  });

  it('gives ADMIN no step: it never writes through its row', () => {
    const admin = findRoleStep('ADMIN')!;
    expect(roleStepState(admin, timing('2026-11-15T10:00:00Z'))).toBeNull();
  });

  it('finds the step of another audience, for the clarification predicate', () => {
    expect(audienceStepState('programs', timing('2026-11-24T10:00:00Z'))).toBe(
      'in_progress',
    );
    expect(audienceStepState('programs', timing('2026-11-15T10:00:00Z'))).toBe(
      'upcoming',
    );
    expect(audienceStepState('tpb', timing('2026-11-15T10:00:00Z'))).toBeNull();
  });
});
