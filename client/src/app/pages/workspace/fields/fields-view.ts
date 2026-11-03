import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { FieldConfigField, FieldConfigResultType, PublishTimelines } from '../../../core/api/field-config.models';
import { QaButtonImports, QaSelect, QaSelectOption, QaSkeleton } from '../../../ui';
import {
  FieldChangeGroupVm,
  FieldConfig,
  FieldSectionVm,
  FieldState,
  countFields,
  describeChange,
  effective,
  fieldsOf,
  fromOptions,
  isActive,
  rowVm,
} from './fields-config';
import { FieldsColumnHeader } from './fields-column-header';
import { FIELD_STATES } from './fields-copy';
import { FieldsPublishConfirm } from './fields-publish-confirm';
import { FieldRowEvent, FieldsSection } from './fields-section';
import { FieldsSkeleton } from './fields-skeleton';
import { FieldsStore } from './fields-store';

/** Matrix width under which rows switch to the two-line layout (mockup: 900px). */
const COMPACT_BELOW = 900;

/** "Fields in QA": which reporting fields each result type is assessed on, and how. */
@Component({
  selector: 'qa-fields-view',
  templateUrl: './fields-view.html',
  imports: [QaButtonImports, QaSelect, QaSkeleton, FieldsColumnHeader, FieldsSection, FieldsPublishConfirm, FieldsSkeleton],
  providers: [FieldsStore],
})
export class FieldsView {
  protected readonly store = inject(FieldsStore);

  // ── State ──────────────────────────────────────────────────────────────
  private readonly types = computed(() => this.store.view()?.resultTypes ?? []);
  /** Result type being configured: kept while it exists, else the first one. */
  protected readonly resultType = linkedSignal<readonly FieldConfigResultType[], string>({
    source: this.types,
    computation: (types, previous) =>
      types.some((t) => t.key === previous?.value) ? previous!.value : (types[0]?.key ?? ''),
  });
  private readonly collapsed = signal<Readonly<Record<string, boolean>>>({});
  /** Table filters: the state chip and the "Core only" toggle. */
  protected readonly stateFilter = signal<FieldState | 'all'>('all');
  protected readonly coreOnly = signal(false);
  /** Rows edited while a filter is on stay visible until the filter or the type changes. */
  private readonly kept = signal<ReadonlySet<string>>(new Set());
  /** Width of the matrix column (measured on the summary grid, which has the same width). */
  private readonly contentWidth = signal(0);
  protected readonly headerStuck = signal(false);

  // ── Derived ────────────────────────────────────────────────────────────
  private readonly type = computed(() => this.types().find((t) => t.key === this.resultType()) ?? null);
  private readonly counts = computed(() => {
    const type = this.type();
    return countFields(type ? fieldsOf(type).map((f) => this.configOf(type.key, f)) : []);
  });

  /** Unpublished changes of every result type (publishing is page-wide), in selector order. */
  protected readonly changeGroups = computed<readonly FieldChangeGroupVm[]>(() =>
    this.types()
      .map((t) => ({ typeKey: t.key, type: t.label, changes: this.changesOf(t) }))
      .filter((g) => g.changes.length > 0),
  );
  protected readonly changeCount = computed(() => this.changeGroups().reduce((n, g) => n + g.changes.length, 0));
  /** "in Innovation development" or "in 2 result types". */
  protected readonly changeScope = computed(() => {
    const groups = this.changeGroups();
    return groups.length === 1 ? 'in ' + groups[0].type : `in ${groups.length} result types`;
  });
  /** The review pop-up lists what the server will publish (its preview), not the local count. */
  protected readonly reviewGroups = computed<readonly FieldChangeGroupVm[]>(() => {
    const changes = this.store.review()?.preview.changes ?? [];
    return this.types()
      .map((t) => ({
        typeKey: t.key,
        type: t.label,
        changes: changes
          .filter((c) => c.resultTypeKey === t.key)
          .map((c) => ({
            id: c.fieldKey,
            name: fieldsOf(t).find((f) => f.key === c.fieldKey)?.label ?? c.fieldKey,
            description: describeChange(effective(fromOptions(c.before)), effective(fromOptions(c.after))),
          })),
      }))
      .filter((g) => g.changes.length > 0);
  });
  protected readonly noTimelines: PublishTimelines = { receive: [], keep: [] };
  protected readonly openingReview = signal(false);
  protected readonly reviewBusy = computed(() => this.store.publishing() || this.store.discarding() || this.store.saving());
  /** What the last bulk action did, shown in the publish bar for a few seconds once nothing is pending. Cleared by any edit. */
  protected readonly lastAction = signal<'published' | 'discarded' | null>(null);
  private lastActionTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly cycleOptions = computed<readonly QaSelectOption[]>(() =>
    this.store.cycles().map((c) => ({
      value: String(c.id),
      label: c.name,
      description: c.status === 'active' ? 'Active cycle' : 'Draft cycle',
    })),
  );
  protected readonly cycleValue = computed(() => (this.store.cycle() ? String(this.store.cycle()!.id) : null));

