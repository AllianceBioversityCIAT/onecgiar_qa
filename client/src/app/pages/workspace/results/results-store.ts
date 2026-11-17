import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  QaStatus,
  WorklistCounters,
  WorklistOptions,
  WorklistQuery,
  WorklistRow,
  WorklistSort,
  WorklistTimeline,
} from '../../../core/api/assessment.models';
import { toApiError } from '../../../core/http/api-envelope';
import { readOnlyReasonOf } from './results.mapper';

export type ResultsState = 'loading' | 'ready' | 'error';

/** The filters a /results URL or the menus set. Lists are ANDed on the server. */
export interface ResultsFilters {
  /** `null` = the default timeline the server names. */
  readonly timelineId: number | null;
  readonly statuses: readonly QaStatus[];
  readonly programIds: readonly number[];
  readonly typeKeys: readonly string[];
  readonly q: string;
}

export const NO_FILTERS: ResultsFilters = { timelineId: null, statuses: [], programIds: [], typeKeys: [], q: '' };

/** Rows per request ("Load more" asks for the next ones). */
export const PAGE_LIMIT = 25;

const NO_OPTIONS: WorklistOptions = { programs: [], resultTypes: [], statuses: [] };
const NO_COUNTERS: WorklistCounters = { pending: 0, finished: 0, total: 0 };

/**
 * State of the Results page on the worklist API (design § 8, T-18). Filtering, search and sorting run
 * on the server; the page only keeps what it was sent. Every new query bumps a generation number, so
 * an answer that arrives after a newer query started is dropped (no flicker back to old rows).
 */
@Injectable()
export class ResultsStore {
  private readonly api = inject(AssessmentApi);

  readonly state = signal<ResultsState>('loading');
  readonly error = signal('');
  readonly timelines = signal<readonly WorklistTimeline[]>([]);
  readonly timelineId = signal<number | null>(null);
  readonly options = signal<WorklistOptions>(NO_OPTIONS);
  readonly rows = signal<readonly WorklistRow[]>([]);
  readonly counters = signal<WorklistCounters>(NO_COUNTERS);
  readonly writable = signal(false);
  readonly noActiveRole = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);
  /** "Load more" failed: the rows already shown stay; the button offers to try again. */
  readonly moreError = signal('');
  /** A refresh after the first load: the table stays, only the request is running. */
  readonly refreshing = signal(false);

  private filters: ResultsFilters = NO_FILTERS;
  private sort: { readonly key: WorklistSort; readonly dir: 'asc' | 'desc' } | null = null;
  private generation = 0;

  readonly timeline = computed(() => this.timelines().find((t) => t.id === this.timelineId()) ?? null);
  readonly readOnlyReason = computed(() => readOnlyReasonOf(this.timeline(), this.writable()));

  /** First load, a new URL, or "Try again": timelines, then the options and the first page of the chosen one. */
  async load(filters: ResultsFilters = this.filters): Promise<void> {
    this.filters = filters;
    const gen = ++this.generation;
    this.state.set('loading');
    try {
      const answer = await firstValueFrom(this.api.timelines());
      if (gen !== this.generation) return;
      this.timelines.set(answer.timelines);
      // A timeline in the URL that is not offered to the caller falls back to the default (dropped like any unknown value).
      const wanted = filters.timelineId;
      const id = wanted !== null && answer.timelines.some((t) => t.id === wanted) ? wanted : answer.defaultTimelineId;
      this.timelineId.set(id);
      if (id === null) {
        this.clearPage();
        this.options.set(NO_OPTIONS);
        this.state.set('ready');
        return;
      }
      const [options] = await Promise.all([firstValueFrom(this.api.worklistOptions(id)), this.fetchFirst(gen)]);
      if (gen !== this.generation) return;
      this.options.set(options);
      this.state.set('ready');
    } catch (error) {
      if (gen !== this.generation) return;
      this.fail(error);
    }
  }

  /** Another timeline from the picker: its options change too. The other filters stay. */
  async selectTimeline(id: number): Promise<void> {
    if (id === this.timelineId()) return;
    await this.load({ ...this.filters, timelineId: id });
  }

  /** A menu, the search box or a chip changed: same timeline, first page again. */
  async setFilters(filters: Omit<ResultsFilters, 'timelineId'>): Promise<void> {
    this.filters = { ...filters, timelineId: this.timelineId() };
    await this.refresh();
  }

  /** Sorted on the server; `null` = the default order (by code). */
  async setSort(sort: { readonly key: WorklistSort; readonly dir: 'asc' | 'desc' } | null): Promise<void> {
    this.sort = sort;
    await this.refresh();
  }

  /** The next rows of the same query (the cursor is only valid with the same sort and dir). */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    const id = this.timelineId();
    if (!cursor || id === null || this.loadingMore()) return;
    const gen = this.generation;
    this.loadingMore.set(true);
    this.moreError.set('');
    try {
      const page = await firstValueFrom(this.api.worklist(id, { ...this.query(), cursor }));
      if (gen !== this.generation) return;
      this.rows.update((rows) => [...rows, ...page.rows]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (gen !== this.generation) return;
      this.moreError.set(toApiError(error).message);
    } finally {
      if (gen === this.generation) this.loadingMore.set(false);
    }
  }

  private async refresh(): Promise<void> {
    if (this.timelineId() === null) return;
    const gen = ++this.generation;
    this.refreshing.set(true);
    try {
      await this.fetchFirst(gen);
      if (gen !== this.generation) return;
      this.state.set('ready');
    } catch (error) {
      if (gen !== this.generation) return;
      this.fail(error);
    } finally {
      if (gen === this.generation) this.refreshing.set(false);
    }
  }

  private async fetchFirst(gen: number): Promise<void> {
    const id = this.timelineId();
    if (id === null) return;
    const page = await firstValueFrom(this.api.worklist(id, this.query()));
    if (gen !== this.generation) return;
    this.rows.set(page.rows);
    this.counters.set(page.counters);
    this.writable.set(page.writable);
    this.noActiveRole.set(page.noActiveRole);
    this.nextCursor.set(page.nextCursor);
    this.loadingMore.set(false);
    this.moreError.set('');
  }

  private query(): WorklistQuery {
    const f = this.filters;
    return {
      status: f.statuses,
      programId: f.programIds,
      resultTypeKey: f.typeKeys,
      q: f.q.trim().slice(0, 200),
      ...(this.sort ? { sort: this.sort.key, dir: this.sort.dir } : {}),
      limit: PAGE_LIMIT,
    };
  }

  private clearPage(): void {
    this.rows.set([]);
    this.counters.set(NO_COUNTERS);
    this.writable.set(false);
    this.noActiveRole.set(false);
    this.nextCursor.set(null);
  }

  private fail(error: unknown): void {
    this.error.set(toApiError(error).message);
    this.state.set('error');
  }
}
