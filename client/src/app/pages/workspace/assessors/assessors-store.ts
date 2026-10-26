import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { UsersApi } from '../../../core/api/users-api';
import { RoleGrant, USERS_ERROR, UserSummary } from '../../../core/api/users.models';
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
  /** The grants exactly as the server sent them, by member id (PUT replaces the whole set). */
  private readonly grants = new Map<string, readonly RoleGrant[]>();
  private readonly removedMembers = signal<readonly TeamMember[] | null>(null);
  private readonly catalogState = signal<TeamCatalogs>({ types: [], programs: [] });

  readonly state = signal<LoadState>('loading');
  /**
   * Catalogs that failed while the team itself loaded (CLARISA or the Reporting Tool down, the server
   * answers 503 after its 10 s wait): the team still shows; only what needs that list is turned off.
   */
  readonly missingCatalogs = signal<readonly ('types' | 'programs')[]>([]);
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
    const missing: ('types' | 'programs')[] = [];
    const optional = <T>(list: Observable<readonly T[]>, name: 'types' | 'programs') =>
      list.pipe(catchError(() => (missing.push(name), of([] as readonly T[]))));
    try {
      const { types, programs, team } = await firstValueFrom(
        forkJoin({
          types: optional(this.catalogsApi.resultTypes(), 'types'),
          programs: optional(this.catalogsApi.sciencePrograms(), 'programs'),
          team: this.users.listAll(),
        }),
      );
      this.missingCatalogs.set(missing);
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
   * Saves the whole person in ONE call (`PUT /users/:id`, one transaction: any refusal changes
   * nothing). Nothing is sent when nothing changed. Roles are only rewritten when what the screen
   * shows changed, so grants it cannot show (`otherRoles`) stay until someone edits the role on purpose.
   */
  async edit(id: string, input: PersonInput): Promise<SaveOutcome> {
    const before = this.find(id);
    if (!before) return { ok: false, message: 'This person is no longer in the list. Reload the page.' };
    const noTypes = assessorWithoutTypes(input);
    if (noTypes) return noTypes;
    const cat = this.catalogState();

    const nick = input.nick.trim();
    // Names change only until the first sign-in (the server answers NAME_LOCKED after it).
    const firstName = before.namesLocked ? before.firstName : input.firstName.trim();
    const lastName = before.namesLocked ? before.lastName : input.lastName.trim();
    const sameRoles = sameGrants(
      rolesFor(input.role, input.lead, input.role === 'Assessor' ? input.types : [], cat),
      rolesFor(before.role, before.lead, before.types, cat),
    );
    const kept = input.blocked.filter((b) => b.code);
    const manual = (list: readonly { code: string; reason: string }[]) =>
      list.flatMap((b) => {
        const programId = programIdOf(b.code, cat);
        return programId === null ? [] : [{ programId, reason: b.reason.trim() }];
      });
    const beforeManual = manual(before.blocked.filter((b) => b.origin !== 'reporting'));
    const afterManual = manual(kept.filter((b) => before.blocked.find((x) => x.code === b.code)?.origin !== 'reporting'));
    const ids = (list: readonly { programId: number }[]) => JSON.stringify(list.map((x) => x.programId).sort());
    const added = kept.filter((b) => !before.blocked.some((x) => x.code === b.code));

    // Never widen by accident: blocking their only program must not turn the limit into "all".
    if (before.programs.length && !input.programs.length && added.some((b) => before.programs.includes(b.code))) {
      return { ok: false, field: 'programs', message: 'Blocking that program leaves them none. Pick the programs they can assess.' };
    }
    const samePrograms = JSON.stringify(programsFor(input.programs, cat)) === JSON.stringify(programsFor(before.programs, cat));
    const sameNames = firstName === before.firstName && lastName === before.lastName;
    if (nick === before.nick && sameNames && sameRoles && samePrograms && ids(afterManual) === ids(beforeManual)) return { ok: true };

    try {
      const detail = await firstValueFrom(
        this.users.replace(
          Number(id),
          {
            ...(nick !== before.nick ? { nickname: nick } : {}),
            ...(firstName !== before.firstName ? { firstName } : {}),
            ...(lastName !== before.lastName ? { lastName } : {}),
            // PUT replaces the whole role set: when the role on screen did not change, a person with
            // grants the screen cannot show (`otherRoles`) gets the server's own grants back untouched.
            roles: sameRoles && before.otherRoles ? this.rawRoles(id) : rolesFor(input.role, input.lead, input.role === 'Assessor' ? input.types : [], cat),
            programs: programsFor(input.programs, cat),
            exclusions: afterManual,
          },
          nick || before.name,
        ),
      );
      this.replace(detail);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

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

  private rawRoles(id: string): readonly RoleGrant[] {
    return this.grants.get(id) ?? [];
  }

  private toMember(u: UserSummary): TeamMember {
    this.grants.set(String(u.id), u.roles);
    return toMember(u, this.catalogState(), Date.now());
  }

  private toMembers(list: readonly UserSummary[]): TeamMember[] {
    const now = Date.now();
    return list.map((u) => {
      this.grants.set(String(u.id), u.roles);
      return toMember(u, this.catalogState(), now);
    });
  }
}
