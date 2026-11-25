// @akili-spec assessment/ai-suggestions
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it, vi } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DrizzleAiUsageStore } from './ai-usage.store.js';

// No database answers: the FR-11 statement is read through `toSQL()`, and
// `record` is driven over a stub insert.

const mock = drizzle.mock() as unknown as DrizzleDB;

describe('DrizzleAiUsageStore', () => {
  it('FR-11: one statement over shown rows of IRL/IUL 2+ above, joined to a validated field of the same membership and step, grouped by field and version', () => {
    const { sql: text, params } = new DrizzleAiUsageStore(mock)
      .buildMissingReasons()
      .toSQL();
    expect(text).toContain('inner join `result_assessments`');
    expect(text).toContain('inner join `assessment_field_validations`');
    expect(text).toContain('left join `ai_suggestion_usage` `above`');
    expect(text).toMatch(
      /`reported_level` >= `ai_suggestion_usage`.`ai_level` \+ 2|>= .*`ai_level` \+ 2/,
    );
    expect(text).toMatch(
      /group by `ai_suggestion_usage`.`field_key`, `ai_suggestion_usage`.`prompt_version`/,
    );
    expect(params).toEqual(
      expect.arrayContaining([
        'shown',
        'validated_above_ai',
        'innovation_dev.readiness_level',
        'innovation_use.use_level.innovation_use_level',
      ]),
    );
    // Counts only: no membership, assessment or user column is selected.
    const select = text.slice(0, text.indexOf(' from '));
    expect(select).not.toMatch(/timeline_result_id|assessment_id|user|author/);
  });

  it('a duplicate key is `duplicate`, nothing thrown', async () => {
    const dup = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const db = {
      insert: () => ({ values: vi.fn().mockRejectedValue(dup) }),
    } as unknown as DrizzleDB;
    const result = await new DrizzleAiUsageStore(db).record({
      suggestionId: 'a'.repeat(32),
      timelineResultId: 1,
      stepPosition: 1,
      roleCode: 'ASSESSOR',
      fieldKey: 'general.gender_tag',
      promptVersion: 'v2-1.0.0',
      signal: 'green',
      action: 'shown',
    });
    expect(result).toBe('duplicate');
  });

  it('any other error is thrown', async () => {
    const db = {
      insert: () => ({ values: vi.fn().mockRejectedValue(new Error('boom')) }),
    } as unknown as DrizzleDB;
    await expect(
      new DrizzleAiUsageStore(db).record({
        suggestionId: 'a'.repeat(32),
        timelineResultId: 1,
        stepPosition: 1,
        roleCode: 'ASSESSOR',
        fieldKey: 'general.gender_tag',
        promptVersion: 'v2-1.0.0',
        signal: 'green',
        action: 'copied',
      }),
    ).rejects.toThrow('boom');
  });
});
