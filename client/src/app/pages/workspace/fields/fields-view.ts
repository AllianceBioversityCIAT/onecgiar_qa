import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaSelect, QaSelectOption } from '../../../ui';
import {
  FieldChangeGroupVm,
  FieldChangeVm,
  FieldRowVm,
  FieldSectionVm,
  countFields,
  defaultOf,
  describeChange,
  effective,
  fieldsFor,
  initialDraft,
  initialPublished,
  isActive,
  sameConfig,
} from './fields-config';
import { FieldsColumnHeader } from './fields-column-header';
import { FieldsPublishConfirm } from './fields-publish-confirm';
import { FieldRowEvent, FieldsSection } from './fields-section';
import {
  FIELD_DEFS,
  FIELD_SECTIONS,
  FieldConfig,
  FieldConfigMap,
  FieldDef,
  FieldState,
  INNOVATION_DEVELOPMENT,
  RESULT_TYPES,
} from './fields.mock';

type ConfigByType = Readonly<Record<string, FieldConfigMap>>;

/** Matrix width under which rows switch to the two-line layout (mockup: 900px). */
const COMPACT_BELOW = 900;

/** "Fields in QA": which reporting fields each result type is assessed on, and how. */
@Component({
  selector: 'qa-fields-view',
  templateUrl: './fields-view.html',
  imports: [HlmButton, QaSelect, FieldsColumnHeader, FieldsSection, FieldsPublishConfirm],
})
export class FieldsView {


  // ── State ──────────────────────────────────────────────────────────────
  protected readonly resultType = signal(INNOVATION_DEVELOPMENT);
  /** Unpublished configuration per result type (kept while switching types). */
  private readonly drafts = signal<ConfigByType>({});
  /** Published configuration per result type. */
  private readonly published = signal<ConfigByType>({});
  private readonly collapsed = signal<Readonly<Record<string, boolean>>>({});
  private readonly confirmRequested = signal(false);
  /** Table filters: the state chip and the "Core only" toggle. */
  protected readonly stateFilter = signal<FieldState | 'all'>('all');
  protected readonly coreOnly = signal(false);
  /** Rows edited while a filter is on stay visible until the filter or the type changes. */
  private readonly kept = signal<ReadonlySet<string>>(new Set());
  /** Width of the matrix column (measured on the summary grid, which has the same width). */
  private readonly contentWidth = signal(0);
  protected readonly headerStuck = signal(false);

  // ── Derived ────────────────────────────────────────────────────────────
  private readonly draft = computed(() => this.draftOf(this.resultType()));
  private readonly base = computed(() => this.publishedOf(this.resultType()));
  private readonly defs = computed(() => fieldsFor(this.resultType()));
  private readonly counts = computed(() => countFields(this.resultType(), this.draft()));

  /** Unpublished changes of every result type (publishing is page-wide), in selector order. */
  protected readonly changeGroups = computed<readonly FieldChangeGroupVm[]>(() =>
    RESULT_TYPES.map((t) => ({ type: t.name, changes: this.changesOf(t.name) })).filter((g) => g.changes.length > 0),
  );
  protected readonly changeCount = computed(() => this.changeGroups().reduce((n, g) => n + g.changes.length, 0));
  /** "in Innovation development" or "in 2 result types". */
  protected readonly changeScope = computed(() => {
    const groups = this.changeGroups();
    return groups.length === 1 ? 'in ' + groups[0].type : `in ${groups.length} result types`;
  });
  protected readonly showConfirm = computed(() => this.confirmRequested() && this.changeCount() > 0);
  /** What the last bulk action did, for the header status once nothing is pending. Cleared by any edit. */
  protected readonly lastAction = signal<'published' | 'discarded' | null>(null);

  protected readonly typeOptions = computed<readonly QaSelectOption[]>(() =>
    RESULT_TYPES.map((t) => {
      const assessed = countFields(t.name, this.draftOf(t.name)).assessed;
      const pending = this.changesOf(t.name).length;
      const unpublished = pending ? ` · ${pending} unpublished` : '';
      return { value: t.name, label: t.name, description: `${assessed} fields assessed${unpublished}` };
    }),
  );

  /** State chips above the table; each count is the number of rows that chip shows. */
  protected readonly stateFilters = computed(() => {
    const c = this.counts();
    return [
      { value: 'all' as const, label: 'All fields', count: c.total },
      { value: 'hidden' as const, label: 'Hidden', count: c.hidden },
      { value: 'view' as const, label: 'View only', count: c.view },
      { value: 'assessed' as const, label: 'Assessed', count: c.assessedOnly },
      { value: 'third' as const, label: 'Third-party', count: c.third },
    ];
  });
  protected readonly coreCount = computed(() => this.counts().core);
  protected readonly filtering = computed(() => this.stateFilter() !== 'all' || this.coreOnly());

  protected readonly hasAssessed = computed(() => this.counts().assessed > 0);

  protected readonly compact = computed(() => this.contentWidth() > 0 && this.contentWidth() < COMPACT_BELOW);

  /** Rows that pass the chips, plus rows edited while filtering (so a row does not vanish under the pointer). */
  private matches(f: FieldDef, cfg: FieldConfig): boolean {
    if (this.kept().has(f.id)) return true;
    const e = effective(cfg);
    const state = this.stateFilter();
    return (state === 'all' || e.state === state) && (!this.coreOnly() || e.core);
  }

