import { Component, computed, input, model } from '@angular/core';
import { QaSelectImports, QaSelectOption } from '../../../ui';

/** Pace of one timeline's open step: results done day by day against what is needed to close on time. */
export interface PaceVm {
  readonly id: string;
  /** "July 2026 sub-timeline · Step 1". */
  readonly label: string;
  /** "Step 1". */
  readonly step: string;
  /** Results the step has to get through. */
  readonly target: number;
  /** Cumulative results done, one value per day from the step's start to today. */
  readonly done: readonly number[];
  /** Days from the step's start to its close (the last x of the chart). */
  readonly span: number;
  /** "06 Jul", "23 Jul". */
  readonly startLabel: string;
  readonly endLabel: string;
  /** True for the assessors' step, the only one the assessor filter applies to. */
  readonly byAssessor: boolean;
}

const W = 640;
const H = 360;
const PL = 40;
const PR = 16;
const PT = 16;
const PB = 28;

/** Round gridlines for the y axis, with some air above the target: 41 → 0…50 by 10, 216 → 0…250 by 50, 989 → 0…1,200 by 200. */
function yTicks(v: number): number[] {
  let step = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  const count = () => Math.ceil((v * 1.1) / step);
  if (count() < 4) step /= 2;
  if (count() > 6) step *= 2;
  return Array.from({ length: count() + 1 }, (_, i) => i * step);
}

/**
 * "Assessment pace": one open step, the riskiest one the page's filters keep (the timeline is picked only at the top
 * of the page). In the assessors' step an "Assessor" line narrows it to one assessor.
 */
