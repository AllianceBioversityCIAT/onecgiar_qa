// @akili-spec assessment/ai-suggestions
import { AI_LEVEL_FIELDS } from '../../src/ai-suggestions/production.js';
import type { AiUsageMark } from '../../src/assessment/ai-suggestions-rules.js';
import type {
  AiUsageRow,
  AiUsageStore,
  MissingReasonsRow,
} from '../../src/assessment/ai-usage.store.js';
import type { InMemoryAssessmentWorld } from './in-memory-assessment.js';

/**
 * `ai_suggestion_usage` over an array, with the two unique keys of migration
 * 0010: (suggestion, membership, step, action) for every action but
 * `comment_saved`, and the comment id. The FR-11 count joins the world's
 * assessments and validations the way the Drizzle statement does.
 */
export class InMemoryAiUsageStore implements AiUsageStore {
  readonly rows: Array<AiUsageRow & { id: number }> = [];
  private nextId = 1;

  constructor(private readonly world: InMemoryAssessmentWorld) {}

  record(row: AiUsageRow): Promise<'inserted' | 'duplicate'> {
    const duplicate = this.rows.some((r) =>
      row.action === 'comment_saved'
        ? r.commentId != null && r.commentId === row.commentId
        : r.action === row.action &&
          r.suggestionId === row.suggestionId &&
          r.timelineResultId === row.timelineResultId &&
          r.stepPosition === row.stepPosition,
    );
    if (duplicate) return Promise.resolve('duplicate');
    this.rows.push({ ...row, id: this.nextId++ });
    return Promise.resolve('inserted');
  }

  marksFor(ids: readonly string[]): Promise<Map<string, AiUsageMark>> {
    const marks = new Map<string, AiUsageMark>();
    for (const r of [...this.rows].reverse()) {
      if (!ids.includes(r.suggestionId)) continue;
      if (r.action !== 'copied' && r.action !== 'comment_saved') continue;
      const mark = marks.get(r.suggestionId) ?? { copied: false, edited: null };
      if (r.action === 'copied') mark.copied = true;
      if (r.action === 'comment_saved' && mark.edited === null) {
        mark.edited = r.edited ?? null;
      }
      marks.set(r.suggestionId, mark);
    }
    return Promise.resolve(marks);
  }

  missingReasons(): Promise<MissingReasonsRow[]> {
    const out = new Map<string, MissingReasonsRow>();
    for (const s of this.rows) {
      if (s.action !== 'shown' || !AI_LEVEL_FIELDS.includes(s.fieldKey))
        continue;
      if (s.reportedLevel == null || s.aiLevel == null) continue;
      if (s.reportedLevel < s.aiLevel + 2) continue;
      const assessment = this.world.assessments.find(
        (a) =>
          a.membershipId === s.timelineResultId &&
          a.stepPosition === s.stepPosition,
      );
      if (assessment === undefined) continue;
      const validated = this.world.validations.some(
        (v) =>
          v.assessmentId === assessment.id &&
          v.fieldKey === s.fieldKey &&
          v.validated,
      );
      if (!validated) continue;
      const withReason = this.rows.some(
        (a) =>
          a.action === 'validated_above_ai' &&
          a.suggestionId === s.suggestionId &&
          a.timelineResultId === s.timelineResultId &&
          a.stepPosition === s.stepPosition,
      );
      const key = `${s.fieldKey}|${s.promptVersion}`;
      const entry = out.get(key) ?? {
        fieldKey: s.fieldKey,
        promptVersion: s.promptVersion,
        withReason: 0,
        withoutReason: 0,
      };
      if (withReason) entry.withReason += 1;
      else entry.withoutReason += 1;
      out.set(key, entry);
    }
    return Promise.resolve(
      [...out.values()].sort((a, b) =>
        `${a.fieldKey}|${a.promptVersion}` < `${b.fieldKey}|${b.promptVersion}`
          ? -1
          : 1,
      ),
    );
  }
}
