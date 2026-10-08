import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QaBadge } from './badge/qa-badge';
import { QaDrawerImports } from './drawer/qa-drawer';
import { QaMenuImports } from './menu/qa-menu';
import { QaMultiSelect } from './multi-select/qa-multi-select';
import { QaProgress } from './progress/qa-progress';
import { QaSegmented } from './segmented/qa-segmented';
import { QaSelect, QaSelectImports } from './select/qa-select';
import { QaSwitch } from './switch/qa-switch';
import { QaTabsImports } from './tabs/qa-tabs';
import { UiGallery } from './ui-gallery';

@Component({
  imports: [QaDrawerImports, QaMenuImports, QaSwitch, QaSegmented, QaTabsImports, QaSelect, QaMultiSelect, QaBadge, QaProgress],
  template: `
    <button id="open-drawer" type="button" (click)="open.set(true)">open</button>
    <qa-drawer [(open)]="open" title="Invite assessor" subtitle="Sub">
      <p id="drawer-body">Body</p>
      <div qaDrawerFooter><button id="drawer-save" type="button">Save</button></div>
    </qa-drawer>

    <button id="menu-trigger" type="button" [qaMenuTrigger]="menu">Actions</button>
    <ng-template #menu>
      <qa-menu-panel>
        <button qaMenuItem id="mi-edit" (triggered)="picked.set('edit')">Edit</button>
        <button qaMenuItem variant="danger">Remove</button>
      </qa-menu-panel>
    </ng-template>

    <qa-switch [(checked)]="on" aria-label="Loads results" />
    <qa-segmented [(value)]="seg" [options]="segOptions" size="compact" aria-label="Visibility" />

    <div qaTabs [(value)]="tab">
      <div qaTabList aria-label="Timelines">
        <button qaTab="live" id="tab-live">Live</button>
        <button qaTab="closed" id="tab-closed">Closed</button>
      </div>
      <div qaTabPanel="live" id="panel-live">L</div>
      <div qaTabPanel="closed" id="panel-closed">C</div>
    </div>

    <qa-select [(value)]="sel" [options]="selOptions" label="Timeline" />
    <qa-multi-select [(value)]="multi" [options]="multiOptions" label="Status" />
    <qa-badge status="awaiting" id="badge">Awaiting response</qa-badge>
    <qa-progress [value]="3" [max]="12" aria-label="Done" id="progress" />
  `,
})
class Host {
  readonly open = signal(false);
  readonly picked = signal('');
  readonly on = signal(false);
  readonly seg = signal<string | null>('hidden');
  readonly segOptions = [
    { value: 'hidden', label: 'Hidden' },
    { value: 'view', label: 'View only' },
  ];
  readonly tab = signal<string | undefined>('live');
  readonly sel = signal<string | null>('a');
  readonly selOptions = [
    { value: 'a', label: 'All timelines', description: '1,330 results' },
    { value: 'b', label: 'Annual report 2026', group: 'Official timeline' },
  ];
  readonly multi = signal<readonly string[]>([]);
  readonly multiOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'answered', label: 'Answered' },
  ];
}

@Component({
  imports: [QaDrawerImports, QaMenuImports, QaSelectImports, QaMultiSelect],
  template: `
    <button id="open-guarded" type="button" (click)="open.set(true)">open</button>
    <qa-drawer [(open)]="open" title="Comments" [closeGuard]="guard">
      <span qaDrawerHeader id="hdr-avatar">SR</span>
      <span qaDrawerHeader="end" id="hdr-tag">Highlighted</span>
      <p>Body</p>
    </qa-drawer>

    <qa-select [(value)]="type" [options]="typeOptions" label="Result type" searchable appearance="field">
      <button qaSelectFooter type="button" id="sel-footer">Manage</button>
    </qa-select>
    <qa-select [(value)]="round" [options]="roundOptions" label="QA round" appearance="filter" indicator="radio" />
    <qa-multi-select appearance="field" [(value)]="programs" [options]="programOptions" label="Science programs" placeholder="All programs" />

    <button id="menu2" type="button" [qaMenuTrigger]="m2">Timelines</button>
    <ng-template #m2>
      <qa-menu-panel density="comfortable" maxHeight="360px" scroll="content">
        <button qaMenuItem size="tall" id="mi-tall">Annual</button>
        <button qaMenuItem variant="link" size="compact" id="mi-link">Manage timelines</button>
      </qa-menu-panel>
    </ng-template>
  `,
})
class Host2 {
  readonly open = signal(false);
  readonly allow = signal(false);
  guardCalls = 0;
  readonly guard = () => {
    this.guardCalls++;
    return this.allow();
  };
  readonly type = signal<string | null>(null);
  readonly typeOptions = [
    { value: 'cap', label: 'Capacity sharing', count: 41 },
    { value: 'inn', label: 'Innovation development', count: 38 },
    { value: 'kp', label: 'Knowledge product', count: 44 },
  ];
  readonly round = signal<string | null>('');
  readonly roundOptions = [
    { value: '', label: 'All rounds' },
    { value: 'R1', label: 'Round 1' },
  ];
  readonly programs = signal<readonly string[]>([]);
  readonly programOptions = [
    { value: 'SP01', label: 'SP01 Breeding' },
    { value: 'SP02', label: 'SP02 Rice' },
    { value: 'SP05', label: 'SP05 Landscapes' },
  ];
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

describe('UI kit', () => {
  beforeAll(() => {
    // jsdom has no scrollIntoView (BrnSelectItem calls it on keyboard highlight).
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function settle(fixture: { whenStable(): Promise<unknown> }) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 30));
    await fixture.whenStable();
  }

  it('registers the global qa-tokens stylesheet', async () => {
    await setup();
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css).toContain('.qa-tokens');
    expect(css).toContain('--shadow-pop');
    expect(css).toMatch(/\.dark \.qa-tokens/);
  });

