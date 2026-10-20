import { Component, DestroyRef, computed, effect, inject, input, linkedSignal, model, untracked } from '@angular/core';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { HlmInputImports } from '@spartan/input';
import { UnsavedChanges } from '../../../core/forms/unsaved-changes';
import { submission } from '../../../core/http/submission';
import { QaButtonImports, QaDrawerCloseGuard, QaDrawerImports, QaMultiSelect, QaMultiSelectOption, QaSelect, QaSelectOption, QaSwitch, QaTooltipImports } from '../../../ui';
import { AssessorsStore, PersonField, PersonInput, SaveOutcome } from './assessors-store';
import { accountTypeFor, dateLabel } from './assessors.mapper';
import { BlockedProgram, ROLE_OPTIONS, TeamMember, TeamRole, fmt, initials } from './assessors.models';

/** What the drawer is showing: the invite form, or one team member (optionally on the remove step). */
export interface DrawerSession {
  readonly mode: 'new' | 'edit';
  readonly id: string | null;
  readonly confirmRemove: boolean;
  /** Changes on every open so the draft resets even when the same person is opened twice. */
  readonly seq: number;
}

export interface BlockDraft {
  readonly code: string;
  readonly reason: string;
  readonly date: string;
  readonly isNew: boolean;
  /** API exclusion id of a saved block. */
  readonly id?: number;
  readonly origin?: BlockedProgram['origin'];
}

export interface PersonDraft {
  firstName: string;
  lastName: string;
  email: string;
  nick: string;
  role: TeamRole;
  lead: boolean;
  types: readonly string[];
  programs: readonly string[];
  blocked: readonly BlockDraft[];
}

const INFO = {
  nick: 'How this person appears in tables and in comment threads. Short is better.',
  types: 'Results of these types are shared among their assessors when results are loaded. You can move a single result later from the Results table.',
  programs: 'Leave this open unless this person should only assess certain programs.',
  blocked: 'Programs this person has worked with. They cannot be assigned to them, and the block stays until you remove it.',
};

function emptyDraft(): PersonDraft {
  return { firstName: '', lastName: '', email: '', nick: '', role: 'Assessor', lead: false, types: [], programs: [], blocked: [] };
}

function draftOf(p: TeamMember): PersonDraft {
  return {
    firstName: '',
    lastName: '',
    email: '',
    nick: p.nick,
    role: p.role,
    lead: p.lead,
    types: [...p.types],
    programs: [...p.programs],
    blocked: p.blocked.map((b) => ({ ...b, isNew: false })),
  };
}

/**
 * The one person drawer of the Assessors view: "Invite assessor" (mode new) and the edit drawer of
 * any team member (mode edit), with the remove-from-team and discard confirmations in its footer.
 */
@Component({
  selector: 'qa-assessor-drawer',
  imports: [FormField, QaButtonImports, HlmInputImports, QaDrawerImports, QaSelect, QaSwitch, QaTooltipImports, QaMultiSelect],
  templateUrl: './assessor-drawer.html',
})
export class AssessorDrawer {
  readonly open = model(false);
  // Tab close / reload / leaving the view ask first while an invite has text in it.
  private readonly unregisterUnsaved = inject(UnsavedChanges).register(() => this.open() && this.isDirty());
  private readonly unsavedCleanup = inject(DestroyRef).onDestroy(this.unregisterUnsaved);
  readonly session = input<DrawerSession | null>(null);

  private readonly store = inject(AssessorsStore);
  private readonly team = this.store.team;
  /** One save or remove at a time: a double click never sends twice. */
  private readonly saving = submission();
  protected readonly busy = this.saving.busy;

  protected readonly info = INFO;
  protected readonly isNew = computed(() => this.session()?.mode === 'new');
  protected readonly person = computed(() => {
    const s = this.session();
    return s && s.id ? (this.team().find((p) => p.id === s.id) ?? null) : null;
  });

