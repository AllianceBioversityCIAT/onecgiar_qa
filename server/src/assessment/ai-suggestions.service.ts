// @akili-spec assessment/ai-suggestions
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  eligibleFields,
  AI_ELIGIBLE_STATUS,
} from '../ai-suggestions/ai-config.js';
import {
  AI_SUGGESTION_STORE,
  type AiSuggestionItem,
  type AiSuggestionStore,
} from '../ai-suggestions/ai-suggestion.store.js';
import { productionFieldOf } from '../ai-suggestions/ai-config.js';
import { snapshotKeyOf } from '../ingestion/load-rules.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import {
  aiAudienceOf,
  checkAboveAi,
  isEdited,
  toSuggestionViews,
  type AiSignalValue,
  type AiSuggestionView,
} from './ai-suggestions-rules.js';
import {
  AiEventInvalidError,
  AiSuggestionNotFoundError,
  AiSuggestionsForbiddenError,
  AiSuggestionsUnavailableError,
} from './ai-suggestions.errors.js';
import {
  AI_USAGE_STORE,
  type AiUsageStore,
  type MissingReasonsRow,
} from './ai-usage.store.js';
import {
  AssessmentNotFoundError,
  AssessmentReadOnlyError,
} from './assessment.errors.js';
import { AssessmentService } from './assessment.service.js';
import { ASSESSMENT_STORE, type AssessmentStore } from './assessment.store.js';
import type { AiSuggestionEventBody } from './dto/ai-suggestion-event.body.js';

/**
 * The AI suggestion routes (ai-suggestions FR-4, FR-5, FR-8, FR-9, FR-11).
 * Scope and the 404 come from `AssessmentService.resolveForAi`; the audience
 * decides the rest. A suggestion is read from DynamoDB (one Query) and never
 * changes an assessment: the AI never validates or comments (AC6).
 *
 * Usage rows measure the AI, never the reviewers (NFR-3): they carry the role
 * and the membership, no user, and no route returns them per reviewer.
 */
@Injectable()
export class AiSuggestionsService {
  private readonly logger = new Logger(AiSuggestionsService.name);

  constructor(
    @Inject(AssessmentService) private readonly assessments: AssessmentService,
    @Inject(AI_SUGGESTION_STORE)
    private readonly suggestions: AiSuggestionStore,
    @Inject(AI_USAGE_STORE) private readonly usage: AiUsageStore,
    @Inject(ASSESSMENT_STORE) private readonly store: AssessmentStore,
  ) {}

  /** FR-4, FR-5, FR-9. */
  async list(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
  ): Promise<AiSuggestionView[]> {
    const context = await this.assessments.resolveForAi(
      user,
      timelineId,
      resultCode,
    );
    const audience = aiAudienceOf(context.access);
    if (audience.kind === 'forbidden') throw new AiSuggestionsForbiddenError();
    if (audience.kind === 'none') throw new AssessmentNotFoundError();
    // FR-1: an auto-validated or not-in-QA membership got no job.
    if (context.membership.status !== AI_ELIGIBLE_STATUS) return [];
    const fields = eligibleFields(context.config);
    if (fields.length === 0) return [];
    const items = await this.itemsOf(context.membership);
    const marks =
      audience.kind === 'tpb'
        ? await this.usage.marksFor(
            items
              .filter((item) => item.status === 'available')
              .map((item) => item.suggestionId),
          )
        : undefined;
    const defects: string[] = [];
    const views = toSuggestionViews(fields, items, marks, defects);
    if (defects.length > 0) {
      this.logger.warn(
        `ai_suggestion_shape_repaired membership=${context.membership.membershipId} suggestions=${defects.join(',')}`,
      );
    }
    return views;
  }