  it('drawer opens as a labelled dialog with tokens, and closes on Escape', async () => {
    const fixture = await setup();
    $('#open-drawer')!.click();
    await settle(fixture);
    const dialog = $('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('.qa-tokens')).toBeTruthy();
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toContain('Invite assessor');
    expect(dialog.querySelector('#drawer-body')).toBeTruthy();
    expect(dialog.querySelector('#drawer-save')).toBeTruthy();
    expect(dialog.querySelector('button[aria-label="Close"]')).toBeTruthy();
    expect($('.cdk-overlay-backdrop')?.classList.contains('qa-tokens')).toBe(true);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('menu opens role=menu items and closes on selection', async () => {
    const fixture = await setup();
    $('#menu-trigger')!.click();
    await settle(fixture);
    expect($('[role="menu"].qa-tokens')).toBeTruthy();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2);
    $('#mi-edit')!.click();
    await settle(fixture);
    expect(fixture.componentInstance.picked()).toBe('edit');
    expect($('[role="menu"]')).toBeNull();
  });

  it('switch, segmented and tabs update their models', async () => {
    const fixture = await setup();
    const sw = $('button[role="switch"]')!;
    expect(sw.getAttribute('aria-label')).toBe('Loads results');
    sw.click();
    await settle(fixture);
    expect(fixture.componentInstance.on()).toBe(true);

    const radios = document.querySelectorAll<HTMLInputElement>('qa-segmented input[type="radio"]');
    expect(radios.length).toBe(2);
    $('qa-segmented [role="radiogroup"]') ?? expect.fail('no radiogroup');
    radios[1].click();
    await settle(fixture);
    expect(fixture.componentInstance.seg()).toBe('view');

    const closedTab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.includes('Closed'))!;
    closedTab.click();
    await settle(fixture);
    expect(fixture.componentInstance.tab()).toBe('closed');
    expect(Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).find((p) => p.textContent === 'L')!.hidden).toBe(true);
    expect(closedTab.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById(closedTab.getAttribute('aria-controls')!)?.textContent).toBe('C');
  });

  it('select opens a listbox and picks an option', async () => {
    const fixture = await setup();
    const trigger = $('qa-select button[role="combobox"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Timeline: All timelines');
    trigger.click();
    await settle(fixture);
    const options = document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]');
    expect(options.length).toBe(2);
    expect($('[role="listbox"]')!.closest('.qa-tokens')).toBeTruthy();
    options[1].click();
    await settle(fixture);
    expect(fixture.componentInstance.sel()).toBe('b');
  });

  it('multi-select toggles values and shows a count', async () => {
    const fixture = await setup();
    $('qa-multi-select button')!.click();
    await settle(fixture);
    const boxes = document.querySelectorAll<HTMLElement>('[role="checkbox"]');
    expect(boxes.length).toBe(2);
    boxes[1].click();
    await settle(fixture);
    expect(fixture.componentInstance.multi()).toEqual(['answered']);
    expect($('qa-multi-select button')!.getAttribute('aria-label')).toBe('Status, 1 selected');
  });

  it('badge and progress render', async () => {
    await setup();
    expect($('#badge')!.className).toContain('bg-(--st-editing-bg)');
    const bar = $('#progress')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.querySelector<HTMLElement>('div')!.style.width).toBe('25%');
  });

  it('gallery renders', async () => {
    const fixture = TestBed.createComponent(UiGallery);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('section').length).toBe(7);
  });
});

