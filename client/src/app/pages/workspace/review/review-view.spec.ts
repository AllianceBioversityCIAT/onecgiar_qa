// @akili-spec assessment/step-1-assessment
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AiSuggestionsApi } from '../../../core/api/ai-suggestions-api';
import { AiSuggestionEvent, AiSuggestionView } from '../../../core/api/ai-suggestions.models';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  AssessmentComment,
  AssessmentView,
  CommentThread,
  QuickComment,
  ValidationSummary,
  ValidationsBody,
  WorklistTimelines,
} from '../../../core/api/assessment.models';
import { AuthSession } from '../../../core/auth/auth-session';
import { ApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { WorkspaceLayout } from '../../../shell/workspace-layout';
import { clarificationThread, comment, field, viewFixture } from './review.api-fixture';
import { ReviewView } from './review-view';

/** The signed-in assessor: the author of the fixture's comments. */
const ME = 1053;

const summary = (over: Partial<ValidationSummary> = {}): ValidationSummary => ({ status: 'pending', assessedBy: null, finishedAt: null, validations: [], ...over });
const refusal = (status: number, code: string, message: string, fields?: readonly string[]) =>
  throwError(() => new ApiError({ status, code, message, ...(fields ? { fields } : {}) }));
/** What a read answers once the assessment ended. */
const finishedView = (): AssessmentView =>
  viewFixture({
    writable: false,
    readOnlyReason: 'finished',
    assessment: { status: 'returned', assessedBy: { id: 77, nickname: 'jdoe' }, finishedAt: '2026-11-17T10:00:00.000Z' },
  });

/** A fake transport: each test says what a call answers (the writes too, refusals included). */
class FakeApi {
  view = vi.fn<(timelineId: number, code: number) => Observable<AssessmentView>>(() => of(viewFixture()));
  timelines = vi.fn<() => Observable<WorklistTimelines>>(() =>
    of({ timelines: [], defaultTimelineId: 31, timeZone: 'Europe/Rome' }),
  );
  setValidations = vi.fn<(timelineId: number, code: number, body: ValidationsBody) => Observable<ValidationSummary>>(() => of(summary()));
  addComment = vi.fn<(timelineId: number, code: number, fieldKey: string, body: string) => Observable<AssessmentComment>>(
    (_t, _c, fieldKey, body) => of(comment({ id: 50, fieldKey, body, author: { id: ME, nickname: 'mchen' } })),
  );
  withdrawComment = vi.fn<(id: number) => Observable<AssessmentComment>>((id) =>
    of(comment({ id, state: 'withdrawn', withdrawnAt: '2026-11-17T10:00:00.000Z' })),
  );
  finish = vi.fn<(timelineId: number, code: number) => Observable<ValidationSummary>>(() => of(summary({ status: 'returned' })));
  quickComments = vi.fn<(role: string) => Observable<readonly QuickComment[]>>(() =>
    of([{ id: 3, body: 'Please add the evidence link.', createdAt: '2026-11-10T10:00:00.000Z' }]),
  );
  saveQuickComment = vi.fn<(role: string, body: string) => Observable<QuickComment>>((_role, body) =>
    of({ id: 9, body, createdAt: '2026-11-17T10:00:00.000Z' }),
  );
  programResponses = vi.fn<(timelineId: number, code: number) => Observable<readonly CommentThread[]>>(() => of([]));
  answerClarification = vi.fn<(commentId: number, body: string) => Observable<CommentThread>>((commentId) =>
    of(clarificationThread({ commentId, state: 'open' })),
  );
}

/** The AI side of the page (P2-3918): no suggestion unless a test gives one, and its events never reach the network. */
class FakeAiApi {
  list = vi.fn<(timelineId: number, code: number) => Observable<readonly AiSuggestionView[]>>(() => of([]));
  sendEvent = vi.fn<(timelineId: number, code: number, suggestionId: string, event: AiSuggestionEvent) => Observable<void>>(() => of(undefined));
}

/** The fixture with no comment: in step 1 only an uncommented result can end by itself (OQ-2, 2026-11-18). */
const uncommented = (v: AssessmentView): AssessmentView => ({
  ...v,
  sections: v.sections.map((sec) => ({ ...sec, fields: sec.fields.map((f) => ({ ...f, comments: [] })) })),
});

describe('ReviewView on the assessment API', () => {
  let api: FakeApi;
  let ai: FakeAiApi;
  let harness: RouterTestingHarness;
  let toasts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; bottomOffset: ReturnType<typeof signal<{ readonly desktop: string; readonly phone: string } | null>> };

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
    ai = new FakeAiApi();
    toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), bottomOffset: signal<{ readonly desktop: string; readonly phone: string } | null>(null) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'results', children: [] },
          { path: 'results/:code', component: ReviewView },
        ]),
        { provide: AssessmentApi, useValue: api },
        { provide: AiSuggestionsApi, useValue: ai },
        { provide: AuthSession, useValue: { user: signal({ id: ME }) } },
        { provide: Toasts, useValue: toasts },
      ],
    });
  });

  /** Lets a write settle and repaints. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      harness.detectChanges();
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  /** A button anywhere on the page (the drawer and the dialog render outside the route element). */
  const anywhere = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') ?? text(b)) === name);
  const draftBox = () => document.querySelector<HTMLTextAreaElement>('#review-comment-draft')!;
  const type = (value: string) => {
    const box = draftBox();
    box.value = value;
    box.dispatchEvent(new Event('input'));
    harness.detectChanges();
  };

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

  describe('actions (T-20)', () => {
    describe('green / grey (FR-10, FR-14)', () => {
      it('Approve sets the field green with one request, and the card shows what the server holds', async () => {
        api.setValidations.mockReturnValueOnce(
          of(summary({ validations: [{ fieldKey: 'general.title', validated: true }, { fieldKey: 'general.description', validated: true }] })),
        );
        const el = await open();
        byName(el, 'Approve Description of Result')!.click();
        await settle();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: ['general.description'] });
        expect(byName(el, 'Undo approval of Description of Result')).toBeDefined();
        expect(byName(el, 'Approve Description of Result')).toBeUndefined();
      });

      it('Undo sets it back to grey', async () => {
        const el = await open();
        byName(el, 'Undo approval of Title of Result')!.click();
        await settle();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: false, fieldKeys: ['general.title'] });
        expect(byName(el, 'Approve Title of Result')).toBeDefined();
      });

      it('while the write is on its way the button is busy, and a second tap sends nothing', async () => {
        const slow = new Subject<ValidationSummary>();
        api.setValidations.mockReturnValueOnce(slow);
        const el = await open();
        const approve = byName(el, 'Approve Description of Result')!;
        approve.click();
        harness.detectChanges();
        expect(approve.getAttribute('aria-busy')).toBe('true');
        approve.click();
        slow.next(summary({ validations: [{ fieldKey: 'general.description', validated: true }] }));
        slow.complete();
        await settle();
        expect(api.setValidations).toHaveBeenCalledTimes(1);
      });

      it('the write that would leave every core field green asks first: it finishes the assessment and cannot be undone', async () => {
        api.view.mockImplementation(() => of(uncommented(viewFixture())));
        const el = await open();
        byName(el, 'Theory of Change, 1 pending')!.click();
        harness.detectChanges();
        // The only grey core field of the fixture is the ToC contributions.
        byName(el, 'Approve Contribution 1')!.click();
        await settle();
        expect(api.setValidations).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Finish as Quality Assessed?');

        anywhere('Cancel')!.click();
        await settle();
        expect(api.setValidations).not.toHaveBeenCalled();

        byName(el, 'Approve Contribution 1')!.click();
        await settle();
        anywhere('Validate and finish')!.click();
        await settle();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: ['toc.entries'] });
      });

      it('in step 1 a commented result does not ask: the last core going green does not end it (Finish returns it)', async () => {
        const el = await open();
        byName(el, 'Theory of Change, 1 pending')!.click();
        harness.detectChanges();
        byName(el, 'Approve Contribution 1')!.click();
        await settle();
        expect(document.body.textContent).not.toContain('Finish as Quality Assessed?');
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: ['toc.entries'] });
      });

      it('Check all is one request for every Assessed field (asked first, since it ends the assessment)', async () => {
        api.view.mockImplementation(() => of(uncommented(viewFixture())));
        const el = await open();
        byName(el, 'Check all')!.click();
        await settle();
        anywhere('Validate and finish')!.click();
        await settle();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, all: true });
      });

      it('409 ASSESSMENT_FINISHED: someone ended it first, so the page shows the end and who did it (FR-16, FR-17)', async () => {
        const el = await open();
        api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'This assessment is already finished.'));
        api.view.mockReturnValueOnce(of(finishedView()));
        byName(el, 'Approve Description of Result')!.click();
        await settle();
        expect(text(el.querySelector('[data-testid="review-read-only"]')!)).toContain('Finished by jdoe');
        expect(buttons(el).some((b) => /^(Approve|Undo)/.test(b.getAttribute('aria-label') ?? ''))).toBe(false);
        expect(byName(el, 'Finish assessment')).toBeUndefined();
        expect(toasts.error).toHaveBeenCalledWith('This assessment is already finished.');
      });

      it('409 ASSESSMENT_STEP_CLOSED: the page turns read only with the reason', async () => {
        const el = await open();
        api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'The step is closed.'));
        api.view.mockReturnValueOnce(of(viewFixture({ writable: false, readOnlyReason: 'step_closed' })));
        byName(el, 'Approve Description of Result')!.click();
        await settle();
        expect(text(el.querySelector('[data-testid="review-read-only"]')!)).toContain('is closed');
        expect(byName(el, 'Approve Description of Result')).toBeUndefined();
      });
    });

    it('lifts the toasts above its footer while it is open (they land on "Finish assessment" otherwise), and puts them back when it leaves', async () => {
      await open();
      expect(toasts.bottomOffset()).toEqual({ desktop: '96px', phone: '148px' });
      await harness.navigateByUrl('/results');
      expect(toasts.bottomOffset()).toBeNull();
    });

    describe('another result on the same page (the router reuses it)', () => {
      it('the question of an ending write does not travel: confirming it later writes nothing on the other result', async () => {
        api.view.mockImplementation(() => of(uncommented(viewFixture())));
        const el = await open();
        byName(el, 'Check all')!.click();
        await settle();
        expect(document.body.textContent).toContain('Finish as Quality Assessed?');
        await harness.navigateByUrl('/results/8793?timeline=29');
        await settle();
        expect(document.body.textContent).not.toContain('Finish as Quality Assessed?');
        (harness.routeDebugElement!.componentInstance as { confirmEnd(): void }).confirmEnd();
        await settle();
        expect(api.setValidations).not.toHaveBeenCalled();
      });

      it('a comment draft does not travel either: the same field of another result opens with an empty box', async () => {
        const el = await open();
        byName(el, 'Add comment for Title of Result')!.click();
        await settle();
        type('About result 9890 only');
        await harness.navigateByUrl('/results/8793?timeline=29');
        await settle();
        byName(harness.routeNativeElement as HTMLElement, 'Add comment for Title of Result')!.click();
        await settle();
        expect(draftBox().value).toBe('');
      });
    });

    describe('comments (FR-11, FR-12, FR-13)', () => {
      const openThread = async (el: HTMLElement, button: string) => {
        byName(el, button)!.click();
        await settle();
      };

      it('adds a comment: the thread shows it and the box is empty again', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        type('  The title is too long.  ');
        anywhere('Add comment')!.click();
        await settle();
        expect(api.addComment).toHaveBeenCalledWith(29, 9890, 'general.title', 'The title is too long.');
        expect(text(document.querySelector('ol[aria-label="Comments"]')!)).toContain('The title is too long.');
        expect(draftBox().value).toBe('');
      });

      it('an empty comment is not sent, and the box says so', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        anywhere('Add comment')!.click();
        await settle();
        expect(api.addComment).not.toHaveBeenCalled();
        expect(draftBox().getAttribute('aria-invalid')).toBe('true');
      });

      it('more than 2,000 characters is not sent', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        type('x'.repeat(2001));
        anywhere('Add comment')!.click();
        await settle();
        expect(api.addComment).not.toHaveBeenCalled();
        expect(document.querySelector('#review-comment-server-error')?.textContent).toContain('within 2,000 characters');
      });

      it('a comment the server refuses keeps the text, with the server\'s message under the box', async () => {
        api.addComment.mockReturnValueOnce(refusal(400, 'VALIDATION_FAILED', 'This field cannot be commented.'));
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        type('Check this');
        anywhere('Add comment')!.click();
        await settle();
        expect(draftBox().value).toBe('Check this');
        expect(document.querySelector('#review-comment-server-error')?.textContent).toContain('This field cannot be commented.');
      });

      it('a quick comment of the role fills the box, where it can still be changed', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        expect(api.quickComments).toHaveBeenCalledWith('ASSESSOR');
        const comp = harness.routeDebugElement!.componentInstance as { pickQuick(text: string): void };
        comp.pickQuick('Please add the evidence link.');
        harness.detectChanges();
        expect(draftBox().value).toBe('Please add the evidence link.');
        expect(api.addComment).not.toHaveBeenCalled();
      });

      it('"Save as quick comment" saves what is in the box for the role', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        type('Name the partner.');
        anywhere('Save as quick comment')!.click();
        await settle();
        expect(api.saveQuickComment).toHaveBeenCalledWith('ASSESSOR', 'Name the partner.');
        expect(toasts.success).toHaveBeenCalledWith('Saved as a quick comment.');
      });

      it('the author can withdraw an own open comment; another assessor\'s has no such button', async () => {
        const view = viewFixture();
        const general = view.sections[0];
        api.view.mockReturnValue(
          of({
            ...view,
            sections: [
              {
                ...general,
                fields: general.fields.map((f) =>
                  f.key === 'general.description'
                    ? { ...f, comments: [comment(), comment({ id: 4, author: { id: 77, nickname: 'jdoe' }, body: 'Mine is another one.' })] }
                    : f,
                ),
              },
              ...view.sections.slice(1),
            ],
          }),
        );
        const el = await open();
        await openThread(el, 'View comments2 for Description of Result');
        const items = [...document.querySelectorAll('ol[aria-label="Comments"] li')];
        expect(items.map((li) => !![...li.querySelectorAll('button')].find((b) => text(b) === 'Withdraw comment'))).toEqual([true, false]);
        // Each one says which comment it takes back (they all read "Withdraw comment").
        anywhere('Withdraw your comment of 12 Nov 2026')!.click();
        await settle();
        expect(api.withdrawComment).toHaveBeenCalledWith(1);
        expect(text(document.querySelector('ol[aria-label="Comments"]')!)).not.toContain('Add the evidence link.');
      });

      it('a withdraw that fails says why inside the thread (a toast would sit behind the drawer)', async () => {
        api.withdrawComment.mockReturnValueOnce(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
        const el = await open();
        await openThread(el, 'View comments1 for Description of Result');
        anywhere('Withdraw your comment of 12 Nov 2026')!.click();
        await settle();
        expect(document.querySelector('#review-thread-error')?.textContent).toContain('Try again in a moment.');
        expect(text(document.querySelector('ol[aria-label="Comments"]')!)).toContain('Add the evidence link.');
      });

      it('after saving a quick comment the link says so, until the text changes', async () => {
        const el = await open();
        await openThread(el, 'Add comment for Title of Result');
        type('Name the partner.');
        anywhere('Save as quick comment')!.click();
        await settle();
        expect(anywhere('Saved as quick comment')).toBeDefined();
        type('Name the partner and the country.');
        expect(anywhere('Save as quick comment')).toBeDefined();
      });

      it('a view-only field never gets the comment form', async () => {
        const el = await open();
        expect(byName(el, 'Add comment for Result code')).toBeUndefined();
      });
    });

    describe('AI suggestion on a field (P2-3918 T-9)', () => {
      const EXPLANATION = 'The description names an activity, not a change.';
      const suggestion: AiSuggestionView = {
        status: 'available',
        fieldKey: 'general.description',
        suggestionId: 's1',
        signal: 'red',
        valueKind: 'level',
        suggestedValue: 0,
        explanation: EXPLANATION,
        evidenceQuote: 'trained farmers',
        quoteVerified: true,
        evidenceSource: null,
        promptVersion: 'v2-1.0.0',
        modelId: 'anthropic.claude-haiku-5-5',
      };
      const savedEvents = () => ai.sendEvent.mock.calls.filter(([, , , e]) => e.action === 'comment_saved');
      const copy = async (el: HTMLElement) => {
        byName(card(el, 'Description of Result'), 'Copy to comment')!.click();
        await settle();
      };
      beforeEach(() => ai.list.mockReturnValue(of([suggestion])));

      it('"Copy to comment" leaves the AI text in the comment box of that field and saves nothing', async () => {
        const el = await open();
        await copy(el);
        expect(draftBox().value).toBe(EXPLANATION);
        expect(api.addComment).not.toHaveBeenCalled();
        expect(savedEvents()).toEqual([]);
      });

      it('saving that comment tells the AI side which comment it became (the id the server gave)', async () => {
        const el = await open();
        await copy(el);
        anywhere('Add comment')!.click();
        await settle();
        expect(api.addComment).toHaveBeenCalledWith(29, 9890, 'general.description', EXPLANATION);
        expect(savedEvents()).toEqual([[29, 9890, 's1', { action: 'comment_saved', commentId: '50' }]]);
      });

      it('a comment the server refuses is not reported as saved', async () => {
        api.addComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'This step is closed.'));
        const el = await open();
        await copy(el);
        anywhere('Add comment')!.click();
        await settle();
        expect(savedEvents()).toEqual([]);
      });

      it('a comment on a field no suggestion was copied to reports nothing', async () => {
        const el = await open();
        byName(el, 'Add comment for Title of Result')!.click();
        await settle();
        type('The title is too long.');
        anywhere('Add comment')!.click();
        await settle();
        expect(api.addComment).toHaveBeenCalledTimes(1);
        expect(savedEvents()).toEqual([]);
      });
    });

    describe('reason before an IRL / IUL validation 2+ above the AI (P2-3918 T-10)', () => {
      const IRL = 'innovation_dev.readiness_level';
      const irl = (aiLevel: number): AiSuggestionView => ({
        status: 'available',
        fieldKey: IRL,
        suggestionId: 's-irl',
        signal: 'red',
        valueKind: 'level',
        suggestedValue: aiLevel,
        explanation: 'The evidence shows a pilot only.',
        evidenceQuote: 'piloted in two villages',
        quoteVerified: true,
        evidenceSource: null,
        promptVersion: 'v2-1.0.0',
        modelId: 'anthropic.claude-haiku-5-5',
      });
      /** The readiness level, reported 6; core when it is the last grey core field (its write ends the assessment). */
      const irlView = (core: boolean) =>
        viewFixture({
          sections: [
            {
              key: 'general_information',
              label: 'General information',
              fields: [
                field({ key: 'general.title', label: 'Title of Result', core: true, validated: true }),
                field({ key: IRL, label: 'Readiness level', type: 'number', core, value: 6 }),
                // Another grey core field: the IRL write alone does not end the assessment.
                ...(core ? [] : [field({ key: 'general.description', label: 'Description of Result', core: true })]),
              ],
            },
          ],
        });
      const reasonEvents = () => ai.sendEvent.mock.calls.filter(([, , , e]) => e.action === 'validated_above_ai');
      const reasonBox = () => document.querySelector<HTMLInputElement>('#ai-reason');
      const writeReason = (value: string) => {
        reasonBox()!.value = value;
        reasonBox()!.dispatchEvent(new Event('input'));
        harness.detectChanges();
      };
      const approveIrl = async (el: HTMLElement) => {
        byName(el, 'Approve Readiness level')!.click();
        await settle();
      };

      it('order: the reason, then validated_above_ai, then the confirmation that ends it, then the validation', async () => {
        api.view.mockReturnValue(of(irlView(true)));
        ai.list.mockReturnValue(of([irl(3)]));
        const el = await open();
        await approveIrl(el);
        expect(document.body.textContent).toContain('Why does the reported level hold?');
        expect(document.body.textContent).not.toContain('Finish as Quality Assessed?');
        expect(reasonEvents()).toEqual([]);

        writeReason('A second pilot is in the annex');
        anywhere('Save and validate')!.click();
        await settle();
        expect(reasonEvents()).toEqual([
          [29, 9890, 's-irl', { action: 'validated_above_ai', aiLevel: 3, validatedLevel: 6, reason: 'A second pilot is in the annex' }],
        ]);
        expect(reasonBox()).toBeNull();
        expect(document.body.textContent).toContain('Finish as Quality Assessed?');
        expect(api.setValidations).not.toHaveBeenCalled();

        anywhere('Validate and finish')!.click();
        await settle();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: [IRL] });
        const eventAt = ai.sendEvent.mock.invocationCallOrder[ai.sendEvent.mock.calls.findIndex(([, , , e]) => e.action === 'validated_above_ai')];
        expect(eventAt).toBeLessThan(api.setValidations.mock.invocationCallOrder[0]);
      });

      it('while the reason is posted Save and the card are busy; a failed POST keeps the reason and validates nothing', async () => {
        api.view.mockReturnValue(of(irlView(false)));
        ai.list.mockReturnValue(of([irl(3)]));
        const slow = new Subject<void>();
        ai.sendEvent.mockImplementation((_t, _c, _id, e) => (e.action === 'validated_above_ai' ? slow : of(undefined)));
        const el = await open();
        await approveIrl(el);
        writeReason('Field visit report');
        anywhere('Save and validate')!.click();
        harness.detectChanges();
        expect(anywhere('Save and validate')!.getAttribute('aria-busy')).toBe('true');
        expect(byName(el, 'Approve Readiness level')!.getAttribute('aria-busy')).toBe('true');

        slow.error(new ApiError({ status: 503, code: 'UNAVAILABLE', message: 'Down' }));
        await settle();
        expect(api.setValidations).not.toHaveBeenCalled();
        expect(reasonBox()!.value).toBe('Field visit report');
        expect(document.body.textContent).toContain('The reason could not be saved, so nothing was validated.');

        // The retry goes through: a field that does not end the assessment is validated right away.
        ai.sendEvent.mockImplementation(() => of(undefined));
        anywhere('Save and validate')!.click();
        await settle();
        expect(reasonEvents()).toHaveLength(2);
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: [IRL] });
      });

      it('no reason when the reported level is less than 2 above the AI, or there is no AI level', async () => {
        api.view.mockReturnValue(of(irlView(false)));
        ai.list.mockReturnValue(of([irl(5)]));
        const el = await open();
        await approveIrl(el);
        expect(reasonBox()).toBeNull();
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: [IRL] });
        expect(reasonEvents()).toEqual([]);
      });

      it('Cancel validates nothing and posts nothing', async () => {
        api.view.mockReturnValue(of(irlView(false)));
        ai.list.mockReturnValue(of([irl(3)]));
        const el = await open();
        await approveIrl(el);
        writeReason('Half a thought');
        anywhere('Cancel')!.click();
        await settle();
        expect(api.setValidations).not.toHaveBeenCalled();
        expect(reasonEvents()).toEqual([]);
      });
    });

    describe('finish (FR-15)', () => {
      const toConfirm = async (el: HTMLElement) => {
        byName(el, 'Finish assessment')!.click();
        await settle();
        byName(el, 'Finish anyway')!.click(); // the fixture has open fields
        await settle();
      };

      it('says what finishing does now and that it cannot be undone, then finishes with one request', async () => {
        const el = await open();
        await toConfirm(el);
        expect(text(el.querySelector('[role="alertdialog"]')!)).toContain('The result becomes Returned to program. This cannot be undone.');
        api.view.mockReturnValueOnce(of(finishedView()));
        byName(el, 'Finish assessment')!.click();
        await settle();
        expect(api.finish).toHaveBeenCalledTimes(1);
        expect(api.finish).toHaveBeenCalledWith(29, 9890);
        expect(text(el.querySelector('[data-testid="review-read-only"]')!)).toContain('Finished by jdoe');
        expect(byName(el, 'Finish assessment')).toBeUndefined();
        expect(toasts.success).toHaveBeenCalledWith('Assessment finished: returned to the program.');
      });

      it('step 1, every core green and a comment on another field: the footer announces Returned to program (OQ-2)', async () => {
        const base = viewFixture(); // step 1, one open comment on general.description (not core)
        const coreGreen = { ...base, sections: base.sections.map((sec) => ({ ...sec, fields: sec.fields.map((f) => (f.core ? { ...f, validated: true } : f)) })) };
        api.view.mockImplementation(() => of(coreGreen));
        const el = await open();
        await toConfirm(el);
        expect(text(el.querySelector('[role="alertdialog"]')!)).toContain('The result becomes Returned to program. This cannot be undone.');
      });

      it('409 ASSESSMENT_CORE_UNCOMMENTED: names the core fields still open, by their label, and stays on the page', async () => {
        api.finish.mockReturnValueOnce(refusal(409, 'ASSESSMENT_CORE_UNCOMMENTED', 'Core fields are still open.', ['toc.entries']));
        const el = await open();
        await toConfirm(el);
        byName(el, 'Finish assessment')!.click();
        await settle();
        expect(text(el.querySelector('qa-review-footer [role="alert"]')!)).toBe('Validate or comment this core field first: ToC contributions.');
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(byName(el, 'Keep working')).toBeDefined();
      });

      it('409 ASSESSMENT_FINISHED on finish: the page shows who finished it', async () => {
        api.finish.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'This assessment is already finished.'));
        const el = await open();
        await toConfirm(el);
        api.view.mockReturnValueOnce(of(finishedView()));
        byName(el, 'Finish assessment')!.click();
        await settle();
        expect(text(el.querySelector('[data-testid="review-read-only"]')!)).toContain('Finished by jdoe');
        expect(el.querySelector('[role="alertdialog"]')).toBeNull();
      });
    });
  });

  describe("the program's responses and the clarification answer (P2-3911)", () => {
    /** The assessment ended as returned and the program asked about the caller's comment (its step is open). */
    const asked = (): AssessmentView => {
      const v = finishedView();
      return {
        ...v,
        header: { ...v.header, status: 'clarification_requested' },
        sections: v.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) => (f.key === 'general.description' ? { ...f, comments: [comment({ state: 'clarification_requested' })] } : f)),
        })),
      };
    };
    const thread = () => document.querySelector('ol[aria-label="Comments"]')!;
    const openAsked = async () => {
      api.view.mockReturnValue(of(asked()));
      api.programResponses.mockReturnValue(of([clarificationThread()]));
      const el = await open();
      await settle();
      byName(el, 'View comments1 for Description of Result')!.click();
      await settle();
      return el;
    };

    it('shows what the program asked under the comment, with who asked, and the form for the answer', async () => {
      await openAsked();
      const rows = [...thread().querySelectorAll('li')].map(text);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain('Pepa Program · Program');
      expect(rows[1]).toContain('Requested clarification');
      expect(rows[1]).toContain('pepa@program.org');
      expect(rows[1]).toContain('Which evidence link do you mean?');
      expect(document.querySelector('label[for="review-comment-draft"]')?.textContent).toContain('Your answer to the program');
      expect(anywhere('Send answer')).toBeDefined();
      // The comment tools of step 1 are not offered here.
      expect(anywhere('Add comment')).toBeUndefined();
      expect(text(document.body)).not.toContain('Quick comment');
    });

    it('sends the answer, shows it under the request and takes the form away', async () => {
      await openAsked();
      const answered = clarificationThread({
        state: 'open',
        clarifications: [{ requestId: 70, question: 'Which evidence link do you mean?', requestedAt: '2026-11-18T14:00:00.000Z', answer: { body: 'The one in the evidence section.', answeredAt: '2026-11-19T10:00:00.000Z' } }],
      });
      api.answerClarification.mockReturnValueOnce(of(answered));
      api.programResponses.mockReturnValue(of([answered]));
      api.view.mockReturnValue(of({ ...asked(), header: { ...asked().header, status: 'returned_to_program' }, sections: finishedView().sections }));
      type('The one in the evidence section.');
      anywhere('Send answer')!.click();
      await settle();

      expect(api.answerClarification).toHaveBeenCalledWith(1, 'The one in the evidence section.');
      const rows = [...thread().querySelectorAll('li')].map(text);
      expect(rows).toHaveLength(3);
      expect(rows[2]).toContain('mchen · Answer');
      expect(rows[2]).toContain('The one in the evidence section.');
      expect(anywhere('Send answer')).toBeUndefined();
      expect(anywhere('Close')).toBeDefined();
    });

    it('an empty answer is not sent, and a refused text says why under the box', async () => {
      await openAsked();
      anywhere('Send answer')!.click();
      await settle();
      expect(api.answerClarification).not.toHaveBeenCalled();
      expect(document.querySelector('#review-comment-error')?.textContent).toContain('Write your answer before sending it.');

      api.answerClarification.mockReturnValueOnce(refusal(400, 'VALIDATION_FAILED', 'Keep it within 2,000 characters.'));
      type('An answer');
      anywhere('Send answer')!.click();
      await settle();
      expect(document.querySelector('#review-comment-server-error')?.textContent).toContain('Keep it within 2,000 characters.');
      expect(draftBox().value).toBe('An answer');
    });

    it('says which request the answer goes to, and after "step closed" takes the form away with what was typed', async () => {
      await openAsked();
      expect(document.querySelector('#review-clarify-question')?.textContent).toContain('Which evidence link do you mean?');

      api.answerClarification.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'The step is closed.'));
      type('Too late');
      anywhere('Send answer')!.click();
      await settle();
      expect(toasts.error).toHaveBeenCalledWith('The step is closed.');
      expect(document.querySelector('#review-comment-draft')).toBeNull();
      expect(anywhere('Close')).toBeDefined();
      expect([...thread().querySelectorAll('li')]).toHaveLength(2);
    });

    it('another assessor reads the same thread with no form', async () => {
      api.view.mockReturnValue(of({ ...asked(), sections: asked().sections.map((sec) => ({ ...sec, fields: sec.fields.map((f) => ({ ...f, comments: f.comments.map((c) => ({ ...c, author: { id: 7, nickname: 'other' } })) })) })) }));
      api.programResponses.mockReturnValue(of([clarificationThread()]));
      const el = await open();
      await settle();
      byName(el, 'View comments1 for Description of Result')!.click();
      await settle();
      expect([...thread().querySelectorAll('li')]).toHaveLength(2);
      expect(document.querySelector('#review-comment-draft')).toBeNull();
      expect(anywhere('Close')).toBeDefined();
    });

    it("says so in the thread when the program's responses could not be read", async () => {
      api.view.mockReturnValue(of(asked()));
      api.programResponses.mockReturnValue(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
      const el = await open();
      await settle();
      byName(el, 'View comments1 for Description of Result')!.click();
      await settle();
      expect(document.querySelector('#review-thread-error')?.textContent).toContain("The program's responses could not be loaded.");
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
      expect(buttons(section).map((b) => b.getAttribute('aria-label') ?? text(b))).toEqual([
        'Undo approval of Title of Result',
        'Add comment for Title of Result',
        'Approve Description of Result',
        'View comments1 for Description of Result',
      ]);
      for (const b of buttons(section)) expect(b.tabIndex).toBeGreaterThanOrEqual(0);

      const next = byName(el, 'Next →')!;
      next.focus();
      next.click();
      harness.detectChanges();
      expect(text(el.querySelector('#review-section-title')!)).toBe('Theory of Change');
      byName(el, 'Next →')!.click();
      harness.detectChanges();
      expect(text(el.querySelector('#review-section-title')!)).toBe('Geographic location');
      expect(buttons(el.querySelector('section')!).map((b) => b.getAttribute('aria-label') ?? text(b))).toEqual([
        'Approve Countries',
        'Add comment for Countries',
        'Approve Regions',
        'Add comment for Regions',
      ]);
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

    it('an auto-validated result is not assessed: no pending count, no "Not validated" mark and no write button, even when the caller may write', async () => {
      api.view.mockReturnValue(of(viewFixture({ header: { ...viewFixture().header, status: 'auto_validated' } })));
      const el = await open();
      expect(text(el)).toContain('Auto-validated: this result is not assessed.');
      expect(text(el)).toContain('No fields to assess in this result');
      expect(text(el)).not.toMatch(/\d+ of \d+ fields resolved/);
      expect(text(el)).not.toMatch(/\d+ pending/);
      expect(text(el)).not.toContain('Not validated');
      const names = buttons(el).map((b) => b.getAttribute('aria-label') ?? text(b));
      expect(names.filter((n) => /^(Approve|Undo|Add comment|Check all|Uncheck all|Finish assessment)/.test(n))).toEqual([]);
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
