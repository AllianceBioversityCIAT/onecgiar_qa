import { Component, computed, effect, input, linkedSignal, model, output, untracked } from '@angular/core';
import { FieldTree, FormField, email, form, required, submit } from '@angular/forms/signals';
import { HlmButtonImports } from '@spartan/button';
import { HlmInputImports } from '@spartan/input';
import { QaDrawerCloseGuard, QaDrawerImports, QaMultiSelect, QaMultiSelectOption, QaSelect, QaSelectOption, QaSwitch, QaTooltipImports } from '../../../ui';
import {
  CURRENT_SUBTIMELINE,
  PROGRAMS,
  PROGRAM_CODES,
  PROGRAM_COUNTS,
  ROLE_OPTIONS,
  TODAY_LABEL,
  TYPE_COUNTS,
  TYPE_NAMES,
  TeamMember,
  TeamRole,
  fmt,
  initials,
} from './assessors.mock';

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
}

export interface PersonDraft {
  name: string;
  email: string;
  nick: string;
  role: TeamRole;
  lead: boolean;
  types: readonly string[];
  programs: readonly string[];
  blocked: readonly BlockDraft[];
}

export interface PersonSave {
  readonly mode: 'new' | 'edit';
  readonly id: string | null;
  readonly draft: PersonDraft;
}

const INFO = {
  nick: 'How this person appears in tables and in comment threads. Short is better.',
  types: 'Results of these types are shared among their assessors when results are loaded. You can move a single result later from the Results table.',
  programs: 'Leave this open unless this person should only assess certain programs.',
  blocked: 'Programs this person has worked with. They cannot be assigned to them, and the block stays until you remove it.',
};

function emptyDraft(): PersonDraft {
  return { name: '', email: '', nick: '', role: 'Assessor', lead: false, types: [], programs: [], blocked: [] };
}

function draftOf(p: TeamMember): PersonDraft {
  return {
    name: '',
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
  imports: [FormField, HlmButtonImports, HlmInputImports, QaDrawerImports, QaSelect, QaSwitch, QaTooltipImports, QaMultiSelect],
  templateUrl: './assessor-drawer.html',
})
export class AssessorDrawer {
  readonly open = model(false);
  readonly session = input<DrawerSession | null>(null);
  readonly team = input.required<readonly TeamMember[]>();
  readonly saved = output<PersonSave>();
  readonly removed = output<string>();

  protected readonly info = INFO;
  protected readonly subtimeline = CURRENT_SUBTIMELINE;
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

  protected readonly personForm = form(this.draft, (p) => {
    const isNew = () => this.isNew();
    required(p.name, { message: 'Enter their full name.', when: isNew });
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
  protected readonly typeOptions: readonly QaMultiSelectOption[] = TYPE_NAMES.map((t) => ({
    value: t,
    label: t,
    count: fmt(TYPE_COUNTS[t] ?? 0),
  }));
  private readonly blockedCodes = computed(() => this.draft().blocked.filter((b) => b.code).map((b) => b.code));
  protected readonly programOptions = computed<readonly QaMultiSelectOption[]>(() =>
    PROGRAM_CODES.filter((c) => !this.blockedCodes().includes(c)).map((c) => ({
      value: c,
      label: c + ' ' + PROGRAMS[c],
      count: fmt(PROGRAM_COUNTS[c] ?? 0),
    })),
  );

  /** Estimated load: each type's results shared among its assessors, scaled by the programs they can see. */
  protected readonly load = computed(() => {
    const d = this.draft();
    if (d.role !== 'Assessor' || !d.types.length) return null;
    const blocked = this.blockedCodes().length;
    const all = PROGRAM_CODES.length;
    const pf = (d.programs.length ? d.programs.length : all - blocked) / all;
    const id = this.session()?.id ?? null;
    const rows = d.types.map((t) => {
      const others = this.team().filter((p) => p.id !== id && p.role === 'Assessor' && p.types.includes(t)).length;
      return { name: t, n: Math.round(((TYPE_COUNTS[t] ?? 0) / (others + 1)) * pf) };
    });
    return {
      rows: rows.map((r) => ({ name: r.name, count: fmt(r.n) })),
      total: fmt(rows.reduce((a, r) => a + r.n, 0)),
      blockNote: blocked
        ? blocked + (blocked === 1 ? ' blocked program is' : ' blocked programs are') + ' excluded from this estimate.'
        : '',
    };
  });

  /** Copy of the remove-from-team confirmation. */
  protected readonly removeCopy = computed(() => {
    const person = this.person();
    if (!person) return null;
    const unreviewed = Math.max(0, person.prog.reduce((a, e) => a + e.assigned - e.reviewed, 0));
    const tail = person.types.length
      ? ' unreviewed results go back to the pool and are shared among the other ' + person.types.join(' and ') + ' assessors.'
      : ' unreviewed results go back to the pool and are shared among the rest of the team.';
    const team = this.team();
    const alone =
      person.role === 'Assessor' && person.act !== 'never'
        ? person.types.filter(
            (t) => !team.some((p) => p.id !== person.id && p.role === 'Assessor' && p.act !== 'never' && p.types.includes(t)),
          )
        : [];
    return {
      lead: 'Remove ' + person.name + ' from the team? Their ',
      n: fmt(unreviewed),
      tail,
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

  protected showError(field: FieldTree<string>): boolean {
    const state = field();
    return state.touched() && state.invalid();
  }

  protected errorOf(field: FieldTree<string>): string {
    return field().errors()[0]?.message ?? '';
  }

  protected patch(p: Partial<PersonDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
    this.confirmDiscard.set(false);
  }

  /** Typing the full name proposes a nickname ("Assessor DD") until the nickname is edited by hand. */
  protected onNameInput(event: Event): void {
    this.confirmDiscard.set(false);
    if (this.nickTouched()) return;
    const v = (event.target as HTMLInputElement).value.trim();
    this.draft.update((d) => ({ ...d, nick: v ? 'Assessor ' + initials(v) : '' }));
  }

  protected onNickInput(): void {
    this.nickTouched.set(true);
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
    this.patch({ blocked: [...this.draft().blocked, { code: '', reason: '', date: TODAY_LABEL, isNew: true }] });
  }

  protected blockOptions(index: number): readonly QaSelectOption[] {
    const blocked = this.draft().blocked;
    const own = blocked[index]?.code;
    const taken = blocked.map((b) => b.code);
    return PROGRAM_CODES.filter((c) => c === own || !taken.includes(c)).map((c) => ({ value: c, label: c + ' ' + PROGRAMS[c] }));
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
    return PROGRAMS[code] ?? '';
  }

  // Closing, saving, removing
  private isDirty(): boolean {
    const d = this.draft();
    return this.isNew() && !!(d.name.trim() || d.email.trim());
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
    await submit(this.personForm, async () => {
      const s = this.session();
      if (!s) return undefined;
      this.saved.emit({ mode: s.mode, id: s.id, draft: this.draft() });
      this.open.set(false);
      return undefined;
    });
  }

  protected remove(): void {
    const p = this.person();
    if (!p) return;
    this.removed.emit(p.id);
    this.open.set(false);
  }
}
