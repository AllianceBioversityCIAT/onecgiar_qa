import { TestBed } from '@angular/core/testing';
import { TIMELINES } from '../results/results.mock';
import { NotificationList } from './notification-list';
import { NotificationRow } from './notification-row';
import { NOTIFICATION_TYPES, type Notification } from './notifications.model';

/** A notification built for these tests only (the list never reads the mock). */
function make(overrides: Partial<Notification> & Pick<Notification, 'id'>): Notification {
  return {
    type: 'Stage',
    subject: '146 results',
    text: 'reached Assessed by 2 assessors in Round 1. 18 since yesterday.',
    timelineId: 'annual',
    day: 'today',
    time: '10:42',
    unread: false,
    target: { path: '/results' },
    total: 146,
    delta: 18,
    action: 'View results',
    ...overrides,
  };
}

/** One notification of every type, so a rule about "every type" cannot pass by covering only one. */
const ALL_TYPES: readonly Notification[] = NOTIFICATION_TYPES.map((type, i) =>
  make({ id: `t-${i}`, type, subject: `Subject ${i}`, text: `text of ${type}.` }),
);

const VARIANTS = ['panel', 'page'] as const;

function renderRow(n: Notification, variant: 'panel' | 'page', timelineName = '') {
  const fixture = TestBed.createComponent(NotificationRow);
  fixture.componentRef.setInput('notification', n);
  fixture.componentRef.setInput('variant', variant);
  fixture.componentRef.setInput('timelineName', timelineName);
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
const buttonLabelled = (host: HTMLElement, label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((b) => text(b) === label);

describe('NotificationRow', () => {
  // (a) FR-3: the subject is bold, the rest of the sentence is regular.
  it('(a) puts the subject in a bold element and leaves the rest of the sentence regular', () => {
    const n = make({ id: 'a', subject: 'QA-2026-0841', text: 'was escalated to the third-party broker.', type: 'Escalation' });
    for (const variant of VARIANTS) {
      const sentence = root(renderRow(n, variant)).querySelector('[data-sentence]');
      expect(sentence, `${variant}: sentence element`).toBeTruthy();
      const bold = sentence!.querySelectorAll('strong, b');
      expect(bold.length, `${variant}: bold elements`).toBe(1);
      expect(text(bold[0])).toBe('QA-2026-0841');
      expect(text(sentence!)).toBe(`${n.subject} ${n.text}`);
      expect(text(sentence!).replace(n.subject, '').trim()).toBe('was escalated to the third-party broker.');
    }
  });

  // (b) FR-3: meta is "type · timeline · time" on the page, "type · time" in the panel.
  it('(b) shows the type label, and the timeline only in the page variant', () => {
    const n = make({ id: 'b', type: 'Escalation', timelineId: 'annual', time: '10:42' });
    const annual = TIMELINES.find((t) => t.id === 'annual')!.name;

    // The row reads no mock: the parent hands it the name (here, as the page does from its map).
    const page = root(renderRow(n, 'page', annual)).querySelector('[data-meta]')!;
    expect(page, 'page: meta line').toBeTruthy();
    expect(text(page)).toBe(`Escalation · ${annual} · 10:42`);

    // The panel never shows the timeline, even if a name is given.
    const panel = root(renderRow(n, 'panel', annual)).querySelector('[data-meta]')!;
    expect(text(panel)).toBe('Escalation · 10:42');
    expect(text(panel)).not.toContain(annual);

    // No name given: no empty "·" segment.
    const none = root(renderRow(n, 'page')).querySelector('[data-meta]')!;
    expect(text(none)).toBe('Escalation · 10:42');
  });

  it('(b) the list passes each row its timeline name from timelineNames, and reads "All timelines" for all', () => {
    const names = { annual: 'Annual report 2026', all: 'All timelines' };
    const items = [make({ id: 'b3', timelineId: 'annual' }), make({ id: 'b4', timelineId: 'all' })];
    const page = root(renderList({ items, variant: 'page', timelineNames: names }));
    const metas = Array.from(page.querySelectorAll('[data-meta]')).map((m) => text(m));
    expect(metas[0]).toContain('Annual report 2026');
    expect(metas[1]).toContain('All timelines');

    // `all` still reads "All timelines" when the map omits it; an unknown id shows no name.
    const bare = root(renderList({ items: [items[1], make({ id: 'b5', timelineId: 'ghost' })], variant: 'page' }));
    const bareMetas = Array.from(bare.querySelectorAll('[data-meta]')).map((m) => text(m));
    expect(bareMetas[0]).toContain('All timelines');
    expect(bareMetas[1]).toBe('Stage · 10:42');

    const panel = root(renderList({ items, variant: 'panel', timelineNames: names }));
    expect(text(panel)).not.toContain('Annual report 2026');
    expect(text(panel)).not.toContain('All timelines');
  });

  // (c) FR-3: only the At risk type label is red; no other type, sentence or count.
  it('(c) carries the --danger class on the At risk type label and on nothing else, for every type', () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const variant of VARIANTS) {
        const host = root(renderRow(make({ id: 'c', type, unread: true }), variant));
        const red = Array.from(host.querySelectorAll('[class*="--danger"]'));
        const label = host.querySelector('[data-type]')!;
        expect(label, `${type}/${variant}: label`).toBeTruthy();
        expect(text(label), `${type}/${variant}: label text`).toBe(type);
        if (type === 'At risk') {
          expect(red, `${type}/${variant}: red elements`).toEqual([label]);
          expect(label.className).toContain('font-semibold');
        } else {
          expect(red.length, `${type}/${variant}: red elements`).toBe(0);
        }
      }
    }
  });

  // (d) FR-3: no icon before the type or the sentence.
  it('(d) has no svg or icon element in a row, for every type', () => {
    for (const variant of VARIANTS) {
      for (const n of ALL_TYPES) {
        const host = root(renderRow({ ...n, unread: true }, variant));
        expect(host.querySelector('[data-row]'), `${n.type}/${variant}: row`).toBeTruthy();
        expect(host.querySelectorAll('svg, img, i, ng-icon, [data-icon]').length, `${n.type}/${variant}`).toBe(0);
      }
    }
  });

  // (g) FR-9: the unread dot has a text equivalent.
  it('(g) holds the hidden "Unread" text only when the notification is unread', () => {
    for (const variant of VARIANTS) {
      const unread = root(renderRow(make({ id: 'g1', unread: true }), variant));
      const hidden = Array.from(unread.querySelectorAll('.sr-only')).filter((e) => text(e) === 'Unread');
      expect(hidden.length, `${variant}: unread`).toBe(1);
      const read = root(renderRow(make({ id: 'g2', unread: false }), variant));
      expect(text(read), `${variant}: read`).not.toContain('Unread');
    }
  });

  // (h) S-4: --text-muted is under 4.5:1 on --surface, so no text in the feature uses it.
  it('(h) never uses the --text-muted class', () => {
    for (const variant of VARIANTS) {
      for (const n of ALL_TYPES) {
        const host = root(renderRow({ ...n, unread: true }, variant));
        expect(host.querySelector('[data-row]'), `${n.type}/${variant}: row`).toBeTruthy();
        expect(host.querySelectorAll('[class*="--text-muted"]').length, `${n.type}/${variant}`).toBe(0);
      }
    }
  });

  it('emits opened from the whole panel row, and from the sentence and the action on the page', () => {
    const n = make({ id: 'open' });

    const panel = renderRow(n, 'panel');
    const panelOpened: Notification[] = [];
    panel.componentInstance.opened.subscribe((v) => panelOpened.push(v));
    root(panel).querySelector<HTMLButtonElement>('button')!.click();
    expect(panelOpened).toEqual([n]);

    const page = renderRow(n, 'page');
    const pageOpened: Notification[] = [];
    page.componentInstance.opened.subscribe((v) => pageOpened.push(v));
    const buttons = root(page).querySelectorAll<HTMLButtonElement>('button');
    expect(buttons.length).toBe(2);
    expect(text(buttons[1])).toBe('View results');
    buttons[0].click();
    buttons[1].click();
    expect(pageOpened).toEqual([n, n]);
  });
});

