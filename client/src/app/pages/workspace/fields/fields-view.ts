import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaSelect, QaSelectOption } from '../../../ui';
import {
  ASSESSED_OFFSETS,
  FieldChangeVm,
  FieldRowVm,
  FieldSectionVm,
  SUMMARY_OFFSETS,
  configurationCsv,
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
  ACTIVE_STEP_NOTICE,
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
  private readonly document = inject(DOCUMENT);

  protected readonly notice = ACTIVE_STEP_NOTICE;

  // ── State ──────────────────────────────────────────────────────────────
  protected readonly resultType = signal(INNOVATION_DEVELOPMENT);
  /** Unpublished configuration per result type (kept while switching types). */
  private readonly drafts = signal<ConfigByType>({});
  /** Published configuration per result type. */
  private readonly published = signal<ConfigByType>({});
  private readonly collapsed = signal<Readonly<Record<string, boolean>>>({});
  private readonly confirmRequested = signal(false);
  /** Width of the matrix column (measured on the summary grid, which has the same width). */
  private readonly contentWidth = signal(0);
  protected readonly headerStuck = signal(false);

  // ── Derived ────────────────────────────────────────────────────────────
  private readonly draft = computed(() => this.draftOf(this.resultType()));
  private readonly base = computed(() => this.published()[this.resultType()] ?? initialPublished(this.resultType()));
  private readonly defs = computed(() => fieldsFor(this.resultType()));
  private readonly counts = computed(() => countFields(this.resultType(), this.draft()));

  protected readonly changes = computed<readonly FieldChangeVm[]>(() => {
    const draft = this.draft();
    const base = this.base();
    return this.defs()
      .filter((f) => !sameConfig(effective(draft[f.id]), effective(base[f.id])))
      .map((f) => ({ id: f.id, name: f.name, description: describeChange(effective(base[f.id]), effective(draft[f.id])) }));
  });
  protected readonly showConfirm = computed(() => this.confirmRequested() && this.changes().length > 0);

  protected readonly typeOptions = computed<readonly QaSelectOption[]>(() =>
    RESULT_TYPES.map((t) => {
      const assessed = countFields(t.name, this.draftOf(t.name)).assessed + ASSESSED_OFFSETS[t.name];
      return { value: t.name, label: t.name, description: `${assessed} fields assessed` };
    }),
  );

  protected readonly summary = computed(() => {
    const c = this.counts();
    return [
      { value: c.total + SUMMARY_OFFSETS.total, label: 'Fields in the form' },
      { value: c.hidden + SUMMARY_OFFSETS.hidden, label: 'Hidden in QA' },
      { value: c.view + SUMMARY_OFFSETS.view, label: 'View only' },
      { value: c.assessedOnly + SUMMARY_OFFSETS.assessedOnly, label: 'Assessed' },
      { value: c.third + SUMMARY_OFFSETS.third, label: 'Third-party' },
      { value: c.core + SUMMARY_OFFSETS.core, label: 'Core' },
    ];
  });

  protected readonly hasAssessed = computed(() => this.counts().assessed > 0);

  protected readonly compact = computed(() => this.contentWidth() > 0 && this.contentWidth() < COMPACT_BELOW);
  protected readonly summaryCols = computed(() => {
    const w = this.contentWidth();
    if (w > 0 && w < 560) return 'grid-cols-2';
    if (w > 0 && w < COMPACT_BELOW) return 'grid-cols-3';
    return 'grid-cols-6';
  });

  protected readonly sections = computed<readonly FieldSectionVm[]>(() => {
    const defs = this.defs();
    const draft = this.draft();
    const base = this.base();
    const collapsed = this.collapsed();
    return FIELD_SECTIONS.filter((s) => defs.some((f) => f.section === s.id)).map((s) => {
      const fields = defs.filter((f) => f.section === s.id);
      const open = !collapsed[s.id];
      return {
        id: s.id,
        name: s.name,
        open,
        total: fields.length,
        assessed: fields.filter((f) => isActive(draft[f.id].state)).length,
        rows: open ? fields.map((f) => rowVm(f, draft[f.id], base[f.id])) : [],
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

  protected publish(): void {
    const type = this.resultType();
    // TODO(api): publish the draft configuration of this result type; on success keep the local copy as published.
    this.published.update((all) => ({ ...all, [type]: this.draft() }));
    this.confirmRequested.set(false);
  }

  protected discard(): void {
    const type = this.resultType();
    this.drafts.update((all) => ({ ...all, [type]: this.base() }));
    this.confirmRequested.set(false);
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

  protected download(): void {
    const type = this.resultType();
    // TODO(api): download the "Field configuration" export from the server. Built locally from the draft for now.
    const csv = configurationCsv(type, this.draft());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = this.document.createElement('a');
    link.href = url;
    link.download = `qa-fields-${type.toLowerCase().replace(/\s+/g, '-')}.csv`;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private draftOf(type: string): FieldConfigMap {
    return this.drafts()[type] ?? initialDraft(type);
  }

  private patch(id: string, patch: Partial<FieldConfig>): void {
    const type = this.resultType();
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
