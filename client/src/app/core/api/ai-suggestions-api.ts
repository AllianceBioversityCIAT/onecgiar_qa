import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS } from '../http/request-context';
import { AiSuggestionEvent, AiSuggestionView } from './ai-suggestions.models';

/**
 * HTTP calls for the AI suggestions of a result (spec assessment/ai-suggestions). Only transport, no state.
 * Errors are silent: a failed read shows "Suggestion not available" on the field, never a toast (NFR-1).
 * Events stay out of the Unsent list: they measure the AI and must never block or replay a reviewer's work.
 */
@Service()
export class AiSuggestionsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  /** One view per AI-input field of the result: available, unavailable (with its reason) or pending. */
  list(timelineId: number, resultCode: number): Observable<readonly AiSuggestionView[]> {
    return this.http
      .get<ApiEnvelope<readonly AiSuggestionView[]>>(this.url(timelineId, resultCode), {
        context: silent(),
      })
      .pipe(unwrap<readonly AiSuggestionView[]>());
  }

  /** Records one use of a suggestion (204, a repeat is a no-op on the server). */
  sendEvent(
    timelineId: number,
    resultCode: number,
    suggestionId: string,
    event: AiSuggestionEvent,
  ): Observable<void> {
    return this.http
      .post(
        `${this.url(timelineId, resultCode)}/${encodeURIComponent(suggestionId)}/events`,
        event,
        {
          context: silent().set(NO_QUEUE, true),
        },
      )
      .pipe(map(() => undefined));
  }

  private url(timelineId: number, resultCode: number): string {
    return `${this.base}/timelines/${timelineId}/results/${resultCode}/ai-suggestions`;
  }
}

function silent(): HttpContext {
  return new HttpContext().set(SILENT_ERRORS, true);
}