describe('NotificationList', () => {
  // (e) FR-2: Today, Yesterday, Earlier, newest first.
  it('(e) splits the items into Today, Yesterday and Earlier in that order, keeping newest first', () => {
    const items = [
      make({ id: 'e1', day: 'today', time: '10:42' }),
      make({ id: 'e2', day: 'today', time: '09:15' }),
      make({ id: 'e3', day: 'yesterday', time: '16:20' }),
      make({ id: 'e4', day: 'earlier', time: '15 Jul' }),
      make({ id: 'e5', day: 'earlier', time: '14 Jul' }),
    ];
    const host = root(renderList({ items, variant: 'page' }));
    const headings = Array.from(host.querySelectorAll('h3'));
    expect(headings.map((h) => text(h))).toEqual(['Today', 'Yesterday', 'Earlier']);
    const timesOf = (label: string) => {
      const group = headings.find((h) => text(h) === label)!.parentElement!;
      return Array.from(group.querySelectorAll('[data-meta]')).map((m) => text(m).split(' · ').pop());
    };
    expect(timesOf('Today')).toEqual(['10:42', '09:15']);
    expect(timesOf('Yesterday')).toEqual(['16:20']);
    expect(timesOf('Earlier')).toEqual(['15 Jul', '14 Jul']);
  });

  it('(e) omits a day without items, and its eyebrow is --text-4 with no line between it and the first row', () => {
    const host = root(renderList({ items: [make({ id: 'e6', day: 'yesterday' }), make({ id: 'e7', day: 'yesterday' })] }));
    const headings = Array.from(host.querySelectorAll('h3'));
    expect(headings.map((h) => text(h))).toEqual(['Yesterday']);
    expect(headings[0].className).toContain('--text-4');
    expect(headings[0].className).not.toContain('border');
    const rows = Array.from(host.querySelectorAll('li'));
    expect(rows.length).toBe(2);
    expect(rows[0].className).not.toContain('border-t');
    expect(rows[0].className).toContain('border-b');
    expect(rows[1].className).not.toContain('border-b');
  });

  // (f) FR-8: each state renders its copy.
  it('(f) reads "No unread notifications" with "Show all" when the Unread view is empty', () => {
    const fixture = renderList({ items: [], emptyKind: 'unread' });
    expect(text(root(fixture))).toContain('No unread notifications');
    const button = buttonLabelled(root(fixture), 'Show all');
    expect(button).toBeTruthy();
    let fired = 0;
    fixture.componentInstance.emptyAction.subscribe(() => fired++);
    button!.click();
    expect(fired).toBe(1);
  });

  it('(f) reads "No notifications match these filters" with "Clear filters" when filters match nothing', () => {
    const fixture = renderList({ items: [], emptyKind: 'no-match' });
    expect(text(root(fixture))).toContain('No notifications match these filters');
    expect(buttonLabelled(root(fixture), 'Clear filters')).toBeTruthy();
    expect(text(root(fixture))).not.toContain('No unread notifications');
  });

  it('(f) reads "No notifications yet" with no action when there are no notifications at all', () => {
    const fixture = renderList({ items: [], emptyKind: 'all' });
    expect(text(root(fixture))).toContain('No notifications yet');
    expect(root(fixture).querySelectorAll('button').length).toBe(0);
    // The default kind is this one: it must not loop back to the same view with "Show all".
    expect(text(root(renderList({ items: [] })))).toContain('No notifications yet');
  });

  it('(f) shows 4 placeholder rows while loading, and no real rows', () => {
    for (const variant of VARIANTS) {
      const host = root(renderList({ items: [make({ id: 'l1' })], state: 'loading', variant }));
      expect(host.querySelectorAll('[data-placeholder]').length, variant).toBe(4);
      expect(host.querySelectorAll('[data-sentence]').length, variant).toBe(0);
      expect(host.querySelector('[role="status"]'), variant).toBeTruthy();
    }
  });

  // (f) FR-8, "placeholder rows of the same height as real rows". STRUCTURAL, NOT A MEASUREMENT: jsdom lays nothing out, so
  // this pins that a placeholder is built from the row's own box (same padding, grid, font size and line boxes). That the
  // heights really come out equal at 390 and 1440 px is measured in the browser (T-7).
  it('(f) builds each placeholder from the row box of its variant: same padding, grid, font size and line boxes', () => {
    const geometry = (e: Element, re: RegExp): string[] => e.className.split(/\s+/).filter((t) => re.test(t)).sort();
    const BOX = /^(?:sm:)?(?:grid|grid-cols-|items-|gap-x-|gap-y-|px-|py-|text-\(length|leading-)/;
    const META = /^(?:mt-|text-\(length|leading-)/;
    const leading = (e: Element): string => /leading-\[([\d.]+)\]/.exec(e.className)![1];

    for (const variant of VARIANTS) {
      const label = `${variant}`;
      const row = root(renderRow(make({ id: 'l2' }), variant)).querySelector('[data-row]')!;
      const list = root(renderList({ items: [], state: 'loading', variant }));
      const placeholder = list.querySelector('[data-placeholder]')!;

      // The padding and the font size and line height are part of the shared set, and equal.
      const rowBox = geometry(row, BOX);
      for (const part of [/^py-/, /^px-/, /^text-\(length/, /^leading-/]) {
        expect(rowBox.some((t) => part.test(t)), `${label}: row has ${part}`).toBe(true);
      }
      expect(geometry(placeholder, BOX), `${label}: box classes`).toEqual(rowBox);
      expect(row.className, `${label}: no min-height standing in for the content`).not.toContain('min-h-');
      expect(placeholder.className, `${label}: no min-height standing in for the content`).not.toContain('min-h-');

      // Two sentence line boxes at the row's line height (em of the shared font size), then the meta line.
      const lines = Array.from(placeholder.querySelectorAll('[data-placeholder-line]'));
      expect(lines.length, `${label}: sentence line boxes`).toBe(2);
      for (const line of lines) expect(line.className, `${label}: sentence line height`).toContain(`h-[${leading(row)}em]`);
      // From 640 px a page sentence fits on one line (measured in T-7), so the page hides the second line box there.
      expect(lines.map((l) => l.classList.contains('sm:hidden')), `${label}: one line box from 640 px`).toEqual(
        variant === 'page' ? [false, true] : [false, false],
      );

      const rowMeta = row.querySelector('[data-meta]')!;
      const meta = placeholder.querySelector('[data-placeholder-meta]')!;
      expect(geometry(meta, META), `${label}: meta classes`).toEqual(geometry(rowMeta, META));
      expect(meta.className, `${label}: meta line height`).toContain(`h-[${leading(rowMeta)}em]`);

      // Same border between rows as the real list: a line under all but the last.
      const wrappers = Array.from(list.querySelectorAll('[data-placeholder]')).map((p) => p.parentElement!);
      expect(wrappers.map((w) => w.classList.contains('border-b'))).toEqual([true, true, true, false]);

      // The page row's action: its slot sits where the real action sits (below the text under 640 px, beside it above).
      const slot = placeholder.querySelector('[data-placeholder-action]');
      if (variant === 'page') {
        const action = Array.from(row.querySelectorAll('button')).find((b) => text(b) === 'View results')!;
        expect(slot, 'page: action slot').toBeTruthy();
        const place = /^(?:sm:)?(?:col-start-|row-start-|self-|justify-self-)/;
        expect(geometry(slot!, place), 'page: action placement').toEqual(geometry(action, place));
        expect(geometry(slot!, place).length).toBeGreaterThan(0);
      } else {
        expect(slot, 'panel: no action slot').toBeNull();
      }
    }
  });

  it('(f) reads "Couldn\'t load notifications." with "Try again", which emits retry', () => {
    const fixture = renderList({ items: [], state: 'error' });
    expect(text(root(fixture))).toContain("Couldn't load notifications.");
    const button = buttonLabelled(root(fixture), 'Try again');
    expect(button).toBeTruthy();
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);
    button!.click();
    expect(retries).toBe(1);
  });

  it('forwards a row opening as opened with the notification', () => {
    const n = make({ id: 'fw', day: 'today' });
    const fixture = renderList({ items: [n], variant: 'panel' });
    const opened: Notification[] = [];
    fixture.componentInstance.opened.subscribe((v) => opened.push(v));
    root(fixture).querySelector<HTMLButtonElement>('li button')!.click();
    expect(opened).toEqual([n]);
  });

  // (h) across every list state.
  it('(h) never uses the --text-muted class in any state', () => {
    const states: { name: string; inputs: Record<string, unknown> }[] = [
      { name: 'page rows', inputs: { items: ALL_TYPES, variant: 'page' } },
      { name: 'panel rows', inputs: { items: ALL_TYPES, variant: 'panel' } },
      { name: 'unread empty', inputs: { items: [], emptyKind: 'unread' } },
      { name: 'no match', inputs: { items: [], emptyKind: 'no-match' } },
      { name: 'loading', inputs: { items: [], state: 'loading' } },
      { name: 'error', inputs: { items: [], state: 'error' } },
    ];
    for (const { name, inputs } of states) {
      const host = root(renderList(inputs));
      expect(text(host).length, `${name}: renders something`).toBeGreaterThan(0);
      expect(host.querySelectorAll('[class*="--text-muted"]').length, name).toBe(0);
    }
  });
});
