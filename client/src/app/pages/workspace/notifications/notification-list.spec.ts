import { TestBed } from '@angular/core/testing';
import { NotificationList } from './notification-list';
import { NotificationRow, ROW_BOX } from './notification-row';
import { NOTIFICATION_TYPES, type Notification, type SentencePart } from './notifications.model';

/** A notification built for these tests only (the list never reads the mock). */
function make(overrides: Partial<Notification> & Pick<Notification, 'id'>): Notification {
  return {
    type: 'Slow program',
    sentence: [{ text: 'SP12', strong: true }, { text: ' has not replied to any of its ' }, { text: '2', strong: true }, { text: ' returned results.' }],
    detail: null,
    timelineId: 'annual',
    program: null,
    step: null,
    day: 'today',
    when: '2 hours ago',
    unread: false,
    target: { path: '/results' },
    total: 2,
    action: null,
    ...overrides,
  };
}

/** One notification of every type, so a rule about "every type" cannot pass by covering only one. */
const ALL_TYPES: readonly Notification[] = NOTIFICATION_TYPES.map((type, i) =>
  make({ id: `t-${i}`, type, action: 'View results' }),
);

const STEP_COMPLETE = make({
  id: 'sc',
  type: 'Step complete',
  sentence: [
    { text: 'Assessors', strong: true },
    { text: ' finished ' },
    { text: 'July 2026 sub-timeline', strong: true },
    { text: ': all ' },
    { text: '216', strong: true },
    { text: ' results are assessed. They can go to the science programs.' },
  ],
  detail: 'Assessed by 2 assessors, or by 1 for Knowledge product and Other output.',
  timelineId: 'jul',
  step: 'Next: Programs correct',
  unread: true,
  target: { path: '/cycle' },
  total: 216,
  action: 'Open next step',
});

function renderRow(n: Notification, inputs: { timelineName?: string; batch?: string } = {}) {
  const fixture = TestBed.createComponent(NotificationRow);
  fixture.componentRef.setInput('notification', n);
  fixture.componentRef.setInput('timelineName', inputs.timelineName ?? 'Annual report 2026');
  fixture.componentRef.setInput('batch', inputs.batch ?? 'Main batch');
  fixture.detectChanges();
  return fixture;
}

function renderList(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(NotificationList);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture;
}

