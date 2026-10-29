import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { QaStage } from '../results/results.mock';

export interface RoundStageVm {
  /** Status key, unique in the hero. */
  readonly key: string;
  readonly label: string;
  readonly n: number;
  readonly count: string;
  /** Solid color of the status in the bar and its swatch. */
  readonly color: string;
  /** Results stage the row opens, or null while Results has no filter for this status (it is then not a link). */
  readonly stage: QaStage | null;
}

/**
 * One step of a round, with its own statuses (agreed with María Julia, 2026-10-27: "status inside the step").
 * Shown by name, never by number: a timeline uses some of the five steps, in order, so the same step can be
 * "Step 3" in one timeline and "Step 4" in another, but its name always means the same work.
 */
export interface RoundStepVm {
  /** Position among the five steps (1 Assessors … 4 Third-party broker); a key, not shown. */
  readonly n: number;
  /** "Assessors", "Programs correct"… the same short names as the Timeline progress lanes. */
  readonly name: string;
  readonly total: string;
  readonly stages: readonly RoundStageVm[];
}

export interface RoundVm {
  readonly id: 'r1' | 'r2';
  readonly title: string;
  /** Who works in the round. */
  readonly who: string;
  readonly total: string;
  readonly steps: readonly RoundStepVm[];
}

export interface CycleHeroVm {
  /** After the total: ", from 4 live timelines", or ", Step 4 of 5 · closes 23 Jul" for one timeline. */
  readonly detail: string;
  /** The Overview's filters as Results query params (timeline, program, type); a row adds its stage. */
  readonly query: Readonly<Record<string, string | null>>;
  readonly total: string;
  readonly rounds: readonly RoundVm[];
  /** Results that finished every QA step (the only place "Quality assessed" is used). */
  readonly final: { readonly count: string; readonly pct: number };
}

/**
 * Top of the Overview: the whole cycle at a glance, with Round 1 and Round 2 side by side so they can be compared.
 * Each round lists its steps, and each step its statuses; the bar shows the whole round in the same colors.
 */
