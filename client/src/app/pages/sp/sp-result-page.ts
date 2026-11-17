import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { SpApi } from '../../core/api/sp-api';
import { SP_ERROR, SpComment, SpField, SpRespondAnswer, SpResult, SpSection } from '../../core/api/sp.models';
import { formatMoment } from '../../core/domain/rome-date';
import { ApiError, toApiError } from '../../core/http/api-envelope';
import { QaBadge, QaButtonImports, QaLoadingImports } from '../../ui';
import { SpCommentThread } from './sp-comment-thread';
import { SpContext } from './sp-context';
import { SpCsvDownload } from './sp-csv-download';
import { SpFieldValue } from './sp-field-value';
import { statusLabel, statusTone } from './sp-format';
import { SpResultSkeleton } from './sp-result-skeleton';

interface SectionVm {
  readonly key: string;
  readonly label: string;
  readonly anchor: string;
  readonly fields: readonly SpField[];
  readonly comments: number;
}

const OTHER_KEY = 'other';

/** Puts the server's answer for one comment in place, wherever its field is. */
export function withComment(view: SpResult, comment: SpComment, counts: SpResult['counts']): SpResult {
  const swap = (fields: readonly SpField[]): readonly SpField[] =>
    fields.map((f) => (f.comments.some((c) => c.id === comment.id) ? { ...f, comments: f.comments.map((c) => (c.id === comment.id ? comment : c)) } : f));
  return {
    ...view,
    sections: view.sections.map((s): SpSection => ({ ...s, fields: swap(s.fields) })),
    other: swap(view.other),
    counts,
  };
}

/**
 * One result as the program sees it (P2-3911 AC6–AC12, AC14, AC15): header, "Open in Reporting",
 * the step-2 notice, every section with its fields and, next to each field, its QA comments with the
 * response form while the programs step is open. Never shows who wrote a comment.
 */
