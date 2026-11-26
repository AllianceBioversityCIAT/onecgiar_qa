// @akili-spec admin/acts-as-reviewer
import { HttpInterceptorFn } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import type { Person } from './assessment.models';

/**
 * The QA Admin acting as a reviewer role (admin/acts-as-reviewer; front contract § 2.1 of
 * `docs/specs/assessment/step-1-assessment/front-contract.md`). The Admin picks a role on the review page of ONE
 * result; every assessment call of that result then carries `X-Acting-Role`, and the server builds the view and
 * accepts the writes as that role. With no pick there is no header and the Admin reads only, as before.
 *
 * Why an interceptor and not a parameter on each call: the header belongs to every assessment route of the
 * result (view, validations, comments, withdraw, decisions, delete, finish, quick comments), and a parameter would
 * change the signature of every `AssessmentApi` method and every caller. The pick lives in one root state and the
 * interceptor adds the header only to those routes, only for the result the pick was made on.
 */

/** The roles an Admin can act as today (TPB and PPU join when their steps exist). */
export type ActingRole = 'ASSESSOR' | 'LEAD_ASSESSOR';

export const ACTING_ROLE_HEADER = 'X-Acting-Role';

export const ACTING_ROLE_LABELS: Readonly<Record<ActingRole, string>> = {
  ASSESSOR: 'Assessor',
  LEAD_ASSESSOR: 'Lead Assessor',
};

export interface ActingPick {
  readonly timelineId: number;
  readonly resultCode: number;
  readonly role: ActingRole;
}

/** The Admin's pick for the result open on the review page; `null` = reading only. */
@Service()
export class ActingRoleState {
  private readonly current = signal<ActingPick | null>(null);
  readonly pick = this.current.asReadonly();

  /** Acts as `role` on this result from the next call on; `null` goes back to reading only. */
  set(timelineId: number, resultCode: number, role: ActingRole | null): void {
    this.current.set(role === null ? null : { timelineId, resultCode, role });
  }

  /** Drops a pick made on another result: a pick never travels to the next result opened. */
  keepOnly(timelineId: number, resultCode: number): void {
    const pick = this.current();
    if (pick && (pick.timelineId !== timelineId || pick.resultCode !== resultCode)) this.current.set(null);
  }

  clear(): void {
    this.current.set(null);
  }
}

const RESULT_ROUTE = /\/timelines\/(\d+)\/results\/(\d+)\/assessment(?:\/|$)/;
const COMMENT_ROUTE = /\/assessment-comments\/\d+\/(?:withdraw|delete)$/;
const QUICK_ROUTE = /\/quick-comments$/;

/**
 * The role to send with a request to `url`, or `null`. Only the assessment routes the server reads the header on:
 * the result's own routes (for the picked result only), withdraw and delete of a comment, and quick comments. Never
 * the program's responses, the clarification answer, the worklist or any other API.
 */
export function actingRoleFor(url: string, pick: ActingPick | null): ActingRole | null {
  if (pick === null) return null;
  const path = url.split('?')[0];
  const result = RESULT_ROUTE.exec(path);
  if (result) {
    return Number(result[1]) === pick.timelineId && Number(result[2]) === pick.resultCode ? pick.role : null;
  }
  return COMMENT_ROUTE.test(path) || QUICK_ROUTE.test(path) ? pick.role : null;
}

/** Adds `X-Acting-Role` to the assessment calls of the result the Admin picked a role on. */
export const actingRoleInterceptor: HttpInterceptorFn = (req, next) => {
  const role = actingRoleFor(req.url, inject(ActingRoleState).pick());
  return role === null || req.headers.has(ACTING_ROLE_HEADER)
    ? next(req)
    : next(req.clone({ setHeaders: { [ACTING_ROLE_HEADER]: role } }));
};

/**
 * A reviewer as reviewers and admins see them: by nickname, and "Admin" when a QA Admin wrote it acting as a role
 * (`admin: true`). Never used on the program's pages, which carry no author.
 */
export function reviewerLabel(person: Person | null | undefined, fallback = '—'): string {
  if (!person) return fallback;
  if (person.admin) return person.nickname ? `Admin · ${person.nickname}` : 'Admin';
  return person.nickname ?? fallback;
}