  protected readonly typeOptions = computed<readonly QaSelectOption[]>(() =>
    this.types().map((t) => {
      const assessed = countFields(fieldsOf(t).map((f) => this.configOf(t.key, f))).assessed;
      const pending = this.changesOf(t).length;
      const unpublished = pending ? ` · ${pending} unpublished` : '';
      return { value: t.key, label: t.label, description: `${assessed} fields assessed${unpublished}` };
    }),
  );

  /** State chips above the table; each count is the number of rows that chip shows. */
  protected readonly stateFilters = computed(() => {
    const c = this.counts();
    return [
      { value: 'all' as const, label: 'All fields', count: c.total },
      { value: 'hidden' as const, label: 'Hidden', count: c.hidden },
      { value: 'view_only' as const, label: 'View only', count: c.view },
      { value: 'assessed' as const, label: 'Assessed', count: c.assessed },
    ];
  });
  protected readonly coreCount = computed(() => this.counts().core);
  protected readonly filtering = computed(() => this.stateFilter() !== 'all' || this.coreOnly());

  protected readonly hasAssessed = computed(() => this.counts().assessed > 0);
  protected readonly readOnly = computed(() => !this.store.canWrite());

  protected readonly compact = computed(() => this.contentWidth() > 0 && this.contentWidth() < COMPACT_BELOW);

  /** Fields the catalog no longer lists for their type (read only). */
  protected readonly notInCatalog = computed(() => {
    const types = this.types();
    return (this.store.view()?.notInCatalog ?? []).map((f) => ({
      key: `${f.resultTypeKey}/${f.fieldKey}`,
      type: types.find((t) => t.key === f.resultTypeKey)?.label ?? f.resultTypeKey,
      field: f.fieldKey,
      state: FIELD_STATES.find((s) => s.value === f.draft.visibility)?.label ?? f.draft.visibility,
    }));
  });

  /** Rows that pass the chips, plus rows edited while filtering (so a row does not vanish under the pointer). */
  private matches(f: FieldConfigField, cfg: FieldConfig): boolean {
    if (this.kept().has(f.key)) return true;
    const e = effective(cfg);
    const state = this.stateFilter();
    return (state === 'all' || e.state === state) && (!this.coreOnly() || e.core);
  }

  protected readonly sections = computed<readonly FieldSectionVm[]>(() => {
    const type = this.type();
    if (!type) return [];
    const collapsed = this.collapsed();
    // Sections with no matching row are left out; their "N of M assessed" still counts the whole section.
    return type.sections
      .map((s) => {
        const configs = s.fields.map((f) => this.configOf(type.key, f));
        const shown = s.fields.filter((f, i) => this.matches(f, configs[i]));
        const open = !collapsed[s.key];
        return {
          id: s.key,
          name: s.label,
          open,
          total: s.fields.length,
          assessed: configs.filter((c) => isActive(c.state)).length,
          shown: shown.length,
          rows: open
            ? shown.map((f) => rowVm(f, this.configOf(type.key, f), f.unclassified && !this.store.hasOverride(type.key, f.key)))
            : [],
        };
      })
      .filter((s) => s.shown > 0)
      .map(({ shown: _shown, ...s }) => s);
  });

  /** Widths of the filter chips while they load (All fields, Hidden, View only, Assessed). */
  protected readonly chipWidths = ['w-[88px]', 'w-[74px]', 'w-[82px]', 'w-[86px]'];

  /** Where each section starts in the one-after-another entrance: its bar, then its rows. */
  protected readonly revealFrom = computed(() => {
    let next = 0;
    return this.sections().map((s) => {
      const start = next;
      next += 1 + s.rows.length;
      return start;
    });
  });

