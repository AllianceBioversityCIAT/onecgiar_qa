import { Router, NavigationStart, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { ResultsView } from './results-view';
import { RESULTS, qaStage, type QaStage } from './results.mock';

/** Expected total of a stage on "All timelines", from the mock with the rule "has a QA stage and is in that stage". */
const stageTotal = (stage: QaStage): number => RESULTS.filter((r) => qaStage(r) === stage).length;
const underAssessment = (): number => RESULTS.filter((r) => qaStage(r)).length;

const TWO = '/results?stage=r1-two';
const ASSESSED = '/results?stage=r2-assessed';

/** What the user reads: the "of N" in the paginator under the table. */
function paginatorTotal(harness: RouterTestingHarness): number | null {
  harness.detectChanges();
  const text = harness.routeNativeElement?.querySelector('qa-pagination p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /of ([\d,]+)$/.exec(text);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

describe('ResultsView re-reads its filters on navigation', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  /** Every navigation the router started, in order: the test's own, plus any the view might add. */
  let started: string[];

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'results', component: ResultsView }])] });
    router = TestBed.inject(Router);
    started = [];
    router.events.subscribe((e) => {
      if (e instanceof NavigationStart) started.push(e.url);
    });
    harness = await RouterTestingHarness.create(TWO);
  });

  it('fixture: the two stages have different, non-zero totals', () => {
    expect(stageTotal('r1-two')).toBeGreaterThan(0);
    expect(stageTotal('r2-assessed')).toBeGreaterThan(0);
    expect(stageTotal('r1-two')).not.toBe(stageTotal('r2-assessed'));
    expect(stageTotal('r1-two')).not.toBe(underAssessment());
  });

  // FR-5: a notification opened while Results is already on screen with another ?stage=.
  it('(a) an open view navigated from one ?stage= to another shows the new total, in the same component', async () => {
    const before = harness.routeDebugElement?.componentInstance;
    expect(paginatorTotal(harness)).toBe(stageTotal('r1-two'));

    await router.navigateByUrl(ASSESSED);

    expect(harness.routeDebugElement?.componentInstance).toBe(before); // reused, not re-created
    expect(paginatorTotal(harness)).toBe(stageTotal('r2-assessed'));
  });

  // FR-5: "the same filter and count" after she changed a filter by hand and opens the same URL again.
  it('(b) after a manual filter change, a same-URL reload navigation restores the target count', async () => {
    const before = harness.routeDebugElement?.componentInstance;
    expect(paginatorTotal(harness)).toBe(stageTotal('r1-two'));

    // By hand: remove the QA stage chip, as she would (it only sets a signal).
    const chip = harness.routeNativeElement?.querySelector<HTMLButtonElement>('button[aria-label="Remove QA stage filter"]');
    expect(chip).not.toBeNull();
    chip!.click();
    expect(paginatorTotal(harness)).toBe(underAssessment());

    await router.navigateByUrl(TWO, { onSameUrlNavigation: 'reload' });

    expect(harness.routeDebugElement?.componentInstance).toBe(before);
    expect(paginatorTotal(harness)).toBe(stageTotal('r1-two'));
  });

  // P-24 / P-27: Results never writes its filters to the URL.
  it('(c) the router only ever navigates where the test sent it (no URL writes)', async () => {
    await router.navigateByUrl(ASSESSED);
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('button[aria-label="Remove QA stage filter"]')!.click();
    harness.detectChanges();
    await router.navigateByUrl(TWO, { onSameUrlNavigation: 'reload' });
    harness.detectChanges();
    const search = harness.routeNativeElement!.querySelector<HTMLInputElement>('input[type="text"]')!;
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(started).toEqual([TWO, ASSESSED, TWO]);
    expect(router.url).toBe(TWO);
  });

  // Accepted change (design.md reversion challenge e): a link to bare /results shows the unfiltered list.
  it('(d) navigating from a filtered list to bare /results clears the filters', async () => {
    await router.navigateByUrl('/results');
    expect(paginatorTotal(harness)).toBe(underAssessment());
  });

  it('(e) every filter in the new URL replaces the old ones, and values outside the allowed lists are dropped', async () => {
    await router.navigateByUrl('/results?stage=r2-assessed,not-a-stage&q=zzzz-no-match');
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('No results match your filters.');

    await router.navigateByUrl('/results?stage=not-a-stage&timeline=nope');
    expect(paginatorTotal(harness)).toBe(underAssessment());
  });
});
