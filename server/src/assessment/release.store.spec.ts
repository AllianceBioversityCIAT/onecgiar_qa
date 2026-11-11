// @akili-spec assessment/step-1-assessment
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleReleaseStore,
  DrizzleReleaseWriteStore,
} from './release.store.js';

// The generated SQL of the release outbox (T-12; design 5, 7.6; FR-18, NFR-3).
// No database answers: the builders are read through `toSQL()`, so this spec
// pins what each statement SAYS. The lease condition of the claim is what keeps
// two dispatchers from sending the same row, and a drop of it is silent on a
// fake that models the lease in code.

const mock = drizzle.mock() as unknown as DrizzleDB;
const reads = new DrizzleReleaseStore(mock);
const writes = new DrizzleReleaseWriteStore(mock);
const NOW = new Date('2026-11-13T10:00:00Z');
const LEASE = new Date('2026-11-13T10:01:00Z');

describe('the claim (design 7.6 step 1)', () => {
  it('takes the phase year of the oldest due row, without a lock', () => {
    const { sql: text, params } = reads.buildOldestDue(NOW).toSQL();
    expect(text).toMatch(
      /^select `phase_year` from `assessment_releases` where /,
    );
    expect(text).toContain('order by `assessment_releases`.`id`');
    expect(text).not.toContain('for update');
    expect(params).toEqual(['pending', '2026-11-13 10:00:00.000', 1]);
  });

  it('reads the due ids of that one year FOR UPDATE SKIP LOCKED: pending, with a null or a past lease, oldest first, at most the limit', () => {
    const { sql: text, params } = reads.buildDueSelect(NOW, 50, 2026).toSQL();
    expect(text).toMatch(
      /^select `id`, `result_id` from `assessment_releases` where /,
    );
    expect(text).toContain('`assessment_releases`.`status` = ?');
    expect(text).toContain(
      '(`assessment_releases`.`lease_until` is null or `assessment_releases`.`lease_until` < ?)',
    );
    expect(text).toContain('`assessment_releases`.`phase_year` = ?');
    expect(text).toContain('order by `assessment_releases`.`id`');
    expect(text).toMatch(/limit \? for update skip locked$/);
    expect(params).toEqual(['pending', '2026-11-13 10:00:00.000', 2026, 50]);
  });

  it("leases with ONE conditional UPDATE: status = 'pending' AND the lease null or past, and counts the attempt", () => {
    const { sql: text, params } = reads
      .buildClaimUpdate([7, 8], NOW, LEASE)
      .toSQL();
    expect(text).toMatch(/^update `assessment_releases` set /);
    expect(text).toContain('`lease_until` = ?');
    expect(text).toContain(
      '`attempts` = least(`assessment_releases`.`attempts` + 1, 255)',
    );
    expect(text).toContain('`assessment_releases`.`id` in (?, ?)');
    expect(text).toContain('`assessment_releases`.`status` = ?');
    expect(text).toContain(
      '(`assessment_releases`.`lease_until` is null or `assessment_releases`.`lease_until` < ?)',
    );
    expect(params).toEqual([
      '2026-11-13 10:01:00.000',
      7,
      8,
      'pending',
      '2026-11-13 10:00:00.000',
    ]);
  });

  it('reads the leased rows back with the timeline of each membership, by id', () => {
    const { sql: text } = reads.buildLeasedRows([7, 8]).toSQL();
    expect(text).toContain('from `assessment_releases`');
    expect(text).toContain('join `timeline_results`');
    expect(text).toContain('`timeline_results`.`timeline_id`');
    expect(text).toContain('`assessment_releases`.`id` in (?, ?)');
    expect(text).not.toContain('for update');
  });
});

describe('the ack (design 7.6 step 3, design 5)', () => {
  it('locks the assessment row FOR UPDATE by id', () => {
    const { sql: text, params } = writes.buildAssessmentLock(70).toSQL();
    expect(text).toMatch(
      /^select `id`, `finished_by` from `result_assessments` where `result_assessments`.`id` = \? limit \? for update$/,
    );
    expect(params).toEqual([70, 1]);
  });

  it('settles with ONE conditional UPDATE that matches only while the row is pending, so a row another dispatcher acknowledged is not written twice', () => {
    const { sql: text, params } = writes
      .buildSettle({ id: 7, status: 'sent', reason: 'not_in_qa', at: NOW })
      .toSQL();
    expect(text).toMatch(/^update `assessment_releases` set /);
    expect(text).toContain('`status` = ?, `reason` = ?, `sent_at` = ?');
    expect(text).toContain(
      'where (`assessment_releases`.`id` = ? and `assessment_releases`.`status` = ?)',
    );
    expect(params).toEqual([
      'sent',
      'not_in_qa',
      '2026-11-13 10:00:00.000',
      7,
      'pending',
    ]);
  });

  it('keeps sent_at null for a refusal', () => {
    const { params } = writes
      .buildSettle({
        id: 7,
        status: 'refused',
        reason: 'not_submitted',
        at: NOW,
      })
      .toSQL();
    expect(params.slice(0, 3)).toEqual(['refused', 'not_submitted', null]);
  });
});

describe('the admin list (design 6)', () => {
  it('lists one status with the timeline name and the result code, oldest first, capped', () => {
    const { sql: text, params } = reads.buildList('refused').toSQL();
    expect(text).toContain('from `assessment_releases`');
    expect(text).toContain('join `timeline_results`');
    expect(text).toContain('join `timelines`');
    expect(text).toContain('`assessment_releases`.`status` = ?');
    expect(text).toContain('order by `assessment_releases`.`id`');
    expect(params).toEqual(['refused', 500]);
  });
});
