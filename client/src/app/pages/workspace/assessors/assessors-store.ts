import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { UsersApi } from '../../../core/api/users-api';
import { USERS_ERROR, UserDetail, UserSummary } from '../../../core/api/users.models';
import { CLIENT_ERROR, toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { TeamMember, TeamRole } from './assessors.models';
import { TeamCatalogs, accountTypeFor, programIdOf, programsFor, rolesFor, sameGrants, toMember } from './assessors.mapper';

export type LoadState = 'loading' | 'ready' | 'error';

/** Form fields a server answer can point at. */
export type PersonField = 'firstName' | 'lastName' | 'email' | 'nick' | 'role' | 'types' | 'programs' | 'blocked';

export type SaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly field?: PersonField };

export interface PersonInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly nick: string;
  readonly role: TeamRole;
  readonly lead: boolean;
  readonly types: readonly string[];
  readonly programs: readonly string[];
  readonly blocked: readonly { readonly code: string; readonly reason: string; readonly id?: number }[];
}

const CODE_FIELD: Readonly<Record<string, PersonField>> = {
  [USERS_ERROR.EMAIL_TAKEN]: 'email',
  [USERS_ERROR.NICKNAME_TAKEN]: 'nick',
  [USERS_ERROR.NAME_LOCKED]: 'firstName',
  [USERS_ERROR.ROLE_CONFLICT]: 'role',
  [USERS_ERROR.LAST_ADMIN]: 'role',
  [USERS_ERROR.EXCLUSION_EXISTS]: 'blocked',
};

/** Server field path (`roles[0].resultTypes`, `exclusions[1].reason`) → form field. */
function fieldOfPath(path: string): PersonField | undefined {
  if (path === 'nickname') return 'nick';
  if (path === 'email' || path === 'firstName' || path === 'lastName') return path;
  if (path.startsWith('roles')) return path.includes('resultTypes') ? 'types' : 'role';
  if (path.startsWith('programs')) return 'programs';
  if (path.startsWith('exclusions') || path === 'programId' || path === 'reason') return 'blocked';
  return undefined;
}

function failure(error: unknown): SaveOutcome & { ok: false } {
  const e = toApiError(error);
  const first = e.fields[0];
  return { ok: false, message: first?.message ?? e.message, field: CODE_FIELD[e.code] ?? (first ? fieldOfPath(first.field) : undefined) };
}

/** An Assessor with no result type would be saved with no role at all (every grant revoked). */
function assessorWithoutTypes(input: PersonInput): SaveOutcome | null {
  return input.role === 'Assessor' && !input.types.length
    ? { ok: false, field: 'types', message: 'Pick at least one result type for an assessor.' }
    : null;
}

/**
 * State and actions of the Assessors view (provided by the view, shared with its drawer and cells).
 * The whole team is loaded at once and filtered on the client (design D1). Every write answers the
 * full user, so the row is replaced with what the server holds after each call.
 */
@Injectable()
export class AssessorsStore {
  private readonly users = inject(UsersApi);
  private readonly catalogsApi = inject(CatalogsApi);
  private readonly toasts = inject(Toasts);

  private readonly members = signal<readonly TeamMember[]>([]);
  private readonly removedMembers = signal<readonly TeamMember[] | null>(null);
  private readonly catalogState = signal<TeamCatalogs>({ types: [], programs: [] });

  readonly state = signal<LoadState>('loading');
  readonly loadError = signal('');
  readonly team = this.members.asReadonly();
  /** People removed from the team (loaded on demand). */
  readonly removed = this.removedMembers.asReadonly();
  readonly catalogs = this.catalogState.asReadonly();
  readonly typeNames = computed(() => this.catalogState().types.map((t) => t.name));
  readonly programCodes = computed(() => this.catalogState().programs.map((p) => p.code));
  /** Rows with an inline save in flight: their cells are locked so two quick clicks never race. */
  private readonly busyRows = signal<ReadonlySet<string>>(new Set());

  isBusy(id: string): boolean {
    return this.busyRows().has(id);
  }

