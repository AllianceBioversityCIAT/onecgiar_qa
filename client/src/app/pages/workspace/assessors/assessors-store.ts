import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { UsersApi } from '../../../core/api/users-api';
import { USERS_ERROR, UserDetail, UserSummary } from '../../../core/api/users.models';
import { toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { TeamMember, TeamRole } from './assessors.models';
import { TeamCatalogs, accountTypeFor, programIdOf, programsFor, rolesFor, toMember } from './assessors.mapper';

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

  async invite(input: PersonInput): Promise<SaveOutcome> {
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
          programs: programsFor(input.programs.filter((c) => !blocked.some((b) => b.code === c)), cat),
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
      return { ok: true };
    } catch (error) {
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
    const cat = this.catalogState();
    const num = Number(id);
    const who = input.nick.trim() || before.name;
    const steps: (() => Promise<UserDetail>)[] = [];

    if (input.nick.trim() !== before.nick) {
      steps.push(() => firstValueFrom(this.users.edit(num, { nickname: input.nick.trim() }, who)));
    }
    // Only when the admin changed role, lead or types: a person with grants this screen cannot show
    // (`otherRoles`) keeps them until someone edits their role on purpose (the drawer warns).
    const sorted = (list: readonly string[]) => JSON.stringify([...list].sort());
    if (input.role !== before.role || input.lead !== before.lead || sorted(input.types) !== sorted(before.types)) {
      const roles = rolesFor(input.role, input.lead, input.role === 'Assessor' ? input.types : [], cat);
      steps.push(() => firstValueFrom(this.users.setRoles(num, roles, who)));
    }
    const kept = input.blocked.filter((b) => b.code);
    const removed = before.blocked.filter((b) => b.id !== undefined && !kept.some((k) => k.id === b.id));
    const added = kept.filter((b) => b.id === undefined);
    for (const b of removed) {
      if (b.origin === 'reporting') continue; // dismissed with its own reason, not from this form
      steps.push(() => firstValueFrom(this.users.removeExclusion(num, b.id as number, who)));
    }
    const programs = input.programs.filter((c) => !kept.some((b) => b.code === c));
    if (JSON.stringify(programsFor(programs, cat)) !== JSON.stringify(programsFor(before.programs, cat))) {
      steps.push(() => firstValueFrom(this.users.setPrograms(num, programsFor(programs, cat), who)));
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
  async setRole(id: string, role: TeamRole): Promise<void> {
    const m = this.find(id);
    if (m) await this.inline(() => this.users.setRoles(Number(id), rolesFor(role, m.lead, role === 'Assessor' ? m.types : [], this.catalogState()), m.nick || m.name));
  }

  async setTypes(id: string, types: readonly string[]): Promise<void> {
    const m = this.find(id);
    if (m) await this.inline(() => this.users.setRoles(Number(id), rolesFor(m.role, m.lead, types, this.catalogState()), m.nick || m.name));
  }

  async resendInvitation(id: string): Promise<void> {
    const m = this.find(id);
    if (!m) return;
    if (await this.inline(() => this.users.resendInvitation(Number(id), m.nick || m.name))) {
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

  private async inline(call: () => ReturnType<UsersApi['setRoles']>): Promise<boolean> {
    try {
      this.replace(await firstValueFrom(call()));
      return true;
    } catch (error) {
      this.toasts.error(failure(error).message);
      return false;
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