  // Draft and per-open UI state: reset whenever a new session starts.
  protected readonly draft = linkedSignal<PersonDraft>(() => {
    const s = this.session();
    const p = untracked(this.person);
    return s?.mode === 'edit' && p ? draftOf(p) : emptyDraft();
  });
  protected readonly confirmRemove = linkedSignal(() => !!this.session()?.confirmRemove);
  protected readonly confirmDiscard = linkedSignal(() => (this.session(), false));
  protected readonly blockConfirm = linkedSignal<number | null>(() => (this.session(), null));
  private readonly nickTouched = linkedSignal(() => this.session()?.mode === 'edit');
  /** Server answer that did not fit a field (or the field it pointed at, shown under it). */
  protected readonly formError = linkedSignal<string>(() => (this.session(), ''));
  private readonly serverField = linkedSignal<{ field: PersonField; message: string } | null>(() => (this.session(), null));
  private readonly triedSave = linkedSignal(() => (this.session(), false));
  protected readonly blockError = computed(() => {
    if (!this.triedSave()) return this.serverField()?.field === 'blocked' ? this.serverField()?.message : '';
    const missing = this.draft().blocked.some((b) => b.isNew && (!b.code || !b.reason.trim()));
    return missing ? 'Pick a program and write the reason for every block.' : '';
  });

  protected readonly personForm = form(this.draft, (p) => {
    const isNew = () => this.isNew();
    required(p.firstName, { message: 'Enter their first name.', when: isNew });
    required(p.lastName, { message: 'Enter their last name.', when: isNew });
    required(p.email, { message: 'Enter their email address.', when: isNew });
    email(p.email, { message: 'Enter a valid email address.' });
    required(p.nick, { message: 'Enter a nickname.' });
  });

  protected readonly title = computed(() => (this.isNew() ? 'Invite assessor' : (this.person()?.name ?? '')));
  protected readonly subtitle = computed(() =>
    this.isNew() ? 'They get an email with a link to the QA platform.' : (this.person()?.email ?? ''),
  );

  protected readonly roleOptions: readonly QaSelectOption[] = ROLE_OPTIONS.map((r) => ({
    value: r.role,
    label: r.role,
    description: r.description,
  }));
  protected readonly typeOptions = computed<readonly QaMultiSelectOption[]>(() =>
    this.store.typeNames().map((t) => ({ value: t, label: t })),
  );
  private readonly blockedCodes = computed(() => this.draft().blocked.filter((b) => b.code).map((b) => b.code));
  protected readonly programOptions = computed<readonly QaMultiSelectOption[]>(() =>
    this.store
      .programCodes()
      .filter((c) => !this.blockedCodes().includes(c))
      .map((c) => ({ value: c, label: c + ' ' + this.store.programName(c) })),
  );

  /** How the new person will sign in (account type rule, design integration review 5). */
  protected readonly accountHint = computed(() =>
    accountTypeFor(this.draft().email) === 'sso'
      ? 'Signs in with their CGIAR account.'
      : 'Gets an email invitation to set a password.',
  );

  /**
   * Copy of the remove-from-team confirmation. Removing only takes away access (the API deactivates
   * the account); nothing moves results around, so the copy does not promise it.
   */
  protected readonly removeCopy = computed(() => {
    const person = this.person();
    if (!person) return null;
    const team = this.team();
    const alone =
      person.role === 'Assessor' && person.act !== 'never'
        ? person.types.filter(
            (t) => !team.some((p) => p.id !== person.id && p.role === 'Assessor' && p.act !== 'never' && p.types.includes(t)),
          )
        : [];
    return {
      lead: 'Remove ' + person.name + ' from the team? They lose access to QA. You can bring them back from "Show removed people".',
      warn: alone.length ? 'No one else assesses ' + alone.join(' or ') + '. Those results will not be reviewed until you assign someone.' : '',
      warn2: person.lead ? 'Comments they edited stay as they are, attributed to their original author.' : '',
    };
  });

  protected readonly assigned = computed(() => {
    const p = this.person();
    return p ? p.prog.reduce((a, e) => a + e.assigned, 0) : 0;
  });

  constructor() {
    // A new session starts with a clean form (no touched fields from the last time).
    effect(() => {
      this.session();
      untracked(() => this.personForm().reset());
    });
  }

  protected fmt = fmt;
  protected readonly initialsOf = initials;

  private readonly fieldOf = new Map<FieldTree<string>, PersonField>([
    [this.personForm.firstName, 'firstName'],
    [this.personForm.lastName, 'lastName'],
    [this.personForm.email, 'email'],
    [this.personForm.nick, 'nick'],
  ]);

  protected showError(field: FieldTree<string>): boolean {
    const state = field();
    return (state.touched() && state.invalid()) || this.serverField()?.field === this.fieldOf.get(field);
  }

  protected errorOf(field: FieldTree<string>): string {
    const server = this.serverField();
    if (server && server.field === this.fieldOf.get(field)) return server.message;
    return field().errors()[0]?.message ?? '';
  }

  protected patch(p: Partial<PersonDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
    this.confirmDiscard.set(false);
    this.serverField.set(null);
    this.formError.set('');
  }

