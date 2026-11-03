import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ResultsView } from '../results/results-view';
import { SINGLE_CHECK_TYPES, TIMELINES } from '../results/results.mock';
import { NOTIFICATIONS, totalInResults } from './notifications.mock';
import { NOTIFICATION_TYPES, sentenceText, type Notification, type NotificationTarget } from './notifications.model';

const strongParts = (n: Notification): string[] => n.sentence.filter((p) => p.strong).map((p) => p.text);

/**
 * The Results list a sentence's total is compared with: its own target, or, for a step that finished (whose button opens
 * Cycle), every result of its timeline.
 */
const comparedList = (n: Notification): NotificationTarget =>
  n.type === 'Step complete' ? { path: '/results', queryParams: { timeline: n.timelineId } } : n.target;

/** Renders `ResultsView` at a target URL, as the router would open it, and reads the paginator total. */
async function renderedTotal(target: NotificationTarget): Promise<number | null> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'results', component: ResultsView }])] });
  const router = TestBed.inject(Router);
  const url = router.serializeUrl(router.createUrlTree([target.path], { queryParams: target.queryParams }));
  const harness = await RouterTestingHarness.create(url);
  harness.detectChanges();
  const text = harness.routeNativeElement?.querySelector('qa-pagination p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /of ([\d,]+)$/.exec(text);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

describe('notifications mock', () => {
  it('has 5 entries with unique ids, newest first, 2 of them unread', () => {
    expect(NOTIFICATIONS.length).toBe(5);
    expect(new Set(NOTIFICATIONS.map((n) => n.id)).size).toBe(NOTIFICATIONS.length);
    const rank = { today: 0, yesterday: 1, earlier: 2 } as const;
    const ranks = NOTIFICATIONS.map((n) => rank[n.day]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const day of ['today', 'yesterday', 'earlier'] as const) expect(NOTIFICATIONS.some((n) => n.day === day), day).toBe(true);
    expect(NOTIFICATIONS.filter((n) => n.unread).length).toBe(2);
  });

  // Only what María Julia asked for (meeting, 2026-10-27): a step finished for a batch, and slow science programs.
  it('uses only the two types she asked for, both of them, and none of the dropped ones', () => {
    expect([...NOTIFICATION_TYPES]).toEqual(['Step complete', 'Slow program']);
    const used = new Set<string>(NOTIFICATIONS.map((n) => n.type));
    expect(NOTIFICATION_TYPES.filter((t) => !used.has(t))).toEqual([]);
    for (const dropped of ['At risk', 'Escalation', 'Program response', 'Load', 'Stage', 'Quality assessed', 'Third-party broker', 'PPU', 'Waiting']) {
      expect(used.has(dropped), dropped).toBe(false);
    }
  });

  it('every notification needs her action, so every one has a button label', () => {
    for (const n of NOTIFICATIONS) expect(n.action, n.id).not.toBeNull();
  });

  // NFR-4 / FR-5: the sentence's total is what Results shows for it, for 100 % of the entries.
  it('every total equals the paginator total of a rendered ResultsView for its list', async () => {
    expect(NOTIFICATIONS.every((n) => n.total !== null)).toBe(true);
    for (const n of NOTIFICATIONS) {
      const list = comparedList(n);
      expect(await renderedTotal(list), `${n.id} (${n.type}) → ${JSON.stringify(list)}`).toBe(n.total);
    }
  });

  it('every sentence states its total in bold, formatted as Results formats it', () => {
    for (const n of NOTIFICATIONS) {
      const shown = (n.total ?? NaN).toLocaleString('en-US');
      expect(strongParts(n).some((p) => p === shown || p === `${shown} results`), `${n.id}: ${sentenceText(n)}`).toBe(true);
    }
  });

  it('every notification is about one real timeline', () => {
    for (const n of NOTIFICATIONS) expect(TIMELINES.some((t) => t.id === n.timelineId), `${n.id} timelineId`).toBe(true);
  });

  it('Step complete: the three hand-offs, each opening Cycle with "Open next step"', () => {
    const steps = NOTIFICATIONS.filter((n) => n.type === 'Step complete');
    expect(steps.map((n) => strongParts(n)[0])).toEqual(expect.arrayContaining(['Assessors', 'Lead assessor', 'Third-party broker']));
    expect(steps.length).toBe(3);
    const next = (who: string) => sentenceText(steps.find((n) => strongParts(n)[0] === who)!);
    expect(next('Assessors')).toContain('They can go to the science programs.');
    expect(next('Lead assessor')).toContain('They can go to the third-party broker.');
    expect(next('Third-party broker')).toContain('They can go to PPU.');
    for (const n of steps) {
      expect(n.target).toEqual({ path: '/cycle' });
      expect(n.action).toBe('Open next step');
      expect(strongParts(n), n.id).toContain(TIMELINES.find((t) => t.id === n.timelineId)!.name);
      expect(n.total, n.id).toBe(totalInResults({ timelineId: n.timelineId }));
    }
    // "Assessed" by the assessors means 2 of them, or 1 for the single-check types.
    const detail = steps.find((n) => strongParts(n)[0] === 'Assessors')!.detail ?? '';
    for (const type of SINGLE_CHECK_TYPES) expect(detail).toContain(type);
  });

  it('Slow program: opens its program\'s results awaiting a response in that timeline, and says "not replied to any" only when none is answered', () => {
    const slow = NOTIFICATIONS.filter((n) => n.type === 'Slow program');
    expect(slow.length).toBe(2);
    for (const n of slow) {
      expect(n.target).toEqual({ path: '/results', queryParams: { timeline: n.timelineId, program: n.program, status: 'Awaiting response' } });
      expect(n.action).toBe('View results');
      expect(strongParts(n)[0]).toBe(n.program);
      const answered = totalInResults({ timelineId: n.timelineId, program: n.program!, status: 'Answered' });
      if (answered === 0) expect(sentenceText(n), n.id).toContain('has not replied to any of its');
      else {
        const returned = answered + n.total!;
        expect(sentenceText(n), n.id).toContain(`has replied to ${answered} of its ${returned} returned results`);
        expect(sentenceText(n), n.id).toContain(`(${Math.round((answered / returned) * 100)}%)`);
      }
    }
    expect(slow.some((n) => sentenceText(n).includes('has not replied to any'))).toBe(true);
    expect(slow.some((n) => sentenceText(n).includes('has replied to'))).toBe(true);
  });

  it('writes relative times: "… ago" today and earlier, "Yesterday" for yesterday', () => {
    for (const n of NOTIFICATIONS) {
      if (n.day === 'yesterday') expect(n.when, n.id).toBe('Yesterday');
      else expect(n.when, n.id).toMatch(/^\d+ (minutes?|hours?|days) ago$/);
    }
  });
});