  // ── Layout observers ───────────────────────────────────────────────────
  private readonly summaryGrid = viewChild<ElementRef<HTMLElement>>('summaryGrid');
  private readonly stickSentinel = viewChild<ElementRef<HTMLElement>>('stickSentinel');

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(this.lastActionTimer));
    void this.store.load();

    // The summary grid only exists once the configuration is loaded.
    effect((onCleanup) => {
      const el = this.summaryGrid()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.contentWidth.set(el.clientWidth));
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
    afterNextRender(() => {
      const el = this.summaryGrid()?.nativeElement;
      if (el) this.contentWidth.set(el.clientWidth);
    });

    // Square the header corners while it is stuck to the top of the scrolling <main>.
    effect((onCleanup) => {
      const sentinel = this.stickSentinel()?.nativeElement;
      if (!sentinel || typeof IntersectionObserver === 'undefined') {
        this.headerStuck.set(false);
        return;
      }
      const root = sentinel.closest('main');
      const observer = new IntersectionObserver(
        ([entry]) => {
          const top = entry.rootBounds?.top ?? 0;
          this.headerStuck.set(!entry.isIntersecting && entry.boundingClientRect.top < top);
        },
        { root, threshold: 0 },
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────
  protected selectCycle(id: string | null): void {
    if (id) void this.store.selectCycle(Number(id));
    this.kept.set(new Set());
  }

  protected selectType(type: string | null): void {
    if (!type || type === this.resultType()) return;
    this.resultType.set(type);
    this.lastAction.set(null);
    this.kept.set(new Set());
  }

  protected setStateFilter(value: FieldState | 'all'): void {
    this.stateFilter.set(value);
    this.kept.set(new Set());
  }

  protected toggleCoreOnly(): void {
    this.coreOnly.update((on) => !on);
    this.kept.set(new Set());
  }

  protected clearFilters(): void {
    this.stateFilter.set('all');
    this.coreOnly.set(false);
    this.kept.set(new Set());
  }

  protected toggleSection(id: string): void {
    this.collapsed.update((all) => ({ ...all, [id]: !all[id] }));
  }

  protected setState(e: FieldRowEvent<FieldState>): void {
    this.patch(e.id, { state: e.value });
  }

  protected setCore(e: FieldRowEvent<boolean>): void {
    this.patch(e.id, { core: e.value });
  }

  protected setAi(e: FieldRowEvent<boolean>): void {
    this.patch(e.id, { ai: e.value });
  }

  protected async openConfirm(): Promise<void> {
    if (this.openingReview()) return;
    this.openingReview.set(true);
    try {
      await this.store.openReview();
    } finally {
      this.openingReview.set(false);
    }
  }

  protected cancelConfirm(): void {
    this.store.closeReview();
  }

  protected async publish(): Promise<void> {
    if (await this.store.publish()) this.flash('published');
  }

  /** Undo one change from the review: the field goes back to its published configuration. */
  protected undoChange(e: { type: string; id: string }): void {
    void this.store.undo(e.type, e.id);
  }

  protected async discard(): Promise<void> {
    if (await this.store.discard()) this.flash('discarded');
  }

  protected retry(): void {
    void this.store.load();
  }

  /** Shows the outcome in the publish bar, then hides the bar. */
  private flash(action: 'published' | 'discarded'): void {
    clearTimeout(this.lastActionTimer);
    this.lastAction.set(action);
    this.lastActionTimer = setTimeout(() => this.lastAction.set(null), 4000);
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private configOf(typeKey: string, f: FieldConfigField): FieldConfig {
    return this.store.configOf(typeKey, f.key, fromOptions(f.draft));
  }

  /** Fields of a result type whose draft differs from what is published. */
  private changesOf(type: FieldConfigResultType) {
    return fieldsOf(type)
      .map((f) => ({ f, draft: effective(this.configOf(type.key, f)), base: effective(fromOptions(f.published)) }))
      .filter(({ draft, base }) => describeChange(base, draft) !== '')
      .map(({ f, draft, base }) => ({ id: f.key, name: f.label, description: describeChange(base, draft) }));
  }

  private patch(id: string, patch: Partial<FieldConfig>): void {
    const type = this.type();
    const field = type && fieldsOf(type).find((f) => f.key === id);
    if (!type || !field) return;
    this.lastAction.set(null);
    if (this.filtering()) this.kept.update((ids) => new Set(ids).add(id));
    // From what applies: a Core left on while the field was not assessed never comes back by itself.
    this.store.edit(type.key, id, { ...effective(this.configOf(type.key, field)), ...patch });
  }
}
