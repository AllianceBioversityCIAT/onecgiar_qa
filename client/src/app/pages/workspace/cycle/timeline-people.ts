import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { CyclesApi } from '../../../core/api/cycles-api';
import { AssignableRole, CYCLE_ERROR, TimelineUser } from '../../../core/api/cycles.models';
import { UsersApi } from '../../../core/api/users-api';
import { UserSummary } from '../../../core/api/users.models';
import { toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { assignedByRole, candidatesFor, peopleSummary, personName } from './timeline-people.logic';

export type PeopleLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * People of one timeline (provided by the People drawer): who is assigned per role, and the active
 * team to pick from. Reads `GET /timelines/:id` (its `users[]`) and the team list; writes go through
 * `POST /timelines/:id/users` and `DELETE /timelines/:id/users/:assignmentId` (front contract § 3–4).
 */
@Injectable()
export class TimelinePeople {
  private readonly cycles = inject(CyclesApi);
  private readonly usersApi = inject(UsersApi);
  private readonly toasts = inject(Toasts);

  readonly state = signal<PeopleLoadState>('idle');
  readonly loadError = signal('');
  private readonly timelineId = signal<number | null>(null);
  private readonly assigned = signal<readonly TimelineUser[]>([]);
  private readonly team = signal<readonly UserSummary[]>([]);
  /** Rows and roles with a write on its way: their buttons spin and a second tap does nothing. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Last problem per role ("ASSESSOR": "…"), shown under that block until the next try. */
  readonly roleError = signal<Readonly<Partial<Record<AssignableRole, string>>>>({});
  /** Only the newest load paints (reopening the drawer on another timeline never shows the old one). */
  private loadSeq = 0;

  readonly byRole = computed(() => assignedByRole(this.assigned()));
  readonly summary = computed(() => peopleSummary(this.assigned()));

  candidates(role: AssignableRole): readonly UserSummary[] {
    return candidatesFor(role, this.team(), this.assigned());
  }

  async load(timelineId: number): Promise<void> {
    const seq = ++this.loadSeq;
    this.timelineId.set(timelineId);
    this.state.set('loading');
    this.roleError.set({});
    try {
      const [detail, team] = await firstValueFrom(forkJoin([this.cycles.timeline(timelineId), this.usersApi.listAll({ status: 'active' })]));
      if (seq !== this.loadSeq) return;
      this.assigned.set(detail.users);
      this.team.set(team);
      this.state.set('ready');
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.loadError.set(toApiError(error).message);
      this.state.set('error');
    }
  }

  /** True when something changed on the server (the view refreshes the timeline counts). */
  async assign(role: AssignableRole, userId: number): Promise<boolean> {
    const id = this.timelineId();
    const person = this.team().find((u) => u.id === userId);
    const key = `add:${role}`;
    if (id == null || !person || this.busy().has(key)) return false;
    this.setBusy(key, true);
    this.clearError(role);
    try {
      const saved = await firstValueFrom(this.cycles.assign(id, userId, role, personName(person)));
      if (id !== this.timelineId()) return true;
      // 200 = already assigned (same body): keep one row per assignment.
      this.assigned.update((list) => [...list.filter((u) => u.assignmentId !== saved.assignmentId), saved]);
      this.toasts.success(`${personName(saved)} was added.`);
      return true;
    } catch (error) {
      const e = toApiError(error);
      this.setError(role, e.code === CYCLE_ERROR.TIMELINES_USER_NOT_ELIGIBLE ? `${personName(person)} is inactive or no longer holds this role.` : e.message);
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  async remove(user: TimelineUser): Promise<boolean> {
    const id = this.timelineId();
    const key = `remove:${user.assignmentId}`;
    if (id == null || this.busy().has(key)) return false;
    this.setBusy(key, true);
    this.clearError(user.role);
    try {
      await firstValueFrom(this.cycles.unassign(id, user.assignmentId, personName(user)));
      this.drop(id, user);
      this.toasts.success(`${personName(user)} was removed.`);
      return true;
    } catch (error) {
      const e = toApiError(error);
      // Already removed (another tab, or a replay): the screen catches up instead of showing an error.
      if (e.code === CYCLE_ERROR.TIMELINES_ASSIGNMENT_NOT_FOUND) {
        this.drop(id, user);
        return true;
      }
      this.setError(user.role, e.message);
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  private drop(id: number, user: TimelineUser): void {
    if (id === this.timelineId()) this.assigned.update((list) => list.filter((u) => u.assignmentId !== user.assignmentId));
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private setError(role: AssignableRole, message: string): void {
    this.roleError.update((m) => ({ ...m, [role]: message }));
  }

  private clearError(role: AssignableRole): void {
    this.roleError.update(({ [role]: _gone, ...rest }) => rest);
  }
}
