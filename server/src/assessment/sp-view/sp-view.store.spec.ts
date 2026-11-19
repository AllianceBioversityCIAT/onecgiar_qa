// P2-3911: the generated SQL of the SP view reads. No database answers here:
// the builders are read through `toSQL()`; the fake in `test/support` pins the
// behavior over HTTP.
import { drizzle } from 'drizzle-orm/mysql2';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import { DrizzleSpViewStore } from './sp-view.store.js';

const store = new DrizzleSpViewStore(drizzle.mock() as unknown as DrizzleDB);

describe('DrizzleSpViewStore SQL (P2-3911)', () => {
  it('lists timelines of the active cycle: the official one, or one whose scope covers the program', () => {
    const { sql, params } = store.buildTimelinesQuery(7).toSQL();
    expect(sql).toContain('`cycles`.`status` = ?');
    expect(sql).toMatch(/`timelines`.`kind` = \?/);
    expect(sql).toMatch(/`timelines`.`all_programs` = \?/);
    expect(sql).toMatch(/exists \(select 1 from `timeline_programs`/i);
    expect(params).toEqual(
      expect.arrayContaining(['active', 'official', true, 7]),
    );
  });

  it('lists round-1 memberships of the program that the worklist would list', () => {
    const { sql, params } = store
      .buildResultsQuery({
        timelineId: 3,
        programId: 7,
        assessmentStepPosition: 1,
        commentsVisible: true,
      })
      .toSQL();
    expect(sql).toMatch(/`timeline_results`.`program_clarisa_id` = \?/);
    expect(sql).toMatch(/`timeline_results`.`entry_round` = \?/);
    expect(sql).toMatch(/`timeline_results`.`status` <> \?/);
    expect(sql).toMatch(/`timeline_results`.`end_reason` in \(\?, \?\)/);
    expect(params).toEqual(
      expect.arrayContaining([
        3,
        7,
        1,
        'not_in_qa',
        'released_qaed',
        'returned',
      ]),
    );
    // The correlated counts and the round-2 probe name every column with its table.
    expect(sql).toContain(
      "`assessment_comments`.`assessment_id` = `result_assessments`.`id` AND `assessment_comments`.`visible_to_program_at` IS NOT NULL AND `assessment_comments`.`deleted_at` IS NULL AND `assessment_comments`.`state` <> 'withdrawn'",
    );
    // DD-11: an answered clarification request reads `open`, in the answered count and in the clarification probe.
    const answeredProbe =
      "WHEN ? THEN CASE WHEN EXISTS (SELECT 1 FROM `comment_clarification_answers` WHERE `comment_clarification_answers`.`response_id` = (SELECT `sp_comment_responses`.`id` FROM `sp_comment_responses` WHERE `sp_comment_responses`.`comment_id` = `assessment_comments`.`id` ORDER BY `sp_comment_responses`.`id` DESC LIMIT 1)) THEN 'open' ELSE ? END";
    // Once in `hasClarificationThread` and once in the `answered` count.
    expect(sql.split(answeredProbe)).toHaveLength(3);
    // DD-11: the answered count reads the program-side state, not the stored review state.
    expect(sql).toContain(
      'ELSE `assessment_comments`.`state` END) IN (?, ?, ?)',
    );
    expect(sql).toContain(
      'CASE WHEN `assessment_comments`.`state` IN (?, ?, ?, ?, ?) THEN COALESCE(CASE (SELECT `sp_comment_responses`.`kind`',
    );
    expect(params).toEqual(
      expect.arrayContaining([
        'accepted',
        'accepted_with_comment',
        'disagreed',
      ]),
    );
    expect(sql).toContain(
      '`round_two`.`timeline_id` = `timeline_results`.`timeline_id` AND `round_two`.`result_code` = `timeline_results`.`result_code` AND `round_two`.`entry_round` = 2',
    );
    // Never an assessor column.
    expect(sql).not.toMatch(/author_id|nickname|finished_by|`users`/);
  });

  it('counts nothing before the programs step starts', () => {
    const { sql } = store
      .buildResultsQuery({
        timelineId: 3,
        programId: 7,
        assessmentStepPosition: 1,
        commentsVisible: false,
      })
      .toSQL();
    expect(sql).not.toContain('visible_to_program_at');
  });

  it('reads only visible, non-withdrawn comments, without their author', () => {
    const { sql } = store.buildVisibleCommentsQuery(5).toSQL();
    expect(sql).toMatch(/`visible_to_program_at` is not null/);
    expect(sql).toMatch(/`state` <> \?/);
    expect(sql).not.toMatch(/author_id|nickname|`users`/);
  });
});
