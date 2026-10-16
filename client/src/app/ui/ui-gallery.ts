import { Component, signal } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaBadge, QaBadgeStatus } from './badge/qa-badge';
import { QaDrawerImports } from './drawer/qa-drawer';
import { QaMenuImports } from './menu/qa-menu';
import { QaMultiSelect, QaMultiSelectOption } from './multi-select/qa-multi-select';
import { QaProgress } from './progress/qa-progress';
import { QaSegmented, QaSegmentedOption } from './segmented/qa-segmented';
import { QaSelectImports, QaSelectOption } from './select/qa-select';
import { QaSwitch } from './switch/qa-switch';
import { QaTabsImports } from './tabs/qa-tabs';
import { injectQaTokens } from './tokens/qa-tokens';
import { QaTooltipImports } from './tooltip/qa-tooltip';

const BTN_OUTLINE =
  'h-auto min-h-9 gap-2 rounded-lg border-(--border) bg-(--field-bg) px-3.5 text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) dark:border-(--border) dark:bg-(--field-bg) dark:hover:bg-(--surface-2) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) focus-visible:outline-none';
const BTN_PRIMARY =
  'h-auto min-h-9 gap-2 rounded-lg border-0 bg-(--primary) px-3.5 text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) focus-visible:outline-none';

/**
 * Visual check page for the shared UI kit (not routed; the lead adds the route).
 * Wears `qa-tokens` itself so it renders correctly inside or outside the app shell.
 */
