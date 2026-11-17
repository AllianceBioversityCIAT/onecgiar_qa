// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { resultAssessments } from '../database/drizzle/schema/result-assessments.js';
import { timelineResults } from '../database/drizzle/schema/timeline-results.js';
import { statusSqlCase } from './qa-status.js';
import { resolveAccess, type WorklistAccess } from './scope.js';
import {
  DrizzleWorklistStore,
  type WorklistPageCriteria,
  type WorklistScope,
} from './worklist.store.js';

// The generated SQL of the Drizzle adapter (design 7.2, 7.3). No database
// answers here: the builders are read through `toSQL()`, so the spec pins what
// the statements say, and the fake in `test/support` pins the behavior.

const store = new DrizzleWorklistStore(drizzle.mock() as unknown as DrizzleDB);

function assessorAccess(): WorklistAccess {
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
      programScope: [1, 2],
      exclusions: [],
    },
    ['ASSESSOR'],
    false,
  );
}

function scope(overrides: Partial<WorklistScope> = {}): WorklistScope {
  return {
    timelineId: 7,
    userId: 10,
    access: assessorAccess(),
    assessmentStepPosition: 1,
    clarificationWindowOpen: false,
    hideAutoValidated: true,
    ...overrides,
  };
}

function criteria(
  overrides: Partial<WorklistPageCriteria> = {},
): WorklistPageCriteria {
  return {
    ...scope(),
    filters: { statuses: [], programIds: [], resultTypeKeys: [], q: null },
    sort: { key: 'code', dir: 'asc', programOrder: [], resultTypeOrder: [] },
    after: null,
    take: 26,
    ...overrides,
  };
}

const pageSql = (c: WorklistPageCriteria) => store.buildPageQuery(c).toSQL();
/** The statement's own text with the page's select list cut away. */
const whereOf = (text: string) => text.slice(text.indexOf(' where '));
/** The EXISTS sub-select of the clarification thread, which binds a parameter and so reads differently from a literal. */
const THREAD =
  /exists \(select 1 from `assessment_comments` where \(`assessment_comments`\.`assessment_id` = `result_assessments`\.`id` and `assessment_comments`\.`state` = \?\)\)/g;
const normalized = (text: string) => text.replace(THREAD, 'THREAD');

/** The CASE the statements must carry: the output of `statusSqlCase` on the same columns. */
const expectedCase = new MySqlDialect().sqlToQuery(
  statusSqlCase({
    membershipStatus: timelineResults.status,
    endReason: timelineResults.endReason,
    assessmentStatus: resultAssessments.status,
    hasClarificationThread: sql.raw('THREAD'),
  }),
).sql;

