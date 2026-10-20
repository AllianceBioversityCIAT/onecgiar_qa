import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { EMPTY, Observable, expand, reduce } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, ApiPage, unwrap, unwrapPage } from '../http/api-envelope';
import { NO_QUEUE, SILENT_ERRORS, TIMEOUT_MS, UNSENT_LABEL } from '../http/request-context';
import {
  AllOr,
  CreateUserBody,
  EditUserBody,
  ListUsersQuery,
  RoleGrant,
  UserDetail,
  UserSummary,
} from './users.models';

/** Largest page the API serves (`limit` 1–200). */
const MAX_PAGE = 200;
/** Creating reads Reporting + CLARISA (cold cache) and then calls Cognito: it can take well over 20 s (Juanda, 20-oct-2026). */
const CREATE_TIMEOUT_MS = 60_000;

/**
 * HTTP calls of the user-management API (`/api/v1/users`, ADMIN only). Only transport, no state.
 * Writes are silent (the drawer shows field errors and conflicts inline) and carry a label for the
 * Unsent list. Until the server honors `Idempotency-Key` (Juanda's spec `users-admin-write-safety`),
 * only the writes that are safe to repeat go to the unsent queue: PATCH, PUT roles / programs,
 * deactivate, activate. Create (a repeat answers 409 EMAIL_TAKEN), exclusions (409 / 404) and the
 * invitation (every repeat sends another Cognito email) are never replayed.
 */
@Service()
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_CONFIG).apiBaseUrl}/users`;

  list(query: ListUsersQuery = {}): Observable<ApiPage<UserSummary>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<ApiEnvelope<readonly UserSummary[]>>(this.base, { params }).pipe(unwrapPage<UserSummary>());
  }

  /** Every page of the list, in order (the team is small: tens of people, see design D1). */
  listAll(query: Omit<ListUsersQuery, 'cursor' | 'limit'> = {}): Observable<readonly UserSummary[]> {
    return this.list({ ...query, limit: MAX_PAGE }).pipe(
      expand((page) => (page.nextCursor ? this.list({ ...query, limit: MAX_PAGE, cursor: page.nextCursor }) : EMPTY)),
      reduce((all, page) => [...all, ...page.items], [] as readonly UserSummary[]),
    );
  }

  get(id: number): Observable<UserDetail> {
    return this.http.get<ApiEnvelope<UserDetail>>(`${this.base}/${id}`).pipe(unwrap<UserDetail>());
  }

  create(body: CreateUserBody): Observable<UserDetail> {
    const context = this.silent(`Invite ${body.email}`).set(NO_QUEUE, true).set(TIMEOUT_MS, CREATE_TIMEOUT_MS);
    return this.http.post<ApiEnvelope<UserDetail>>(this.base, body, { context }).pipe(unwrap<UserDetail>());
  }

  edit(id: number, body: EditUserBody, who: string): Observable<UserDetail> {
    return this.write('PATCH', `${this.base}/${id}`, body, `Edit ${who}`);
  }

  setRoles(id: number, roles: readonly RoleGrant[], who: string): Observable<UserDetail> {
    return this.write('PUT', `${this.base}/${id}/roles`, { roles }, `Roles of ${who}`);
  }

  setPrograms(id: number, programs: AllOr<number>, who: string): Observable<UserDetail> {
    return this.write('PUT', `${this.base}/${id}/programs`, { programs }, `Programs of ${who}`);
  }

  addExclusion(id: number, programId: number, reason: string, who: string): Observable<UserDetail> {
    return this.write('POST', `${this.base}/${id}/exclusions`, { programId, reason }, `Block a program for ${who}`, false);
  }

  removeExclusion(id: number, exclusionId: number, who: string): Observable<UserDetail> {
    return this.write('DELETE', `${this.base}/${id}/exclusions/${exclusionId}`, null, `Unblock a program for ${who}`, false);
  }

  dismissExclusion(id: number, exclusionId: number, reason: string, who: string): Observable<UserDetail> {
    return this.write('POST', `${this.base}/${id}/exclusions/${exclusionId}/dismiss`, { reason }, `Dismiss a block for ${who}`, false);
  }

  deactivate(id: number, who: string): Observable<UserDetail> {
    return this.write('POST', `${this.base}/${id}/deactivate`, null, `Remove ${who} from the team`);
  }

  activate(id: number, who: string): Observable<UserDetail> {
    return this.write('POST', `${this.base}/${id}/activate`, null, `Bring ${who} back`);
  }

  resendInvitation(id: number, who: string): Observable<UserDetail> {
    return this.write('POST', `${this.base}/${id}/invitation`, null, `Resend the invitation to ${who}`, false);
  }

  /** `replayable = false`: a lost answer is shown to the user instead of going to the unsent queue. */
  private write(method: string, url: string, body: unknown, label: string, replayable = true): Observable<UserDetail> {
    const context = this.silent(label).set(NO_QUEUE, !replayable);
    return this.http
      .request<ApiEnvelope<UserDetail>>(method, url, { body, context })
      .pipe(unwrap<UserDetail>());
  }

  private silent(label: string): HttpContext {
    return new HttpContext().set(SILENT_ERRORS, true).set(UNSENT_LABEL, label);
  }
}
