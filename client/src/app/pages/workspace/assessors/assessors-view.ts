import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { HlmInputImports } from '@spartan/input';
import { QaButtonImports, QaMenuImports, QaMultiSelect, QaMultiSelectOption } from '../../../ui';
import { AssessorDrawer, DrawerSession } from './assessor-drawer';
import { AssessorsStore } from './assessors-store';
import { ACTIVITY_LABELS, ROLE_OPTIONS, TeamMember, TeamRole, fmt, initials } from './assessors.models';
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

const FILTER_KEYS: readonly FilterKey[] = ['role', 'type', 'activity', 'perm', 'prog'];

const HEADS: readonly { key: SortKey; label: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'role', label: 'Role' },
  { key: 'types', label: 'Result types' },
  { key: 'progress', label: 'Progress' },
];

/**
 * Responsive team table, driven by the width of the table container (`@container`):
 * - < 640px: stacked person cards (no header row; ⋯ pinned top-right, role + result types on one line, progress below).
 * - 640–949px: four columns; the role sits under the person.
 * - >= 950px: the five mockup columns.
 */
const CELL = {
  row:
    'relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 bg-(--surface) px-4 py-3 hover:bg-(--surface-2) ' +
    '@min-[640px]:min-h-24 @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,210px)_32px] @min-[640px]:gap-y-0.5 @min-[640px]:px-5 @min-[640px]:py-2 ' +
    '@min-[950px]:grid-cols-[minmax(0,1fr)_160px_220px_260px_32px] @min-[950px]:gap-y-0',
  person: 'col-span-2 row-start-1 pr-10 @min-[640px]:col-span-1 @min-[640px]:col-start-1 @min-[640px]:self-end @min-[640px]:pr-0 @min-[950px]:self-stretch',
  role:
    'col-start-1 row-start-2 ml-[30px] justify-self-start @min-[640px]:self-start ' +
    '@min-[950px]:col-start-2 @min-[950px]:row-start-1 @min-[950px]:ml-0 @min-[950px]:self-center @min-[950px]:justify-self-stretch',
  types:
    'col-start-2 row-start-2 @min-[640px]:col-start-2 @min-[640px]:row-span-2 @min-[640px]:row-start-1 ' +
    '@min-[950px]:col-start-3 @min-[950px]:row-span-1',
  progress:
    'col-span-2 row-start-3 ml-[38px] max-w-[360px] @min-[640px]:col-span-1 @min-[640px]:col-start-3 @min-[640px]:row-span-2 @min-[640px]:row-start-1 @min-[640px]:ml-0 @min-[640px]:max-w-none ' +
    '@min-[950px]:col-start-4 @min-[950px]:row-span-1',
  menu:
    'absolute top-2 right-2 @min-[640px]:relative @min-[640px]:col-start-4 @min-[640px]:row-span-2 @min-[640px]:row-start-1 @min-[640px]:justify-self-end ' +
    '@min-[950px]:col-start-5 @min-[950px]:row-span-1',
} as const;

const assignedOf = (p: TeamMember) => p.prog.reduce((a, e) => a + e.assigned, 0);
const reviewedOf = (p: TeamMember) => p.prog.reduce((a, e) => a + e.reviewed, 0);

/** "Assessors" view: the assessment team, its coverage gaps and who assesses what. */
@Component({
  selector: 'qa-assessors-view',
  templateUrl: './assessors-view.html',
  imports: [NgTemplateOutlet, QaButtonImports, HlmInputImports, QaMenuImports, QaMultiSelect, AssessorDrawer, AssessorRoleCell, AssessorTypesCell],
  providers: [AssessorsStore],
})
export class AssessorsView {
  protected readonly store = inject(AssessorsStore);
  /** Active team, or the removed people while "Show removed people" is on. */
  protected readonly showRemoved = signal(false);
  protected readonly team = computed(() => (this.showRemoved() ? (this.store.removed() ?? []) : this.store.team()));