@Component({
  selector: 'qa-ov-pace',
  imports: [QaSelectImports],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-pace-title" class="flex h-full flex-col rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <h3 id="overview-pace-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Assessment pace</h3>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1">
            <!-- The timeline is picked only at the top of the page: with several open steps this shows the one most behind. -->
            @if (current(); as c) {
              <p class="m-0 text-(length:--fs-14) text-(--text-3)">Step <span class="font-semibold text-(--text)">{{ c.label }}</span></p>
            }
            @if (current()?.byAssessor) {
              <qa-select
                [value]="assessor()"
                (valueChange)="assessor.set($event ?? 'all')"
                [options]="assessorOptions()"
                label="Assessor"
                appearance="inline"
                searchable
                searchPlaceholder="Search assessors"
              />
            }
          </div>
        </div>
        @if (view(); as v) {
          <span class="flex-none rounded-full px-2.5 py-0.5 text-(length:--fs-12) font-semibold" [class]="v.behind ? 'bg-(--st-editing-bg) text-(--st-editing-fg)' : 'bg-(--st-approved-bg) text-(--st-approved-fg)'">
            {{ v.behind ? 'Behind pace' : 'On pace' }}
          </span>
        }
      </div>
      @if (series().length > 1) {
        <p class="m-0 mt-1 text-(length:--fs-13) text-(--text-3)">The step most behind of {{ series().length }} open steps. Pick a timeline at the top to see another.</p>
      }

      @if (!series().length) {
        <p class="m-0 mt-3 text-(length:--fs-14) text-(--text-3)">No open step matches these filters.</p>
      }
      @if (view(); as v) {
        <!-- Full-width card: from a wide card the summary sits left and the chart right, so the chart does not grow too tall. -->
        <div class="mt-3 flex flex-1 flex-col gap-4 @4xl:grid @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:items-end @4xl:gap-8">
          <div class="flex flex-col gap-3 @4xl:self-start">
            <p class="m-0 text-(length:--fs-15) leading-[1.5] text-pretty text-(--text-2)">
              At the current pace, about <b class="text-(--text)">{{ v.projected }} of {{ v.target }}</b> results will be done when {{ v.step }} closes on {{ v.endLabel }}.
            </p>

            <dl class="m-0 grid grid-cols-2 gap-2 @lg:grid-cols-4 @4xl:grid-cols-2">
              @for (k of v.kpis; track k.label) {
                <div class="flex flex-col-reverse gap-0.5 rounded-[10px] border border-(--surface-4) bg-(--surface-2) px-3 py-2.5">
                  <dt class="text-(length:--fs-12) text-(--text-3)">{{ k.label }}</dt>
                  <dd class="m-0 text-(length:--fs-20) font-bold tabular-nums tracking-[-0.01em] text-(--text)">{{ k.value }}</dd>
                </div>
              }
            </dl>
          </div>

          <div class="flex flex-col justify-end">
            <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" class="block h-auto w-full" role="img" [attr.aria-label]="v.ariaLabel">
              @for (g of v.grid; track g.v) {
                <line [attr.x1]="pl" [attr.x2]="w - pr" [attr.y1]="g.y" [attr.y2]="g.y" class="stroke-(--surface-4)" stroke-width="1"></line>
                <text [attr.x]="pl - 8" [attr.y]="g.y + 4" text-anchor="end" class="fill-(--text-muted) text-[11px]">{{ g.label }}</text>
              }
              @for (t of v.ticks; track t.label) {
                <text [attr.x]="t.x" [attr.y]="h - 8" [attr.text-anchor]="t.anchor" class="fill-(--text-muted) text-[11px]">{{ t.label }}</text>
              }
              <line [attr.x1]="v.todayX" [attr.x2]="v.todayX" [attr.y1]="pt" [attr.y2]="h - pb" class="stroke-(--border-strong)" stroke-dasharray="3 3"></line>
              <polyline [attr.points]="v.needLine" fill="none" class="stroke-(--text-muted)" stroke-width="2" stroke-dasharray="6 5"></polyline>
              <polyline [attr.points]="v.projLine" fill="none" class="stroke-(--primary)" stroke-width="2" stroke-dasharray="2 4" opacity=".7"></polyline>
              <polyline [attr.points]="v.actLine" fill="none" class="stroke-(--primary)" stroke-width="2.5" stroke-linejoin="round"></polyline>
              <circle [attr.cx]="v.todayX" [attr.cy]="v.todayY" r="4.5" class="fill-(--primary) stroke-(--surface)" stroke-width="2"></circle>
              <circle [attr.cx]="v.endX" [attr.cy]="v.targetY" r="4.5" class="fill-(--surface) stroke-(--text-muted)" stroke-width="2"></circle>
              <!-- Hover targets bigger than the line: one per day with its value. -->
              @for (d of v.days; track $index) {
                <circle [attr.cx]="d.x" [attr.cy]="d.y" r="9" fill="transparent"><title>{{ d.title }}</title></circle>
              }
            </svg>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-(length:--fs-12) text-(--text-3)">
              <span class="inline-flex items-center gap-1.5"><i class="inline-block w-[18px] border-t-[2.5px] border-(--primary)"></i>Done so far</span>
              <span class="inline-flex items-center gap-1.5"><i class="inline-block w-[18px] border-t-2 border-dotted border-(--primary)"></i>At current pace</span>
              <span class="inline-flex items-center gap-1.5"><i class="inline-block w-[18px] border-t-2 border-dashed border-(--text-muted)"></i>Needed to finish on time</span>
            </div>
          </div>
        </div>
      }
    </section>
  `,
})
export class OvPace {
  /** Open steps with history, riskiest first; the first one is shown by default. */
  readonly series = input.required<readonly PaceVm[]>();
  /** "All assessors", then each assessor of the assessors' step. */
  readonly assessorOptions = input<readonly QaSelectOption[]>([]);
  /** Assessor the assessors' step is narrowed to ("all" by default); the page recomputes the series with it. */
  readonly assessor = model('all');

  protected readonly w = W;
  protected readonly h = H;
  protected readonly pl = PL;
  protected readonly pr = PR;
  protected readonly pt = PT;
  protected readonly pb = PB;

  /** The step shown: the riskiest one the filters keep (the series comes sorted, most behind first). */
  protected readonly current = computed(() => this.series()[0] ?? null);

  protected readonly view = computed(() => {
    const s = this.current();
    if (!s || !s.done.length) return null;
    const today = s.done.length - 1;
    const done = s.done[today];
    const left = Math.max(0, s.target - done);
    const daysLeft = Math.max(0, s.span - today);
    const back = Math.min(7, today);
    const perDay = back ? Math.round((done - s.done[today - back]) / back) : 0;
    const needed = daysLeft ? Math.ceil(left / daysLeft) : left;
    const projected = Math.min(s.target, done + perDay * daysLeft);

    const ticks = yTicks(s.target);
    const max = ticks[ticks.length - 1];
    const x = (i: number) => PL + (i / Math.max(1, s.span)) * (W - PL - PR);
    const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
    const pts = (arr: readonly (readonly [number, number])[]) => arr.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const proj = Array.from({ length: daysLeft + 1 }, (_, k) => [today + k, Math.min(s.target, done + perDay * k)] as const);

    return {
      step: s.step,
      target: s.target.toLocaleString('en-US'),
      projected: projected.toLocaleString('en-US'),
      endLabel: s.endLabel,
      behind: projected < s.target,
      kpis: [
        { label: 'still to do', value: left.toLocaleString('en-US') },
        { label: 'needed per day', value: needed.toLocaleString('en-US') },
        { label: 'per day, last 7 days', value: perDay.toLocaleString('en-US') },
        { label: daysLeft === 1 ? 'day left' : 'days left', value: String(daysLeft) },
      ],
      ariaLabel: `${s.label}: ${done} of ${s.target} done today; at ${perDay} a day, about ${projected} by ${s.endLabel}; ${needed} a day are needed.`,
      grid: ticks.map((v) => ({ v, y: y(v), label: v.toLocaleString('en-US') })),
      ticks: [
        { x: x(0), label: s.startLabel, anchor: 'start' },
        { x: x(today), label: 'Today', anchor: 'middle' },
        { x: x(s.span), label: s.endLabel, anchor: 'end' },
      ],
      todayX: x(today),
      todayY: y(done),
      endX: x(s.span),
      targetY: y(s.target),
      needLine: pts([[today, done], [s.span, s.target]]),
      projLine: pts(proj),
      actLine: pts(s.done.map((v, i) => [i, v] as const)),
      days: s.done.map((v, i) => ({ x: x(i), y: y(v), title: `${i === today ? 'Today' : 'Day ' + (i + 1)}: ${v} done` })),
    };
  });
}