  /** FR-8: one usage event. Nothing is returned (204); a repeat is a no-op. */
  async record(
    user: AuthenticatedUser,
    timelineId: number,
    resultCode: number,
    suggestionId: string,
    event: AiSuggestionEventBody,
  ): Promise<void> {
    const context = await this.assessments.resolveForAi(
      user,
      timelineId,
      resultCode,
    );
    const audience = aiAudienceOf(context.access);
    if (audience.kind === 'forbidden') throw new AiSuggestionsForbiddenError();
    if (audience.kind === 'none') throw new AssessmentNotFoundError();
    // A TPB or an ADMIN reads; only a reviewer's use measures the AI.
    if (audience.kind !== 'reviewer') throw new AssessmentReadOnlyError();
    const stepPosition = context.stepPosition;
    if (stepPosition === null) throw new AssessmentNotFoundError();

    const items = await this.itemsOf(context.membership);
    const item = items.find((i) => i.suggestionId === suggestionId);
    if (
      item === undefined ||
      item.status !== 'available' ||
      !eligibleFields(context.config).includes(item.fieldKey)
    ) {
      throw new AiSuggestionNotFoundError();
    }

    const base = {
      suggestionId,
      timelineResultId: context.membership.membershipId,
      stepPosition,
      roleCode: audience.roleCode,
      fieldKey: item.fieldKey,
      promptVersion: item.promptVersion,
      signal: item.signal as AiSignalValue,
    };

    switch (event.action) {
      case 'shown':
        // The levels FR-11 compares are copied from the stored item, never from the client.
        await this.usage.record({
          ...base,
          action: 'shown',
          // Levels only: a category or use numbers (contract 2.0.0) has none.
          aiLevel: levelOrNull(item.suggestedValue),
          reportedLevel: levelOrNull(item.reportedValue),
        });
        return;
      case 'copied':
        await this.usage.record({ ...base, action: 'copied' });
        return;
      case 'comment_saved': {
        if (event.commentId == null) {
          throw new AiEventInvalidError('comment_id_required');
        }
        const comment = await this.store.findCommentContext(
          Number(event.commentId),
        );
        if (
          comment === null ||
          comment.timelineResultId !== context.membership.membershipId ||
          comment.stepPosition !== stepPosition ||
          comment.fieldKey !== item.fieldKey
        ) {
          throw new AiEventInvalidError('comment_not_of_field');
        }
        // Only whether it was edited is kept, never the text (NFR-2, NFR-3).
        await this.usage.record({
          ...base,
          action: 'comment_saved',
          commentId: comment.id,
          edited: isEdited(comment.body, item.explanation ?? ''),
        });
        return;
      }
      case 'validated_above_ai': {
        const refusal = checkAboveAi(item, {
          aiLevel: event.aiLevel!,
          validatedLevel: event.validatedLevel!,
          reason: event.reason!,
        });
        if (refusal !== null) throw new AiEventInvalidError(refusal);
        await this.usage.record({
          ...base,
          action: 'validated_above_ai',
          aiLevel: event.aiLevel!,
          validatedLevel: event.validatedLevel!,
          reason: event.reason!.trim(),
        });
        return;
      }
    }
  }

  /** FR-11: counts only. */
  async missingReasons(): Promise<{
    basis: 'shown';
    fields: MissingReasonsRow[];
  }> {
    return { basis: 'shown', fields: await this.usage.missingReasons() };
  }

  /** One Query on the membership's snapshot; a DynamoDB failure is a 503 (NFR-1). */
  private async itemsOf(membership: {
    resultCode: number;
    snapshotSk: string;
    membershipId: number;
  }): Promise<AiSuggestionItem[]> {
    try {
      return await this.suggestions.listForSnapshot(
        membership.resultCode,
        snapshotKeyOf(membership.snapshotSk),
        (fieldKey) => productionFieldOf(fieldKey)?.promptVersion,
      );
    } catch (error) {
      this.logger.error(
        `ai_suggestions_read_failed membership=${membership.membershipId} name=${(error as Error).name}`,
      );
      throw new AiSuggestionsUnavailableError(error);
    }
  }
}

/** An integer level (0–9) or null: indicative values are not levels. */
function levelOrNull(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9
    ? value
    : null;
}
