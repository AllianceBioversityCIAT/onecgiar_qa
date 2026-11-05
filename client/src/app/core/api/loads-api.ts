import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { LoadDetail, LoadItem, LoadPreview, LoadStarted } from './loads.models';

/**
 * HTTP calls for step-1 loads of a QA timeline (ADMIN only). Only transport, no state.
 * The start carries the interceptor's `Idempotency-Key`: a repeat of the same key returns the same load
 * and starts no second one. It stays out of the Unsent list: the admin is watching the drawer, and a load
 * replayed later (window closed by then) would surprise; a lost answer goes back to the drawer, which offers
 * "Try again" (the server also refuses a second live load in the cycle).
 */
@Service()
export class LoadsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  /** What a load would bring in now (an estimate). Writes nothing. */
  preview(timelineId: number): Observable<LoadPreview> {
    return this.http
      .get<ApiEnvelope<LoadPreview>>(`${this.base}/timelines/${timelineId}/loads/preview`, { context: silent() })
      .pipe(unwrap<LoadPreview>());
  }

  start(timelineId: number, name: string): Observable<LoadStarted> {
    const context = silent().set(UNSENT_LABEL, `Load results into ${name}`).set(NO_QUEUE, true);
    return this.http
      .post<ApiEnvelope<LoadStarted>>(`${this.base}/timelines/${timelineId}/loads`, {}, { context })
      .pipe(unwrap<LoadStarted>());
  }

  /** Loads of the timeline, newest first (poll it every 2 s while the newest is `running`). */
  list(timelineId: number): Observable<readonly LoadItem[]> {
    return this.http
      .get<ApiEnvelope<readonly LoadItem[]>>(`${this.base}/timelines/${timelineId}/loads`, { context: silent() })
      .pipe(unwrap<readonly LoadItem[]>());
  }

  /** One load with its `summary` (read once when it ends). */
  get(timelineId: number, loadId: number): Observable<LoadDetail> {
    return this.http
      .get<ApiEnvelope<LoadDetail>>(`${this.base}/timelines/${timelineId}/loads/${loadId}`, { context: silent() })
      .pipe(unwrap<LoadDetail>());
  }
}

function silent(): HttpContext {
  return new HttpContext().set(SILENT_ERRORS, true);
}
