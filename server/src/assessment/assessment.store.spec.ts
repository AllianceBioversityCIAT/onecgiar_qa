// @akili-spec assessment/step-1-assessment
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleAssessmentStore,
  type MembershipCriteria,
} from './assessment.store.js';
import { resolveAccess, type WorklistAccess } from './scope.js';

// The generated SQL of the Drizzle adapter of the assessment reads (design
// 7.4, FR-1, FR-2). No database answers here: the builders are read through
// `toSQL()`, so this spec pins what the statements SAY (the timeline and code
// predicates, the scope, the round, the assessment join, the order and the
// limit), and the fake in `test/support` pins the behavior. T-7 shipped the
// same hole: a store with no SQL spec and a fake that was looser than it.

const store = new DrizzleAssessmentStore(
  drizzle.mock() as unknown as DrizzleDB,
);

function reviewerAccess(): WorklistAccess {
  return resolveAccess(
    {
      assignments: [
        {
          roleCode: 'ASSESSOR',
          roleIsActive: true,
          isActive: true,
          revokedAt: null,
          resultTypeKey: 'policy_change',
          programId: null,
        },
      ],
      programScope: [3, 4],
      exclusions: [],
    },
    ['ASSESSOR'],
    false,
  );
}

const adminAccess = (): WorklistAccess => ({
  reviewerRows: [],
  admin: true,
  disabledRoles: [],
});

function criteria(
  overrides: Partial<MembershipCriteria> = {},
): MembershipCriteria {
  return {
    timelineId: 7,
    resultCode: 5001,
    access: reviewerAccess(),
    round: null,
    assessmentStepPosition: 1,
    ...overrides,
  };
}

const membershipSql = (c: MembershipCriteria) =>
  store.buildMembershipQuery(c).toSQL();
const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to === '' ? text.length : text.indexOf(to, start);
  return text.slice(start, end < 0 ? text.length : end);
};
/** The WHERE of the statement, up to its ORDER BY. */
const whereOf = (text: string) => between(text, ' where ', ' order by ');
const count = (text: string, part: string) => text.split(part).length - 1;

const TIMELINE = '`timeline_results`.`timeline_id` = ?';
const CODE = '`timeline_results`.`result_code` = ?';
const ROUND = '`timeline_results`.`entry_round` = ?';

describe('DrizzleAssessmentStore.buildMembershipQuery', () => {
  it('reads one row: the latest round of the (timeline, code) pair inside the scope, ordered and limited by the statement', () => {
    const { sql: text, params } = membershipSql(criteria());
    expect(text).toContain(
      ' order by `timeline_results`.`entry_round` desc limit ?',
    );
    // The limit is the last parameter.
    expect(params[params.length - 1]).toBe(1);
  });

  it('is bound to the timeline asked for, and to the result code asked for', () => {
    const { sql: text, params } = membershipSql(criteria());
    const where = whereOf(text);
    // Dropping the timeline predicate leaks a result across timelines.
    expect(where).toContain(TIMELINE);
    expect(where).toContain(CODE);
    // The step position of the join binds first, then the timeline and the code.
    expect(params.slice(1, 3)).toEqual([7, 5001]);
    expect(membershipSql(criteria({ timelineId: 8 })).params[1]).toBe(8);
    expect(membershipSql(criteria({ resultCode: 5002 })).params[2]).toBe(5002);
  });

  it('scopes a reviewer by the worklist condition: the row round, the granted result type and the program scope', () => {
    const { sql: text, params } = membershipSql(criteria());
    const where = whereOf(text);
    expect(where).toContain(ROUND);
    expect(where).toContain('`timeline_results`.`result_type_key` in (?)');
    expect(where).toContain(
      '`timeline_results`.`program_clarisa_id` in (?, ?)',
    );
    expect(params).toEqual(
      expect.arrayContaining([7, 5001, 'policy_change', 3, 4]),
    );
  });

  it('ignores the round asked for when the caller is a reviewer: only their own row round is in the statement', () => {
    const own = membershipSql(criteria({ round: null }));
    const asked = membershipSql(criteria({ round: 2 }));
    expect(count(whereOf(asked.sql), ROUND)).toBe(1);
    expect(asked.sql).toBe(own.sql);
    expect(asked.params).toEqual(own.params);
  });

  it('scopes an ADMIN by "not not_in_qa" alone, with no round when none is asked for', () => {
    const { sql: text, params } = membershipSql(
      criteria({ access: adminAccess() }),
    );
    const where = whereOf(text);
    expect(where).toContain('`timeline_results`.`status` <> ?');
    expect(params).toEqual([1, 7, 5001, 'not_in_qa', 1]);
    expect(where).not.toContain('`entry_round`');
    expect(where).not.toContain('result_type_key');
    expect(where).toContain(TIMELINE);
    expect(where).toContain(CODE);
  });

  it('filters an ADMIN by the round asked for, and only an ADMIN', () => {
    const { sql: text, params } = membershipSql(
      criteria({ access: adminAccess(), round: 2 }),
    );
    const where = whereOf(text);
    expect(count(where, ROUND)).toBe(1);
    expect(params).toEqual([1, 7, 5001, 'not_in_qa', 2, 1]);
  });

  it('joins the assessment of the step on the membership and the step position, and reads zero when the timeline has no step', () => {
    const withStep = membershipSql(criteria({ assessmentStepPosition: 2 }));
    const join = between(
      withStep.sql,
      ' left join `result_assessments`',
      ' left join `users`',
    );
    expect(join).toContain(
      '`result_assessments`.`timeline_result_id` = `timeline_results`.`id`',
    );
    expect(join).toContain('`result_assessments`.`step_position` = ?');
    expect(withStep.params[0]).toBe(2);

    // Position 0 never exists (positions are 1 to 5): no step, no assessment.
    const noStep = membershipSql(criteria({ assessmentStepPosition: null }));
    expect(noStep.params[0]).toBe(0);
  });

  it('joins the cycle for the catalog year, who finished the assessment, and the row of the version the assessment pinned', () => {
    const { sql: text } = membershipSql(criteria());
    expect(text).toContain(
      ' inner join `cycles` on `cycles`.`id` = `timeline_results`.`cycle_id`',
    );
    expect(text).toContain(
      ' left join `users` on `users`.`id` = `result_assessments`.`finished_by`',
    );
    // The pinned NUMBER becomes the version row by (cycle, number): one statement, no `listVersions`.
    const join = between(text, ' left join `field_config_versions`', ' where ');
    expect(join).toContain(
      '`field_config_versions`.`cycle_id` = `timeline_results`.`cycle_id`',
    );
    expect(join).toContain(
      '`field_config_versions`.`number` = `result_assessments`.`field_config_version`',
    );
    expect(text).toContain('`field_config_versions`.`id`');
  });

  it('is one SELECT, which never writes', () => {
    const { sql: text } = membershipSql(criteria());
    expect(text.startsWith('select ')).toBe(true);
    expect(text).not.toMatch(/\b(insert|update|delete)\b/i);
  });
});

