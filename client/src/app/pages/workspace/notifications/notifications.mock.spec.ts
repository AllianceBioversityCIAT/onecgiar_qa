import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { STATUS_COUNTS } from '../overview/overview.mock';
import { ResultsView } from '../results/results-view';
import { QA_STAGE_LABELS, RESULTS as RESULTS_IN_QA, TIMELINES, type QaStage } from '../results/results.mock';
import { RESULTS as REVIEW_RESULTS } from '../review/review.mock';
import { NOTIFICATIONS } from './notifications.mock';
import { NOTIFICATION_TYPES, type Notification, type NotificationType } from './notifications.model';

/** A target that opens a Results list with filters (as opposed to one result's review page). */
const isList = (n: Notification): boolean => n.target.path === '/results';
const sentence = (n: Notification): string => `${n.subject} ${n.text}`;
const listEntries = (): Notification[] => NOTIFICATIONS.filter(isList);
const stageOf = (n: Notification): QaStage => (n.type === 'Quality assessed' ? 'quality-assessed' : (n.target.queryParams?.['stage'] as QaStage));

/** Renders `ResultsView` at the notification's target URL, as the router would open it, and reads the paginator total. */
async function renderedTotal(n: Notification): Promise<number | null> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'results', component: ResultsView }])] });
  const router = TestBed.inject(Router);
  const url = router.serializeUrl(router.createUrlTree([n.target.path], { queryParams: n.target.queryParams }));
  const harness = await RouterTestingHarness.create(url);
  harness.detectChanges();
  const text = harness.routeNativeElement?.querySelector('qa-pagination p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /of ([\d,]+)$/.exec(text);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

describe('notifications mock', () => {
  it('has 9 to 12 entries with unique ids, newest first', () => {
    expect(NOTIFICATIONS.length).toBeGreaterThanOrEqual(9);
    expect(NOTIFICATIONS.length).toBeLessThanOrEqual(12);
    expect(new Set(NOTIFICATIONS.map((n) => n.id)).size).toBe(NOTIFICATIONS.length);
    const rank = { today: 0, yesterday: 1, earlier: 2 } as const;
    const ranks = NOTIFICATIONS.map((n) => rank[n.day]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  // (a) NFR-4 / FR-5: the sentence's total is what Results shows on the target, for 100 % of the list targets.
  it('(a) every list target shows, in a rendered ResultsView, a paginator total equal to its total', async () => {
    const list = listEntries();
    expect(list.length).toBeGreaterThan(0);
    // No list entry is skipped: the only entries left out are the ones that open one result.
    expect(NOTIFICATIONS.filter((n) => !isList(n)).every((n) => /^\/results\/QA-2026-\d{4}$/.test(n.target.path) && n.total === null)).toBe(true);
    expect(list.every((n) => n.total !== null)).toBe(true);
    for (const n of list) {
      expect(await renderedTotal(n), `${n.id} (${n.type}) → ${JSON.stringify(n.target)}`).toBe(n.total);
    }
  });

  // (b) The timeline parameter of the target is the notification's timeline; "all" means no parameter.
  it('(b) a list target has a timeline parameter equal to timelineId, absent exactly when timelineId is all', () => {
    const list = listEntries();
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) {
      const timeline = n.target.queryParams?.['timeline'];
      if (n.timelineId === 'all') expect(timeline, n.id).toBeUndefined();
      else {
        expect(
          TIMELINES.some((t) => t.id === n.timelineId),
          `${n.id} timelineId`,
        ).toBe(true);
        expect(timeline, n.id).toBe(n.timelineId);
      }
    }
  });

  // (c) FR-3 / DD-6: the stage words come from the shared stage labels, exactly.
  it('(c) every Stage, Quality assessed and At risk sentence contains the words of its QA_STAGE_LABELS entry', () => {
    const checked = NOTIFICATIONS.filter((n) => ['Stage', 'Quality assessed', 'At risk'].includes(n.type));
    expect(checked.length).toBeGreaterThan(0);
    for (const n of checked) {
      const label = QA_STAGE_LABELS[stageOf(n)];
      expect(label, `${n.id} stage`).toBeDefined();
      // "Round 1 · Assessed by 2 assessors" → both parts; "Quality assessed" → used whole.
      for (const words of label.split(' · ')) expect(sentence(n), n.id).toContain(words);
    }
  });

  // (d) DD-12: a single-result notification opens a result the Review view really has, and that is not Automatic.
  it('(d) single-result codes exist in review.mock.ts and are not Automatic', () => {
    const single = NOTIFICATIONS.filter((n) => !isList(n));
    expect(single.length).toBeGreaterThan(0);
    for (const n of single) {
      const code = n.target.path.split('/').pop()!;
      const result = REVIEW_RESULTS.find((r) => r.code === code);
      expect(result, `${n.id} → ${code}`).toBeDefined();
      expect(result?.status, code).not.toBe('Automatic');
      expect(n.subject, n.id).toBe(code);
      // The result's timeline in the Results mock is the notification's timeline.
      const timeline = TIMELINES.find((t) => t.name === RESULTS_IN_QA.find((r) => r.code === code)?.batch);
      expect(n.timelineId, `${n.id} timeline`).toBe(timeline?.id);
    }
  });

  // (e) A first load: everything loaded today is new.
  it('(e) a Load notification has delta equal to total', () => {
    const loads = NOTIFICATIONS.filter((n) => n.type === 'Load');
    expect(loads.length).toBeGreaterThan(0);
    for (const n of loads) expect(n.delta, n.id).toBe(n.total);
  });

  // (f) NFR-4: the Overview shows the same figure for the same filter.
  it('(f) the Waiting notification states 212, the Overview figure', () => {
    const waiting = NOTIFICATIONS.filter((n) => n.type === 'Waiting');
    expect(waiting.length).toBe(1);
    expect(waiting[0].total).toBe(212);
    expect(waiting[0].total).toBe(STATUS_COUNTS.find(([status]) => status === 'Awaiting response')?.[1]);
  });

  // (g) FR-3: closed set of 9 types, every one present.
  it('(g) uses only the 9 types of FR-3 and every one appears', () => {
    const closed: readonly NotificationType[] = [
      'Stage',
      'Program response',
      'Escalation',
      'Third-party broker',
      'PPU',
      'Quality assessed',
      'Waiting',
      'At risk',
      'Load',
    ];
    expect([...NOTIFICATION_TYPES]).toEqual([...closed]);
    const used = new Set<string>(NOTIFICATIONS.map((n) => n.type));
    expect([...used].every((t) => closed.includes(t as NotificationType))).toBe(true);
    expect(closed.filter((t) => !used.has(t))).toEqual([]);
  });

  // (h) FR-3 / DD-6: no sentence reads "reached Pending".
  it('(h) Stage entries use only r1-one, r1-two and r2-assessed', () => {
    const stages = NOTIFICATIONS.filter((n) => n.type === 'Stage');
    expect(stages.length).toBeGreaterThan(0);
    for (const n of stages) expect(['r1-one', 'r1-two', 'r2-assessed'], n.id).toContain(n.target.queryParams?.['stage']);
  });

  // FR-5: the number in the sentence is the compared total, formatted as Results formats it.
  it('a sentence with a list target states its total', () => {
    const list = listEntries();
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) {
      const shown = (n.total ?? NaN).toLocaleString('en-US').replaceAll(',', '\\,');
      expect(sentence(n), n.id).toMatch(new RegExp(`(?<![\\d,])${shown}(?![\\d,])`));
    }
  });
});