describe('UI kit variants', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  async function setup() {
    const fixture = TestBed.createComponent(Host2);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function settle(fixture: { whenStable(): Promise<unknown> }) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 30));
    await fixture.whenStable();
  }

  it('drawer shows header slots next to the title and asks the guard before closing', async () => {
    const fixture = await setup();
    $('#open-guarded')!.click();
    await settle(fixture);
    const dialog = $('[role="dialog"]')!;
    expect(dialog.querySelector('#hdr-avatar')).toBeTruthy();
    expect(dialog.querySelector('#hdr-tag')!.className).toContain('order-last');

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(fixture.componentInstance.guardCalls).toBe(1);
    expect(fixture.componentInstance.open()).toBe(true);
    expect($('[role="dialog"]')).toBeTruthy();
    expect($('[role="dialog"] [data-state]')!.getAttribute('data-state')).toBe('open');

    fixture.componentInstance.allow.set(true);
    $<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click();
    await settle(fixture);
    expect(fixture.componentInstance.guardCalls).toBe(2);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('closing the drawer from code skips the guard', async () => {
    const fixture = await setup();
    fixture.componentInstance.open.set(true);
    await settle(fixture);
    fixture.componentInstance.open.set(false);
    await settle(fixture);
    expect(fixture.componentInstance.guardCalls).toBe(0);
  });

  it('searchable field select filters, shows counts, picks with the keyboard and has a footer', async () => {
    const fixture = await setup();
    const trigger = document.querySelectorAll('qa-select button[role="combobox"]')[0] as HTMLElement;
    expect(trigger.getAttribute('aria-label')).toBe('Result type: Select…');
    expect(trigger.className).toContain('min-w-[280px]');
    trigger.click();
    await settle(fixture);
    expect(document.querySelectorAll('[role="listbox"] [role="option"]').length).toBe(3);
    expect(document.querySelector('[role="listbox"] [role="option"]')!.textContent).toContain('41');

    const search = $<HTMLInputElement>('input[role="combobox"]')!;
    search.value = 'know';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(document.querySelectorAll('[role="listbox"] [role="option"]').length).toBe(1);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(fixture);
    expect(fixture.componentInstance.type()).toBe('kp');

    trigger.click();
    await settle(fixture);
    expect($('#sel-footer')).toBeTruthy();
    $('#sel-footer')!.click();
    await settle(fixture);
    expect($('[role="listbox"]')).toBeNull();
  });

  it('filter select with radios shows a count chip once a value is picked', async () => {
    const fixture = await setup();
    const trigger = document.querySelectorAll('qa-select button[role="combobox"]')[1] as HTMLElement;
    expect(trigger.getAttribute('aria-label')).toBe('QA round');
    trigger.click();
    await settle(fixture);
    const options = document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]');
    expect(options[0].querySelector('.rounded-full')).toBeTruthy();
    options[1].click();
    await settle(fixture);
    expect(fixture.componentInstance.round()).toBe('R1');
    expect(trigger.getAttribute('aria-label')).toBe('QA round, Round 1');
    expect(trigger.textContent).toContain('1');
  });

  it('field multi-select summarises the selection', async () => {
    const fixture = await setup();
    const trigger = () => $('qa-multi-select button')!;
    expect(trigger().textContent).toContain('All programs');
    fixture.componentInstance.programs.set(['SP02', 'SP05']);
    await settle(fixture);
    expect(trigger().textContent).toContain('SP02, SP05');
    fixture.componentInstance.programs.set(['SP01', 'SP02', 'SP05']);
    await settle(fixture);
    expect(trigger().textContent).toContain('3 selected');
    expect(trigger().getAttribute('aria-label')).toBe('Science programs: 3 selected');
  });

  it('menu panel density and item sizes come from inputs', async () => {
    const fixture = await setup();
    $('#menu2')!.click();
    await settle(fixture);
    const panel = $('[role="menu"]')!;
    expect(panel.className).toContain('p-3');
    expect(panel.className).toContain('overflow-hidden');
    expect(panel.style.maxHeight).toBe('360px');
    expect($('#mi-tall')!.className).toContain('min-h-11');
    expect($('#mi-link')!.className).toContain('text-(--accent)');
    expect($('#mi-link')!.className).toContain('w-auto');
  });
});
