import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { PublishTimelines } from '../../../core/api/field-config.models';
import { opensLabel } from '../../../core/domain/rome-date';
import { QaButtonImports, QaDialogImports } from '../../../ui';
import { FieldChangeGroupVm } from './fields-config';

/**
 * "Review & publish" pop-up, built from the server's publish preview: the changes of every result
 * type, grouped, and which timelines will use the new version or keep theirs. Undo one, discard all
 * (asks first) or publish all.
 */
@Component({
  selector: 'qa-fields-publish-confirm',
  imports: [QaButtonImports, QaDialogImports],
  host: { class: 'contents' },
  template: `
    <qa-dialog [(open)]="open" [title]="title()" subtitle="Timelines that have not started will use this version. Timelines already running keep the version they started with." width="600px">
      @if (notice()) {
        <p role="alert" class="m-0 rounded-lg bg-(--surface-3) px-3 py-2 text-(length:--fs-13) text-(--text-2)">{{ notice() }}</p>
      }

      @for (group of groups(); track group.typeKey) {
        <section [attr.aria-labelledby]="'fields-publish-' + $index" class="flex flex-col">
          <h3 [id]="'fields-publish-' + $index" class="m-0 flex items-center gap-2 pt-2 pb-1 text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">
            {{ group.type }}
            <span class="rounded-full bg-(--surface-3) px-1.5 py-px font-(family-name:--qa-mono) text-(length:--fs-11) tabular-nums">{{ group.changes.length }}</span>
          </h3>
          <ul class="m-0 flex list-none flex-col p-0">
            @for (change of group.changes; track change.id) {
              <li class="flex min-h-11 items-center gap-3 border-b border-(--surface-4) py-2 text-(length:--fs-13) leading-[1.5] font-normal text-(--text-2) last:border-b-0">
                <span class="min-w-0 flex-1"><span class="font-semibold">{{ change.name }}</span><span class="text-(--text-3)"> — {{ change.description }}</span></span>
                <button
                  hlmBtn
                  qaBtn
                  tone="link"
                  size="sm"
                  type="button"
                  [disabled]="busy()"
                  (click)="undo.emit({ type: group.typeKey, id: change.id })"
                  [attr.aria-label]="'Undo the change to ' + change.name + ' in ' + group.type"
                  class="flex-none"
                >
                  Undo
                </button>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">Nothing to publish: the draft is the same as the latest version.</p>
      }

      @if (count() > 0) {
        <section aria-labelledby="fields-publish-timelines" class="flex flex-col gap-2 border-t border-(--surface-4) pt-3">
          <h3 id="fields-publish-timelines" class="sr-only">Timelines</h3>
          @if (receive().length === 0 && keep().length === 0) {
            <p class="m-0 text-(length:--fs-13) text-(--text-3)">No timeline is affected yet.</p>
          }
          @if (receive().length > 0) {
            <div class="flex flex-col gap-1">
              <h4 class="m-0 text-(length:--fs-12) font-semibold text-(--text-2)">Will use the new version</h4>
              <ul class="m-0 flex list-none flex-col gap-0.5 p-0 text-(length:--fs-13) text-(--text-2)">
                @for (t of receive(); track t.id) {
                  <li>{{ t.name || 'Deleted timeline' }}<span class="text-(--text-3)"> · {{ t.opens }}</span></li>
                }
              </ul>
            </div>
          }
          @if (keep().length > 0) {
            <div class="flex flex-col gap-1">
              <h4 class="m-0 text-(length:--fs-12) font-semibold text-(--text-2)">Keep their current version</h4>
              <ul class="m-0 flex list-none flex-col gap-0.5 p-0 text-(length:--fs-13) text-(--text-2)">
                @for (t of keep(); track t.id) {
                  <li>{{ t.name || 'Deleted timeline' }}<span class="text-(--text-3)"> · {{ t.version }}</span></li>
                }
              </ul>
            </div>
          }
        </section>
      }

      @if (confirmDiscard()) {
        <div role="alert" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-(--danger-bg) px-3 py-2">
          <span class="mr-auto text-(length:--fs-13) text-(--text-2)">Discard all {{ count() }} {{ count() === 1 ? 'change' : 'changes' }}? This can't be undone.</span>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="confirmDiscard.set(false)">Keep them</button>
          <button hlmBtn qaBtn tone="danger" size="sm" type="button" [disabled]="busy()" (click)="discard.emit()">Discard all</button>
        </div>
      }

      <div qaDialogFooter class="contents">
        @if (!confirmDiscard() && count() > 0) {
          <button
            hlmBtn
            qaBtn
            tone="danger-quiet"
            type="button"
            [disabled]="busy()"
            (click)="confirmDiscard.set(true)"
            class="mr-auto"
          >
            Discard all
          </button>
        }
        <button
          hlmBtn
          qaBtn
          tone="secondary"
          type="button"
          [disabled]="publishing()"
          (click)="open.set(false)"
        >
          Cancel
        </button>
        <button
          hlmBtn
          qaBtn
          tone="primary"
          type="button"
          [disabled]="busy() || count() === 0"
          (click)="publish.emit()"
        >
          {{ publishing() ? 'Publishing…' : 'Publish' }}
        </button>
      </div>
    </qa-dialog>
  `,
})
export class FieldsPublishConfirm {
  readonly open = model(false);
  readonly groups = input.required<readonly FieldChangeGroupVm[]>();
  readonly timelines = input<PublishTimelines>({ receive: [], keep: [] });
  /** Why the review was reloaded (the draft changed, or nothing to publish). */
  readonly notice = input('');
  /** A publish, discard or undo is running. */
  readonly busy = input(false);
  readonly publishing = input(false);

  readonly publish = output<void>();
  /** Undo one change (`type` = result type key, `id` = field key). */
  readonly undo = output<{ type: string; id: string }>();
  /** Discard every change, after the inline confirmation. */
  readonly discard = output<void>();

  /** Changes across all groups. */
  protected readonly count = computed(() => this.groups().reduce((n, g) => n + g.changes.length, 0));
  protected readonly receive = computed(() =>
    this.timelines().receive.map((t) => ({ id: t.id, name: t.name, opens: t.opensOn ? opensLabel(t.opensOn) : 'No steps yet' })),
  );
  protected readonly keep = computed(() =>
    this.timelines().keep.map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version == null ? 'Started with no field configuration' : `Version ${t.version}`,
    })),
  );

  /** Inline "Discard all?" question; reset every time the pop-up opens or closes. */
  protected readonly confirmDiscard = linkedSignal(() => (this.open(), false));

  protected title(): string {
    const n = this.count();
    return n === 0 ? 'Publish' : `Publish ${n} ${n === 1 ? 'change' : 'changes'}`;
  }
}
