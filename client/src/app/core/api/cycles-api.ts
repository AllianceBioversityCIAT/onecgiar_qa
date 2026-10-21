import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { AssignableRole, Cycle, DefaultStep, Timeline, TimelineCreate, TimelineDetail, TimelineUser } from './cycles.models';

/**
 * HTTP calls for cycles and QA timelines (ADMIN only). Only transport, no state.
 * Creates honor `Idempotency-Key` (the interceptor sends one per submit), so a lost answer may be
 * replayed from the Unsent list. Activate has no key: it closes the active cycle, so a lost answer
 * goes back to the screen, which refetches. Assign answers 200 when the user already holds that
 * role (nothing written), so replaying it is safe; remove is 404 once done.
 */
@Service()
export class CyclesApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBaseUrl;

  list(): Observable<readonly Cycle[]> {
    return this.http.get<ApiEnvelope<readonly Cycle[]>>(`${this.base}/cycles`).pipe(unwrap<readonly Cycle[]>());
  }

  create(year: number): Observable<Cycle> {
    return this.http
      .post<ApiEnvelope<Cycle>>(`${this.base}/cycles`, { year }, { context: this.silent(`Create the ${year} cycle`) })
      .pipe(unwrap<Cycle>());
  }

  /** Closes the currently active cycle in the same operation: confirm that before calling. */
  activate(cycle: Pick<Cycle, 'id' | 'name'>): Observable<Cycle> {
    const context = this.silent(`Activate ${cycle.name}`).set(NO_QUEUE, true);
    return this.http
      .post<ApiEnvelope<Cycle>>(`${this.base}/cycles/${cycle.id}/activate`, null, { context })
      .pipe(unwrap<Cycle>());
  }

  /** Proposal to pre-fill a new timeline; the admin may rename, drop, re-date or regroup. */
  defaults(): Observable<readonly DefaultStep[]> {
    return this.http
      .get<ApiEnvelope<readonly DefaultStep[]>>(`${this.base}/timeline-defaults`)
      .pipe(unwrap<readonly DefaultStep[]>());
  }

  /** Official first, then newest first. */
  timelines(cycleId: number): Observable<readonly Timeline[]> {
    return this.http
      .get<ApiEnvelope<readonly Timeline[]>>(`${this.base}/cycles/${cycleId}/timelines`)
      .pipe(unwrap<readonly Timeline[]>());
  }

  createTimeline(cycleId: number, body: TimelineCreate): Observable<Timeline> {
    return this.http
      .post<ApiEnvelope<Timeline>>(`${this.base}/cycles/${cycleId}/timelines`, body, {
        context: this.silent(`Create the timeline ${body.name}`),
      })
      .pipe(unwrap<Timeline>());
  }

  timeline(id: number): Observable<TimelineDetail> {
    return this.http.get<ApiEnvelope<TimelineDetail>>(`${this.base}/timelines/${id}`).pipe(unwrap<TimelineDetail>());
  }

  /** 201 new or 200 already assigned: both are success. */
  assign(timelineId: number, userId: number, role: AssignableRole, who: string): Observable<TimelineUser> {
    return this.http
      .post<ApiEnvelope<TimelineUser>>(`${this.base}/timelines/${timelineId}/users`, { userId, role }, {
        context: this.silent(`Assign ${who} to the timeline`),
      })
      .pipe(unwrap<TimelineUser>());
  }

  /** 204: history is kept; assigning again later creates a new assignment. */
  unassign(timelineId: number, assignmentId: number, who: string): Observable<void> {
    return this.http
      .delete<null>(`${this.base}/timelines/${timelineId}/users/${assignmentId}`, {
        context: this.silent(`Remove ${who} from the timeline`),
      })
      .pipe(unwrap<void>());
  }

  private silent(label: string): HttpContext {
    return new HttpContext().set(SILENT_ERRORS, true).set(UNSENT_LABEL, label);
  }
}
