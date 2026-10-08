import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { HlmButtonImports } from '@spartan/button';
import { HlmInputImports } from '@spartan/input';
import { QaMenuImports, QaMultiSelect, QaMultiSelectOption } from '../../../ui';
import { AssessorDrawer, DrawerSession, PersonSave } from './assessor-drawer';
import {
  ACTIVITY_LABELS,
  COVERAGE_INIT,
  GAP_DEMO,
  PROGRAMS,
  PROGRAM_CODES,
  ROLE_OPTIONS,
  TEAM,
  TYPE_COUNTS,
  TYPE_NAMES,
  TeamMember,
  TeamRole,
  TypeProgress,
  coverageKey,
  fmt,
  initials,
} from './assessors.mock';
import { AssessorRoleCell } from './role-cell';
import { AssessorTypesCell } from './types-cell';

type FilterKey = 'role' | 'type' | 'activity' | 'perm' | 'prog';
type SortKey = 'person' | 'role' | 'types' | 'progress';

interface FilterDef {
  readonly key: FilterKey;
  readonly label: string;
  readonly placeholder: string;
  readonly searchable: boolean;
  readonly options: readonly QaMultiSelectOption[];
}

const opts = (values: readonly string[]): QaMultiSelectOption[] => values.map((v) => ({ value: v, label: v }));

const FILTER_DEFS: readonly FilterDef[] = [
  { key: 'role', label: 'Role', placeholder: 'Search roles', searchable: true, options: opts(ROLE_OPTIONS.map((r) => r.role)) },
  { key: 'type', label: 'Result type', placeholder: 'Search result types', searchable: true, options: opts(TYPE_NAMES) },
  { key: 'activity', label: 'Activity', placeholder: 'Search activity', searchable: true, options: opts(Object.values(ACTIVITY_LABELS)) },
  { key: 'perm', label: 'Permissions', placeholder: '', searchable: false, options: opts(['Lead assessor', 'Has blocked programs']) },
  {
    key: 'prog',
    label: 'Science program',
    placeholder: 'Search programs',
    searchable: true,
    options: PROGRAM_CODES.map((c) => ({ value: c, label: c + ' ' + PROGRAMS[c] })),
  },
];

const HEADS: readonly { key: SortKey; label: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'role', label: 'Role' },
  { key: 'types', label: 'Result types' },
  { key: 'progress', label: 'Progress' },
];

const withProg = (p: TeamMember, prog: readonly TypeProgress[]): TeamMember => ({ ...p, prog });
const assignedOf = (p: TeamMember) => p.prog.reduce((a, e) => a + e.assigned, 0);
const reviewedOf = (p: TeamMember) => p.prog.reduce((a, e) => a + e.reviewed, 0);

/** "Assessors" view: the assessment team, its coverage gaps and who assesses what. */
@Component({
  selector: 'qa-assessors-view',
  templateUrl: './assessors-view.html',
  imports: [HlmButtonImports, HlmInputImports, QaMenuImports, QaMultiSelect, AssessorDrawer, AssessorRoleCell, AssessorTypesCell],
})
export class AssessorsView {
  private readonly document = inject(DOCUMENT);

  protected readonly team = signal<readonly TeamMember[]>(TEAM);

  // Toolbar state
  protected readonly search = signal('');
  protected readonly filters = {
    role: signal<readonly string[]>([]),
    type: signal<readonly string[]>([]),
    activity: signal<readonly string[]>([]),
    perm: signal<readonly string[]>([]),
    prog: signal<readonly string[]>([]),
  } as const;
  protected readonly filterDefs = FILTER_DEFS;
  protected readonly heads = HEADS;
  protected readonly sortKey = signal<SortKey | null>(null);
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');

  // Drawer state
  protected readonly drawerOpen = signal(false);
  protected readonly drawerSession = signal<DrawerSession | null>(null);
  private seq = 0;

  /** Result types with no active assessor (the demo keeps its two seeded gaps until their assessors change). */
  protected readonly gaps = computed(() => {
    const team = this.team();
    const covered = (t: string) => team.some((p) => p.role === 'Assessor' && p.act !== 'never' && p.types.includes(t));
    return TYPE_NAMES.filter((t) =>
      GAP_DEMO.includes(t) && coverageKey(team, t) === COVERAGE_INIT[t] ? true : !covered(t),
    );
  });
  protected readonly gapResults = computed(() => fmt(this.gaps().reduce((a, t) => a + (TYPE_COUNTS[t] ?? 0), 0)));

  protected readonly applied = computed(() =>
    FILTER_DEFS.filter((d) => this.filters[d.key]().length).map((d) => ({
      key: d.key,
      label: d.label,
      values: this.filters[d.key]()
        .map((v) => d.options.find((o) => o.value === v)?.label ?? v)
        .join(', '),
    })),
  );

