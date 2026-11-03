import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CyclesApi } from '../../../core/api/cycles-api';
import { Cycle } from '../../../core/api/cycles.models';
import { FieldConfigApi } from '../../../core/api/field-config-api';
import {
  FIELD_CONFIG_ERROR,
  FieldConfigEdit,
  FieldConfigPreview,
  FieldConfigView,
} from '../../../core/api/field-config.models';
import { toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { isRetryLater } from '../../../core/http/unsent-queue';
import { FieldConfig, editKey, fromOptions, toEdit } from './fields-config';

export type FieldsLoadState = 'loading' | 'ready' | 'no-cycle' | 'no-catalog' | 'error';

/** Review pop-up: the preview being shown, and why it was reloaded (409 stale / nothing to publish). */
export interface PublishReview {
  readonly preview: FieldConfigPreview;
  readonly notice: string;
}

interface PendingEdit {
  readonly typeKey: string;
  readonly fieldKey: string;
  readonly config: FieldConfig;
}

/**
 * State and actions of the Fields view (provided by the view). The draft lives on the server: every
 * click is shown at once (local override) and saved through one serial queue; edits made while a
 * save is in flight go together in the next `PATCH`. Every answer is the whole view, which replaces
 * the server copy.
 */
@Injectable()
export class FieldsStore {
  private readonly api = inject(FieldConfigApi);
  private readonly cyclesApi = inject(CyclesApi);
  private readonly toasts = inject(Toasts);

  readonly state = signal<FieldsLoadState>('loading');
  readonly loadError = signal('');
  /** Cycles whose fields can be configured (draft and active), newest year first. */
  readonly cycles = signal<readonly Cycle[]>([]);
  readonly cycle = signal<Cycle | null>(null);
  readonly view = signal<FieldConfigView | null>(null);
  /** Clicks not yet confirmed by the server, by `editKey`. */
  private readonly overrides = signal<ReadonlyMap<string, PendingEdit>>(new Map());
  /** Clicks not yet sent. */
  private pending = new Map<string, PendingEdit>();
  private flushing: Promise<void> | null = null;
  readonly saving = signal(false);

  readonly review = signal<PublishReview | null>(null);
  readonly publishing = signal(false);
  readonly discarding = signal(false);

  /** A closed cycle answers 409 CYCLES_CLOSED on every write. */
  readonly canWrite = computed(() => this.cycle()?.status !== 'closed');

  /** Only the newest load writes its answer. */
  private loadSeq = 0;

  /** The configuration shown for one field: the pending click, else the server draft. */
  configOf(typeKey: string, fieldKey: string, draft: FieldConfig): FieldConfig {
    return this.overrides().get(editKey(typeKey, fieldKey))?.config ?? draft;
  }

  hasOverride(typeKey: string, fieldKey: string): boolean {
    return this.overrides().has(editKey(typeKey, fieldKey));
  }

  async load(): Promise<void> {
    this.state.set('loading');
    const seq = ++this.loadSeq;
    try {
      const all = await firstValueFrom(this.cyclesApi.list());
      if (seq !== this.loadSeq) return;
      const open = all.filter((c) => c.status !== 'closed').sort((a, b) => b.year - a.year);
      this.cycles.set(open);
      const pick = open.find((c) => c.id === this.cycle()?.id) ?? open.find((c) => c.status === 'active') ?? open[0] ?? null;
      this.cycle.set(pick);
      if (!pick) {
        this.state.set('no-cycle');
        return;
      }
      await this.loadView(pick.id, seq);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.loadError.set(toApiError(error).message);
      this.state.set('error');
    }
  }

  async selectCycle(id: number): Promise<void> {
    const next = this.cycles().find((c) => c.id === id);
    if (!next || next.id === this.cycle()?.id) return;
    await this.settle();
    this.cycle.set(next);
    // Nothing of the previous cycle stays on screen (publish bar, counts) while this one loads.
    this.view.set(null);
    this.overrides.set(new Map());
    this.review.set(null);
    this.state.set('loading');
    const seq = ++this.loadSeq;
    try {
      await this.loadView(next.id, seq);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.view.set(null);
      this.loadError.set(toApiError(error).message);
      this.state.set('error');
    }
  }

  /** Shows the click at once and queues it for the server. */
  edit(typeKey: string, fieldKey: string, config: FieldConfig): void {
    if (!this.canWrite() || !this.view()) return;
    const item: PendingEdit = { typeKey, fieldKey, config };
    const key = editKey(typeKey, fieldKey);
    this.overrides.update((all) => new Map(all).set(key, item));
    this.pending.set(key, item);
    void this.flush();
  }

  /** Discards every unpublished change (back to the latest version). */
  async discard(): Promise<boolean> {
    const cycle = this.cycle();
    if (!cycle || this.discarding()) return false;
    this.discarding.set(true);
    try {
      await this.settle();
      this.view.set(await firstValueFrom(this.api.discardDraft(cycle.id)));
      this.overrides.set(new Map());
      this.review.set(null);
      return true;
    } catch (error) {
      this.failed(error, 'The changes could not be discarded.');
      return false;
    } finally {
      this.discarding.set(false);
    }
  }

  /** Opens the review: waits for the saves, then asks the server what would be published. */
  async openReview(): Promise<boolean> {
    const cycle = this.cycle();
    if (!cycle) return false;
    await this.settle();
    try {
      this.review.set({ preview: await firstValueFrom(this.api.preview(cycle.id)), notice: '' });
      return true;
    } catch {
      // A read: the interceptor already showed the error.
      return false;
    }
  }

  /** Not while publishing: the answer decides what the dialog shows next. */
  closeReview(): void {
    if (!this.publishing()) this.review.set(null);
  }

  /** Undo one change from the review: the field goes back to what is published, then the preview reloads. */
  async undo(typeKey: string, fieldKey: string): Promise<void> {
    const field = this.view()
      ?.resultTypes.find((t) => t.key === typeKey)
      ?.sections.flatMap((s) => s.fields)
      .find((f) => f.key === fieldKey);
    if (!field) return;
    this.edit(typeKey, fieldKey, fromOptions(field.published));
    await this.settle();
    await this.refreshReview('');
  }

  /** Publishes the reviewed draft (`revision` of the preview the admin saw). */
  async publish(): Promise<boolean> {
    const cycle = this.cycle();
    const review = this.review();
    if (!cycle || !review || this.publishing()) return false;
    this.publishing.set(true);
    try {
      const result = await firstValueFrom(this.api.publish(cycle.id, review.preview.revision));
      const reach = result.timelines.receive.length;
      const timelines = reach === 1 ? '1 timeline will use it' : `${reach} timelines will use it`;
      this.toasts.success(`Version ${result.version.number} published. ${timelines}.`);
      this.review.set(null);
      await this.reloadView();
      return true;
    } catch (error) {
      const code = toApiError(error).code;
      if (code === FIELD_CONFIG_ERROR.REVISION_STALE) {
        await this.reloadView();
        await this.refreshReview('The draft changed since you opened this review. Check the changes below and publish again.');
      } else if (code === FIELD_CONFIG_ERROR.NOTHING_TO_PUBLISH) {
        await this.reloadView();
        await this.refreshReview('There is nothing new to publish: the draft is the same as the latest version.');
      } else {
        this.failed(error, 'The fields could not be published.', true);
      }
      return false;
    } finally {
      this.publishing.set(false);
    }
  }

  /** Waits until every click is saved (or failed). */
  async settle(): Promise<void> {
    while (this.flushing) await this.flushing;
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private async loadView(cycleId: number, seq: number): Promise<void> {
    try {
      const view = await firstValueFrom(this.api.view(cycleId));
      if (seq !== this.loadSeq) return;
      this.view.set(view);
      this.overrides.set(new Map());
      this.pending.clear();
      this.state.set('ready');
    } catch (error) {
      if (seq !== this.loadSeq) return;
      if (toApiError(error).code === FIELD_CONFIG_ERROR.CATALOG_MISSING) {
        this.view.set(null);
        this.state.set('no-catalog');
        return;
      }
      throw error;
    }
  }

  /** Quiet refresh of the server copy (keeps the screen; pending clicks stay on top). */
  private async reloadView(): Promise<void> {
    const cycle = this.cycle();
    if (!cycle) return;
    try {
      const view = await firstValueFrom(this.api.view(cycle.id));
      if (this.cycle()?.id === cycle.id) this.view.set(view);
    } catch {
      // Keep what is shown: the next action reports the problem.
    }
  }

  private async refreshReview(notice: string): Promise<void> {
    const cycle = this.cycle();
    if (!cycle) return;
    try {
      this.review.set({ preview: await firstValueFrom(this.api.preview(cycle.id)), notice });
    } catch {
      // A read: the interceptor already showed the error.
      this.review.set(null);
    }
  }

  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
      this.saving.set(false);
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) {
      const cycle = this.cycle();
      if (!cycle) return;
      const batch = [...this.pending.entries()];
      this.pending = new Map();
      this.saving.set(true);
      const items: FieldConfigEdit[] = batch.map(([, e]) => toEdit(e.typeKey, e.fieldKey, e.config));
      try {
        const view = await firstValueFrom(this.api.editDraft(cycle.id, items));
        if (this.cycle()?.id !== cycle.id) return;
        this.view.set(view);
        this.dropOverrides(batch);
      } catch (error) {
        if (this.cycle()?.id !== cycle.id) return;
        this.dropOverrides(batch);
        this.failed(error, 'The change could not be saved.');
        await this.reloadView();
      }
    }
  }

  /** Drops the overrides the server answered for; a newer click on the same field keeps its own. */
  private dropOverrides(batch: readonly (readonly [string, PendingEdit])[]): void {
    this.overrides.update((all) => {
      const next = new Map(all);
      for (const [key, sent] of batch) if (next.get(key) === sent) next.delete(key);
      return next;
    });
  }

  /**
   * Tells the admin why a write failed. `queued`: the request may sit in the Unsent list, which
   * already says so when it could not reach the server. A closed cycle or a catalog that went away
   * reloads the screen, so it shows the right state.
   */
  private failed(error: unknown, fallback: string, queued = false): void {
    const e = toApiError(error);
    if (e.code === FIELD_CONFIG_ERROR.CYCLE_CLOSED || e.code === FIELD_CONFIG_ERROR.CATALOG_MISSING) void this.load();
    if (queued && isRetryLater(e.status, e.code)) return;
    this.toasts.error(e.fields[0]?.message ?? (e.message || fallback));
  }
}
