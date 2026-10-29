import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ResultsView } from '../results/results-view';
import { QA_STAGE_LABELS, RESULTS as RESULTS_IN_QA, SINGLE_CHECK_TYPES, TIMELINES, type QaStage } from '../results/results.mock';
import { RESULTS as REVIEW_RESULTS } from '../review/review.mock';
import { NOTIFICATIONS, totalInResults } from './notifications.mock';
import { NOTIFICATION_CATEGORY, NOTIFICATION_TYPES, sentenceText, type Notification, type NotificationTarget } from './notifications.model';

/** A target that opens a Results list with filters (as opposed to one result's review page or Cycle). */
const isList = (n: Notification): boolean => n.target.path === '/results';
const isSingle = (n: Notification): boolean => n.target.path.startsWith('/results/');
const stageOf = (n: Notification): QaStage => (n.type === 'Quality assessed' ? 'quality-assessed' : (n.target.queryParams?.['stage'] as QaStage));
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
  it('has 14 entries with unique ids, newest first, 4 of them unread', () => {
    expect(NOTIFICATIONS.length).toBe(14);
    expect(new Set(NOTIFICATIONS.map((n) => n.id)).size).toBe(NOTIFICATIONS.length);
    const rank = { today: 0, yesterday: 1, earlier: 2 } as const;
    const ranks = NOTIFICATIONS.map((n) => rank[n.day]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const day of ['today', 'yesterday', 'earlier'] as const) expect(NOTIFICATIONS.some((n) => n.day === day), day).toBe(true);
    expect(NOTIFICATIONS.filter((n) => n.unread).length).toBe(4);
  });

  it('splits into 6 that need the Admin\'s action (each with a button label) and 8 updates (none)', () => {
    const action = NOTIFICATIONS.filter((n) => NOTIFICATION_CATEGORY[n.type] === 'action');
    const info = NOTIFICATIONS.filter((n) => NOTIFICATION_CATEGORY[n.type] === 'info');
    expect(action.length).toBe(6);
    expect(info.length).toBe(8);
    for (const n of action) expect(n.action, n.id).not.toBeNull();
    for (const n of info) expect(n.action, n.id).toBeNull();
  });

  it('uses only the 8 types, every one of them, and none of the dropped ones', () => {
    expect([...NOTIFICATION_TYPES]).toEqual(['Step complete', 'Slow program', 'At risk', 'Stage', 'Program response', 'Escalation', 'Quality assessed', 'Load']);
    const used = new Set<string>(NOTIFICATIONS.map((n) => n.type));
    expect(NOTIFICATION_TYPES.filter((t) => !used.has(t))).toEqual([]);
    for (const dropped of ['Third-party broker', 'PPU', 'Waiting']) expect(used.has(dropped), dropped).toBe(false);
  });

  // NFR-4 / FR-5: the sentence's total is what Results shows for it, for 100 % of the entries that lead to a list.
  it('every total equals the paginator total of a rendered ResultsView for its list', async () => {
    const counted = NOTIFICATIONS.filter((n) => !isSingle(n));
    // No entry is skipped: the only ones left out open one result and have no total.
    expect(NOTIFICATIONS.filter(isSingle).every((n) => /^\/results\/QA-2026-\d{4}$/.test(n.target.path) && n.total === null)).toBe(true);
    expect(counted.every((n) => n.total !== null)).toBe(true);
    for (const n of counted) {
      const list = comparedList(n);
      expect(await renderedTotal(list), `${n.id} (${n.type}) → ${JSON.stringify(list)}`).toBe(n.total);
    }
  });

  it('every sentence that leads to a list states its total in bold, formatted as Results formats it', () => {
    for (const n of NOTIFICATIONS.filter((x) => !isSingle(x))) {
      const shown = (n.total ?? NaN).toLocaleString('en-US');
      expect(strongParts(n).some((p) => p === shown || p === `${shown} results`), `${n.id}: ${sentenceText(n)}`).toBe(true);
    }
  });

  it('a list target has a timeline parameter equal to timelineId, absent exactly when timelineId is all', () => {
    for (const n of NOTIFICATIONS.filter(isList)) {
      const timeline = n.target.queryParams?.['timeline'];
      if (n.timelineId === 'all') expect(timeline, n.id).toBeUndefined();
      else {
        expect(TIMELINES.some((t) => t.id === n.timelineId), `${n.id} timelineId`).toBe(true);
        expect(timeline, n.id).toBe(n.timelineId);
      }
    }
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

  it('At risk: the third-party broker step closes with results still pending', () => {
    const risk = NOTIFICATIONS.filter((n) => n.type === 'At risk');
    expect(risk.length).toBe(1);
    expect(sentenceText(risk[0])).toMatch(/^Third-party broker of Annual report 2026 closes in \d+ days with [\d,]+ results still Pending in Round 2\.$/);
    expect(risk[0].action).toBe('View results');
  });

  // FR-3 / DD-6: the stage words come from the shared stage labels, exactly.
  it('every Stage, Quality assessed and At risk sentence contains the words of its QA_STAGE_LABELS entry', () => {
    const checked = NOTIFICATIONS.filter((n) => ['Stage', 'Quality assessed', 'At risk'].includes(n.type));
    expect(checked.length).toBeGreaterThan(0);
    for (const n of checked) {
      const label = QA_STAGE_LABELS[stageOf(n)];
      expect(label, `${n.id} stage`).toBeDefined();
      for (const words of label.split(' · ')) expect(sentenceText(n), n.id).toContain(words);
    }
  });

  // No sentence reads "reached Pending".
  it('Stage entries use only r1-one, r1-two and r2-assessed', () => {
    const stages = NOTIFICATIONS.filter((n) => n.type === 'Stage');
    expect(stages.length).toBeGreaterThan(0);
    for (const n of stages) expect(['r1-one', 'r1-two', 'r2-assessed'], n.id).toContain(n.target.queryParams?.['stage']);
  });

  // DD-12: a single-result notification opens a result the Review view really has, and that is not Automatic.
  it('single-result codes exist in review.mock.ts, are not Automatic, and carry their result\'s timeline and program', () => {
    const single = NOTIFICATIONS.filter(isSingle);
    expect(single.length).toBeGreaterThan(0);
    for (const n of single) {
      const code = n.target.path.split('/').pop()!;
      const review = REVIEW_RESULTS.find((r) => r.code === code);
      expect(review, `${n.id} → ${code}`).toBeDefined();
      expect(review?.status, code).not.toBe('Automatic');
      expect(strongParts(n)[0], n.id).toBe(code);
      const result = RESULTS_IN_QA.find((r) => r.code === code)!;
      expect(n.timelineId, `${n.id} timeline`).toBe(TIMELINES.find((t) => t.name === result.batch)?.id);
      expect(n.program, `${n.id} program`).toBe(result.program);
    }
  });

  it('a Load notification has delta equal to total', () => {
    const loads = NOTIFICATIONS.filter((n) => n.type === 'Load');
    expect(loads.length).toBeGreaterThan(0);
    for (const n of loads) expect(n.delta, n.id).toBe(n.total);
  });

  it('writes relative times: "… ago" today and earlier, "Yesterday" for yesterday', () => {
    for (const n of NOTIFICATIONS) {
      if (n.day === 'yesterday') expect(n.when, n.id).toBe('Yesterday');
      else expect(n.when, n.id).toMatch(/^\d+ (minutes?|hours?|days) ago$/);
    }
  });
});
