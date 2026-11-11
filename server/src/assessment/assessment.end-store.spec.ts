// @akili-spec assessment/step-1-assessment
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleAssessmentStore,
  DrizzleAssessmentWriteStore,
} from './assessment.store.js';

// The generated SQL of the end writes and of the quick comments (T-11; design
// 5, 7.5, 7.7; FR-12, FR-14, FR-15, FR-17, FR-18). No database answers: the
// builders are read through `toSQL()`, so this spec pins what each statement
// SAYS. The `status = 'pending'` guard of the end UPDATE is what decides the
// winner of two concurrent ends, and a drop of it is silent on a fake.

const mock = drizzle.mock() as unknown as DrizzleDB;
const store = new DrizzleAssessmentWriteStore(mock);
const reads = new DrizzleAssessmentStore(mock);
const AT = new Date('2026-11-13T10:00:00Z');

describe('the end writes (FR-14, FR-15, FR-17, FR-18; design 7.5)', () => {
  it('ends with ONE conditional UPDATE: it matches only while the assessment is pending, so the database decides which end wins', () => {
    const { sql: text, params } = store
      .buildEndAssessment({
        assessmentId: 70,
        status: 'returned',
        actorId: 10,
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^update `result_assessments` set /);
    expect(text).toContain(
      '`status` = ?, `finished_at` = ?, `finished_by` = ?',
    );
    expect(text).toContain(
      "where (`result_assessments`.`id` = ? and `result_assessments`.`status` = ?)",
    );
    expect(params).toEqual([
      'returned',
      '2026-11-13 10:00:00.000',
      10,
      70,
      'pending',
    ]);
  });

  it('queues the release pending, one row per assessment, with the outcome and the phase of the result', () => {
    const { sql: text, params } = store
      .buildInsertRelease({
        assessmentId: 70,
        timelineResultId: 33,
        resultId: 888,
        phaseYear: 2026,
        outcome: 'not_qaed',
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^insert into `assessment_releases`/);
    for (const column of [
      'assessment_id',
      'timeline_result_id',
      'result_id',
      'phase_year',
      'outcome',
      'created_at',
    ]) {
      expect(text).toContain(`\`${column}\``);
    }
    // `status` (pending), `attempts` (0), the lease, the reason and `sent_at` take their column default.
    expect(text).not.toContain('on duplicate');
    expect(params).toEqual(
      expect.arrayContaining([70, 33, 888, 2026, 'not_qaed']),
    );
  });

  it('marks the non-withdrawn comments visible to the program, only those not yet visible', () => {
    const { sql: text, params } = store
      .buildMarkCommentsVisible(70, AT)
      .toSQL();
    expect(text).toMatch(
      /^update `assessment_comments` set `visible_to_program_at` = \?/,
    );
    expect(text).toContain('`assessment_comments`.`assessment_id` = ?');
    expect(text).toContain('`assessment_comments`.`state` <> ?');
    expect(text).toContain(
      '`assessment_comments`.`visible_to_program_at` is null',
    );
    expect(params).toEqual(['2026-11-13 10:00:00.000', 70, 'withdrawn']);
  });

  it('reads the commented field keys: distinct, non-withdrawn, of one assessment', () => {
    const { sql: text, params } = store.buildCommentedFieldKeys(70).toSQL();
    expect(text).toBe(
      'select distinct `field_key` from `assessment_comments` where (`assessment_comments`.`assessment_id` = ? and `assessment_comments`.`state` <> ?)',
    );
    expect(params).toEqual([70, 'withdrawn']);
  });
});

describe('the quick-comment statements (FR-12)', () => {
  it('inserts the text with its role and hash, with no ON DUPLICATE: a duplicate is a 1062 the store turns into the existing row', () => {
    const { sql: text, params } = store
      .buildInsertQuickComment({
        roleCode: 'ASSESSOR',
        body: 'Please add the evidence link',
        bodyHash: 'h'.repeat(64),
        createdBy: 10,
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^insert into `quick_comments`/);
    expect(text).not.toContain('on duplicate');
    expect(params).toEqual(
      expect.arrayContaining(['ASSESSOR', 'Please add the evidence link', 10]),
    );
  });

  it('finds the existing row by role and hash', () => {
    const { sql: text, params } = store
      .buildFindQuickComment('ASSESSOR', 'h'.repeat(64))
      .toSQL();
    expect(text).toContain('`quick_comments`.`role_code` = ?');
    expect(text).toContain('`quick_comments`.`body_hash` = ?');
    expect(params).toEqual(['ASSESSOR', 'h'.repeat(64), 1]);
  });

  it('lists one role, newest first, ties by id', () => {
    const { sql: text, params } = reads
      .buildQuickCommentsQuery('ASSESSOR')
      .toSQL();
    expect(text).toContain('where `quick_comments`.`role_code` = ?');
    expect(text).toContain(
      'order by `quick_comments`.`created_at` desc, `quick_comments`.`id` desc',
    );
    expect(params).toEqual(['ASSESSOR']);
  });
});
