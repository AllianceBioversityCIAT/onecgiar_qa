import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { CatalogsApi } from '../../../core/api/catalogs-api';
import { CyclesApi } from '../../../core/api/cycles-api';
import { CYCLE_ERROR, Cycle, DefaultStep } from '../../../core/api/cycles.models';
import { ApiFieldError, toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { CreateDraft, CycleCatalogs, OFFICIAL_ID, toCreateBody, toUpdateBody, toViewTimeline } from './cycle.mapper';
import { Timeline } from './cycle.mock';

export type CycleLoadState = 'loading' | 'ready' | 'no-cycle' | 'error';

export type TimelineSaveOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      /** Field problems as the server lists them (`name`, `programIds`, `steps[2].closesAt`…). */
      readonly fields: readonly ApiFieldError[];
      /** 409 TIMELINES_IN_PROGRESS_UNCONFIRMED: ask the admin, then save again with confirm = true. */
      readonly needsConfirm?: boolean;
      /** 409 TIMELINES_VERSION_STALE: the list was reloaded; close the drawer and say so. */
      readonly stale?: boolean;
    };

/**
 * State and actions of the Cycle view (provided by the view). Shows the active cycle: its official
 * timeline and its sub-timelines, mapped to the design's view model. Every write answers the whole
 * timeline, which replaces the card; nothing is patched locally.
 */
@Injectable()
export class CycleStore {
  private readonly api = inject(CyclesApi);
  private readonly catalogsApi = inject(CatalogsApi);
  private readonly toasts = inject(Toasts);

  private readonly all = signal<readonly Timeline[]>([]);
  private readonly catalogState = signal<CycleCatalogs>({ programs: [], types: [] });

  readonly state = signal<CycleLoadState>('loading');
  readonly loadError = signal('');
  readonly cycle = signal<Cycle | null>(null);
  readonly defaults = signal<readonly DefaultStep[]>([]);
  /** Catalogs that failed (CLARISA / Reporting down): names fall back to ids and their pickers turn off. */
  readonly missingCatalogs = signal<readonly ('types' | 'programs' | 'step proposal')[]>([]);
  /** Only the newest load writes its answer (a retry click or a quiet reload never lets an older one win). */
  private loadSeq = 0;
  readonly catalogs = this.catalogState.asReadonly();

  readonly official = computed(() => this.all().find((t) => t.id === OFFICIAL_ID) ?? null);
  readonly subTimelines = computed(() => this.all().filter((t) => t.id !== OFFICIAL_ID));
  readonly programOptions = computed(() => this.catalogState().programs.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })));
  readonly typeOptions = computed(() => this.catalogState().types.map((t) => ({ value: t.name, label: t.name })));
  /** A closed cycle takes no new timeline and no edit (409 CYCLES_CLOSED). */
  readonly canWrite = computed(() => this.cycle()?.status !== 'closed');

  programName(code: string): string {
    return this.catalogState().programs.find((p) => p.code === code)?.name ?? '';
  }

  /** `quiet`: refresh in place (after a stale edit) without the loading state. */
  async load(quiet = false): Promise<void> {
    if (!quiet) this.state.set('loading');
    const seq = ++this.loadSeq;
    const missing: ('types' | 'programs' | 'step proposal')[] = [];
    const optional = <T>(list: Observable<readonly T[]>, name: 'types' | 'programs') =>
      list.pipe(catchError(() => (missing.push(name), of([] as readonly T[]))));
    try {
      const { cycles, programs, types, defaults } = await firstValueFrom(
        forkJoin({
          cycles: this.api.list(),
          programs: optional(this.catalogsApi.sciencePrograms(), 'programs'),
          types: optional(this.catalogsApi.resultTypes(), 'types'),
          defaults: this.api.defaults().pipe(catchError(() => (missing.push('step proposal'), of([] as readonly DefaultStep[])))),
        }),
      );
      if (seq !== this.loadSeq) return;
      this.missingCatalogs.set(missing);
      this.catalogState.set({ programs, types });
      this.defaults.set(defaults);
      const active = cycles.find((c) => c.status === 'active') ?? null;
      this.cycle.set(active);
      if (!active) {
        this.all.set([]);
        this.state.set('no-cycle');
        return;
      }
      const timelines = await firstValueFrom(this.api.timelines(active.id));
      if (seq !== this.loadSeq) return;
      this.all.set(timelines.map((t) => toViewTimeline(t, { programs, types })));
      this.state.set('ready');
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.loadError.set(toApiError(error).message);
      this.state.set('error');
    }
  }

  async create(draft: CreateDraft): Promise<TimelineSaveOutcome> {
    const cycle = this.cycle();
    if (!cycle) return { ok: false, message: 'There is no active cycle to add the timeline to.', fields: [] };
    try {
      const created = await firstValueFrom(this.api.createTimeline(cycle.id, toCreateBody(draft, this.catalogState())));
      const view = toViewTimeline(created, this.catalogState());
      // Same order as the server: official first, then newest first.
      this.all.update((list) => {
        const official = list.filter((t) => t.id === OFFICIAL_ID);
        const subs = list.filter((t) => t.id !== OFFICIAL_ID);
        return view.id === OFFICIAL_ID ? [view, ...subs] : [...official, view, ...subs];
      });
      this.toasts.success(`${created.name} was created.`);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  /** `confirm`: the admin already agreed to change a step in progress (sent up front, no 409 round trip). */
  async update(before: Timeline, draft: CreateDraft, confirm = false): Promise<TimelineSaveOutcome> {
    const body = toUpdateBody(before, draft, this.catalogState());
    if (!body || before.apiId == null) return { ok: true };
    try {
      const saved = await firstValueFrom(
        this.api.updateTimeline(before.apiId, before.name, confirm ? { ...body, confirmInProgress: true } : body),
      );
      const view = toViewTimeline(saved, this.catalogState());
      this.all.update((list) => list.map((t) => (t.apiId === saved.id ? view : t)));
      this.toasts.success(`${saved.name} was saved.`);
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      if (e.code === CYCLE_ERROR.TIMELINES_IN_PROGRESS_UNCONFIRMED) return { ok: false, message: e.message, fields: [], needsConfirm: true };
      if (e.code === CYCLE_ERROR.TIMELINES_VERSION_STALE) {
        // Someone else saved first: show what is stored now and let the admin redo the change.
        await this.load(true);
        return { ok: false, message: 'Someone else changed this timeline. We reloaded it: review it and make your change again.', fields: [], stale: true };
      }
      return failure(error);
    }
  }
}

function failure(error: unknown): TimelineSaveOutcome & { ok: false } {
  const e = toApiError(error);
  return { ok: false, message: e.fields.length ? 'Fix the marked fields and save again.' : e.message, fields: e.fields };
}
