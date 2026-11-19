import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
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
import { clarificationThread, comment, viewFixture } from './review.api-fixture';
import { ReviewStore } from './review-store';

const ME = 1053;

const summary = (over: Partial<ValidationSummary> = {}): ValidationSummary => ({
  status: 'pending',
  assessedBy: null,
  finishedAt: null,
  validations: [],
  ...over,
});

const refusal = (status: number, code: string, message: string, fields?: readonly string[]) =>
  throwError(() => new ApiError({ status, code, message, ...(fields ? { fields } : {}) }));

/** The view after the assessment ended (what a reload answers). */
const finishedView = (status: 'quality_assessed' | 'returned' = 'quality_assessed'): AssessmentView =>
  viewFixture({
    writable: false,
    readOnlyReason: 'finished',
    assessment: { status, assessedBy: { id: 77, nickname: 'jdoe' }, finishedAt: '2026-11-17T10:00:00.000Z' },
  });

/** A fake transport: each test says what the next call answers; no call succeeds by default without being asked. */
class FakeApi {
  view = vi.fn<(timelineId: number, code: number) => Observable<AssessmentView>>(() => of(viewFixture()));
  timelines = vi.fn<() => Observable<WorklistTimelines>>(() => of({ timelines: [], defaultTimelineId: 29, timeZone: 'Europe/Rome' }));
  setValidations = vi.fn<(timelineId: number, code: number, body: ValidationsBody) => Observable<ValidationSummary>>(() => of(summary()));
  addComment = vi.fn<(timelineId: number, code: number, fieldKey: string, body: string) => Observable<AssessmentComment>>(
    (_t, _c, fieldKey, body) => of(comment({ id: 50, fieldKey, body, author: { id: ME, nickname: 'me' } })),
  );
  withdrawComment = vi.fn<(id: number) => Observable<AssessmentComment>>((id) =>
    of(comment({ id, state: 'withdrawn', withdrawnAt: '2026-11-17T10:00:00.000Z' })),
  );
  finish = vi.fn<(timelineId: number, code: number) => Observable<ValidationSummary>>(() =>
    of(summary({ status: 'returned', assessedBy: { id: ME, nickname: 'me' }, finishedAt: '2026-11-17T10:00:00.000Z' })),
  );
  quickComments = vi.fn<(role: string) => Observable<readonly QuickComment[]>>(() => of([]));
  saveQuickComment = vi.fn<(role: string, body: string) => Observable<QuickComment>>((_role, body) =>
    of({ id: 9, body, createdAt: '2026-11-17T10:00:00.000Z' }),
  );
  programResponses = vi.fn<(timelineId: number, code: number) => Observable<readonly CommentThread[]>>(() => of([]));
  answerClarification = vi.fn<(commentId: number, body: string) => Observable<CommentThread>>((commentId) =>
    of(clarificationThread({ commentId, state: 'open' })),
  );
}