  // Toolbar state
  protected readonly search = signal('');
  protected readonly filters = {
    role: signal<readonly string[]>([]),
    type: signal<readonly string[]>([]),
    activity: signal<readonly string[]>([]),
    perm: signal<readonly string[]>([]),
    prog: signal<readonly string[]>([]),
  } as const;
  /** Filter options come from the catalogs (result types, programs). */
  protected readonly filterDefs = computed<readonly FilterDef[]>(() => [
    { key: 'role', label: 'Role', placeholder: 'Search roles', searchable: true, options: opts(ROLE_OPTIONS.map((r) => r.role)) },
    { key: 'type', label: 'Result type', placeholder: 'Search result types', searchable: true, options: opts(this.store.typeNames()) },
    { key: 'activity', label: 'Activity', placeholder: 'Search activity', searchable: true, options: opts(Object.values(ACTIVITY_LABELS)) },
    { key: 'perm', label: 'Permissions', placeholder: '', searchable: false, options: opts(['Lead assessor', 'Has blocked programs']) },
    {
      key: 'prog',
      label: 'Science program',
      placeholder: 'Search programs',
      searchable: true,
      options: this.store.programCodes().map((c) => ({ value: c, label: c + ' ' + this.store.programName(c) })),
    },
  ]);
  protected readonly heads = HEADS;
  protected readonly sortKey = signal<SortKey | null>(null);
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');

  // Drawer state
  protected readonly drawerOpen = signal(false);
  protected readonly drawerSession = signal<DrawerSession | null>(null);
  private seq = 0;

  // Table layout classes per container width (see CELL).
  protected readonly cell = CELL;

  // Square the sticky header corners while it is stuck to the top of the scrolling <main>.
  protected readonly headerStuck = signal(false);
  private readonly stickSentinel = viewChild<ElementRef<HTMLElement>>('stickSentinel');

  constructor() {
    void this.store.load();
    effect((onCleanup) => {
      const sentinel = this.stickSentinel()?.nativeElement;
      if (!sentinel || typeof IntersectionObserver === 'undefined') {
        this.headerStuck.set(false);
        return;
      }
      const observer = new IntersectionObserver(
        ([entry]) => {
          const top = entry.rootBounds?.top ?? 0;
          this.headerStuck.set(!entry.isIntersecting && entry.boundingClientRect.top < top);
        },
        { root: sentinel.closest('main'), threshold: 0 },
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }

  /** Result types no one who has signed in assesses. */
  protected readonly gaps = computed(() => {
    const team = this.store.team();
    const covered = (t: string) => team.some((p) => p.role === 'Assessor' && p.act !== 'never' && p.types.includes(t));
    return this.store.typeNames().filter((t) => !covered(t));
  });

  protected readonly applied = computed(() =>
    this.filterDefs().filter((d) => this.filters[d.key]().length).map((d) => ({
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
        invited: p.invite === 'pending',
        hasAccount: p.invite === 'existing_account',
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
    for (const key of FILTER_KEYS) this.filters[key].set([]);
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

  // Inline cell edits: the row shows what the server answers (errors go to a toast).
  protected setRole(id: string, role: TeamRole): void {
    const m = this.store.find(id);
    // Becoming an assessor needs result types first: saving it bare would revoke every grant.
    if (m && role === 'Assessor' && !m.types.length) {
      this.openPerson(m);
      return;
    }
    void this.store.setRole(id, role);
  }

  protected addType(id: string, type: string): void {
    const m = this.store.find(id);
    if (m) void this.store.setTypes(id, [...m.types, type]);
  }

  protected removeType(id: string, type: string): void {
    const m = this.store.find(id);
    if (m) void this.store.setTypes(id, m.types.filter((t) => t !== type));
  }

  protected async toggleRemoved(): Promise<void> {
    if (!this.showRemoved() && this.store.removed() === null) await this.store.loadRemoved();
    this.showRemoved.update((v) => !v);
  }

  protected reactivate(member: TeamMember): void {
    void this.store.activate(member.id);
  }

  // Drawer
  protected openPerson(p: TeamMember, confirmRemove = false): void {
    // Removed people are only brought back (row menu), not edited.
    if (!p.active) return;
    this.drawerSession.set({ mode: 'edit', id: p.id, confirmRemove, seq: ++this.seq });
    this.drawerOpen.set(true);
  }

  protected openInvite(): void {
    this.drawerSession.set({ mode: 'new', id: null, confirmRemove: false, seq: ++this.seq });
    this.drawerOpen.set(true);
  }

  protected resendInvitation(member: TeamMember): void {
    void this.store.resendInvitation(member.id);
  }
}