@Component({
  selector: 'qa-ov-cycle-hero',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section
      aria-labelledby="overview-hero-title"
      class="relative flex flex-col gap-6 overflow-hidden rounded-[12px] border border-(--border) bg-(--surface) p-5"
    >
      <!-- What the hero counts comes from the Overview's filters at the top of the page. -->
      <!-- One sentence: "1,330 results in QA, from 4 live timelines" (or one timeline's step), with the cycle link on the same line (wraps under it on narrow cards). -->
      <div class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
        <h2 id="overview-hero-title" class="m-0 flex flex-wrap items-baseline gap-x-3">
          <span class="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-(--text) @2xl:text-[2.75rem]">{{ data().total }}</span>
          <span class="text-(length:--fs-16) font-semibold text-(--text-2)"
            >results in QA<span class="font-normal text-(--text-3)">{{ data().detail }}</span></span
          >
        </h2>
        <a hlmBtn qaBtn tone="link" size="sm" routerLink="/cycle" class="-ml-2.5 @2xl:-mr-2.5 @2xl:ml-0">See the full cycle</a>
      </div>

      <!-- Round 1 and Round 2 side by side (stacked on narrow screens). Inside each round, its steps; inside each step,
           its statuses. A row opens Results filtered by that status when Results has that filter. -->
      <div class="-mt-1 grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        @for (r of data().rounds; track r.id) {
          <!-- White card with a grey outline like every Overview block; the rounds inside are grey panels, so they read as parts of it. -->
          <section [attr.aria-labelledby]="'hero-' + r.id + '-title'" class="flex flex-col gap-4 rounded-[12px] bg-(--surface-3) p-4 @2xl:p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 flex-col gap-[2px]">
                <h3 [id]="'hero-' + r.id + '-title'" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ r.title }}</h3>
                <span class="text-(length:--fs-12) text-(--text-4)">{{ r.who }}</span>
              </div>
              <span class="flex flex-none items-baseline gap-[6px]">
                <span class="text-(length:--fs-20) font-bold tabular-nums text-(--text)">{{ r.total }}</span>
                <span class="text-(length:--fs-12) text-(--text-muted)">results</span>
              </span>
            </div>

            <div class="flex h-2 w-full gap-[3px] overflow-hidden rounded-full" role="img" [attr.aria-label]="barLabel(r)">
              @for (step of r.steps; track step.n) {
                @for (s of step.stages; track s.key) {
                  @if (s.n > 0) {
                    <span class="h-full first:rounded-l-full last:rounded-r-full" [class]="s.color" [style.flex-grow]="s.n"></span>
                  }
                }
              }
            </div>

            <div class="flex flex-col gap-3">
              @if (!r.steps.length) {
                <p class="m-0 text-(length:--fs-13) text-(--text-3)">This timeline has no {{ r.title }} steps.</p>
              }
              @for (step of r.steps; track step.n) {
                <section [attr.aria-labelledby]="'hero-step-' + step.n" class="flex flex-col gap-1">
                  <!-- Step eyebrow, like the sidebar's group labels: no line between it and its rows. -->
                  <div class="flex items-baseline justify-between gap-3">
                    <h4 [id]="'hero-step-' + step.n" class="m-0 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-4) uppercase">{{ step.name }}</h4>
                    <span class="text-(length:--fs-12) tabular-nums text-(--text-4)">{{ step.total }}</span>
                  </div>
                  <ul class="m-0 -mx-2 flex list-none flex-col p-0">
                    @for (s of step.stages; track s.key) {
                      <li>
                        @if (s.stage; as stage) {
                          <a
                            routerLink="/results"
                            [queryParams]="link(stage)"
                            [attr.aria-label]="step.name + ', ' + s.label + ': ' + s.count + ' results'"
                            class="group flex min-h-11 items-center gap-3 rounded-[8px] px-2 py-[7px] no-underline hover:bg-(--surface-4) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                          >
                            <span aria-hidden="true" class="size-[10px] flex-none rounded-[3px]" [class]="s.color"></span>
                            <span class="min-w-0 flex-1 text-(length:--fs-14) font-medium text-(--text-2)">{{ s.label }}</span>
                            <span class="flex-none text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ s.count }}</span>
                            <svg class="flex-none text-(--text-muted) group-hover:text-(--text-3)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
                          </a>
                        } @else {
                          <!-- TODO(results): Results has no filter for this status yet; the row becomes a link once it does. -->
                          <div class="flex min-h-11 items-center gap-3 px-2 py-[7px]">
                            <span aria-hidden="true" class="size-[10px] flex-none rounded-[3px]" [class]="s.color"></span>
                            <span class="min-w-0 flex-1 text-(length:--fs-14) font-medium text-(--text-2)">{{ s.label }}</span>
                            <span class="flex-none text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ s.count }}</span>
                            <span aria-hidden="true" class="w-[14px] flex-none"></span>
                          </div>
                        }
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>
          </section>
        }
      </div>

      <!-- Final state: the only place "Quality assessed" appears -->
      <a
        routerLink="/results"
        [queryParams]="link('quality-assessed')"
        [attr.aria-label]="'Quality assessed: ' + data().final.count + ' results, ' + data().final.pct + '% of results in QA'"
        class="group -mt-3 flex min-h-11 items-center gap-3 rounded-[12px] bg-(--st-approved-bg) px-4 py-3 no-underline focus-visible:shadow-(--focus-ring) focus-visible:outline-none @2xl:px-5"
      >
        <span aria-hidden="true" class="flex size-5 flex-none items-center justify-center rounded-full bg-(--st-approved-fg)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-x-3 @xl:flex-row @xl:items-baseline">
          <span class="text-(length:--fs-14) font-semibold text-(--st-approved-fg)">Quality assessed</span>
          <span class="text-(length:--fs-12) text-(--st-approved-fg) @xl:text-(length:--fs-13)">Finished every QA step</span>
        </span>
        <span class="flex flex-none items-baseline gap-[6px]">
          <span class="text-(length:--fs-16) font-bold tabular-nums text-(--st-approved-fg)">{{ data().final.count }}</span>
          <span class="text-(length:--fs-12) tabular-nums text-(--st-approved-fg)">{{ data().final.pct }}%</span>
        </span>
        <svg class="flex-none text-(--st-approved-fg)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
      </a>
    </section>
  `,
})
export class OvCycleHero {
  readonly data = input.required<CycleHeroVm>();


  /** Results filtered like the Overview, at one stage, so the count clicked is the count Results shows. */
  protected link(stage: QaStage): Record<string, string | null> {
    return { ...this.data().query, stage };
  }

  protected barLabel(r: RoundVm): string {
    return `${r.title} by status: ` + r.steps.flatMap((step) => step.stages.map((s) => `${s.label} ${s.count}`)).join(', ');
  }
}
