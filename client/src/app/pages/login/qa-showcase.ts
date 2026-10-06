import { Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';

interface FieldRow {
  readonly y: number;
  readonly label: number;
  readonly value: number;
  readonly verdict: 'approved' | 'comment';
}

interface Step {
  readonly x: number;
  readonly label: string;
}

const ROWS: readonly FieldRow[] = [
  { y: 102, label: 46, value: 214, verdict: 'approved' },
  { y: 130, label: 62, value: 168, verdict: 'comment' },
  { y: 158, label: 38, value: 236, verdict: 'approved' },
  { y: 186, label: 54, value: 150, verdict: 'approved' },
  { y: 214, label: 44, value: 198, verdict: 'comment' },
];

const STEPS: readonly Step[] = [
  { x: 60, label: 'Assess' },
  { x: 160, label: 'Respond' },
  { x: 260, label: 'Review' },
  { x: 360, label: 'Decide' },
  { x: 460, label: 'Apply' },
];

/** Path the result travels: from the card down to "Assess", then along the five QA steps. */
const FLOW_PATH = 'M260 268 C260 300 60 296 60 336 L460 336';

/**
 * Decorative brand artwork: a result is assessed field by field, then moves through the
 * QA workflow. Animated with anime.js in the browser only; static (fully assessed) on the
 * server and for people who ask for reduced motion.
 */
@Component({
  selector: 'app-qa-showcase',
  host: {
    'aria-hidden': 'true',
    class: '[perspective:1200px]',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerleave)': 'onPointerLeave()',
  },
  styles: `
    .qa-node {
      transform-box: fill-box;
      transform-origin: center;
    }
  `,
  template: `
    <div class="qa-tilt will-change-transform">
      <svg viewBox="0 0 520 400" fill="none" class="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="qa-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#5eead4" stop-opacity="0" />
            <stop offset="0.5" stop-color="#5eead4" stop-opacity="0.22" />
            <stop offset="1" stop-color="#5eead4" stop-opacity="0" />
          </linearGradient>
          <filter id="qa-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <clipPath id="qa-card-clip">
            <rect x="40" y="20" width="440" height="248" rx="18" />
          </clipPath>
        </defs>

        <!-- Result card -->
        <g class="qa-card">
          <rect
            x="40.5"
            y="20.5"
            width="439"
            height="247"
            rx="18"
            fill="white"
            fill-opacity="0.045"
            stroke="white"
            stroke-opacity="0.14"
          />
          <rect x="64" y="44" width="84" height="22" rx="11" fill="#6d28d9" fill-opacity="0.45" />
          <text
            x="106"
            y="59"
            text-anchor="middle"
            fill="#ede9fe"
            font-size="10"
            font-weight="600"
            letter-spacing="1.5"
          >
            RESULT
          </text>
          <line
            class="qa-base"
            x1="164"
            y1="55"
            x2="330"
            y2="55"
            stroke="white"
            stroke-opacity="0.32"
            stroke-width="7"
            stroke-linecap="round"
          />
          <line
            class="qa-base"
            x1="64"
            y1="78"
            x2="236"
            y2="78"
            stroke="white"
            stroke-opacity="0.12"
            stroke-width="4"
            stroke-linecap="round"
          />

          @for (row of rows; track row.y) {
            <line
              class="qa-base"
              x1="64"
              [attr.y1]="row.y"
              [attr.x2]="64 + row.label"
              [attr.y2]="row.y"
              stroke="white"
              stroke-opacity="0.24"
              stroke-width="4"
              stroke-linecap="round"
            />
            <line
              class="qa-base"
              x1="132"
              [attr.y1]="row.y"
              [attr.x2]="132 + row.value"
              [attr.y2]="row.y"
              stroke="white"
              stroke-opacity="0.1"
              stroke-width="7"
              stroke-linecap="round"
            />
          }

          <!-- Assessment layer (reset every loop) -->
          <g class="qa-assessment">
            @for (row of rows; track row.y) {
              <line
                class="qa-mark"
                x1="132"
                [attr.y1]="row.y"
                [attr.x2]="132 + row.value"
                [attr.y2]="row.y"
                [attr.stroke]="row.verdict === 'approved' ? '#5eead4' : '#a78bfa'"
                stroke-opacity="0.75"
                stroke-width="7"
                stroke-linecap="round"
              />
              @if (row.verdict === 'approved') {
                <path
                  class="qa-verdict"
                  [attr.d]="'M424 ' + row.y + ' l5 5 l10 -11'"
                  stroke="#5eead4"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              } @else {
                <path
                  class="qa-verdict"
                  [attr.d]="
                    'M421 ' +
                    (row.y - 6) +
                    ' h20 a3 3 0 0 1 3 3 v8 a3 3 0 0 1 -3 3 h-12 l-5 4 v-4 h-3 a3 3 0 0 1 -3 -3 v-8 a3 3 0 0 1 3 -3 z'
                  "
                  stroke="#a78bfa"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              }
            }
            <line
              x1="64"
              y1="246"
              x2="456"
              y2="246"
              stroke="white"
              stroke-opacity="0.08"
              stroke-width="4"
              stroke-linecap="round"
            />
            <line
              class="qa-progress"
              x1="64"
              y1="246"
              x2="456"
              y2="246"
              stroke="#5eead4"
              stroke-width="4"
              stroke-linecap="round"
            />
          </g>

          <g clip-path="url(#qa-card-clip)">
            <g class="qa-beam" opacity="0">
              <rect x="40" y="-14" width="440" height="28" fill="url(#qa-beam)" />
              <line x1="40" y1="0" x2="480" y2="0" stroke="#5eead4" stroke-opacity="0.7" />
            </g>
          </g>
        </g>

        <!-- QA workflow -->
        <path
          [attr.d]="flowPath"
          stroke="white"
          stroke-opacity="0.16"
          stroke-width="1.5"
          stroke-dasharray="3 6"
        />
        <g class="qa-assessment">
          <path
            class="qa-flow"
            [attr.d]="flowPath"
            stroke="#5eead4"
            stroke-width="2"
            stroke-linecap="round"
          />
        </g>
        @for (step of steps; track step.label) {
          <circle
            [attr.cx]="step.x"
            cy="336"
            r="10"
            fill="#062521"
            stroke="white"
            stroke-opacity="0.28"
            stroke-width="1.5"
          />
          <text
            [attr.x]="step.x"
            y="370"
            text-anchor="middle"
            fill="white"
            fill-opacity="0.72"
            font-size="12"
            font-weight="500"
          >
            {{ step.label }}
          </text>
        }
        <g class="qa-assessment">
          @for (step of steps; track step.label) {
            <g class="qa-node">
              <circle
                [attr.cx]="step.x"
                cy="336"
                r="10"
                fill="#5eead4"
                fill-opacity="0.18"
                stroke="#5eead4"
                stroke-width="1.5"
              />
              <circle [attr.cx]="step.x" cy="336" r="3.5" fill="#5eead4" />
            </g>
          }
        </g>
        <g class="qa-pulse" opacity="0">
          <circle r="9" fill="#5eead4" filter="url(#qa-glow)" />
          <circle r="4" fill="#ccfbf1" />
        </g>
      </svg>
    </div>
  `,
})
export class QaShowcase {
  protected readonly rows = ROWS;
  protected readonly steps = STEPS;
  protected readonly flowPath = FLOW_PATH;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private tilt: ((x: number, y: number) => void) | null = null;
  private revert: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revert?.());
    afterNextRender(() => void this.animate());
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.tilt) {
      return;
    }
    const box = this.host.nativeElement.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    this.tilt(x, y);
  }

  protected onPointerLeave(): void {
    this.tilt?.(0, 0);
  }

  private async animate(): Promise<void> {
    const root = this.host.nativeElement;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return; // keep the static, fully assessed artwork
    }
    const { createScope, createTimeline, createAnimatable, stagger, svg } = await import('animejs');
    const q = <T extends Element>(selector: string) =>
      Array.from(root.querySelectorAll<T>(selector));

    const scope = createScope({ root }).add(() => {
      const bases = svg.createDrawable(q('.qa-base'));
      const marks = svg.createDrawable(q('.qa-mark'));
      const verdicts = svg.createDrawable(q('.qa-verdict'));
      const [progress] = svg.createDrawable(q('.qa-progress'));
      const [flow] = svg.createDrawable(q('.qa-flow'));
      const nodes = q<SVGGElement>('.qa-node');
      const scanStart = ROWS[0].y - 22;
      const scanEnd = ROWS[ROWS.length - 1].y + 22;
      const rowStep = 520;
      const scanTime = rowStep * ROWS.length;
      const flowTime = 2600;

      // Card draws itself once.
      createTimeline()
        .add('.qa-card', { opacity: [0, 1], translateY: [12, 0], duration: 700, ease: 'outCubic' })
        .add(
          bases,
          { draw: ['0 0', '0 1'], duration: 600, delay: stagger(40), ease: 'inOutQuad' },
          '-=400',
        );

      // Assessment loop: scan field by field, then travel through the workflow.
      createTimeline({ loop: true, loopDelay: 900, delay: 1400 })
        .set(marks, { draw: '0 0' })
        .set(verdicts, { draw: '0 0' })
        .set(progress, { draw: '0 0' })
        .set(flow, { draw: '0 0' })
        .set(nodes, { opacity: 0, scale: 0.4 })
        .set('.qa-assessment', { opacity: 1 })
        .set('.qa-beam', { translateY: scanStart })
        .label('scan')
        .add('.qa-beam', { opacity: [0, 1], duration: 250 }, 'scan')
        .add(
          '.qa-beam',
          { translateY: [scanStart, scanEnd], duration: scanTime, ease: 'linear' },
          'scan',
        )
        .add(
          marks,
          { draw: ['0 0', '0 1'], duration: 380, delay: stagger(rowStep), ease: 'outQuad' },
          'scan+=180',
        )
        .add(
          verdicts,
          { draw: ['0 0', '0 1'], duration: 320, delay: stagger(rowStep), ease: 'outQuad' },
          'scan+=380',
        )
        .add(progress, { draw: ['0 0', '0 1'], duration: scanTime, ease: 'linear' }, 'scan')
        .label('flow', `scan+=${scanTime}`)
        .add('.qa-beam', { opacity: 0, duration: 300 }, 'flow')
        .add('.qa-pulse', { opacity: [0, 1], duration: 200 }, 'flow')
        .add(
          '.qa-pulse',
          { ...svg.createMotionPath(q('.qa-flow')[0]), duration: flowTime, ease: 'inOutSine' },
          'flow',
        )
        .add(flow, { draw: ['0 0', '0 1'], duration: flowTime, ease: 'inOutSine' }, 'flow')
        .add(
          nodes,
          {
            opacity: [0, 1],
            scale: [0.4, 1],
            duration: 420,
            ease: 'outBack(2)',
            delay: stagger(flowTime * 0.155),
          },
          `flow+=${flowTime * 0.34}`,
        )
        .add('.qa-pulse', { opacity: 0, duration: 300 }, `flow+=${flowTime}`)
        .add('.qa-assessment', { opacity: 0, duration: 600 }, `flow+=${flowTime + 1600}`);

      const tilt = createAnimatable('.qa-tilt', { rotateX: 900, rotateY: 900, ease: 'outCubic' });
      this.tilt = (x, y) => {
        tilt['rotateY'](x * 14);
        tilt['rotateX'](-y * 10);
      };
    });

    this.revert = () => {
      this.tilt = null;
      scope.revert();
    };
  }
}