  /** Typing the name proposes a nickname ("Assessor DD") until the nickname is edited by hand. */
  protected onNameInput(): void {
    this.confirmDiscard.set(false);
    this.serverField.set(null);
    if (this.nickTouched()) return;
    const d = this.draft();
    const full = `${d.firstName} ${d.lastName}`.trim();
    this.draft.update((x) => ({ ...x, nick: full ? 'Assessor ' + initials(full) : '' }));
  }

  protected onNickInput(): void {
    this.nickTouched.set(true);
    this.serverField.set(null);
  }

  protected setRole(value: string | null): void {
    if (value) this.patch({ role: value as TeamRole });
  }

  protected setPrograms(programs: readonly string[]): void {
    this.patch({ programs });
  }

  protected setTypes(types: readonly string[]): void {
    this.patch({ types });
  }

  // Conflict-of-interest blocks
  protected addBlock(): void {
    this.blockConfirm.set(null);
    this.patch({ blocked: [...this.draft().blocked, { code: '', reason: '', date: dateLabel(new Date().toISOString()), isNew: true }] });
  }

  protected blockOptions(index: number): readonly QaSelectOption[] {
    const blocked = this.draft().blocked;
    const own = blocked[index]?.code;
    const taken = blocked.map((b) => b.code);
    return this.store
      .programCodes()
      .filter((c) => c === own || !taken.includes(c))
      .map((c) => ({ value: c, label: c + ' ' + this.store.programName(c) }));
  }

  protected setBlockCode(index: number, code: string | null): void {
    if (!code) return;
    const d = this.draft();
    this.patch({
      blocked: d.blocked.map((b, i) => (i === index ? { ...b, code } : b)),
      programs: d.programs.filter((x) => x !== code),
    });
  }

  protected setBlockReason(index: number, event: Event): void {
    const reason = (event.target as HTMLInputElement).value;
    this.patch({ blocked: this.draft().blocked.map((b, i) => (i === index ? { ...b, reason } : b)) });
  }

  protected removeBlock(index: number): void {
    this.blockConfirm.set(null);
    this.patch({ blocked: this.draft().blocked.filter((_, i) => i !== index) });
  }

  protected programName(code: string): string {
    return this.store.programName(code);
  }

  // Closing, saving, removing
  private isDirty(): boolean {
    const d = this.draft();
    return this.isNew() && !!(d.firstName.trim() || d.lastName.trim() || d.email.trim());
  }

  /** Esc, overlay click and X: an invite with text in it asks before discarding (the drawer stays open). */
  protected readonly closeGuard: QaDrawerCloseGuard = () => {
    if (this.isDirty() && !this.confirmDiscard()) {
      this.confirmRemove.set(false);
      this.confirmDiscard.set(true);
      return false;
    }
    return true;
  };

  /** Cancel button: same question as Esc / X. */
  protected requestClose(): void {
    if (this.closeGuard() === true) this.open.set(false);
  }

  protected async save(): Promise<void> {
    this.triedSave.set(true);
    if (this.blockError()) return;
    await submit(this.personForm, async () => {
      const s = this.session();
      if (!s) return undefined;
      const outcome = await this.saving.run(() => this.send(s));
      if (outcome) this.after(outcome);
      return undefined;
    });
  }

  protected async remove(): Promise<void> {
    const p = this.person();
    if (!p) return;
    const outcome = await this.saving.run(() => this.store.deactivate(p.id));
    if (outcome) this.after(outcome);
  }

  private send(s: DrawerSession): Promise<SaveOutcome> {
    const d = this.draft();
    const input: PersonInput = {
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      nick: d.nick,
      role: d.role,
      lead: d.role === 'Assessor' && d.lead,
      types: d.role === 'Assessor' ? d.types : [],
      programs: d.programs,
      blocked: d.blocked.map((b) => ({ code: b.code, reason: b.reason, id: b.id })),
    };
    return s.mode === 'new' || !s.id ? this.store.invite(input) : this.store.edit(s.id, input);
  }

  /** Success closes; a refusal keeps the drawer open with the message on its field (or in the footer). */
  private after(outcome: SaveOutcome): void {
    if (outcome.ok) {
      this.open.set(false);
      return;
    }
    const onField = outcome.field && ['firstName', 'lastName', 'email', 'nick', 'blocked'].includes(outcome.field);
    this.serverField.set(onField && outcome.field ? { field: outcome.field, message: outcome.message } : null);
    this.formError.set(onField ? '' : outcome.message);
  }
}
