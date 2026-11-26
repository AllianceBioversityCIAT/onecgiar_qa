// @akili-spec escalation/round-2-tpb
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DrizzleAssessmentStore } from './assessment.store.js';
import { resolveAccess } from './scope.js';

// P2-3916 (DD-T5, FR-2, NFR-1): the TPB's thread is one statement over the
// round-1 and step-3 assessments with both decisions; the membership read
// carries the Lead's step-3 row whatever the current step.

const store = new DrizzleAssessmentStore(
  drizzle.mock() as unknown as DrizzleDB,
);
const count = (text: string, word: string) =>
  text.split(word).length - 1;
const between = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to));

describe('DrizzleAssessmentStore.buildEscalationThreadQuery (DD-T5)', () => {
  const thread = (ids: number[] = [70, 80]) =>
    store.buildEscalationThreadQuery(ids, 'TPB', 'LEAD_ASSESSOR').toSQL();

  it('is ONE SELECT over both assessments, the latest-response scalar its only subquery', () => {
    const { sql: text, params } = thread();
    expect(text.startsWith('select ')).toBe(true);
    expect(count(text.toLowerCase(), 'select')).toBe(2);
    expect(between(text, ' where ', ' order by ')).toContain(
      '`assessment_comments`.`assessment_id` in (?, ?)',
    );
    expect(params).toEqual(expect.arrayContaining([70, 80]));
  });

  it('keeps live comments only, in the round-1 thread order', () => {
    const { sql: text } = thread();
    const where = between(text, ' where ', ' order by ');
    expect(where).toContain('`assessment_comments`.`withdrawn_at` is null');
    expect(where).toContain('`assessment_comments`.`deleted_at` is null');
    expect(text.slice(text.indexOf(' order by '))).toBe(
      ' order by `assessment_comments`.`field_key` asc, `assessment_comments`.`created_at` asc, `assessment_comments`.`id` asc, `sp_comment_responses`.`id` asc',
    );
  });

  it("joins the TPB's decision and the Lead's, each by role, and selects the comment's round", () => {
    const { sql: text, params } = thread();
    expect(text).toContain(
      'left join `comment_decisions` on (`comment_decisions`.`comment_id` = `assessment_comments`.`id` and `comment_decisions`.`role_code` = ?)',
    );
    expect(text).toContain(
      'left join `comment_decisions` `context_decision` on (`context_decision`.`comment_id` = `assessment_comments`.`id` and `context_decision`.`role_code` = ?)',
    );
    expect(text).toContain('`assessment_comments`.`round`');
    expect(params).toEqual(expect.arrayContaining(['TPB', 'LEAD_ASSESSOR']));
  });

  it('issues no statement for no assessment', async () => {
    expect(await store.findEscalationThread([], 'TPB', 'LEAD_ASSESSOR')).toEqual(
      [],
    );
  });
});

describe('the membership read joins the Lead step-3 row (FR-13, DD-T4)', () => {
  const access = resolveAccess(
    {
      assignments: [
        {
          roleCode: 'TPB',
          roleIsActive: true,
          isActive: true,
          revokedAt: null,
          resultTypeKey: null,
          programId: null,
        },
      ],
      programScope: [],
      exclusions: [],
    },
    ['TPB'],
    false,
  );
  const { sql: text } = store
    .buildMembershipQuery({
      timelineId: 7,
      resultCode: 1001,
      access,
      round: null,
      assessmentStepPosition: 1,
      roundTwoStepPositions: [3, 4],
    })
    .toSQL();

  it("joins the row at the timeline's lead_assessors step, with no bound value for the step", () => {
    expect(text).toContain(
      "left join `result_assessments` `lead_assessment` on (`lead_assessment`.`timeline_result_id` = `timeline_results`.`id` and `lead_assessment`.`step_position` = (SELECT `lead_step`.`position` FROM `timeline_steps` `lead_step` WHERE `lead_step`.`timeline_id` = `timeline_results`.`timeline_id` AND `lead_step`.`audience` = 'lead_assessors'))",
    );
  });

  it('reads the version the Lead pinned and who ended it', () => {
    expect(text).toContain('`lead_fcv`.`id`');
    expect(text).toContain('`lead_finisher`.`nickname`');
  });

  it("scopes the TPB with the Lead-escalated EXISTS", () => {
    expect(text).toContain("`lead_esc`.`status` = 'escalated'");
  });
});
