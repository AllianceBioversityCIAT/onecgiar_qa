// @akili-spec assessment/step-1-assessment
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import { ASSESSMENT_ERROR, AssessmentView } from '../../../core/api/assessment.models';
import { toApiError } from '../../../core/http/api-envelope';
import { toReviewVm } from './review.mapper';

export type ReviewLoadState = 'loading' | 'ready' | 'error';

export interface ReviewError {
  readonly code: string;
  /** Catalog text, safe to show as is. */
  readonly message: string;
}

const NOT_FOUND: ReviewError = {
  code: ASSESSMENT_ERROR.NOT_FOUND,
  message: 'This result does not exist or is not in your scope.',
};
const NO_TIMELINE: ReviewError = {
  code: ASSESSMENT_ERROR.TIMELINES_NOT_FOUND,
  message: 'You are not assigned to any timeline yet, so there is no assessment to open.',
};

/**
 * State of the Review page (provided by the view). Reads the assessment of one result on one timeline
 * (`/results/:code?timeline=:id`). With no timeline in the URL it opens the caller's default timeline.
 */
@Injectable()
export class ReviewStore {
  private readonly api = inject(AssessmentApi);

  readonly state = signal<ReviewLoadState>('loading');
  readonly error = signal<ReviewError | null>(null);
  readonly view = signal<AssessmentView | null>(null);
  readonly timelineId = signal<number | null>(null);
  readonly resultCode = signal<number | null>(null);
  /** The page's view models, rebuilt from the API answer only (never by hand). */
  readonly vm = computed(() => {
    const view = this.view();
    return view ? toReviewVm(view) : null;
  });

  /** Only the newest load writes its answer (a quick switch of result never shows an older one). */
  private seq = 0;

  /** `code` and `timeline` as the URL carries them. */
  async load(code: string | null, timeline: string | null): Promise<void> {
    const seq = ++this.seq;
    this.state.set('loading');
    this.error.set(null);
    const resultCode = positiveInt(code);
    if (resultCode === null) return this.fail(seq, NOT_FOUND);
    try {
      let timelineId = positiveInt(timeline);
      if (timelineId === null) {
        timelineId = (await firstValueFrom(this.api.timelines())).defaultTimelineId;
        if (seq !== this.seq) return;
        if (timelineId === null) return this.fail(seq, NO_TIMELINE);
      }
      const view = await firstValueFrom(this.api.view(timelineId, resultCode));
      if (seq !== this.seq) return;
      this.timelineId.set(timelineId);
      this.resultCode.set(resultCode);
      this.view.set(view);
      this.state.set('ready');
    } catch (error) {
      const e = toApiError(error);
      this.fail(seq, { code: e.code, message: e.message });
    }
  }

  /** Retry after an error, with the same URL values. */
  retry(code: string | null, timeline: string | null): Promise<void> {
    return this.load(code, timeline);
  }

  private fail(seq: number, error: ReviewError): void {
    if (seq !== this.seq) return;
    this.view.set(null);
    this.error.set(error);
    this.state.set('error');
  }
}

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}