const root = (f: { nativeElement: HTMLElement }): HTMLElement => f.nativeElement;
const text = (e: Element): string => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
const plain = (parts: readonly SentencePart[]): string => parts.map((p) => p.text).join('');
const buttonLabelled = (host: HTMLElement, label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((b) => text(b) === label);

describe('NotificationRow', () => {
  it('bolds exactly the strong parts of the sentence and reads the sentence whole', () => {
    const sentence = root(renderRow(STEP_COMPLETE)).querySelector('[data-sentence]')!;
    expect(text(sentence)).toBe(plain(STEP_COMPLETE.sentence));
    expect(Array.from(sentence.querySelectorAll('strong')).map(text)).toEqual(['Assessors', 'July 2026 sub-timeline', '216']);
  });

  it('shows the meta line: type pill, batch pill, the step (or the timeline) and the relative time', () => {
    const meta = root(renderRow(STEP_COMPLETE, { batch: 'Complementary batch' })).querySelector('[data-meta]')!;
    expect(text(meta.querySelector('[data-type]')!)).toBe('Step complete');
    expect(text(meta.querySelector('[data-batch]')!)).toBe('Complementary batch');
    expect(text(meta.querySelector('[data-context]')!)).toBe('Next: Programs correct');
    expect(text(meta.querySelector('[data-when]')!)).toBe(STEP_COMPLETE.when);

    // Without a step the meta shows the timeline name; an update about every timeline shows none.
    const stage = root(renderRow(make({ id: 's' }), { timelineName: 'Annual report 2026' }));
    expect(text(stage.querySelector('[data-context]')!)).toBe('Annual report 2026');
    const everywhere = root(renderRow(make({ id: 'all', timelineId: 'all' }), { timelineName: 'All timelines', batch: 'All batches' }));
    expect(everywhere.querySelector('[data-context]')).toBeNull();
    expect(text(everywhere.querySelector('[data-batch]')!)).toBe('All batches');
  });

  it('shows the grey detail line only when the notification has one', () => {
    expect(text(root(renderRow(STEP_COMPLETE)).querySelector('[data-detail]')!)).toContain('Knowledge product and Other output');
    expect(root(renderRow(make({ id: 'x' }))).querySelector('[data-detail]')).toBeNull();
  });

  it('colours the pill and the icon by type: green for a finished step, amber for a slow program', () => {
    const tones: Record<string, string> = {
      'Step complete': '--st-approved-bg',
      'Slow program': '--st-editing-bg',
    };
    for (const n of ALL_TYPES) {
      const row = root(renderRow(n));
      const pill = row.querySelector('[data-type]')!;
      const icon = row.querySelector('[data-row] span.size-8')!;
      const expected = tones[n.type] ?? '--surface-3';
      expect(pill.className, `${n.type} pill`).toContain(expected);
      expect(icon.className, `${n.type} icon`).toContain(expected);
      expect(icon.querySelector('svg'), `${n.type} icon svg`).toBeTruthy();
    }
  });

  it('holds the hidden "Unread" text and the dot only when the notification is unread', () => {
    const unread = root(renderRow(make({ id: 'u', unread: true })));
    expect(unread.querySelector('.sr-only')?.textContent).toBe('Unread');
    expect(unread.querySelector('.bg-\\(--primary\\)')).toBeTruthy();
    const read = root(renderRow(make({ id: 'r' })));
    expect(read.querySelector('.sr-only')).toBeNull();
    expect(read.querySelector('.bg-\\(--primary\\)')).toBeNull();
  });

  it('a needs-action row has its main action and "Not now", described by the sentence; the row itself is not a button', () => {
    const f = renderRow(STEP_COMPLETE);
    const opened = vi.fn();
    const dismissed = vi.fn();
    f.componentInstance.opened.subscribe(opened);
    f.componentInstance.dismissed.subscribe(dismissed);
    const host = root(f);

    expect(host.querySelector('[data-row]')!.tagName).toBe('DIV');
    const main = buttonLabelled(host, 'Open next step')!;
    const notNow = buttonLabelled(host, 'Not now')!;
    const sentenceId = host.querySelector('[data-sentence]')!.id;
    expect(sentenceId).toBeTruthy();
    expect(main.getAttribute('aria-describedby')).toBe(sentenceId);
    expect(notNow.getAttribute('aria-describedby')).toBe(sentenceId);

    main.click();
    expect(opened).toHaveBeenCalledWith(STEP_COMPLETE);
    expect(dismissed).not.toHaveBeenCalled();
    notNow.click();
    expect(dismissed).toHaveBeenCalledWith(STEP_COMPLETE);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('an update row is one button that opens it, with the sentence in its name and no other buttons', () => {
    const n = make({ id: 'i' });
    const f = renderRow(n);
    const opened = vi.fn();
    f.componentInstance.opened.subscribe(opened);
    const host = root(f);

    const row = host.querySelector<HTMLButtonElement>('[data-row]')!;
    expect(row.tagName).toBe('BUTTON');
    expect(host.querySelectorAll('button').length).toBe(1);
    expect(text(row)).toContain(plain(n.sentence));
    row.click();
    expect(opened).toHaveBeenCalledWith(n);
  });

  it('never uses --text-muted, for every type, read or unread', () => {
    for (const n of [...ALL_TYPES, ...ALL_TYPES.map((x) => ({ ...x, unread: true }))]) {
      expect(root(renderRow(n)).innerHTML, n.type).not.toContain('--text-muted');
    }
  });
});

describe('NotificationList', () => {
  const items: readonly Notification[] = [
    make({ id: 'a', day: 'today' }),
    make({ id: 'b', day: 'today', type: 'Step complete', action: 'Open next step' }),
    make({ id: 'c', day: 'yesterday' }),
    make({ id: 'd', day: 'earlier' }),
    make({ id: 'e', day: 'earlier' }),
    make({ id: 'f', day: 'earlier' }),
  ];

  it('splits the items into Today, Yesterday and Earlier bands, each with its count, keeping newest first', () => {
    const host = root(renderList({ items }));
    const bands = Array.from(host.querySelectorAll('[data-group]'));
    expect(bands.map((b) => text(b))).toEqual(['Today, 2 notifications', 'Yesterday, 1 notification', 'Earlier, 3 notifications']);
    expect(bands.map((b) => text(b.querySelector('[data-group-count]')!).replace(/\D/g, ''))).toEqual(['2', '1', '3']);
    // Each band is a full-width grey header above its rows.
    for (const b of bands) expect(b.className).toContain('bg-(--surface-2)');
    const sections = Array.from(host.querySelectorAll('section'));
    expect(sections.map((s) => s.querySelectorAll('qa-notification-row').length)).toEqual([2, 1, 3]);
  });

  it('omits a day without items', () => {
    const host = root(renderList({ items: items.filter((n) => n.day !== 'yesterday') }));
    expect(Array.from(host.querySelectorAll('[data-group]')).map((b) => text(b).split(',')[0])).toEqual(['Today', 'Earlier']);
  });

  it('passes each row its timeline name and batch label, and forwards opened and dismissed', () => {
    const f = renderList({
      items,
      timelineNames: { annual: 'Annual report 2026' },
      batchLabels: { annual: 'Main batch' },
    });
    const opened = vi.fn();
    const dismissed = vi.fn();
    f.componentInstance.opened.subscribe(opened);
    f.componentInstance.dismissed.subscribe(dismissed);
    const host = root(f);

    expect(text(host.querySelector('[data-batch]')!)).toBe('Main batch');
    expect(text(host.querySelector('[data-context]')!)).toBe('Annual report 2026');

    host.querySelector<HTMLButtonElement>('button[data-row]')!.click();
    expect(opened).toHaveBeenCalledWith(items[0]);
    buttonLabelled(host, 'Not now')!.click();
    expect(dismissed).toHaveBeenCalledWith(items[1]);
  });

  it('shows the empty title, and its action only when it has one', () => {
    const f = renderList({ items: [], empty: { title: 'No notifications match these filters', action: 'Clear filters' } });
    const emptyAction = vi.fn();
    f.componentInstance.emptyAction.subscribe(emptyAction);
    expect(text(root(f))).toContain('No notifications match these filters');
    buttonLabelled(root(f), 'Clear filters')!.click();
    expect(emptyAction).toHaveBeenCalled();

    const none = root(renderList({ items: [] }));
    expect(text(none)).toContain('No notifications yet');
    expect(none.querySelector('button')).toBeNull();
  });

  it('shows 4 placeholder rows built from the row box while loading, and no real rows', () => {
    const host = root(renderList({ items, state: 'loading' }));
    expect(host.querySelector('[role="status"][aria-busy="true"]')).toBeTruthy();
    const placeholders = host.querySelectorAll('[data-placeholder]');
    expect(placeholders.length).toBe(4);
    for (const p of Array.from(placeholders)) for (const c of ROW_BOX.split(' ')) expect(p.classList, c).toContain(c);
    expect(host.querySelectorAll('[data-row]').length).toBe(0);
  });

  it('reads "Couldn\'t load notifications." with "Try again", which emits retry', () => {
    const f = renderList({ items, state: 'error' });
    const retry = vi.fn();
    f.componentInstance.retry.subscribe(retry);
    expect(text(root(f).querySelector('[role="alert"]')!)).toContain("Couldn't load notifications.");
    buttonLabelled(root(f), 'Try again')!.click();
    expect(retry).toHaveBeenCalled();
  });

  it('never uses --text-muted in any state', () => {
    for (const state of ['loading', 'error', 'ready'] as const) {
      expect(root(renderList({ items: ALL_TYPES, state })).innerHTML, state).not.toContain('--text-muted');
    }
  });
});
