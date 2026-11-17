// @akili-spec assessment/step-1-assessment
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import { AssessmentView, WorklistTimelines } from '../../../core/api/assessment.models';
import { ApiError } from '../../../core/http/api-envelope';
import { WorkspaceLayout } from '../../../shell/workspace-layout';
import { viewFixture } from './review.api-fixture';
import { ReviewView } from './review-view';

/** A fake transport: each test says what the view read answers. */
class FakeApi {
  view = vi.fn<(timelineId: number, code: number) => Observable<AssessmentView>>(() => of(viewFixture()));
  timelines = vi.fn<() => Observable<WorklistTimelines>>(() =>
    of({ timelines: [], defaultTimelineId: 31, timeZone: 'Europe/Rome' }),
  );
}

describe('ReviewView on the assessment API', () => {
  let api: FakeApi;
  let harness: RouterTestingHarness;

  const open = async (url = '/results/9890?timeline=29') => {
    harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  };
  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttons = (el: Element) => [...el.querySelectorAll('button')];
  const byName = (el: Element, name: string) => buttons(el).find((b) => (b.getAttribute('aria-label') ?? text(b)) === name);
  const cards = (el: Element) => [...el.querySelectorAll('qa-review-field-card')];
  const card = (el: Element, label: string) => cards(el).find((c) => text(c).startsWith(label))!;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'results', children: [] },
          { path: 'results/:code', component: ReviewView },
        ]),
        { provide: AssessmentApi, useValue: api },
      ],
    });
  });

  describe('states (FR-23)', () => {
    it('loading: a skeleton announced to screen readers, not a "Loading…" line', async () => {
      api.view.mockReturnValue(new Subject<AssessmentView>());
      const el = await open();
      const loading = el.querySelector('qa-loading')!;
      expect(loading.getAttribute('role')).toBe('status');
      expect(text(loading)).toContain('Loading the assessment');
      expect(el.querySelector('qa-review-field-card')).toBeNull();
    });

    it('error: the catalog message and a retry that reads again', async () => {
      api.view.mockReturnValueOnce(
        throwError(() => new ApiError({ status: 409, code: 'ASSESSMENT_NO_FIELD_CONFIG', message: 'No field configuration covers this result type yet.' })),
      );
      const el = await open();
      const alert = el.querySelector('[role="alert"]')!;
      expect(text(alert)).toContain('No field configuration covers this result type yet.');

      byName(el, 'Try again')!.click();
      await harness.fixture.whenStable();
      harness.detectChanges();
      expect(api.view).toHaveBeenCalledTimes(2);
      expect(el.querySelector('h1')?.textContent).toContain('Seed systems for maize');
    });

    it('reads the timeline of the URL; without one it opens the default timeline', async () => {
      await open();
      expect(api.view).toHaveBeenLastCalledWith(29, 9890);
      expect(api.timelines).not.toHaveBeenCalled();

      await harness.navigateByUrl('/results/9890');
      await harness.fixture.whenStable();
      expect(api.timelines).toHaveBeenCalledTimes(1);
      expect(api.view).toHaveBeenLastCalledWith(31, 9890);
    });

    it('a code that is not a positive integer is "not found" without a request', async () => {
      const el = await open('/results/QA-1?timeline=29');
      expect(api.view).not.toHaveBeenCalled();
      expect(text(el.querySelector('[role="alert"]')!)).toContain('does not exist or is not in your scope');
    });

    it('read only: a banner says why, and no field offers Approve or Undo (FR-2)', async () => {
      api.view.mockReturnValue(of(viewFixture({ writable: false, readOnlyReason: 'step_closed' })));
      const el = await open();
      expect(text(el.querySelector('[data-testid="review-read-only"]')!)).toBe('Step 1 · Assessment is closed. The assessment is read only.');
      expect(buttons(el).some((b) => /^(Approve|Undo)/.test(b.getAttribute('aria-label') ?? ''))).toBe(false);
      expect(byName(el, 'Finish assessment')).toBeUndefined();
      // Comments stay readable.
      expect(buttons(card(el, 'Description of Result')).map(text)).toEqual(['View comments1 for Description of Result']);
    });

    it('writable: no banner', async () => {
      const el = await open();
      expect(el.querySelector('[data-testid="review-read-only"]')).toBeNull();
    });

    it('no button that would do nothing: a writable assessment offers no Approve, Undo, Add comment or Finish until the actions are wired', async () => {
      const el = await open();
      const names = buttons(el).map((b) => b.getAttribute('aria-label') ?? text(b));
      expect(names.filter((n) => /^(Approve|Undo|Add comment)/.test(n))).toEqual([]);
      expect(byName(el, 'Finish assessment')).toBeUndefined();
      expect(text(el)).not.toContain('Your comments are not visible to the program yet.');
    });

    it('the guidance link of the mockup (a placeholder address) is gone', async () => {
      const el = await open();
      expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.startsWith('http'))).toEqual([]);
    });
  });

  describe('fields (FR-9, NFR-8)', () => {
    it('the green/grey mark has an icon and the accessible name "Validated" / "Not validated"', async () => {
      const el = await open();
      const title = card(el, 'Title of Result');
      const description = card(el, 'Description of Result');
      expect(text(title.querySelector('qa-review-state-chips')!.parentElement!)).toContain('Validated');
      expect(text(title)).not.toContain('Not validated');
      expect(text(description)).toContain('Not validated');
      // The icon beside the name is decorative: the meaning is in the text, not in color alone.
      for (const c of [title, description]) {
        const mark = [...c.querySelectorAll('qa-review-state-chips > span')][0];
        expect(mark.querySelector('[aria-hidden="true"]')).not.toBeNull();
      }
    });

    it('a View only field shows its value and no mark, no Core tag and no button', async () => {
      const el = await open();
      const view = card(el, 'Result code');
      expect(text(view)).toContain('View only');
      expect(text(view)).toContain('9890');
      expect(text(view)).not.toMatch(/Validated|Not validated|Core/);
      expect(view.querySelectorAll('button')).toHaveLength(0);
    });

    it('the field tooltip is Reporting\'s help text, only on the fields that have one', async () => {
      const view = viewFixture();
      const general = view.sections[0];
      api.view.mockReturnValue(
        of({
          ...view,
          sections: [
            { ...general, fields: general.fields.map((f) => (f.key === 'general.title' ? { ...f, description: 'A short, clear title.' } : f)) },
            ...view.sections.slice(1),
          ],
        }),
      );
      const el = await open();
      expect(card(el, 'Title of Result').querySelector('button[aria-label="Field guidance"]')).not.toBeNull();
      expect(card(el, 'Description of Result').querySelector('button[aria-label="Field guidance"]')).toBeNull();
    });

    it('Core tag on the core Assessed field only', async () => {
      const el = await open();
      expect(text(card(el, 'Title of Result'))).toContain('Core');
      expect(text(card(el, 'Description of Result'))).not.toContain('Core');
    });

    it('no AI: no review-ai-note and no "flagged by AI" count', async () => {
      const el = await open();
      expect(el.querySelector('qa-review-ai-note')).toBeNull();
      expect(text(el)).not.toContain('flagged by AI');
    });

    it('the comment action opens the field thread, by nickname, without withdrawn comments', async () => {
      const el = await open();
      byName(card(el, 'Description of Result'), 'View comments1 for Description of Result')!.click();
      harness.detectChanges();
      await harness.fixture.whenStable();
      const thread = document.querySelector('ol[aria-label="Comments"]')!;
      expect(text(thread)).toContain('mchen · Assessor');
      expect(text(thread)).toContain('Add the evidence link.');
      expect(text(thread)).not.toContain('Old remark');
    });
  });

  describe('navigator and keyboard path (FR-8, NFR-8)', () => {
    it('sections are buttons with their pending count; the current one is marked', async () => {
      const el = await open();
      const nav = el.querySelector('nav[aria-labelledby="review-sections-label"]')!;
      const items = [...nav.querySelectorAll('button')];
      expect(items.map(text)).toEqual(['General information', 'Theory of Change, 1 pending', 'Geographic location, 2 pending', 'Other fields']);
      expect(items[0].getAttribute('aria-current')).toBe('step');
    });

    it('a keyboard path: every field action is a focusable button, in reading order, and Next moves through the sections', async () => {
      const el = await open();
      const section = el.querySelector('section[aria-labelledby="review-section-title"]')!;
      // Reads only until the review actions are wired (REVIEW_WRITES_WIRED): the comments of a field stay reachable.
      expect(buttons(section).map((b) => b.getAttribute('aria-label') ?? text(b))).toEqual(['View comments1 for Description of Result']);
      for (const b of buttons(section)) expect(b.tabIndex).toBeGreaterThanOrEqual(0);

      const next = byName(el, 'Next →')!;
      next.focus();
      next.click();
      harness.detectChanges();
      expect(text(el.querySelector('#review-section-title')!)).toBe('Theory of Change');
      byName(el, 'Next →')!.click();
      harness.detectChanges();
      expect(text(el.querySelector('#review-section-title')!)).toBe('Geographic location');
      expect(buttons(el.querySelector('section')!)).toEqual([]);
    });

    it('the ToC section shows every contribution with the field mark on its first card', async () => {
      const el = await open();
      byName(el, 'Theory of Change, 1 pending')!.click();
      harness.detectChanges();
      const toc = el.querySelector('section')!;
      expect(text(toc)).toContain('3 contributions across 1 science program');
      expect(text(toc)).toContain('Contribution 1');
      expect(text(toc)).toContain('Seed policy adopted');
      expect(text(toc)).toContain('SP06 Climate Action');
      expect(text(toc)).toContain('Required review');
      expect(text(toc)).toContain('0 reviewed');
      expect(text(toc).match(/Not validated/g)).toHaveLength(1);
    });

    it('measures its own width: the element it watches is still on the page after the skeleton leaves (wide layout on a wide screen)', async () => {
      const observed: Element[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe(el: Element): void {
            observed.push(el);
          }
          readonly disconnect = vi.fn();
        },
      );
      try {
        const el = await open();
        expect(el.querySelector('qa-review-skeleton')).toBeNull();
        expect(observed).toContain(el);
        expect(observed.filter((o) => !o.isConnected)).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('a ToC with no Assessed field is context only: no "Required review" tag and no reviewed count', async () => {
      const view = viewFixture();
      api.view.mockReturnValue(
        of({ ...view, sections: view.sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, mode: 'view' as const })) })) }),
      );
      const el = await open();
      byName(el, 'Theory of Change')!.click();
      harness.detectChanges();
      const toc = el.querySelector('section')!;
      expect(text(toc)).toContain('3 contributions across 1 science program');
      expect(text(toc)).not.toContain('Required review');
      expect(text(toc)).not.toContain('reviewed');
    });

    it('a slower answer for a result left behind never replaces the one on screen', async () => {
      const first = new Subject<AssessmentView>();
      api.view.mockReturnValueOnce(first);
      const el = await open('/results/9890?timeline=29');
      const other = viewFixture();
      api.view.mockReturnValueOnce(of({ ...other, header: { ...other.header, resultCode: 8793, title: 'Dairy value chain' } }));
      await harness.navigateByUrl('/results/8793?timeline=29');
      await harness.fixture.whenStable();
      first.next(viewFixture());
      first.complete();
      await harness.fixture.whenStable();
      harness.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('Dairy value chain');
    });

    it('nothing to assess: the navigator says so instead of "0 of 0 fields resolved"', async () => {
      const view = viewFixture();
      api.view.mockReturnValue(
        of({ ...view, sections: view.sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, mode: 'view' as const })) })) }),
      );
      const el = await open();
      const aside = el.querySelector('qa-review-aside')!;
      expect(text(aside)).toContain('No fields to assess in this result');
      expect(text(aside)).not.toContain('0 of 0');
    });

    it('a value keeps its line breaks (one line per entry of a list, the paragraphs of a narrative)', async () => {
      const el = await open();
      const value = [...card(el, 'Description of Result').querySelectorAll('div')].find((d) => text(d) === 'A long description')!;
      expect(value.classList.contains('whitespace-pre-line')).toBe(true);
    });

    it('ToC cards: a yes/no answer carries the help of its field, a contribution the note about contributions', async () => {
      const view = viewFixture();
      api.view.mockReturnValue(
        of({
          ...view,
          sections: view.sections.map((s) => ({
            ...s,
            fields: s.fields.map((f) => (f.key === 'toc.planned_result' ? { ...f, description: 'Say whether the result maps to a KPI.' } : f)),
          })),
        }),
      );
      const el = await open();
      byName(el, 'Theory of Change, 1 pending')!.click();
      harness.detectChanges();
      const toc = el.querySelector('section')!;
      expect(toc.querySelectorAll('button[aria-label="Field guidance"]')).toHaveLength(1);
      // 3 contributions in the fixture (2 of toc.entries, 1 of the contributing program).
      expect(toc.querySelectorAll('button[aria-label="About theory of change contributions"]')).toHaveLength(3);
      expect(text(toc)).not.toContain('2026');
    });

    it('the focus control collapses the main menu and the navigator together (FR-8 AC2)', async () => {
      const el = await open();
      const layout = TestBed.inject(WorkspaceLayout);
      byName(el, 'Focus: collapse the menu and sections')!.click();
      harness.detectChanges();
      expect(layout.menuCollapsed()).toBe(true);
      expect(layout.navigatorCollapsed()).toBe(true);
      byName(el, 'Exit focus: show the menu and sections')!.click();
      harness.detectChanges();
      expect(layout.menuCollapsed()).toBe(false);
      expect(layout.navigatorCollapsed()).toBe(false);
    });
  });
});
