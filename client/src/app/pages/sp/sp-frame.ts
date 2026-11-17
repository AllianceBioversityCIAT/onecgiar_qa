import { Component, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { SpApi } from '../../core/api/sp-api';
import { toApiError } from '../../core/http/api-envelope';
import { SpSession } from '../../core/sp/sp-session';
import { QaButtonImports, QaLoadingImports, QaSelectImports, QaSelectOption, QaTokensLoader } from '../../ui';
import { SpContext } from './sp-context';
import { SpFrameSkeleton } from './sp-frame-skeleton';

/**
 * The Science Program page inside Reporting's iframe (P2-3911): no QA shell, no sidebar, no Cognito.
 * Trades the one-time `code` for an SP session (browser only), shows the program (an admin picks it),
 * and hosts the results list and the result view. A refused code or a session that ended shows the
 * "link expired" page; `SpSession` tells Reporting once.
 */
@Component({
  selector: 'qa-sp-frame',
  imports: [RouterOutlet, QaButtonImports, QaLoadingImports, QaSelectImports, SpFrameSkeleton],
  host: { class: 'qa-tokens block min-h-dvh bg-(--bg) text-(--text)' },
  template: `
    @switch (session.status()) {
      @case ('expired') {
        <main class="mx-auto flex min-h-dvh max-w-[560px] flex-col items-start justify-center gap-3 px-4 py-10 sm:px-6">
          <p class="m-0 text-(length:--fs-12) font-semibold tracking-[0.08em] text-(--text-4) uppercase">Quality Assurance</p>
          <h1 class="m-0 text-balance text-(length:--fs-22) leading-[1.25] font-bold text-(--text)" role="alert">
            Your Quality Assurance link has expired.
          </h1>
          <p class="m-0 text-pretty text-(length:--fs-14) text-(--text-3)">Open Quality Assurance again from the Reporting Tool.</p>
        </main>
      }
      @case ('failed') {
        <main class="mx-auto flex min-h-dvh max-w-[560px] flex-col items-start justify-center gap-3 px-4 py-10 sm:px-6">
          <p class="m-0 text-(length:--fs-12) font-semibold tracking-[0.08em] text-(--text-4) uppercase">Quality Assurance</p>
          <h1 class="m-0 text-(length:--fs-22) leading-[1.25] font-bold text-(--text)">We could not open Quality Assurance.</h1>
          <p class="m-0 text-pretty text-(length:--fs-14) text-(--text-3)" role="alert">{{ session.startError()?.message }}</p>
          <button hlmBtn qaBtn tone="primary" type="button" [loading]="retrying()" (click)="retryStart()">Try again</button>
        </main>
      }
      @case ('ready') {
        <header class="border-b border-(--border) bg-(--surface)">
          <div class="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
            <div class="flex min-w-0 flex-col">
              <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-4) uppercase">Quality Assurance</span>
              @if (!ctx.isAdmin()) {
                <span class="min-w-0 truncate text-(length:--fs-15) font-semibold text-(--text)" data-testid="sp-program">
                  @if (ctx.program(); as p) {
                    {{ p.code }} · {{ p.name }}
                  }
                </span>
              }
            </div>
            @if (ctx.isAdmin()) {
              <div class="flex min-w-0 items-center gap-2">
                <label for="sp-program-select" class="flex-none text-(length:--fs-13) font-medium text-(--text-3)">Science Program</label>
                <qa-select
                  triggerId="sp-program-select"
                  [value]="programValue()"
                  (valueChange)="onProgram($event)"
                  [options]="programOptions()"
                  label="Science Program"
                  placeholder="Select a program"
                  searchable
                  searchPlaceholder="Search programs"
                  panelWidth="360px"
                  class="min-w-[260px] max-sm:min-w-0 max-sm:flex-1"
                />
              </div>
            }
            @if (ctx.me(); as me) {
              <span class="ml-auto min-w-0 truncate text-(length:--fs-13) text-(--text-3)">{{ me.user.name }}</span>
            }
          </div>
        </header>
        @if (meError(); as error) {
          <main class="mx-auto flex max-w-[1280px] flex-col items-start gap-3 px-4 py-8 sm:px-6 lg:px-8">
            <p class="m-0 text-(length:--fs-14) text-(--text-2)" role="alert">{{ error }}</p>
            <button hlmBtn qaBtn tone="secondary" type="button" [loading]="me.isLoading()" (click)="me.reload()">Try again</button>
          </main>
        } @else if (!ctx.me()) {
          <qa-sp-frame-skeleton />
        } @else {
          <router-outlet />
        }
      }
      @default {
        <qa-sp-frame-skeleton withHeader />
      }
    }
  `,
})
export class SpFrame {
  protected readonly session = inject(SpSession);
  protected readonly ctx = inject(SpContext);
  private readonly api = inject(SpApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly retrying = signal(false);

  protected readonly me = rxResource({
    params: () => (this.session.ready() ? true : undefined),
    stream: () => this.api.me(),
  });

  protected readonly meError = computed(() => {
    const e = this.me.error();
    return e ? toApiError(e).message : null;
  });

  protected readonly programOptions = computed<readonly QaSelectOption[]>(() =>
    (this.ctx.me()?.programs ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` })),
  );

  protected readonly programValue = computed(() => {
    const id = this.ctx.programId();
    return id === null ? null : String(id);
  });

  constructor() {
    // Registers the tokens stylesheet behind the host class qa-tokens (no QA shell here).
    inject(QaTokensLoader);
    effect(() => {
      if (this.me.hasValue()) this.ctx.setMe(this.me.value());
    });
    // Browser only: the code works once, so it must never be traded during server rendering.
    afterNextRender(() => {
      void this.session.begin(this.route.snapshot.queryParamMap.get('code'));
    });
  }

  protected async retryStart(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.session.retry();
    } finally {
      this.retrying.set(false);
    }
  }

  protected onProgram(value: string | null): void {
    const id = value ? Number(value) : null;
    if (id === this.ctx.chosenProgramId()) return;
    this.ctx.chooseProgram(id);
    // A result belongs to one program: another program starts from its list.
    if (this.router.url.split('?')[0] !== '/sp') void this.router.navigateByUrl('/sp');
  }
}