@Component({
  selector: 'qa-sp-result-page',
  imports: [RouterLink, QaBadge, QaButtonImports, QaLoadingImports, SpCommentThread, SpFieldValue, SpResultSkeleton],
  host: { class: 'block' },
  template: `
    <main class="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-5 pb-10 sm:px-6 lg:px-8">
      <a hlmBtn qaBtn tone="link" size="sm" flush="start" routerLink="/sp" class="self-start">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Back to results
      </a>

      @if (result.isLoading() && !view()) {
        <qa-sp-result-skeleton />
      } @else if (notFound()) {
        <div class="flex flex-col items-start gap-2" role="alert" data-testid="sp-not-found">
          <h1 class="m-0 text-(length:--fs-20) font-bold text-(--text)">Result not found</h1>
          <p class="m-0 text-(length:--fs-14) text-(--text-3)">We could not find this result. Go back to the list and try again.</p>
        </div>
      } @else if (loadError(); as error) {
        <div class="flex flex-col items-start gap-2" role="alert">
          <p class="m-0 text-(length:--fs-14) text-(--text-2)">{{ error }}</p>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="result.reload()">Try again</button>
        </div>
      } @else if (view(); as v) {
        <section aria-labelledby="sp-result-title" class="flex flex-col gap-3 rounded-xl border border-(--border) bg-(--surface) px-5 py-4">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--accent) tabular-nums">{{ v.header.resultCode }}</span>
            <qa-badge [status]="statusTone(v.header.status)">{{ statusLabel(v.header.status) }}</qa-badge>
            <div class="ml-auto flex flex-wrap items-center gap-2">
              @if (v.header.reportingUrl; as url) {
                <a hlmBtn qaBtn tone="secondary" size="sm" [href]="url" target="_blank" rel="noopener noreferrer">
                  Open in Reporting<span class="sr-only"> (opens in a new tab)</span>
                </a>
              }
              <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [loading]="exporting()" [disabled]="v.counts.comments === 0" (click)="exportComments(v)">
                Export comments
              </button>
            </div>
          </div>
          <h1 id="sp-result-title" class="m-0 text-balance text-(length:--fs-22) leading-[1.25] font-bold tracking-[-0.01em] text-(--text)">
            {{ v.header.title || 'Untitled result' }}
          </h1>
          <dl class="m-0 flex flex-wrap gap-x-6 gap-y-1 text-(length:--fs-13)">
            <div class="flex gap-1.5"><dt class="text-(--text-4)">Program</dt><dd class="m-0 text-(--text-2)">{{ v.header.program.code }} · {{ v.header.program.name }}</dd></div>
            <div class="flex gap-1.5"><dt class="text-(--text-4)">Type</dt><dd class="m-0 text-(--text-2)">{{ v.header.resultType.label }}</dd></div>
            <div class="flex gap-1.5"><dt class="text-(--text-4)">Timeline</dt><dd class="m-0 text-(--text-2)">{{ v.header.timeline.name }}</dd></div>
            <div class="flex gap-1.5">
              <dt class="text-(--text-4)">Answered by SP</dt>
              <dd class="m-0 font-(family-name:--qa-mono) text-(--text) tabular-nums" data-testid="sp-counts">{{ v.counts.answered }} / {{ v.counts.comments }}</dd>
            </div>
          </dl>
        </section>

        <p class="sr-only" aria-live="polite">{{ countsNotice() }}</p>

        @if (notice(); as message) {
          <p class="m-0 rounded-lg border border-(--danger-soft) bg-(--danger-bg) px-3 py-2 text-(length:--fs-13) text-(--danger-strong)" role="alert">{{ message }}</p>
        }
        @if (readOnlyText(); as text) {
          <p class="m-0 rounded-lg border border-(--border) bg-(--surface-3) px-3 py-2 text-(length:--fs-13) text-(--text-2)" role="status" data-testid="sp-read-only">{{ text }}</p>
        }

        <div class="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Sections" class="lg:sticky lg:top-4 lg:self-start">
            <ul class="m-0 flex list-none flex-wrap gap-1 p-0 lg:flex-col">
              @for (s of sections(); track s.key) {
                <li>
                  <button
                    type="button"
                    (click)="goTo(s.anchor)"
                    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-(length:--fs-13) text-(--text-2) outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)"
                  >
                    <span class="min-w-0 flex-1 truncate">{{ s.label }}</span>
                    @if (s.comments) {
                      <span class="flex-none rounded-full bg-(--tint-2) px-1.5 font-(family-name:--qa-mono) text-(length:--fs-11) font-semibold text-(--accent) tabular-nums">
                        {{ s.comments }}<span class="sr-only"> comments</span>
                      </span>
                    }
                  </button>
                </li>
              }
            </ul>
            <label class="mt-3 flex cursor-pointer items-center gap-2 px-2 text-(length:--fs-13) text-(--text-3)">
              <input type="checkbox" class="size-4 accent-(--primary)" [checked]="onlyCommented()" (change)="onlyCommented.set(!onlyCommented())" />
              Only fields with comments
            </label>
          </nav>

          <div class="flex min-w-0 flex-col gap-8">
            @for (s of sections(); track s.key) {
              @let fields = visibleFields(s);
              @if (fields.length) {
                <section [attr.aria-labelledby]="s.anchor" class="flex flex-col gap-3">
                  <h2 [id]="s.anchor" tabindex="-1" class="m-0 text-(length:--fs-16) font-bold text-(--text) outline-none">{{ s.label }}</h2>
                  @for (f of fields; track f.key) {
                    <article [qaReveal]="$index" class="flex flex-col gap-3 rounded-[10px] border bg-(--surface) px-4 py-3.5" [class]="f.comments.length ? 'border-(--border-accent)' : 'border-(--border)'">
                      <div class="flex flex-col gap-1">
                        <h3 class="m-0 text-(length:--fs-13) font-semibold text-(--text-3)">{{ f.label }}</h3>
                        <qa-sp-field-value [value]="f.value" [labels]="f.labels" [notApplicable]="f.notApplicable" />
                      </div>
                      @for (c of f.comments; track c.id) {
                        <qa-sp-comment-thread
                          [comment]="c"
                          [fieldValue]="f.value"
                          [writable]="v.writable"
                          (saved)="onSaved($event)"
                          (stepClosed)="onStepClosed($event)"
                          (gone)="onGone()"
                        />
                      }
                    </article>
                  }
                </section>
              }
            }
          </div>
        </div>
      }
    </main>
  `,
})
export class SpResultPage {
  private readonly api = inject(SpApi);
  private readonly ctx = inject(SpContext);
  private readonly csv = inject(SpCsvDownload);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = statusTone;

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((p) => ({ timelineId: Number(p.get('timelineId')), resultCode: Number(p.get('resultCode')) }))),
    { initialValue: { timelineId: Number(this.route.snapshot.paramMap.get('timelineId')), resultCode: Number(this.route.snapshot.paramMap.get('resultCode')) } },
  );
  private readonly queryProgram = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('programId'))), {
    initialValue: this.route.snapshot.queryParamMap.get('programId'),
  });

  /** `programId` to send: the link's (an admin's list adds it), else the context's. */
  private readonly programId = computed<number | null>(() => {
    const fromLink = Number(this.queryProgram());
    if (this.queryProgram() && Number.isInteger(fromLink) && fromLink > 0) return fromLink;
    return this.ctx.programParam();
  });

  protected readonly result = rxResource({
    params: () => {
      const { timelineId, resultCode } = this.params();
      if (!(timelineId > 0) || !(resultCode > 0)) return undefined;
      return { timelineId, resultCode, programId: this.programId() };
    },
    stream: ({ params }) => this.api.result(params.timelineId, params.resultCode, params.programId),
  });

  /** The view on screen: the server's answer, then each saved response put in place. */
  protected readonly view = linkedSignal<SpResult | null>(() => (this.result.hasValue() ? this.result.value() : null));

  protected readonly invalidRoute = computed(() => {
    const { timelineId, resultCode } = this.params();
    return !(timelineId > 0) || !(resultCode > 0);
  });
  private readonly error = computed(() => {
    const e = this.result.error();
    return e ? toApiError(e) : null;
  });
  protected readonly notFound = computed(() => this.invalidRoute() || this.error()?.status === 404 || this.error()?.code === SP_ERROR.NOT_FOUND);
  protected readonly loadError = computed(() => this.error()?.message ?? null);

  protected readonly onlyCommented = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly countsNotice = signal('');
  protected readonly exporting = signal(false);

  protected readonly sections = computed<readonly SectionVm[]>(() => {
    const v = this.view();
    if (!v) return [];
    const all = [...v.sections];
    if (v.other.length) all.push({ key: OTHER_KEY, label: 'Other fields', fields: v.other });
    return all.map((s) => ({
      key: s.key,
      label: s.label,
      anchor: `sp-section-${s.key}`,
      fields: s.fields,
      comments: s.fields.reduce((n, f) => n + f.comments.length, 0),
    }));
  });

  protected readonly readOnlyText = computed(() => {
    const v = this.view();
    if (!v || v.writable) return null;
    if (v.readOnlyReason === 'step_not_open') {
      return v.step ? `Responses open on ${formatMoment(v.step.opensAt)} (Rome time).` : 'Responses are not open yet.';
    }
    if (v.readOnlyReason === 'step_closed') return 'Step 2 is closed. Responses are read-only.';
    return 'Responses are read-only.';
  });

  protected visibleFields(section: SectionVm): readonly SpField[] {
    return this.onlyCommented() ? section.fields.filter((f) => f.comments.length > 0) : section.fields;
  }

  protected goTo(anchor: string): void {
    const heading = this.document.getElementById(anchor);
    if (!heading) return;
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
  }

  protected onSaved(answer: SpRespondAnswer): void {
    this.notice.set(null);
    this.view.update((v) => (v ? withComment(v, answer.comment, answer.counts) : v));
    this.countsNotice.set(`Answered by SP: ${answer.counts.answered} of ${answer.counts.comments}.`);
  }

  /** The step closed while the page was open: read it again, now read-only. */
  protected onStepClosed(error: ApiError): void {
    this.notice.set(error.message);
    this.result.reload();
  }

  protected onGone(): void {
    this.notice.set('This comment is no longer available. The result was loaded again.');
    this.result.reload();
  }

  protected async exportComments(v: SpResult): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      await this.csv.download(v.header.timeline.id, v.header.resultCode, this.programId());
      this.notice.set(null);
      this.countsNotice.set('Comments exported.');
    } catch (error) {
      this.notice.set(`We could not export the comments. ${toApiError(error).message}`);
    } finally {
      this.exporting.set(false);
    }
  }
}