describe('DrizzleWorklistStore SQL', () => {
  it('lists only memberships not ended, or ended by release or return (design 7.2)', () => {
    const { sql: text, params } = pageSql(criteria());
    expect(text).toContain('`timeline_results`.`ended_at` is null');
    expect(text).toContain('`timeline_results`.`end_reason` in (?, ?)');
    expect(params).toEqual(
      expect.arrayContaining(['released_qaed', 'returned']),
    );
  });

  it('carries the status CASE of statusSqlCase() in the page and in the counters', () => {
    expect(expectedCase).toContain("THEN 'returned_to_program'");
    expect(normalized(pageSql(criteria()).sql)).toContain(expectedCase);
    expect(normalized(store.buildCountQuery(scope()).toSQL().sql)).toContain(
      expectedCase,
    );
  });

  it('scopes by timeline, reviewer round, result types and programs of the row', () => {
    const { sql: text, params } = pageSql(criteria());
    const where = whereOf(text);
    expect(where).toContain('`timeline_results`.`timeline_id` = ?');
    expect(where).toContain('`timeline_results`.`entry_round` = ?');
    expect(where).toContain('`timeline_results`.`result_type_key` in (?)');
    expect(where).toContain(
      '`timeline_results`.`program_clarisa_id` in (?, ?)',
    );
    expect(params).toEqual(
      expect.arrayContaining([7, 1, 'policy_change', 1, 2]),
    );
  });

  it('scopes an admin by "not not_in_qa" alone, and a caller with no row by nothing', () => {
    const adminWhere = whereOf(
      pageSql(
        criteria({
          access: { reviewerRows: [], admin: true, disabledRoles: [] },
        }),
      ).sql,
    );
    expect(adminWhere).toContain('`timeline_results`.`status` <> ?');
    expect(adminWhere).not.toContain('`entry_round`');

    const noneWhere = whereOf(
      pageSql(
        criteria({
          access: { reviewerRows: [], admin: false, disabledRoles: [] },
        }),
      ).sql,
    );
    expect(noneWhere).toContain('1 = 0');
  });

  it('hides auto-validated in the page and in the counters unless the filter names it', () => {
    const hide = "<> 'auto_validated'";
    expect(pageSql(criteria()).sql).toContain(hide);
    expect(store.buildCountQuery(scope()).toSQL().sql).toContain(hide);
    const shown = scope({ hideAutoValidated: false });
    expect(store.buildCountQuery(shown).toSQL().sql).not.toContain(hide);
    expect(pageSql(criteria({ hideAutoValidated: false })).sql).not.toContain(
      hide,
    );
  });

  it('lifts the ended filter for the clarification window only, through a comment the user wrote', () => {
    expect(pageSql(criteria()).sql).not.toContain(
      '`assessment_comments`.`author_id`',
    );
    const open = pageSql(criteria({ clarificationWindowOpen: true }));
    expect(open.sql).toContain('`assessment_comments`.`author_id` = ?');
    expect(open.params).toContain(10);
    // An admin without a reviewer row never gets the lift (T-3 `listedFor`).
    const adminOpen = pageSql(
      criteria({
        clarificationWindowOpen: true,
        access: { reviewerRows: [], admin: true, disabledRoles: [] },
      }),
    );
    expect(adminOpen.sql).not.toContain('`assessment_comments`.`author_id`');
  });

  it('selects the Updated flag as an expression, never the changed keys, and no name or email', () => {
    const text = pageSql(criteria()).sql;
    expect(text).toContain(
      'JSON_LENGTH(`timeline_results`.`changed_fields`) > 0',
    );
    expect(text).not.toMatch(/`timeline_results`\.`changed_fields`,/);
    expect(text).toContain('`users`.`nickname`');
    expect(text).not.toContain('`users`.`email`');
    expect(text).not.toContain('`users`.`first_name`');
    expect(text).not.toContain('`users`.`last_name`');
  });

  it('orders by FIELD over the catalog order for a program sort, ties by result code then id, and pages by keyset', () => {
    const { sql: text, params } = pageSql(
      criteria({
        sort: {
          key: 'program',
          dir: 'desc',
          programOrder: [3, 5, 1],
          resultTypeOrder: [],
        },
        after: { value: 2, resultCode: 5100, membershipId: 77 },
      }),
    );
    expect(text).toContain(
      'FIELD(`timeline_results`.`program_clarisa_id`, ?, ?, ?)',
    );
    expect(text).toMatch(
      /order by FIELD\([^)]*\) desc, `timeline_results`\.`result_code` asc, `timeline_results`\.`id` asc limit \?$/,
    );
    expect(text).toContain(') < ?');
    expect(text).toContain('`timeline_results`.`result_code` > ?');
    expect(text).toContain('`timeline_results`.`id` > ?');
    expect(params).toEqual(expect.arrayContaining([3, 5, 1, 2, 5100, 77, 26]));
  });

  it('excludes the program ids a reviewer row excludes when its scope is "all"', () => {
    const access = resolveAccess(
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
        programScope: [],
        exclusions: [
          { programId: 4, status: 'active' },
          { programId: 9, status: 'active' },
          { programId: 6, status: 'removed' },
        ],
      },
      ['ASSESSOR'],
      false,
    );
    const { sql: text, params } = pageSql(criteria({ access }));
    expect(whereOf(text)).toContain(
      '`timeline_results`.`program_clarisa_id` not in (?, ?)',
    );
    expect(params).toEqual(expect.arrayContaining([4, 9]));
    // Only the ACTIVE exclusions bind: a removed one (6) does not.
    expect(params).not.toContain(6);
  });

  describe('findTimelines (FR-1, FR-3)', () => {
    const timelinesSql = (timelineId?: number) =>
      store.buildTimelinesQuery(10, timelineId).toSQL();

    it('inner-joins the cycles table on status = active, so a draft or closed cycle never lists', () => {
      const { sql: text, params } = timelinesSql();
      expect(text).toContain('inner join `cycles` on');
      expect(text).toContain('`cycles`.`status` = ?');
      expect(text).toContain('`cycles`.`id` = `timelines`.`cycle_id`');
      expect(params).toContain('active');
    });

    it('takes only ACTIVE assignments of the caller inside the timeline_users join, not in the where', () => {
      const { sql: text, params } = timelinesSql();
      const join = text.slice(
        text.indexOf('left join `timeline_users` on'),
        text.indexOf('left join `roles`'),
      );
      expect(join).toContain('`timeline_users`.`user_id` = ?');
      expect(join).toContain('`timeline_users`.`removed_at` is null');
      expect(params).toContain(10);
    });

    it('narrows to one timeline when asked, and to none otherwise', () => {
      expect(timelinesSql().sql).not.toContain('`timelines`.`id` = ?');
      expect(timelinesSql(7).sql).toContain('`timelines`.`id` = ?');
      expect(timelinesSql(7).params).toContain(7);
    });
  });

  it('binds search text with LIKE metacharacters escaped', () => {
    const { sql: text, params } = pageSql(
      criteria({
        filters: {
          statuses: ['pending'],
          programIds: [],
          resultTypeKeys: [],
          q: '50%_x',
        },
      }),
    );
    expect(text).toContain(
      'CAST(`timeline_results`.`result_code` AS CHAR) LIKE ?',
    );
    expect(text).toContain('`timeline_results`.`title` like ?');
    expect(params).toEqual(
      expect.arrayContaining(['50\\%\\_x%', '%50\\%\\_x%', 'pending']),
    );
  });

  it('groups the counters by the status CASE in one statement, ignoring the page filters', () => {
    const { sql: text } = store.buildCountQuery(scope()).toSQL();
    expect(text).toMatch(/group by status_key$/);
    expect(text).toContain('COUNT(*)');
    expect(text).not.toContain('FIELD(');
    expect(text).not.toContain(' like ?');
  });
});
