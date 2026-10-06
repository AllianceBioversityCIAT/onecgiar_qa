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
  { y: 110, label: 46, value: 214, verdict: 'approved' },
  { y: 138, label: 62, value: 168, verdict: 'comment' },
  { y: 166, label: 38, value: 236, verdict: 'approved' },
  { y: 194, label: 54, value: 150, verdict: 'approved' },
  { y: 222, label: 44, value: 198, verdict: 'comment' },
];

const STEPS: readonly Step[] = [
  { x: 60, label: 'Assess' },
  { x: 160, label: 'Respond' },
  { x: 260, label: 'Review' },
  { x: 360, label: 'Decide' },
  { x: 460, label: 'Apply' },
];

/** Path the result travels: from the card down to "Assess", then along the five QA steps. */
const FLOW_PATH = 'M260 276 C260 308 60 304 60 344 L460 344';
const FIRST_RESULT = 142;

/**
 * Decorative brand artwork telling the QA story: results arrive as a deck, each one is
 * assessed field by field (approvals and reviewer comments), travels the five QA steps
 * and gets stamped, then the next result comes in. anime.js runs in the browser only;
 * the server and reduced-motion users get the static, fully assessed card.
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
    .qa-card,
    .qa-node,
    .qa-note,
    .qa-stamp {
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
          <filter id="qa-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity="0.45" />
          </filter>
          <clipPath id="qa-card-clip">
            <rect x="40" y="28" width="440" height="248" rx="18" />
          </clipPath>
        </defs>

        <!-- Deck of results waiting behind -->
        <rect
          x="72.5"
          y="6.5"
          width="375"
          height="247"
          rx="18"
          fill="white"
          fill-opacity="0.02"
          stroke="white"
          stroke-opacity="0.07"
        />
        <rect
          x="56.5"
          y="16.5"
          width="407"
          height="247"
          rx="18"
          fill="white"
          fill-opacity="0.03"
          stroke="white"
          stroke-opacity="0.1"
        />

        <!-- Result card -->
        <g class="qa-card">
          <rect
            x="40.5"
            y="28.5"
            width="439"
            height="247"
            rx="18"
            fill="#0b3b36"
            stroke="white"
            stroke-opacity="0.16"
          />
          <rect
            x="40.5"
            y="28.5"
            width="439"
            height="247"
            rx="18"
            fill="white"
            fill-opacity="0.035"
          />
          <rect x="64" y="52" width="104" height="22" rx="11" fill="#6d28d9" fill-opacity="0.5" />
          <text
            class="qa-id"
            x="116"
            y="67"
            text-anchor="middle"
            fill="#ede9fe"
            font-size="10"
            font-weight="600"
            letter-spacing="1.2"
          >
            RESULT #0{{ firstResult }}
          </text>
          <text
            class="qa-count"
            x="456"
            y="67"
            text-anchor="end"
            fill="#5eead4"
            font-size="11"
            font-weight="600"
            font-family="ui-monospace, monospace"
          >
            5/5
          </text>
          <line
            class="qa-base"
            x1="184"
            y1="63"
            x2="330"
            y2="63"
            stroke="white"
            stroke-opacity="0.32"
            stroke-width="7"
            stroke-linecap="round"
          />
          <line
            class="qa-base"
            x1="64"
            y1="86"
            x2="236"
            y2="86"
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
              y1="254"
              x2="456"
              y2="254"
              stroke="white"
              stroke-opacity="0.08"
              stroke-width="4"
              stroke-linecap="round"
            />
            <line
              class="qa-progress"
              x1="64"
              y1="254"
              x2="456"
              y2="254"
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

          <!-- Reviewer notes that pop out of commented fields -->
          @for (row of commentRows; track row.y) {
            <g class="qa-note" opacity="0" filter="url(#qa-shadow)">
              <rect
                x="356"
                [attr.y]="row.y - 58"
                width="164"
                height="44"
                rx="10"
                fill="#1e1b4b"
                stroke="#a78bfa"
                stroke-opacity="0.6"
              />
              <path [attr.d]="'M428 ' + (row.y - 14) + ' l6 7 l6 -7 z'" fill="#1e1b4b" />
              <circle cx="376" [attr.cy]="row.y - 36" r="10" fill="#6d28d9" />
              <text
                x="376"
                [attr.y]="row.y - 32.5"
                text-anchor="middle"
                fill="#ede9fe"
                font-size="9"
                font-weight="700"
              >
                AS
              </text>
              <line
                x1="394"
                [attr.y1]="row.y - 42"
                x2="496"
                [attr.y2]="row.y - 42"
                stroke="#ede9fe"
                stroke-opacity="0.75"
                stroke-width="4"
                stroke-linecap="round"
              />
              <line
                x1="394"
                [attr.y1]="row.y - 30"
                x2="462"
                [attr.y2]="row.y - 30"
                stroke="#ede9fe"
                stroke-opacity="0.35"
                stroke-width="4"
                stroke-linecap="round"
              />
            </g>
          }

          <!-- Final stamp -->
          <g class="qa-stamp">
            <g transform="rotate(-8 360 172)">
              <rect
                x="282"
                y="150"
                width="156"
                height="44"
                rx="8"
                fill="#062521"
                fill-opacity="0.85"
                stroke="#5eead4"
                stroke-width="2"
              />
              <text
                x="360"
                y="178"
                text-anchor="middle"
                fill="#5eead4"
                font-size="15"
                font-weight="800"
                letter-spacing="2.5"
              >
                QA COMPLETE
              </text>
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
        <g class="qa-pipeline">
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
            cy="344"
            r="10"
            fill="#062521"
            stroke="white"
            stroke-opacity="0.28"
            stroke-width="1.5"
          />
          <text
            [attr.x]="step.x"
            y="378"
            text-anchor="middle"
            fill="white"
            fill-opacity="0.72"
            font-size="12"
            font-weight="500"
          >
            {{ step.label }}
          </text>
        }
        <g class="qa-pipeline">
          @for (step of steps; track step.label) {
            <g class="qa-node">
              <circle
                [attr.cx]="step.x"
                cy="344"
                r="10"
                fill="#5eead4"
                fill-opacity="0.18"
                stroke="#5eead4"
                stroke-width="1.5"
              />
              <circle [attr.cx]="step.x" cy="344" r="3.5" fill="#5eead4" />
            </g>
          }
        </g>
        <circle
          class="qa-ripple"
          cx="460"
          cy="344"
          r="10"
          stroke="#5eead4"
          stroke-width="2"
          opacity="0"
        />
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
  protected readonly commentRows = ROWS.filter((row) => row.verdict === 'comment');
  protected readonly steps = STEPS;
  protected readonly flowPath = FLOW_PATH;
  protected readonly firstResult = FIRST_RESULT;

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
    this.tilt(
      (event.clientX - box.left) / box.width - 0.5,
      (event.clientY - box.top) / box.height - 0.5,
    );
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
      const notes = q<SVGGElement>('.qa-note');
      const [count] = q<SVGTextElement>('.qa-count');
      const [resultId] = q<SVGTextElement>('.qa-id');

      const scanStart = ROWS[0].y - 22;
      const scanEnd = ROWS[ROWS.length - 1].y + 22;
      const rowStep = 560;
      const scanTime = rowStep * ROWS.length;
      const flowTime = 2600;
      const stampAt = scanTime + flowTime;
      let resultNumber = FIRST_RESULT;

      // The first card draws itself.
      createTimeline()
        .add(bases, { draw: ['0 0', '0 1'], duration: 650, delay: stagger(35), ease: 'inOutQuad' })
        .add('.qa-card', { opacity: [0, 1], duration: 500 }, 0);

      const loop = createTimeline({
        loop: true,
        delay: 900,
        onLoop: () => {
          resultNumber += 1;
          resultId.textContent = `RESULT #0${resultNumber}`;
        },
      })
        .set([...marks, ...verdicts, progress, flow], { draw: '0 0' })
        .set(nodes, { opacity: 0, scale: 0.4 })
        .set(notes, { opacity: 0 })
        .set('.qa-stamp', { opacity: 0 })
        .set('.qa-ripple', { r: 10, opacity: 0 })
        .set(['.qa-assessment', '.qa-pipeline'], { opacity: 1 })
        .set('.qa-beam', { translateY: scanStart })
        .call(() => (count.textContent = `0/${ROWS.length}`), 0)
        // Next result slides in from the deck.
        .add(
          '.qa-card',
          {
            opacity: [0, 1],
            translateY: [-18, 0],
            translateX: 0,
            rotate: 0,
            scale: [0.95, 1],
            duration: 650,
            ease: 'outCubic',
          },
          0,
        )
        .label('scan', 500)
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
        .add(progress, { draw: ['0 0', '0 1'], duration: scanTime, ease: 'linear' }, 'scan');

      ROWS.forEach((row, index) => {
        const verdictAt = 380 + index * rowStep;
        loop.call(() => (count.textContent = `${index + 1}/${ROWS.length}`), `scan+=${verdictAt}`);
        if (row.verdict === 'comment') {
          const note = notes[this.commentRows.indexOf(row)];
          loop
            .add(
              note,
              {
                opacity: [0, 1],
                scale: [0.6, 1],
                translateY: [10, 0],
                duration: 520,
                ease: 'outBack(2.2)',
              },
              `scan+=${verdictAt + 160}`,
            )
            .add(
              note,
              { opacity: 0, translateY: -6, duration: 280, ease: 'inQuad' },
              `scan+=${verdictAt + 1250}`,
            );
        }
      });

      loop
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
        .add('.qa-pulse', { opacity: 0, duration: 250 }, `flow+=${flowTime}`)
        .add(
          '.qa-ripple',
          { r: [10, 46], opacity: [0.9, 0], duration: 1000, ease: 'outQuad' },
          `scan+=${stampAt}`,
        )
        .add(
          '.qa-stamp',
          { opacity: [0, 1], scale: [1.8, 1], duration: 650, ease: 'outBack(1.8)' },
          `scan+=${stampAt + 80}`,
        )
        // Card is filed away to the right; the pipeline fades with it.
        .add(
          '.qa-card',
          { translateX: [0, 70], rotate: [0, 5], opacity: [1, 0], duration: 650, ease: 'inCubic' },
          `scan+=${stampAt + 1900}`,
        )
        .add('.qa-pipeline', { opacity: 0, duration: 650 }, `scan+=${stampAt + 1900}`);

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
