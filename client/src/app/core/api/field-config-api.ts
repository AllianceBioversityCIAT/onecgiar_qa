import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { FieldConfigEdit, FieldConfigPreview, FieldConfigPublishResult, FieldConfigView } from './field-config.models';

/**
 * HTTP calls for the field configuration of a cycle (ADMIN only). Only transport, no state.
 * Edit and discard never go to the Unsent list: a late replay of an old option set (or of a
 * discard) would overwrite newer edits. The screen reverts the click and says so instead.
 * Publish may be queued: the server refuses a replay whose `revision` is no longer current (409).
 */
@Service()
export class FieldConfigApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  /** Silent: the screen shows its own states (no catalog, could not load). */
  view(cycleId: number): Observable<FieldConfigView> {
    return this.http
      .get<ApiEnvelope<FieldConfigView>>(this.url(cycleId), { context: new HttpContext().set(SILENT_ERRORS, true) })
      .pipe(unwrap<FieldConfigView>());
  }

  /** Each item is the whole option set of one field (a flag left out is stored false). Answers the new view. */
  editDraft(cycleId: number, items: readonly FieldConfigEdit[]): Observable<FieldConfigView> {
    return this.http
      .patch<ApiEnvelope<FieldConfigView>>(`${this.url(cycleId)}/draft`, { items }, {
        context: this.silent(items.length === 1 ? 'Change a field in QA' : `Change ${items.length} fields in QA`).set(NO_QUEUE, true),
      })
      .pipe(unwrap<FieldConfigView>());
  }

  /** Back to the latest published version (or nothing classified before the first one). */
  discardDraft(cycleId: number): Observable<FieldConfigView> {
    return this.http
      .delete<ApiEnvelope<FieldConfigView>>(`${this.url(cycleId)}/draft`, { context: this.silent('Discard the field changes').set(NO_QUEUE, true) })
      .pipe(unwrap<FieldConfigView>());
  }

  preview(cycleId: number): Observable<FieldConfigPreview> {
    return this.http
      .get<ApiEnvelope<FieldConfigPreview>>(`${this.url(cycleId)}/publish-preview`)
      .pipe(unwrap<FieldConfigPreview>());
  }

  /** `revision` = the preview's, the one the admin reviewed. 201. */
  publish(cycleId: number, revision: number): Observable<FieldConfigPublishResult> {
    return this.http
      .post<ApiEnvelope<FieldConfigPublishResult>>(`${this.url(cycleId)}/publish`, { revision }, {
        context: this.silent('Publish the fields in QA'),
      })
      .pipe(unwrap<FieldConfigPublishResult>());
  }

  private url(cycleId: number): string {
    return `${this.base}/cycles/${cycleId}/field-config`;
  }

  private silent(label: string): HttpContext {
    return new HttpContext().set(SILENT_ERRORS, true).set(UNSENT_LABEL, label);
  }
}