  private readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const role = this.filters.role();
    const type = this.filters.type();
    const activity = this.filters.activity();
    const perm = this.filters.perm();
    const prog = this.filters.prog();
    return this.team().filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.nick.toLowerCase().includes(q)) &&
        (!role.length || role.includes(p.role)) &&
        (!type.length || (p.role === 'Assessor' && p.types.some((t) => type.includes(t)))) &&
        (!activity.length || activity.includes(ACTIVITY_LABELS[p.act])) &&
        (!perm.length || perm.every((x) => (x === 'Lead assessor' ? p.lead || p.role === 'Lead assessor' : p.blocked.length > 0))) &&
        (!prog.length ||
          prog.some((code) => !p.blocked.some((b) => b.code === code) && (!p.programs.length || p.programs.includes(code)))),
    );
  });

  private readonly sorted = computed(() => {
    const list = this.filtered();
    const k = this.sortKey();
    if (!k) return list;
    const val = (p: TeamMember): string | number => {
      switch (k) {
        case 'person':
          return p.nick || p.name;
        case 'role':
          return p.role;
        case 'types':
          return p.role === 'Assessor' ? (p.types[0] ?? '~') : '~~';
        case 'progress': {
          const a = assignedOf(p);
          return a ? reviewedOf(p) / a : -1;
        }
      }
    };
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  });

  protected readonly rows = computed(() =>
    this.sorted().map((p) => {
      const byPct = [...p.prog].sort(
        (a, b) => (a.assigned ? a.reviewed / a.assigned : 1) - (b.assigned ? b.reviewed / b.assigned : 1),
      );
      const meta = (p.programs.length ? p.programs.join(' · ') : 'All programs') + ' · ' + p.last;
      return {
        member: p,
        initials: initials(p.name),
        title: p.nick ? p.nick + ' · ' + p.name : p.name,
        meta,
        invited: p.act === 'never',
        progRows: byPct.slice(0, 3).map((e) => ({
          label: e.label,
          done: fmt(e.reviewed),
          of: fmt(e.assigned),
          pct: e.assigned ? Math.round((e.reviewed / e.assigned) * 100) : 0,
        })),
        progExtra: p.prog.length > 3 ? '+' + (p.prog.length - 3) + ' more result types' : '',
      };
    }),
  );

  // Toolbar
  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearFilter(key: FilterKey): void {
    this.filters[key].set([]);
  }

  protected clearAll(): void {
    for (const d of FILTER_DEFS) this.filters[d.key].set([]);
    this.search.set('');
  }

  /** Coverage banner: filter the team down to the uncovered result types. */
  protected showGaps(): void {
    this.clearAll();
    this.filters.type.set(this.gaps());
  }

  protected sortBy(key: SortKey): void {
    const active = this.sortKey() === key;
    this.sortDir.set(active && this.sortDir() === 'asc' ? 'desc' : 'asc');
    this.sortKey.set(key);
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  /** CSV of the whole team, as the mockup builds it. */
  protected download(): void {
    // TODO(api): replace with the server export of the assessment team.
    const lines = [['Nickname', 'Name', 'Email', 'Role', 'Result types', 'Assigned', 'Reviewed', 'Last active']].concat(
      this.team().map((p) => [
        p.nick,
        p.name,
        p.email,
        p.role,
        p.role === 'Assessor' ? p.types.join('; ') : 'All types',
        String(assignedOf(p)),
        String(reviewedOf(p)),
        p.last,
      ]),
    );
    const csv = lines.map((l) => l.map((x) => '"' + x.replace(/"/g, '""') + '"').join(',')).join('\n');
    const win = this.document.defaultView;
    if (!win) return;
    const url = win.URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = this.document.createElement('a');
    a.href = url;
    a.download = 'qa-assessment-team.csv';
    this.document.body.appendChild(a);
    a.click();
    a.remove();
    win.URL.revokeObjectURL(url);
  }

  // Inline cell edits
  private update(id: string, fn: (p: TeamMember) => TeamMember): void {
    this.team.update((team) => team.map((p) => (p.id === id ? fn(p) : p)));
  }

  protected setRole(id: string, role: TeamRole): void {
    // TODO(api): save the new role.
    this.update(id, (p) => ({ ...p, role }));
  }

  protected addType(id: string, type: string): void {
    // TODO(api): save the result types of this person.
    this.update(id, (p) => ({ ...p, types: [...p.types, type] }));
  }

  protected removeType(id: string, type: string): void {
    // TODO(api): save the result types; unreviewed results go back to the pool.
    this.update(id, (p) => withProg({ ...p, types: p.types.filter((t) => t !== type) }, p.prog.filter((e) => e.label !== type)));
  }

  // Drawer
  protected openPerson(p: TeamMember, confirmRemove = false): void {
    this.drawerSession.set({ mode: 'edit', id: p.id, confirmRemove, seq: ++this.seq });
    this.drawerOpen.set(true);
  }

  protected openInvite(): void {
    this.drawerSession.set({ mode: 'new', id: null, confirmRemove: false, seq: ++this.seq });
    this.drawerOpen.set(true);
  }

  /** The mockup only closes the menu here. */
  protected resendInvitation(_member: TeamMember): void {
    // TODO(api): resend the invitation email to _member.email.
  }

  protected onSaved(save: PersonSave): void {
    const d = save.draft;
    const isA = d.role === 'Assessor';
    const lead = d.role === 'Lead assessor' || (isA && d.lead);
    const blocked = d.blocked.filter((b) => b.code).map((b) => ({ code: b.code, reason: b.reason, date: b.date }));
    const types = isA ? [...d.types] : [];
    if (save.mode === 'new') {
      // TODO(api): send the invitation and create the team member.
      const np: TeamMember = {
        id: 'p' + Date.now(),
        nick: d.nick.trim(),
        name: d.name.trim(),
        email: d.email.trim(),
        role: d.role,
        lead,
        blocked,
        types,
        prog: types.length
          ? types.map((t) => ({ label: t, reviewed: 0, assigned: 0 }))
          : [{ label: 'All types', reviewed: 0, assigned: 0 }],
        programs: [...d.programs],
        act: 'never',
        last: 'Never signed in',
        rank: 1e9,
      };
      this.team.update((team) => [...team, np]);
      return;
    }
    if (!save.id) return;
    // TODO(api): save the assignment of this person.
    this.update(save.id, (p) => ({ ...p, nick: d.nick.trim(), role: d.role, lead, blocked, types, programs: [...d.programs] }));
  }

  protected onRemoved(id: string): void {
    // TODO(api): remove the person from the team; their unreviewed results go back to the pool.
    this.team.update((team) => team.filter((p) => p.id !== id));
  }
}