@Component({
  selector: 'qa-ui-gallery',
  imports: [
    HlmButton,
    QaBadge,
    QaDrawerImports,
    QaMenuImports,
    QaMultiSelect,
    QaProgress,
    QaSegmented,
    QaSelectImports,
    QaSwitch,
    QaTabsImports,
    QaTooltipImports,
  ],
  host: { class: 'qa-tokens block min-h-dvh bg-(--bg) px-4 py-8 sm:px-8' },
  template: `
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=JetBrains+Mono:wght@400..700&display=swap" />
    <div class="mx-auto flex max-w-[1040px] flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1 class="m-0 text-(length:--fs-26) leading-[1.2] font-bold tracking-[-0.02em] text-(--text)">UI kit</h1>
        <p class="m-0 text-(length:--fs-14) text-(--text-3)">Shared components in <code class="font-(family-name:--qa-mono)">src/app/ui</code>, styled as the QA Platform mockup.</p>
      </header>

      <!-- Drawer -->
      <section class="flex flex-col gap-3 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-drawer">
        <h2 id="g-drawer" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-drawer</h2>
        <div class="flex flex-wrap gap-2.5">
          <button hlmBtn variant="outline" type="button" [class]="btnOutline" (click)="drawerNarrow.set(true)">Open 480px drawer</button>
          <button hlmBtn variant="outline" type="button" [class]="btnOutline" (click)="drawerWide.set(true)">Open 720px drawer</button>
        </div>
        <qa-drawer [(open)]="drawerNarrow" title="Edit assignment" subtitle="Changes apply to results not yet assessed." [closeGuard]="askBeforeClose">
          <span qaDrawerHeader aria-hidden="true" class="flex size-9 items-center justify-center rounded-full bg-(--tint-2) font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--accent)">SR</span>
          <span qaDrawerHeader="end" class="mt-0.5 rounded-full bg-(--st-rejected-bg) px-2 py-0.5 text-(length:--fs-11) font-semibold text-(--st-rejected-fg)">Highlighted</span>
          @if (drawerAsk()) {
            <p role="alert" class="m-0 text-(length:--fs-13) text-(--danger)">The switch is on: press Esc again to close anyway (closeGuard).</p>
          }
          <p class="m-0 text-(length:--fs-14) text-(--text-2)">Drawer body. It scrolls when the content is taller than the screen.</p>
          <div class="flex min-h-[52px] items-center gap-4">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id="g-drawer-lead" class="text-(length:--fs-14) font-medium text-(--text-2)">Can edit and delete other assessors' comments</span>
              <span class="text-(length:--fs-13) text-pretty text-(--text-4)">Gives lead assessor permissions without changing the role.</span>
            </div>
            <qa-switch [(checked)]="drawerSwitch" aria-labelledby="g-drawer-lead" />
          </div>
          <div qaDrawerFooter class="contents">
            <button hlmBtn variant="outline" type="button" [class]="btnOutline" (click)="drawerNarrow.set(false)">Cancel</button>
            <button hlmBtn type="button" [class]="btnPrimary" (click)="drawerNarrow.set(false)">Save</button>
          </div>
        </qa-drawer>
        <qa-drawer [(open)]="drawerWide" width="720px" title="Invite assessor" subtitle="They get an email with a link to the QA platform.">
          @for (n of longList; track n) {
            <p class="m-0 text-(length:--fs-14) text-(--text-3)">Paragraph {{ n }} — long content to show the scrollable body.</p>
          }
          <div qaDrawerFooter class="contents">
            <button hlmBtn variant="outline" type="button" [class]="btnOutline" (click)="drawerWide.set(false)">Cancel</button>
            <button hlmBtn type="button" [class]="btnPrimary" (click)="drawerWide.set(false)">Send invitation</button>
          </div>
        </qa-drawer>
      </section>

      <!-- Menu -->
      <section class="flex flex-col gap-3 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-menu">
        <h2 id="g-menu" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-menu</h2>
        <div class="flex flex-wrap items-center gap-3">
          <button hlmBtn variant="outline" type="button" [class]="btnOutline" [qaMenuTrigger]="rowMenu">Row actions</button>
          <button
            type="button"
            [qaMenuTrigger]="rowMenu"
            qaMenuAlign="end"
            aria-label="Actions for Assessor SR"
            class="flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-(--text-3) hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <span class="text-(length:--fs-13) text-(--text-4)">Last action: {{ lastAction() }}</span>
        </div>
        <ng-template #rowMenu>
          <qa-menu-panel width="220px">
            <span qaMenuLabel>Assessor SR</span>
            <button qaMenuItem (triggered)="lastAction.set('Edit assignment')">Edit assignment</button>
            <button qaMenuItem (triggered)="lastAction.set('Send reminder')">Send reminder</button>
            <button qaMenuItem disabled>Reassign (disabled)</button>
            <span qaMenuSeparator></span>
            <button qaMenuItem variant="danger" (triggered)="lastAction.set('Remove from team')">Remove from team</button>
          </qa-menu-panel>
        </ng-template>
      </section>

      <!-- Switch + segmented -->
      <section class="flex flex-col gap-4 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-controls">
        <h2 id="g-controls" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-switch · qa-segmented</h2>
        <div class="flex flex-wrap items-center gap-6">
          <label class="flex items-center gap-2.5 text-(length:--fs-13) text-(--text-2)">
            <qa-switch [(checked)]="switchOn" aria-label="Step 1 loads results" />
            Step 1 loads results ({{ switchOn() ? 'on' : 'off' }})
          </label>
          <span class="flex items-center gap-2.5 text-(length:--fs-13) text-(--text-4)">
            <qa-switch [checked]="false" disabled aria-label="Core field (locked)" /> Disabled
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-6">
          <qa-segmented [(value)]="grouping" [options]="groupingOptions" aria-label="Group the work" />
          <qa-segmented [(value)]="visibility" [options]="visibilityOptions" size="compact" aria-label="In QA: Contributing CGIAR centers" />
        </div>
        <p class="m-0 text-(length:--fs-13) text-(--text-4)">grouping = {{ grouping() }} · visibility = {{ visibility() }}</p>
      </section>

      <!-- Tabs -->
      <section class="flex flex-col gap-4 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-tabs">
        <h2 id="g-tabs" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-tabs</h2>
        <div qaTabs [(value)]="timelineTab">
          <div qaTabList aria-label="Timelines" class="mb-4">
            <button qaTab="live">Live <span qaTabCount>3</span></button>
            <button qaTab="closed">Closed <span qaTabCount>14</span></button>
          </div>
          <div qaTabPanel="live" class="text-(length:--fs-14) text-(--text-3)">Live timelines panel.</div>
          <div qaTabPanel="closed" class="text-(length:--fs-14) text-(--text-3)">Closed timelines panel.</div>
        </div>
        <div qaTabs variant="segmented" [(value)]="overviewTab" class="gap-3">
          <div qaTabList aria-label="Group the work">
            <button qaTab="type">By result type</button>
            <button qaTab="program">By science program</button>
            <button qaTab="assessor">By assessor</button>
          </div>
          <div qaTabPanel="type" class="text-(length:--fs-14) text-(--text-3)">Grouped by result type.</div>
          <div qaTabPanel="program" class="text-(length:--fs-14) text-(--text-3)">Grouped by science program.</div>
          <div qaTabPanel="assessor" class="text-(length:--fs-14) text-(--text-3)">Grouped by assessor.</div>
        </div>
      </section>

      <!-- Select + multi-select -->
      <section class="flex flex-col gap-4 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-select">
        <h2 id="g-select" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-select · qa-multi-select</h2>
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-(length:--fs-13) font-medium text-(--text-3)">Timeline</span>
          <qa-select [(value)]="timeline" [options]="timelineOptions" label="Timeline" panelWidth="340px" emphasis class="min-w-[260px]" />
          <qa-select [(value)]="role" [options]="roleOptions" label="Role" placeholder="Select a role" class="min-w-[220px]" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <qa-multi-select [(value)]="programs" [options]="programOptions" label="Science program" searchPlaceholder="Search programs" />
          <qa-multi-select [(value)]="statuses" [options]="statusOptions" label="Status" searchPlaceholder="Search statuses" />
        </div>
        <div class="flex flex-wrap items-start gap-3">
          <qa-select [(value)]="timeline" [options]="timelineOptions" label="Timeline (searchable)" searchable searchPlaceholder="Search timelines" panelWidth="340px" class="min-w-[260px]">
            <a qaSelectFooter href="#g-select" class="inline-flex min-h-8 items-center rounded-lg px-2 text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring)">Manage timelines</a>
          </qa-select>
          <qa-select [(value)]="resultType" [options]="typeOptions" label="Result type" searchable appearance="field" />
          <qa-select [(value)]="round" [options]="roundOptions" label="QA round" appearance="filter" indicator="radio" panelWidth="280px" />
          <qa-multi-select appearance="field" [(value)]="programs" [options]="programOptions" label="Science programs" placeholder="All programs" searchPlaceholder="Search programs" />
        </div>
        <p class="m-0 text-(length:--fs-13) text-(--text-4)">timeline = {{ timeline() }} · role = {{ role() ?? '—' }} · programs = {{ programs().join(', ') || '—' }} · status = {{ statuses().join(', ') || '—' }}</p>
      </section>

      <!-- Tooltip -->
      <section class="flex flex-col gap-3 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-tooltip">
        <h2 id="g-tooltip" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-tooltip</h2>
        <div class="flex flex-wrap items-center gap-4 text-(length:--fs-13) font-semibold text-(--text-2)">
          <span class="flex items-center gap-1">
            Nickname
            <button type="button" [qaTooltip]="'How this person appears in tables and comment threads. Short is better.'" aria-label="More about Nickname" [class]="infoBtn">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg>
            </button>
          </span>
          <span class="flex items-center gap-1">
            Contributing CGIAR centers
            <button type="button" [qaTooltip]="docTip" qaTooltipPosition="right" aria-label="Field documentation: Contributing CGIAR centers" [class]="infoBtn">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg>
            </button>
          </span>
          <ng-template #docTip>
            <qa-tooltip-content title="Contributing CGIAR centers">CGIAR centers that contributed staff or funding to the result.</qa-tooltip-content>
          </ng-template>
        </div>
      </section>

      <!-- Badge + progress -->
      <section class="flex flex-col gap-4 rounded-xl border border-(--border) bg-(--surface) p-5" aria-labelledby="g-badge">
        <h2 id="g-badge" class="m-0 text-(length:--fs-16) font-bold text-(--text)">qa-badge · qa-progress</h2>
        <div class="flex flex-wrap items-center gap-2">
          @for (b of badges; track b.status) {
            <qa-badge [status]="b.status">{{ b.label }}</qa-badge>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <qa-badge status="indigo" size="sm">Live</qa-badge>
          <qa-badge status="submitted" size="sm">Scheduled</qa-badge>
          <qa-badge status="editing" size="sm">Test</qa-badge>
        </div>
        <div class="flex max-w-[360px] flex-col gap-3">
          <qa-progress [value]="94" [max]="100" aria-label="Step 5 reviewed" />
          <qa-progress [value]="62" [max]="100" aria-label="Step 5 reviewed" />
          <qa-progress [value]="3" [max]="12" aria-label="Results corrected" />
        </div>
      </section>
    </div>
  `,
})
export class UiGallery {
  protected readonly btnOutline = BTN_OUTLINE;
  protected readonly btnPrimary = BTN_PRIMARY;
  protected readonly infoBtn =
    'flex size-5 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--text-muted) hover:text-(--primary) focus-visible:shadow-(--focus-ring) focus-visible:outline-none';
  protected readonly longList = Array.from({ length: 30 }, (_, i) => i + 1);

