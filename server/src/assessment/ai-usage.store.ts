// @akili-spec assessment/ai-suggestions
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { isDuplicateKeyError } from '../common/idempotency/idempotency.errors.js';
import { AI_LEVEL_FIELDS } from '../ai-suggestions/production.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  aiSuggestionUsage,
  type AiSignal,
  type AiUsageAction,
} from '../database/drizzle/schema/ai-suggestion-usage.js';
import { assessmentFieldValidations } from '../database/drizzle/schema/assessment-field-validations.js';
import { resultAssessments } from '../database/drizzle/schema/result-assessments.js';
import type { AiUsageMark } from './ai-suggestions-rules.js';

export const AI_USAGE_STORE = Symbol('AI_USAGE_STORE');

/** One usage row (design § 3). No user: it measures the AI (NFR-3). */
export interface AiUsageRow {
  suggestionId: string;
  timelineResultId: number;
  stepPosition: number;
  roleCode: string;
  fieldKey: string;
  promptVersion: string;
  signal: AiSignal;
  action: AiUsageAction;
  commentId?: number | null;
  edited?: boolean | null;
  aiLevel?: number | null;
  reportedLevel?: number | null;
  validatedLevel?: number | null;
  reason?: string | null;
}

/** FR-11: per field and prompt version, counts only. */
export interface MissingReasonsRow {
  fieldKey: string;
  promptVersion: string;
  withReason: number;
  withoutReason: number;
}

export interface AiUsageStore {
  /** One INSERT. A row the unique keys already hold is `duplicate`, nothing written (FR-8 dedupe). */
  record(row: AiUsageRow): Promise<'inserted' | 'duplicate'>;
  /** FR-9, one statement: per suggestion, whether it was copied and the `edited` of its last `comment_saved`. */
  marksFor(suggestionIds: readonly string[]): Promise<Map<string, AiUsageMark>>;
  /** FR-11, one statement. */
  missingReasons(): Promise<MissingReasonsRow[]>;
}

const u = aiSuggestionUsage;

@Injectable()
export class DrizzleAiUsageStore implements AiUsageStore {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async record(row: AiUsageRow): Promise<'inserted' | 'duplicate'> {
    try {
      await this.db.insert(u).values({
        suggestionId: row.suggestionId,
        timelineResultId: row.timelineResultId,
        stepPosition: row.stepPosition,
        roleCode: row.roleCode,
        fieldKey: row.fieldKey,
        promptVersion: row.promptVersion,
        signal: row.signal,
        action: row.action,
        commentId: row.commentId ?? null,
        edited: row.edited ?? null,
        aiLevel: row.aiLevel ?? null,
        reportedLevel: row.reportedLevel ?? null,
        validatedLevel: row.validatedLevel ?? null,
        reason: row.reason ?? null,
      });
      return 'inserted';
    } catch (error) {
      if (isDuplicateKeyError(error)) return 'duplicate';
      throw error;
    }
  }

  async marksFor(
    suggestionIds: readonly string[],
  ): Promise<Map<string, AiUsageMark>> {
    const marks = new Map<string, AiUsageMark>();
    if (suggestionIds.length === 0) return marks;
    const rows = await this.db
      .select({
        suggestionId: u.suggestionId,
        action: u.action,
        edited: u.edited,
      })
      .from(u)
      .where(
        and(
          inArray(u.suggestionId, [...suggestionIds]),
          inArray(u.action, ['copied', 'comment_saved']),
        ),
      )
      .orderBy(desc(u.id));
    for (const row of rows) {
      const mark = marks.get(row.suggestionId) ?? {
        copied: false,
        edited: null,
      };
      if (row.action === 'copied') mark.copied = true;
      // Newest first: the first `comment_saved` seen is the last one saved.
      if (row.action === 'comment_saved' && mark.edited === null) {
        mark.edited = row.edited ?? null;
      }
      marks.set(row.suggestionId, mark);
    }
    return marks;
  }

  /** The FR-11 statement; public so a spec can read its SQL. */
  buildMissingReasons() {
    const above = alias(u, 'above');
    return this.db
      .select({
        fieldKey: u.fieldKey,
        promptVersion: u.promptVersion,
        withReason: sql<string>`sum(case when ${above.id} is null then 0 else 1 end)`,
        withoutReason: sql<string>`sum(case when ${above.id} is null then 1 else 0 end)`,
      })
      .from(u)
      .innerJoin(
        resultAssessments,
        and(
          eq(resultAssessments.timelineResultId, u.timelineResultId),
          eq(resultAssessments.stepPosition, u.stepPosition),
        ),
      )
      .innerJoin(
        assessmentFieldValidations,
        and(
          eq(assessmentFieldValidations.assessmentId, resultAssessments.id),
          eq(assessmentFieldValidations.fieldKey, u.fieldKey),
          eq(assessmentFieldValidations.validated, true),
        ),
      )
      .leftJoin(
        above,
        and(
          eq(above.suggestionId, u.suggestionId),
          eq(above.timelineResultId, u.timelineResultId),
          eq(above.stepPosition, u.stepPosition),
          eq(above.action, 'validated_above_ai'),
        ),
      )
      .where(
        and(
          eq(u.action, 'shown'),
          inArray(u.fieldKey, [...AI_LEVEL_FIELDS]),
          sql`${u.reportedLevel} >= ${u.aiLevel} + 2`,
        ),
      )
      .groupBy(u.fieldKey, u.promptVersion)
      .orderBy(u.fieldKey, u.promptVersion);
  }

  async missingReasons(): Promise<MissingReasonsRow[]> {
    const rows = await this.buildMissingReasons();
    return rows.map((row) => ({
      fieldKey: row.fieldKey,
      promptVersion: row.promptVersion,
      withReason: Number(row.withReason),
      withoutReason: Number(row.withoutReason),
    }));
  }
}
