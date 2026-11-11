// @akili-spec assessment/step-1-assessment
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DrizzleAssessmentWriteStore } from './assessment.store.js';

// The generated SQL of the assessment write side (design 5, 7.5; FR-10, FR-21).
// No database answers: the builders are read through `toSQL()`, so this spec
// pins what each statement SAYS. The locks are the contract of the lock order
// (timeline FOR SHARE, then the assessment FOR UPDATE), and a drop of one is
// silent on a fake.

const store = new DrizzleAssessmentWriteStore(
  drizzle.mock() as unknown as DrizzleDB,
);
const AT = new Date('2026-11-13T10:00:00Z');

describe('the locks of the lock order', () => {
  it('locks the timeline row FOR SHARE, one row, by id', () => {
    const { sql: text, params } = store.buildTimelineLock(7).toSQL();
    expect(text).toBe(
      'select `id` from `timelines` where `timelines`.`id` = ? limit ? for share',
    );
    expect(params).toEqual([7, 1]);
  });

  it('reads the steps of that timeline in position order (stable under the share lock)', () => {
    const { sql: text, params } = store.buildTimelineSteps(7).toSQL();
    expect(text).toContain('from `timeline_steps`');
    expect(text).toContain('where `timeline_steps`.`timeline_id` = ?');
    expect(text).toContain('order by `timeline_steps`.`position` asc');
    expect(text).not.toContain('for ');
    expect(params).toEqual([7]);
  });

  it('locks the assessment row of (membership, step) FOR UPDATE, one row, and reads its status and version', () => {
    const { sql: text, params } = store.buildAssessmentLock(70, 1).toSQL();
    expect(text).toContain(
      'where (`result_assessments`.`timeline_result_id` = ? and `result_assessments`.`step_position` = ?)',
    );
    expect(text).toMatch(/ limit \? for update$/);
    expect(text).toMatch(/^select `id`, `status`, `field_config_version` from /);
    expect(params).toEqual([70, 1, 1]);
  });
});

describe('the writes under the lock', () => {
  it('creates the assessment row with ON DUPLICATE KEY UPDATE on its own key: a second creator changes nothing', () => {
    const { sql: text, params } = store
      .buildEnsureAssessment({
        timelineResultId: 70,
        stepPosition: 1,
        roleCode: 'ASSESSOR',
        fieldConfigVersion: 3,
        createdBy: 10,
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^insert into `result_assessments`/);
    expect(text).toContain('on duplicate key update `id` = `id`');
    // A duplicate must never move the status, the pinned version or the creator.
    const update = text.slice(text.indexOf('on duplicate key update'));
    expect(update).not.toContain('status');
    expect(update).not.toContain('field_config_version');
    expect(update).not.toContain('created_by');
    expect(params).toEqual(expect.arrayContaining([70, 1, 'ASSESSOR', 3, 10]));
  });

  it('upserts every changed validation in ONE statement, on its key, writing the flag, the time and the actor only', () => {
    const { sql: text, params } = store
      .buildUpsertValidations(
        70,
        [
          { fieldKey: 'general.title', validated: true },
          { fieldKey: 'general.description', validated: false },
        ],
        10,
        AT,
      )
      .toSQL();
    expect(text).toMatch(/^insert into `assessment_field_validations`/);
    expect(text).toContain(
      'on duplicate key update `validated` = values(`validated`), `updated_at` = values(`updated_at`), `updated_by` = values(`updated_by`)',
    );
    expect(text.match(/\(\?, \?, \?, \?, \?\)/g)).toHaveLength(2);
    expect(params).toEqual(
      expect.arrayContaining([70, 'general.title', 'general.description', 10]),
    );
  });

  it('appends an audit row with ids and keys only: no body and no value column', () => {
    const { sql: text, params } = store
      .buildInsertAudit({
        assessmentId: 70,
        actorId: 10,
        action: 'validate',
        fieldKeys: ['general.title'],
        commentId: null,
        requestId: 'req-1',
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^insert into `assessment_audit_events`/);
    expect(text).not.toMatch(/\b(body|value)\b/);
    expect(text).not.toContain('on duplicate');
    expect(params).toEqual(
      expect.arrayContaining([70, 10, 'validate', 'req-1']),
    );
  });
});

describe('the comment writes (FR-11, FR-13, ADR-006)', () => {
  const comment = {
    assessmentId: 70,
    fieldKey: 'general.title',
    authorId: 10,
    stepPosition: 1,
    round: 1,
    body: 'Check the wording',
    valueCopy: { value: 'Old title' },
    valueTruncated: false,
    at: AT,
  };

  it('inserts the comment open, with the value copy, and never sets the program visibility or the withdraw time', () => {
    const { sql: text, params } = store.buildInsertComment(comment).toSQL();
    expect(text).toMatch(/^insert into `assessment_comments`/);
    for (const column of [
      'assessment_id',
      'field_key',
      'author_id',
      'step_position',
      'round',
      'body',
      'value_copy',
      'value_truncated',
      'created_at',
    ]) {
      expect(text).toContain(`\`${column}\``);
    }
    // `state`, `visible_to_program_at` and `withdrawn_at` take their column default.
    expect(text).toContain(
      'values (default, ?, ?, ?, ?, ?, ?, ?, ?, default, default, default, ?)',
    );
    expect(text).not.toContain('on duplicate');
    expect(params).toEqual(
      expect.arrayContaining([
        70,
        'general.title',
        10,
        'Check the wording',
        JSON.stringify({ value: 'Old title' }),
      ]),
    );
  });

  it('withdraws with ONE conditional UPDATE: it matches only while the comment is open, so the database decides a race', () => {
    const { sql: text, params } = store
      .buildWithdrawComment(700, AT)
      .toSQL();
    expect(text).toMatch(/^update `assessment_comments` set /);
    expect(text).toContain('`state` = ?');
    expect(text).toContain('`withdrawn_at` = ?');
    expect(text).toContain(
      'where (`assessment_comments`.`id` = ? and `assessment_comments`.`state` = ?)',
    );
    expect(params).toEqual(['withdrawn', '2026-11-13 10:00:00.000', 700, 'open']);
  });

  it('appends a comment event with ids and states only: no body, no value', () => {
    const { sql: text, params } = store
      .buildInsertCommentEvent({
        commentId: 700,
        actorId: 10,
        actorRole: 'ASSESSOR',
        fromState: 'open',
        toState: 'withdrawn',
        at: AT,
      })
      .toSQL();
    expect(text).toMatch(/^insert into `comment_events`/);
    expect(text).not.toMatch(/\b(body|value)\b/);
    expect(text).not.toContain('on duplicate');
    expect(params).toEqual(
      expect.arrayContaining([700, 10, 'ASSESSOR', 'open', 'withdrawn']),
    );
  });
});