describe('ReviewStore actions (T-20)', () => {
  let api: FakeApi;
  let toasts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let store: ReviewStore;

  const field = (key: string) => store.view()!.sections.flatMap((s) => s.fields).find((f) => f.key === key)!;

  beforeEach(async () => {
    api = new FakeApi();
    toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ReviewStore,
        { provide: AssessmentApi, useValue: api },
        { provide: Toasts, useValue: toasts },
        { provide: AuthSession, useValue: { user: signal({ id: ME }) } },
      ],
    });
    store = TestBed.inject(ReviewStore);
    await store.load('9890', '29');
  });

  describe('green / grey (FR-10)', () => {
    it('sets one field green and paints what the server holds, another assessor\'s change included (FR-17)', async () => {
      api.setValidations.mockReturnValueOnce(
        of(summary({ validations: [{ fieldKey: 'general.description', validated: true }, { fieldKey: 'geo.regions', validated: true }] })),
      );
      expect(await store.setValidated('general.description', true)).toBe(true);
      expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: ['general.description'] });
      expect(field('general.description').validated).toBe(true);
      expect(field('geo.regions').validated).toBe(true); // someone else's
      // A field with no row in the answer is grey, whatever the page showed before.
      expect(field('general.title').validated).toBe(false);
      expect(store.validating().size).toBe(0);
    });

    it('a second tap while the first is on its way sends nothing (one write per field)', async () => {
      const slow = new Subject<ValidationSummary>();
      api.setValidations.mockReturnValueOnce(slow);
      const first = store.setValidated('general.description', true);
      expect(store.validating().has('general.description')).toBe(true);
      expect(await store.setValidated('general.description', true)).toBe(false);
      slow.next(summary({ validations: [{ fieldKey: 'general.description', validated: true }] }));
      slow.complete();
      await first;
      expect(api.setValidations).toHaveBeenCalledTimes(1);
    });

    it('Check all and Uncheck all are one request each, for every Assessed field', async () => {
      await store.setAllValidated(true);
      expect(api.setValidations).toHaveBeenLastCalledWith(29, 9890, { validated: true, all: true });
      await store.setAllValidated(false);
      expect(api.setValidations).toHaveBeenLastCalledWith(29, 9890, { validated: false, all: true });
    });

    it('the write that leaves every core field green ends the assessment: the page reads it again and says so (FR-14)', async () => {
      api.setValidations.mockReturnValueOnce(
        of(summary({ status: 'quality_assessed', assessedBy: { id: ME, nickname: 'me' }, finishedAt: '2026-11-17T10:00:00.000Z' })),
      );
      api.view.mockReturnValueOnce(of(finishedView()));
      await store.setValidated('general.title', true);
      expect(api.view).toHaveBeenCalledTimes(2);
      expect(store.view()!.writable).toBe(false);
      expect(store.view()!.readOnlyReason).toBe('finished');
      expect(toasts.success).toHaveBeenCalledWith('Assessment finished: Quality Assessed.');
    });

    it('409 ASSESSMENT_FINISHED: someone ended it first, so the page reloads and shows who (FR-16, FR-17)', async () => {
      api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'This assessment is already finished.'));
      api.view.mockReturnValueOnce(of(finishedView('returned')));
      expect(await store.setValidated('general.description', true)).toBe(false);
      expect(api.view).toHaveBeenCalledTimes(2);
      expect(store.view()!.assessment?.assessedBy?.nickname).toBe('jdoe');
      expect(store.vm()!.banner).toContain('Finished by jdoe');
      expect(toasts.error).toHaveBeenCalledWith('This assessment is already finished.');
      // The local state was not kept: the field is what the reload says.
      expect(field('general.description').validated).toBe(false);
    });

    it('409 ASSESSMENT_STEP_CLOSED: the page reloads read only and says the server\'s reason', async () => {
      api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'The step is closed.'));
      api.view.mockReturnValueOnce(of(viewFixture({ writable: false, readOnlyReason: 'step_closed' })));
      await store.setValidated('general.description', true);
      expect(store.view()!.writable).toBe(false);
      expect(toasts.error).toHaveBeenCalledWith('The step is closed.');
    });

    it('a failure that is not a refusal (503) keeps the page and says the message, without a reload', async () => {
      api.setValidations.mockReturnValueOnce(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
      expect(await store.setValidated('general.description', true)).toBe(false);
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(toasts.error).toHaveBeenCalledWith('Try again in a moment.');
      expect(store.validating().size).toBe(0);
    });
  });

  describe('comments (FR-11, FR-13)', () => {
    it('adds a trimmed comment and shows it on its field', async () => {
      const outcome = await store.addComment('geo.regions', '  Add the regions.  ');
      expect(outcome).toMatchObject({ ok: true, comment: { id: 50, fieldKey: 'geo.regions' } });
      expect(api.addComment).toHaveBeenCalledWith(29, 9890, 'geo.regions', 'Add the regions.');
      expect(field('geo.regions').comments.map((c) => c.body)).toEqual(['Add the regions.']);
      expect(store.commenting()).toBe(false);
    });

    it('a refused comment (400) adds nothing and gives the message back to the form', async () => {
      api.addComment.mockReturnValueOnce(refusal(400, 'VALIDATION_FAILED', 'The comment is too long.'));
      expect(await store.addComment('geo.regions', 'x')).toEqual({ ok: false, message: 'The comment is too long.' });
      expect(field('geo.regions').comments).toHaveLength(0);
      expect(toasts.error).not.toHaveBeenCalled();
    });

    it('a comment refused because the assessment ended reloads the page (FR-16)', async () => {
      api.addComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'This assessment is already finished.'));
      api.view.mockReturnValueOnce(of(finishedView()));
      const outcome = await store.addComment('geo.regions', 'Late');
      // The message goes back to the form (a toast would sit behind the drawer) and in a toast, for when the form is gone.
      expect(outcome).toEqual({ ok: false, message: 'This assessment is already finished.' });
      expect(toasts.error).toHaveBeenCalledTimes(1);
      expect(store.view()!.readOnlyReason).toBe('finished');
    });

    it('withdraws an own open comment: it leaves the thread and the counts', async () => {
      expect(await store.withdrawComment(1)).toEqual({ ok: true });
      expect(api.withdrawComment).toHaveBeenCalledWith(1);
      expect(field('general.description').comments.find((c) => c.id === 1)!.state).toBe('withdrawn');
      expect(store.vm()!.commented).toBe(0);
      expect(store.withdrawing()).toBeNull();
    });

    it('409 ASSESSMENT_COMMENT_NOT_OPEN on a withdraw reloads the thread and says why', async () => {
      api.withdrawComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_COMMENT_NOT_OPEN', 'This comment is no longer open.'));
      expect(await store.withdrawComment(1)).toEqual({ ok: false, message: 'This comment is no longer open.' });
      expect(api.view).toHaveBeenCalledTimes(2);
    });
  });

  describe('finish (FR-15)', () => {
    it('ends as returned: the page reads the end again and says so', async () => {
      api.view.mockReturnValueOnce(of(finishedView('returned')));
      expect(await store.finish()).toEqual({ ok: true });
      expect(api.finish).toHaveBeenCalledWith(29, 9890);
      expect(store.view()!.readOnlyReason).toBe('finished');
      expect(toasts.success).toHaveBeenCalledWith('Assessment finished: returned to the program.');
      expect(store.finishing()).toBe(false);
    });

    it('409 ASSESSMENT_CORE_UNCOMMENTED names the core fields still open, and nothing is reloaded', async () => {
      api.finish.mockReturnValueOnce(
        refusal(409, 'ASSESSMENT_CORE_UNCOMMENTED', 'Validate or comment every core field first.', ['general.title']),
      );
      expect(await store.finish()).toEqual({
        ok: false,
        message: 'Validate or comment every core field first.',
        coreKeys: ['general.title'],
      });
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it('of two finishes at once only one is sent', async () => {
      const slow = new Subject<ValidationSummary>();
      api.finish.mockReturnValueOnce(slow);
      const first = store.finish();
      expect((await store.finish()).ok).toBe(false);
      slow.next(summary({ status: 'returned' }));
      slow.complete();
      await first;
      expect(api.finish).toHaveBeenCalledTimes(1);
    });
  });

  describe('answers that got lost, and ends that could not be read again', () => {
    it('a finish whose answer never arrived reads the page again: the server may have finished it', async () => {
      api.finish.mockReturnValueOnce(refusal(0, 'CLIENT_NETWORK_ERROR', 'We could not reach the QA service.'));
      api.view.mockReturnValueOnce(of(finishedView('returned')));
      const outcome = await store.finish();
      expect(outcome.ok).toBe(false);
      expect(api.view).toHaveBeenCalledTimes(2);
      expect(store.view()!.readOnlyReason).toBe('finished');
    });

    it('an ended assessment is read only at once, even when reading it again fails', async () => {
      api.setValidations.mockReturnValueOnce(
        of(summary({ status: 'quality_assessed', assessedBy: { id: ME, nickname: 'me' }, finishedAt: '2026-11-17T10:00:00.000Z' })),
      );
      api.view.mockReturnValueOnce(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
      await store.setValidated('general.title', true);
      expect(store.view()!.writable).toBe(false);
      expect(store.view()!.readOnlyReason).toBe('finished');
      expect(store.vm()!.canFinish).toBe(false);
    });

    it('nothing is validated while a finish is on its way, and nothing is finished while a validation is', async () => {
      const slowFinish = new Subject<ValidationSummary>();
      api.finish.mockReturnValueOnce(slowFinish);
      const finishing = store.finish();
      expect(await store.setValidated('general.description', true)).toBe(false);
      expect(api.setValidations).not.toHaveBeenCalled();
      slowFinish.error(new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' }));
      await finishing;

      const slowWrite = new Subject<ValidationSummary>();
      api.setValidations.mockReturnValueOnce(slowWrite);
      const writing = store.setValidated('general.description', true);
      expect((await store.finish()).ok).toBe(false);
      expect(api.finish).toHaveBeenCalledTimes(1);
      slowWrite.next(summary());
      slowWrite.complete();
      await writing;
    });

    it('opening another result drops the busy marks of the one left behind', async () => {
      api.setValidations.mockReturnValueOnce(new Subject<ValidationSummary>());
      void store.setValidated('general.description', true);
      expect(store.validating().size).toBe(1);
      await store.load('8793', '29');
      expect(store.validating().size).toBe(0);
    });

    it('a withdraw that is refused gives its message back (the thread shows it: a toast would sit behind the drawer)', async () => {
      api.withdrawComment.mockReturnValueOnce(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
      expect(await store.withdrawComment(1)).toEqual({ ok: false, message: 'Try again in a moment.' });
    });
  });

  describe('quick comments (FR-12)', () => {
    it('reads the list of the assessor role once', async () => {
      api.quickComments.mockReturnValue(of([{ id: 3, body: 'Add the evidence link.', createdAt: '2026-11-10T10:00:00.000Z' }]));
      await store.loadQuickComments();
      await store.loadQuickComments();
      expect(api.quickComments).toHaveBeenCalledTimes(1);
      expect(api.quickComments).toHaveBeenCalledWith('ASSESSOR');
      expect(store.quickComments().map((q) => q.body)).toEqual(['Add the evidence link.']);
    });

    it('a caller with no grant of the role (403) just has no list', async () => {
      api.quickComments.mockReturnValueOnce(refusal(403, 'AUTH_PERMISSION_DENIED', 'Not allowed.'));
      await store.loadQuickComments();
      expect(store.quickComments()).toEqual([]);
      expect(toasts.error).not.toHaveBeenCalled();
    });

    it('a text saved while the list was still loading is kept when the list lands', async () => {
      const slow = new Subject<readonly QuickComment[]>();
      api.quickComments.mockReturnValueOnce(slow);
      const loading = store.loadQuickComments();
      await store.saveQuickComment('Name the partner.');
      slow.next([{ id: 3, body: 'Add the evidence link.', createdAt: '2026-11-10T10:00:00.000Z' }]);
      slow.complete();
      await loading;
      expect(store.quickComments().map((q) => q.id)).toEqual([9, 3]);
    });

    it('saves a text on top of the list, once (the server answers the same entry for the same text)', async () => {
      expect(await store.saveQuickComment('  Add the evidence link.  ')).toBe(true);
      expect(api.saveQuickComment).toHaveBeenCalledWith('ASSESSOR', 'Add the evidence link.');
      expect(await store.saveQuickComment('Add the evidence link.')).toBe(true);
      expect(store.quickComments().map((q) => q.id)).toEqual([9]);
      expect(toasts.success).toHaveBeenCalledWith('Saved as a quick comment.');
    });
  });

  describe("the program's responses and the clarification answer (P2-3911)", () => {
    /** Lets the read that follows the assessment land. */
    const settled = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };
    const uncommented = (): AssessmentView => {
      const v = viewFixture();
      return { ...v, sections: v.sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, comments: [] })) })) };
    };

    it('reads them after the assessment when a comment stands, keyed by comment', async () => {
      api.programResponses.mockReturnValue(of([clarificationThread()]));
      await store.load('9890', '29');
      await settled();
      expect(api.programResponses).toHaveBeenLastCalledWith(29, 9890);
      expect(store.threads().get(1)?.state).toBe('clarification_requested');
      expect(store.threadsFailed()).toBe(false);
    });

    it('asks nothing for a result with no standing comment', async () => {
      api.programResponses.mockClear();
      api.view.mockReturnValue(of(uncommented()));
      await store.load('9890', '29');
      await settled();
      expect(api.programResponses).not.toHaveBeenCalled();
      expect(store.threads().size).toBe(0);
    });

    it('a failed read leaves the page as it is and says the responses are missing', async () => {
      api.programResponses.mockReturnValue(refusal(503, 'SERVICE_UNAVAILABLE', 'Try again in a moment.'));
      await store.load('9890', '29');
      await settled();
      expect(store.state()).toBe('ready');
      expect(store.threadsFailed()).toBe(true);
      expect(toasts.error).not.toHaveBeenCalled();
    });

    it('never paints the responses of the result left behind', async () => {
      const slow = new Subject<readonly CommentThread[]>();
      api.programResponses.mockReturnValueOnce(slow);
      await store.load('9890', '29');
      api.programResponses.mockReturnValue(of([]));
      await store.load('9891', '29');
      slow.next([clarificationThread()]);
      slow.complete();
      await settled();
      expect(store.threads().size).toBe(0);
    });

    it('answers a clarification: the text goes trimmed, the comment is open again and the page reads the result once more', async () => {
      api.view.mockClear();
      const outcome = await store.answerClarification(1, '  The one in the evidence section.  ');
      await settled();
      expect(outcome).toEqual({ ok: true });
      expect(api.answerClarification).toHaveBeenCalledWith(1, 'The one in the evidence section.');
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(store.answering()).toBeNull();
    });

    it('keeps what the server answered in the thread before the read lands', async () => {
      api.view.mockReturnValue(new Subject<AssessmentView>()); // the read that follows never lands in this test
      await store.answerClarification(1, 'The one in the evidence section.');
      expect(store.threads().get(1)?.state).toBe('open');
      expect(field('general.description').comments.find((c) => c.id === 1)?.state).toBe('open');
    });

    it('a second tap while the first is on its way sends nothing, and an empty text is never sent', async () => {
      const slow = new Subject<CommentThread>();
      api.answerClarification.mockReturnValueOnce(slow);
      const first = store.answerClarification(1, 'Answer');
      expect(store.answering()).toBe(1);
      expect(await store.answerClarification(1, 'Answer')).toEqual({ ok: false, message: '' });
      slow.next(clarificationThread({ state: 'open' }));
      slow.complete();
      await first;
      expect(api.answerClarification).toHaveBeenCalledTimes(1);
      expect(await store.answerClarification(1, '   ')).toEqual({ ok: false, message: '' });
      expect(api.answerClarification).toHaveBeenCalledTimes(1);
    });

    it('already answered, or the step closed: the page reads the result again and a toast says why', async () => {
      for (const [status, code, message] of [
        [409, 'CLARIFICATION_NOT_PENDING', 'This clarification was already answered.'],
        [409, 'ASSESSMENT_STEP_CLOSED', 'The step is closed.'],
      ] as const) {
        api.view.mockClear();
        toasts.error.mockClear();
        api.answerClarification.mockReturnValueOnce(refusal(status, code, message));
        expect(await store.answerClarification(1, 'Answer')).toEqual({ ok: false, message: '' });
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(toasts.error).toHaveBeenCalledWith(message);
      }
    });

    it('an older read of the responses never paints over what the answer brought', async () => {
      const slow = new Subject<readonly CommentThread[]>();
      api.programResponses.mockReturnValueOnce(slow);
      await store.load('9890', '29'); // its read of the responses is still on its way
      api.view.mockReturnValue(new Subject<AssessmentView>()); // the re-read after the answer never lands here
      await store.answerClarification(1, 'The one in the evidence section.');
      slow.next([clarificationThread()]); // the state before the answer
      slow.complete();
      await settled();
      expect(store.threads().get(1)?.state).toBe('open');
    });

    it('remembers that the programs step is closed, until another result is opened', async () => {
      api.answerClarification.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'The step is closed.'));
      await store.answerClarification(1, 'Answer');
      expect(store.clarifyClosed()).toBe(true);
      await store.load('9891', '29');
      expect(store.clarifyClosed()).toBe(false);
    });

    it('a refused text (too long) keeps the form and gives the message back, with no reload', async () => {
      api.view.mockClear();
      api.answerClarification.mockReturnValueOnce(refusal(400, 'VALIDATION_FAILED', 'Keep it within 2,000 characters.'));
      expect(await store.answerClarification(1, 'Answer')).toEqual({ ok: false, message: 'Keep it within 2,000 characters.' });
      expect(api.view).not.toHaveBeenCalled();
      expect(toasts.error).not.toHaveBeenCalled();
    });
  });
});