  protected readonly sections = computed<readonly FieldSectionVm[]>(() => {
    const draft = this.draft();
    const defs = this.defs();
    const shown = defs.filter((f) => this.matches(f, draft[f.id]));
    const base = this.base();
    const collapsed = this.collapsed();
    // Sections with no matching row are left out; their "N of M assessed" still counts the whole section.
    return FIELD_SECTIONS.filter((s) => shown.some((f) => f.section === s.id)).map((s) => {
      const fields = defs.filter((f) => f.section === s.id);
      const open = !collapsed[s.id];
      return {
        id: s.id,
        name: s.name,
        open,
        total: fields.length,
        assessed: fields.filter((f) => isActive(draft[f.id].state)).length,
        rows: open ? shown.filter((f) => f.section === s.id).map((f) => rowVm(f, draft[f.id], base[f.id])) : [],
      };
    });
  });

  // ── Layout observers ───────────────────────────────────────────────────
  private readonly summaryGrid = viewChild.required<ElementRef<HTMLElement>>('summaryGrid');
  private readonly stickSentinel = viewChild<ElementRef<HTMLElement>>('stickSentinel');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.summaryGrid().nativeElement;
      const observer = new ResizeObserver(() => this.contentWidth.set(el.clientWidth));
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
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
  protected selectType(type: string | null): void {
    if (!type || type === this.resultType()) return;
    this.resultType.set(type);
    this.confirmRequested.set(false);
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

  protected resetToDefault(id: string): void {
    const def = FIELD_DEFS.find((f) => f.id === id);
    if (def) this.patch(id, defaultOf(def));
  }

  protected openConfirm(): void {
    this.confirmRequested.set(true);
  }

  protected cancelConfirm(): void {
    this.confirmRequested.set(false);
  }

  /** Publishes the draft of every result type that has changes. */
  protected publish(): void {
    const types = this.changeGroups().map((g) => g.type);
    // TODO(api): publish the draft configuration of each of these result types (the API may take one type per call);
    // on success keep the local copies as published.
    this.published.update((all) => ({ ...all, ...Object.fromEntries(types.map((t) => [t, this.draftOf(t)])) }));
    this.confirmRequested.set(false);
    this.lastAction.set('published');
  }

  /** Undo one change from the review: the field goes back to its published configuration. */
  protected undoChange(e: { type: string; id: string }): void {
    const published = this.publishedOf(e.type)[e.id];
    if (published) this.patch(e.id, published, e.type);
  }

  /** Discards the unpublished changes of every result type. */
  protected discard(): void {
    const types = this.changeGroups().map((g) => g.type);
    this.drafts.update((all) => ({ ...all, ...Object.fromEntries(types.map((t) => [t, this.publishedOf(t)])) }));
    this.confirmRequested.set(false);
    this.lastAction.set('discarded');
  }

  /** Empty state: copy the setup of another type (Innovation development, or Knowledge product from it). */
  protected copyFromAnotherType(): void {
    const type = this.resultType();
    const source = this.draftOf(type === INNOVATION_DEVELOPMENT ? 'Knowledge product' : INNOVATION_DEVELOPMENT);
    const next: Record<string, FieldConfig> = { ...this.draft() };
    for (const id of Object.keys(next)) {
      if (source[id]) next[id] = { ...source[id] };
    }
    this.drafts.update((all) => ({ ...all, [type]: next }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private draftOf(type: string): FieldConfigMap {
    return this.drafts()[type] ?? initialDraft(type);
  }

  /** Fields of a result type whose draft differs from what is published. */
  private publishedOf(type: string): FieldConfigMap {
    return this.published()[type] ?? initialPublished(type);
  }

  private changesOf(type: string): readonly FieldChangeVm[] {
    const draft = this.draftOf(type);
    const base = this.publishedOf(type);
    return fieldsFor(type)
      .filter((f) => !sameConfig(effective(draft[f.id]), effective(base[f.id])))
      .map((f) => ({ id: f.id, name: f.name, description: describeChange(effective(base[f.id]), effective(draft[f.id])) }));
  }

  private patch(id: string, patch: Partial<FieldConfig>, type = this.resultType()): void {
    this.lastAction.set(null);
    if (this.filtering() && type === this.resultType()) this.kept.update((ids) => new Set(ids).add(id));
    this.drafts.update((all) => {
      const draft = all[type] ?? initialDraft(type);
      return { ...all, [type]: { ...draft, [id]: { ...draft[id], ...patch } } };
    });
  }
}

function rowVm(f: FieldDef, cfg: FieldConfig, published: FieldConfig): FieldRowVm {
  const eff = effective(cfg);
  const common = f.section !== 'detail';
  const isDefault = common && sameConfig(eff, effective(defaultOf(f)));
  return {
    id: f.id,
    name: f.name,
    doc: f.doc,
    required: f.required,
    config: cfg,
    effective: eff,
    active: isActive(cfg.state),
    changed: !sameConfig(eff, effective(published)),
    dim: cfg.state === 'hidden',
    isDefault,
    isException: common && !isDefault,
    requiredHidden: f.required && (cfg.state === 'hidden' || cfg.state === 'view'),
  };
}