describe('DrizzleAssessmentStore.buildValidationsQuery', () => {
  it('reads the validations of one assessment and nothing else', () => {
    const { sql: text, params } = store.buildValidationsQuery(70).toSQL();
    expect(text).toBe(
      'select `field_key`, `validated` from `assessment_field_validations` where `assessment_field_validations`.`assessment_id` = ?',
    );
    expect(params).toEqual([70]);
  });
});

describe('DrizzleAssessmentStore.buildCommentsQuery', () => {
  it('reads the comments of one assessment with the nickname of the author only, oldest first', () => {
    const { sql: text, params } = store.buildCommentsQuery(70).toSQL();
    expect(params).toEqual([70]);
    expect(whereOf(text)).toBe(
      ' where `assessment_comments`.`assessment_id` = ?',
    );
    expect(text).toContain(
      ' inner join `users` on `users`.`id` = `assessment_comments`.`author_id`',
    );
    expect(text).toContain(
      ' order by `assessment_comments`.`created_at` asc, `assessment_comments`.`id` asc',
    );
    // The author is shown by nickname (FR-11): no other column of `users` is selected.
    expect(text).toContain('`users`.`nickname`');
    expect(text).not.toContain('`users`.`email`');
    expect(text).not.toContain('`users`.`first_name`');
    expect(text).not.toContain('`users`.`last_name`');
  });
});

describe('the comment context statement (withdraw and the replay reader)', () => {
  it('reads the comment, its author nickname, its assessment and membership in ONE statement, by the comment id', () => {
    const { sql: text, params } = store.buildCommentContextQuery(700).toSQL();
    expect(text).toContain('from `assessment_comments`');
    expect(text).toContain('inner join `users` on `users`.`id` = `assessment_comments`.`author_id`');
    expect(text).toContain(
      'inner join `result_assessments` on `result_assessments`.`id` = `assessment_comments`.`assessment_id`',
    );
    expect(text).toContain(
      'inner join `timeline_results` on `timeline_results`.`id` = `result_assessments`.`timeline_result_id`',
    );
    expect(text).toContain('where `assessment_comments`.`id` = ?');
    expect(text).toContain(' limit ?');
    expect(text).not.toContain('for update');
    expect(text).not.toContain('for share');
    // The author is shown by nickname only.
    expect(text).not.toContain('`email`');
    expect(params).toEqual([700, 1]);
  });
});