  protected readonly drawerNarrow = signal(false);
  protected readonly drawerWide = signal(false);
  protected readonly drawerSwitch = signal(false);
  protected readonly drawerAsk = signal(false);
  /** Gallery demo of closeGuard: with the switch on, the first Esc / X only shows a warning. */
  protected readonly askBeforeClose = (): boolean => {
    if (this.drawerSwitch() && !this.drawerAsk()) {
      this.drawerAsk.set(true);
      return false;
    }
    this.drawerAsk.set(false);
    return true;
  };
  protected readonly resultType = signal<string | null>('Innovation development');
  protected readonly typeOptions: QaSelectOption[] = [
    { value: 'Capacity sharing', label: 'Capacity sharing', count: 41 },
    { value: 'Innovation development', label: 'Innovation development', count: 38 },
    { value: 'Knowledge product', label: 'Knowledge product', count: 44 },
    { value: 'Policy change', label: 'Policy change', count: 40, meta: 'New' },
  ];
  protected readonly round = signal<string | null>('');
  protected readonly roundOptions: QaSelectOption[] = [
    { value: '', label: 'All rounds' },
    { value: 'Round 1', label: 'Round 1' },
    { value: 'Round 2', label: 'Round 2' },
  ];
  protected readonly lastAction = signal('none');