  programName(code: string): string {
    return this.catalogState().programs.find((p) => p.code === code)?.name ?? '';
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const { types, programs, team } = await firstValueFrom(
        forkJoin({ types: this.catalogsApi.resultTypes(), programs: this.catalogsApi.sciencePrograms(), team: this.users.listAll() }),
      );
      this.catalogState.set({ types, programs });
      this.members.set(this.toMembers(team));
      this.state.set('ready');
    } catch (error) {
      this.loadError.set(toApiError(error).message);
      this.state.set('error');
    }
  }

  async loadRemoved(): Promise<void> {
    try {
      this.removedMembers.set(this.toMembers(await firstValueFrom(this.users.listAll({ status: 'inactive' }))));
    } catch (error) {
      this.toasts.error(toApiError(error).message);
    }
  }

  find(id: string): TeamMember | undefined {
    return this.members().find((m) => m.id === id) ?? this.removedMembers()?.find((m) => m.id === id);
  }

  /** Email of an invite whose answer never came (it may have been created anyway). */
  private unconfirmedInvite: string | null = null;

  async invite(input: PersonInput): Promise<SaveOutcome> {
    const noTypes = assessorWithoutTypes(input);
    if (noTypes) return noTypes;
    const cat = this.catalogState();
    const blocked = input.blocked.filter((b) => b.code);
    try {
      const created = await firstValueFrom(
        this.users.create({
          email: input.email.trim(),
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          nickname: input.nick.trim(),
          accountType: accountTypeFor(input.email),
          roles: rolesFor(input.role, input.lead, input.types, cat),
          programs: programsFor(input.programs, cat),
          exclusions: blocked.flatMap((b) => {
            const programId = programIdOf(b.code, cat);
            return programId === null ? [] : [{ programId, reason: b.reason.trim() }];
          }),
        }),
      );
      this.members.update((team) => [...team, this.toMember(created)]);
      this.toasts.success(
        created.invitation === 'existing_account'
          ? `${input.nick.trim()} already has an account: no email was sent, they can sign in now.`
          : created.accountType === 'custom'
            ? `Invitation sent to ${created.email}.`
            : `${input.nick.trim()} can sign in with their CGIAR account.`,
      );
      this.unconfirmedInvite = null;
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      const email = input.email.trim().toLowerCase();
      // Retry after a lost answer: "email taken" means the first try did create them (Juanda, 20-oct).
      if (e.code === USERS_ERROR.EMAIL_TAKEN && this.unconfirmedInvite === email) {
        this.unconfirmedInvite = null;
        await this.load();
        this.toasts.success(`${input.nick.trim()} was already created by the first try.`);
        return { ok: true };
      }
      // No answer, or a gateway that gave up without the server's envelope: it may have been created.
      const lost = e.status === 0 || ((e.status === 502 || e.status === 504) && e.code === CLIENT_ERROR.UNEXPECTED_RESPONSE);
      if (lost) this.unconfirmedInvite = email;
      return failure(error);
    }
  }

  /**
   * Saves only what changed, in order, stopping at the first refusal (design D4: the API has no
   * single edit call). The row always shows what the server holds after the last call that worked.
   */
  async edit(id: string, input: PersonInput): Promise<SaveOutcome> {
    const before = this.find(id);
    if (!before) return { ok: false, message: 'This person is no longer in the list. Reload the page.' };
    const noTypes = assessorWithoutTypes(input);
    if (noTypes) return noTypes;
    const cat = this.catalogState();
    const num = Number(id);
    const who = input.nick.trim() || before.name;
    const steps: (() => Promise<UserDetail>)[] = [];

    if (input.nick.trim() !== before.nick) {
      steps.push(() => firstValueFrom(this.users.edit(num, { nickname: input.nick.trim() }, who)));
    }
    // Only when what the screen shows changed: a person with grants it cannot show (`otherRoles`)
    // keeps them until someone edits their role on purpose (the drawer warns).
    const roles = rolesFor(input.role, input.lead, input.role === 'Assessor' ? input.types : [], cat);
    if (!sameGrants(roles, rolesFor(before.role, before.lead, before.types, cat))) {
      steps.push(() => firstValueFrom(this.users.setRoles(num, roles, who)));
    }
    const kept = input.blocked.filter((b) => b.code);
    // Matched by id or program: after a partial save the drawer still holds new blocks without an id.
    const removed = before.blocked.filter((b) => b.id !== undefined && !kept.some((k) => k.id === b.id || k.code === b.code));
    const added = kept.filter((b) => b.id === undefined && !before.blocked.some((x) => x.code === b.code));
    for (const b of removed) {
      if (b.origin === 'reporting') continue; // dismissed with its own reason, not from this form
      steps.push(() => firstValueFrom(this.users.removeExclusion(num, b.id as number, who)));
    }
    // Never widen by accident: blocking their only program must not turn the limit into "all".
    if (before.programs.length && !input.programs.length && added.some((b) => before.programs.includes(b.code))) {
      return { ok: false, field: 'programs', message: 'Blocking that program leaves them none. Pick the programs they can assess.' };
    }
    if (JSON.stringify(programsFor(input.programs, cat)) !== JSON.stringify(programsFor(before.programs, cat))) {
      steps.push(() => firstValueFrom(this.users.setPrograms(num, programsFor(input.programs, cat), who)));
    }
    for (const b of added) {
      const programId = programIdOf(b.code, cat);
      if (programId !== null) steps.push(() => firstValueFrom(this.users.addExclusion(num, programId, b.reason.trim(), who)));
    }

    for (const step of steps) {
      try {
        this.replace(await step());
      } catch (error) {
        return failure(error);
      }
    }
    return { ok: true };
  }

  /** Inline role / result-type edits from the table cells: the row shows the server answer, errors go to a toast. */
  /** Assessor needs result types: the caller opens the drawer instead of revoking every grant. */
  async setRole(id: string, role: TeamRole): Promise<void> {
    const m = this.find(id);
    if (!m || (role === 'Assessor' && !m.types.length)) return;
    await this.inline(id, () => this.users.setRoles(Number(id), rolesFor(role, m.lead, role === 'Assessor' ? m.types : [], this.catalogState()), m.nick || m.name));
  }

  async setTypes(id: string, types: readonly string[]): Promise<void> {
    const m = this.find(id);
    if (!m) return;
    if (!types.length) {
      this.toasts.info('An assessor needs at least one result type. To take them all away, change the role or remove the person.');
      return;
    }
    await this.inline(id, () => this.users.setRoles(Number(id), rolesFor(m.role, m.lead, types, this.catalogState()), m.nick || m.name));
  }

  async resendInvitation(id: string): Promise<void> {
    const m = this.find(id);
    if (!m) return;
    if (await this.inline(id, () => this.users.resendInvitation(Number(id), m.nick || m.name))) {
      this.toasts.success(`Invitation sent again to ${m.email}.`);
    }
  }

  async deactivate(id: string): Promise<SaveOutcome> {
    const m = this.find(id);
    if (!m) return { ok: true };
    try {
      const detail = await firstValueFrom(this.users.deactivate(Number(id), m.nick || m.name));
      this.members.update((team) => team.filter((p) => p.id !== id));
      this.removedMembers.update((list) => (list ? [...list, this.toMember(detail)] : list));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async activate(id: string): Promise<void> {
    const m = this.find(id);
    if (!m) return;
    try {
      const detail = await firstValueFrom(this.users.activate(Number(id), m.nick || m.name));
      this.removedMembers.update((list) => list?.filter((p) => p.id !== id) ?? null);
      this.members.update((team) => [...team, this.toMember(detail)]);
      this.toasts.success(`${m.nick || m.name} is back on the team.`);
    } catch (error) {
      this.toasts.error(toApiError(error).message);
    }
  }

  private async inline(id: string, call: () => ReturnType<UsersApi['setRoles']>): Promise<boolean> {
    if (this.isBusy(id)) return false;
    this.busyRows.update((set) => new Set(set).add(id));
    try {
      this.replace(await firstValueFrom(call()));
      return true;
    } catch (error) {
      this.toasts.error(failure(error).message);
      return false;
    } finally {
      this.busyRows.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }

  private replace(detail: UserSummary): void {
    const next = this.toMember(detail);
    this.members.update((team) => team.map((p) => (p.id === next.id ? next : p)));
  }

  private toMember(u: UserSummary): TeamMember {
    return toMember(u, this.catalogState(), Date.now());
  }

  private toMembers(list: readonly UserSummary[]): TeamMember[] {
    const now = Date.now();
    return list.map((u) => toMember(u, this.catalogState(), now));
  }
}