  protected readonly switchOn = signal(true);
  protected readonly grouping = signal<string | null>('type');
  protected readonly groupingOptions: QaSegmentedOption[] = [
    { value: 'type', label: 'By result type' },
    { value: 'program', label: 'By science program' },
    { value: 'assessor', label: 'By assessor' },
  ];
  protected readonly visibility = signal<string | null>('hidden');
  protected readonly visibilityOptions: QaSegmentedOption[] = [
    { value: 'hidden', label: 'Hidden' },
    { value: 'view', label: 'View only' },
    { value: 'assessed', label: 'Assessed' },
    { value: 'third', label: 'Third-party' },
  ];

  protected readonly timelineTab = signal<string | undefined>('live');
  protected readonly overviewTab = signal<string | undefined>('type');

  protected readonly timeline = signal<string | null>('all');
  protected readonly timelineOptions: QaSelectOption[] = [
    { value: 'all', label: 'All timelines', description: '1,330 results' },
    { value: 'ar-2026', label: 'Annual report 2026', description: '1,114 results · step 5 of 5 · closes 19 Jul', group: 'Official timeline' },
    { value: 'jul-2026', label: 'July 2026 sub-timeline', description: '216 results · step 5 of 5 · closes 19 Jul', group: 'Sub-timelines' },
    { value: 'sep-pilot', label: 'September pilot', description: '0 results · step 1 of 5 · opens 01 Sep', group: 'Sub-timelines' },
  ];
  protected readonly role = signal<string | null>(null);
  protected readonly roleOptions: QaSelectOption[] = [
    { value: 'assessor', label: 'Assessor' },
    { value: 'lead', label: 'Lead assessor' },
    { value: 'broker', label: 'Third-party broker', disabled: true },
  ];

  protected readonly programs = signal<readonly string[]>([]);
  protected readonly programOptions: QaMultiSelectOption[] = [
    { value: 'SP01', label: 'SP01 Breeding for Tomorrow' },
    { value: 'SP02', label: 'SP02 Rice Agrifood Systems' },
    { value: 'SP04', label: 'SP04 Climate Action' },
    { value: 'SP05', label: 'SP05 Multifunctional Landscapes' },
    { value: 'SP07', label: 'SP07 Genetic Innovation' },
    { value: 'SP09', label: 'SP09 Sustainable Animal and Aquatic Foods' },
    { value: 'SP11', label: 'SP11 Policy Innovations' },
    { value: 'SP12', label: 'SP12 Scaling for Impact' },
  ];
  protected readonly statuses = signal<readonly string[]>(['awaiting']);
  protected readonly statusOptions: QaMultiSelectOption[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'in-review', label: 'In review' },
    { value: 'awaiting', label: 'Awaiting response' },
    { value: 'answered', label: 'Answered' },
    { value: 'assessed', label: 'Quality assessed' },
  ];

  protected readonly badges: { status: QaBadgeStatus; label: string }[] = [
    { status: 'pending', label: 'Pending' },
    { status: 'in-review', label: 'In review' },
    { status: 'awaiting', label: 'Awaiting response' },
    { status: 'answered', label: 'Answered' },
    { status: 'assessed', label: 'Quality assessed' },
    { status: 'approved', label: 'Approved' },
    { status: 'rejected', label: 'Rejected' },
    { status: 'editing', label: 'Editing' },
    { status: 'submitted', label: 'Submitted' },
    { status: 'indigo', label: 'Live' },
    { status: 'qa', label: 'In QA' },
    { status: 'neutral', label: 'Automatic' },
  ];

  constructor() {
    injectQaTokens();
  }
}
