import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  AssessmentComment,
  AssessmentView,
  CommentThread,
  DecisionResult,
  LeadDecisionKind,
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
import { decisionResultFixture, endedRoundTwo, roundTwoViewFixture, withField, withThread } from './review.round2-fixture';

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
  decide = vi.fn<(timelineId: number, code: number, commentId: number, decision: LeadDecisionKind, body: string) => Observable<DecisionResult>>(() =>
    of(decisionResultFixture()),
  );
  clearDecision = vi.fn<(timelineId: number, code: number, commentId: number) => Observable<DecisionResult>>(() =>
    of(decisionResultFixture({ decision: null, validations: [] })),
  );
  deleteComment = vi.fn<(commentId: number) => Observable<AssessmentComment>>((id) =>
    of(comment({ id, deletedAt: '2026-11-25T11:30:00.000Z', deletedBy: 14 })),
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
  it('round 1: a comment added or withdrawn is painted from its answer, with no second read of the view', async () => {
    api.view.mockClear();
    await store.addComment('general.title', 'A comment.');
    await store.withdrawComment(50);
    expect(api.view).not.toHaveBeenCalled();
  });

  describe('round 2: the Lead decides the round-1 comments (P2-3912, round-2 contract § 4.1)', () => {
    const item = (id: number) => field('general.description').thread!.find((t) => t.commentId === id)!;
    const agreed = withThread(
      { decision: { decision: 'agree_program', body: 'The program is right.', decidedAt: '2026-11-25T11:00:00.000Z' } },
      [],
      withField('general.description', (f) => ({ ...f, validated: true, effectiveValidated: true })),
    );

    beforeEach(async () => {
      api.view.mockReturnValue(of(roundTwoViewFixture()));
      await store.load('9890', '29');
      api.view.mockClear();
    });

    describe('green / grey and finish in round 2 (tramo-2 findings)', () => {
      it('a green/grey answer repaints effectiveValidated too: Undo on a carried green turns it grey at once', async () => {
        api.view.mockReturnValue(new Subject<AssessmentView>());
        api.setValidations.mockReturnValueOnce(
          of(
            summary({
              validations: [{ fieldKey: 'general.title', validated: false }],
              effectiveValidated: [
                { fieldKey: 'general.description', validated: false },
                { fieldKey: 'general.title', validated: false },
              ],
            }),
          ),
        );
        await store.setValidated('general.title', false);
        expect(field('general.title').effectiveValidated).toBe(false);
        expect(field('general.title').carried).toBe(false);
        expect(store.vm()!.validated).toBe(0);
      });

      it('an answer without effectiveValidated: a stored row wins over the carried green, no row keeps it', async () => {
        api.setValidations.mockReturnValueOnce(of(summary({ validations: [{ fieldKey: 'general.description', validated: true }] })));
        await store.setValidated('general.description', true);
        expect(field('general.description').effectiveValidated).toBe(true);
        expect(field('general.title').effectiveValidated).toBe(true);
        expect(field('general.title').carried).toBe(true);
        expect(store.vm()!.validated).toBe(2);
      });

      it('a finish that ends escalated says Pending for TPB review, never "returned to the program"', async () => {
        api.finish.mockReturnValueOnce(
          of(summary({ status: 'escalated', assessedBy: { id: 14, nickname: 'lea' }, finishedAt: '2026-11-25T12:00:00.000Z' })),
        );
        api.view.mockReturnValueOnce(of(endedRoundTwo('escalated')));
        await store.finish();
        expect(toasts.success).toHaveBeenCalledWith('Assessment finished: Pending for TPB review.');
        expect(toasts.success).not.toHaveBeenCalledWith('Assessment finished: returned to the program.');
      });

      it('a green write refused with ASSESSMENT_CORE_COMMENT_UNDECIDED says so next to the field, by code, with no toast', async () => {
        api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_CORE_COMMENT_UNDECIDED', 'raw server text', ['general.description']));
        expect(await store.setValidated('general.description', true)).toBe(false);
        expect(store.fieldErrors().get('general.description')).toBe(
          'Decide the round-1 comments on this field first: agree with the program or escalate them.',
        );
        expect(toasts.error).not.toHaveBeenCalled();
        // The next try on that field starts clean.
        api.setValidations.mockReturnValueOnce(of(summary()));
        await store.setValidated('general.description', true);
        expect(store.fieldErrors().has('general.description')).toBe(false);
      });

      it('Check all refused with ASSESSMENT_CORE_COMMENT_UNDECIDED marks each listed field and says it in a toast', async () => {
        api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_CORE_COMMENT_UNDECIDED', 'raw server text', ['general.description']));
        await store.setAllValidated(true);
        expect([...store.fieldErrors().keys()]).toEqual(['general.description']);
        expect(toasts.error).toHaveBeenCalledWith('Decide the round-1 comments first on: Description of Result.');
      });

      it('a green write refused with ASSESSMENT_FIELD_ESCALATED says so next to the field', async () => {
        api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FIELD_ESCALATED', 'raw server text'));
        await store.setValidated('general.description', true);
        expect(store.fieldErrors().get('general.description')).toBe('This field is escalated to TPB, so it cannot be validated.');
        expect(toasts.error).not.toHaveBeenCalled();
      });
    });

    it('decide: PUT with the trimmed text, then the view is read again (the server is the source of truth)', async () => {
      api.view.mockReturnValueOnce(of(agreed));
      expect(await store.decide(41, 'agree_program', '  The program is right.  ')).toEqual({ ok: true });
      expect(api.decide).toHaveBeenCalledWith(29, 9890, 41, 'agree_program', 'The program is right.');
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(item(41).decision?.decision).toBe('agree_program');
      expect(field('general.description').effectiveValidated).toBe(true);
      expect(store.deciding()).toBeNull();
    });

    it('while the re-read is on its way the answer is already painted (decision and stored marks)', async () => {
      api.view.mockReturnValueOnce(new Subject<AssessmentView>());
      void store.decide(41, 'agree_program', 'Right.');
      await Promise.resolve();
      await Promise.resolve();
      expect(item(41).decision?.decision).toBe('agree_program');
      expect(field('general.description').validated).toBe(true);
    });

    it('an empty or too long text sends nothing and says why next to the control', async () => {
      expect(await store.decide(41, 'escalate', '   ')).toEqual({ ok: false, message: 'Write a comment before saving the decision.' });
      expect(store.decisionErrors().get(41)).toBe('Write a comment before saving the decision.');
      const long = await store.decide(41, 'escalate', 'x'.repeat(2001));
      expect(long).toEqual({ ok: false, message: 'Keep the comment within 2,000 characters (it has 2,001).' });
      expect(api.decide).not.toHaveBeenCalled();
    });

    it('a second tap while a decision is on its way sends nothing (double tap safe)', async () => {
      const slow = new Subject<DecisionResult>();
      api.decide.mockReturnValueOnce(slow);
      const first = store.decide(41, 'escalate', 'Escalate it.');
      expect(store.deciding()).toEqual({ commentId: 41, action: 'decide' });
      expect((await store.decide(41, 'escalate', 'Escalate it.')).ok).toBe(false);
      expect((await store.clearDecision(41)).ok).toBe(false);
      expect(await store.setValidated('general.description', true)).toBe(false);
      slow.next(decisionResultFixture({ decision: { decision: 'escalate', body: 'Escalate it.', decidedAt: '2026-11-25T11:00:00.000Z' }, validations: [] }));
      slow.complete();
      await first;
      expect(api.decide).toHaveBeenCalledTimes(1);
      expect(api.setValidations).not.toHaveBeenCalled();
      expect(store.deciding()).toBeNull();
    });

    it('no decision while a green write is on its way', async () => {
      const slow = new Subject<ValidationSummary>();
      api.setValidations.mockReturnValueOnce(slow);
      const write = store.setValidated('general.title', false);
      expect((await store.decide(41, 'escalate', 'Escalate it.')).ok).toBe(false);
      slow.next(summary());
      slow.complete();
      await write;
      expect(api.decide).not.toHaveBeenCalled();
    });

    it('an agree that leaves every core field green ends the review: read only at once, read again, a toast says so', async () => {
      api.decide.mockReturnValueOnce(
        of(decisionResultFixture({ status: 'quality_assessed', assessedBy: { id: 14, nickname: 'lea' }, finishedAt: '2026-11-25T12:00:00.000Z' })),
      );
      api.view.mockReturnValueOnce(of(endedRoundTwo('quality_assessed')));
      expect(await store.decide(41, 'agree_program', 'Right.')).toEqual({ ok: true });
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(store.view()!.writable).toBe(false);
      expect(store.view()!.readOnlyReason).toBe('finished');
      expect(toasts.success).toHaveBeenCalledWith('Assessment finished: Quality Assessed.');
    });

    it('409 ASSESSMENT_FIELD_ESCALATED: a message by code next to the control (not the raw text), and the choices are read again', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FIELD_ESCALATED', 'raw server text'));
      const outcome = await store.decide(41, 'agree_program', 'Right.');
      const message = 'Another comment on this field is escalated to TPB, so you cannot agree with the program here. Escalate this one or clear that escalation first.';
      expect(outcome).toEqual({ ok: false, message });
      expect(store.decisionErrors().get(41)).toBe(message);
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(toasts.error).not.toHaveBeenCalled();
    });

    it('409 ASSESSMENT_DECISION_INVALID: its own message, and the view is read again', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_DECISION_INVALID', 'raw server text'));
      await store.decide(41, 'agree_program', 'Right.');
      expect(store.decisionErrors().get(41)).toBe('This comment cannot take that decision now. The page now shows what it can take.');
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it('409 ASSESSMENT_FINISHED: someone ended it first; the page reads it again and says why next to the control', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'raw server text'));
      api.view.mockReturnValueOnce(of(endedRoundTwo('quality_assessed')));
      await store.decide(41, 'agree_program', 'Right.');
      expect(store.decisionErrors().get(41)).toBe('This review has already finished. The page now shows its final state.');
      expect(store.view()!.readOnlyReason).toBe('finished');
    });

    it('400 VALIDATION_FAILED: the field message of the server, no reload', async () => {
      api.decide.mockReturnValueOnce(
        throwError(
          () =>
            new ApiError({
              status: 400,
              code: 'VALIDATION_FAILED',
              message: 'The request is not valid.',
              fields: [{ field: 'body', code: 'too_long', message: 'Keep the comment within 2,000 characters.' }],
            }),
        ),
      );
      await store.decide(41, 'escalate', 'Escalate it.');
      expect(store.decisionErrors().get(41)).toBe('Keep the comment within 2,000 characters.');
      expect(api.view).not.toHaveBeenCalled();
    });

    it('a new attempt clears the error of that comment', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_DECISION_INVALID', 'raw'));
      await store.decide(41, 'escalate', 'Escalate it.');
      expect(store.decisionErrors().has(41)).toBe(true);
      await store.decide(41, 'escalate', 'Escalate it.');
      expect(store.decisionErrors().has(41)).toBe(false);
    });

    it('a successful decision clears the green-write error of its field', async () => {
      api.setValidations.mockReturnValueOnce(refusal(409, 'ASSESSMENT_CORE_COMMENT_UNDECIDED', 'raw', ['general.description']));
      await store.setValidated('general.description', true);
      await store.decide(41, 'agree_program', 'Right.');
      expect(store.fieldErrors().has('general.description')).toBe(false);
    });

    it('clear: DELETE, busy as "clear", then the view is read again', async () => {
      api.view.mockReturnValue(of(agreed));
      await store.load('9890', '29');
      api.view.mockClear();
      api.view.mockReturnValueOnce(of(roundTwoViewFixture()));
      const slow = new Subject<DecisionResult>();
      api.clearDecision.mockReturnValueOnce(slow);
      const cleared = store.clearDecision(41);
      expect(store.deciding()).toEqual({ commentId: 41, action: 'clear' });
      slow.next(decisionResultFixture({ decision: null, validations: [] }));
      slow.complete();
      expect(await cleared).toEqual({ ok: true });
      expect(api.clearDecision).toHaveBeenCalledWith(29, 9890, 41);
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(item(41).decision).toBeUndefined();
    });

    it('opening another result drops the errors of the one left behind', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_DECISION_INVALID', 'raw'));
      await store.decide(41, 'escalate', 'Escalate it.');
      api.deleteComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_COMMENT_NOT_DELETABLE', 'raw'));
      await store.deleteComment(41);
      await store.load('9891', '29');
      expect(store.decisionErrors().size).toBe(0);
      expect(store.deleteErrors().size).toBe(0);
    });

    describe('Finish and Check all for the Lead (tramo 5, contract § 4.2, § 4.3)', () => {
      const escalate = { decision: 'escalate' as const, body: 'TPB.', decidedAt: '2026-11-25T11:00:00.000Z' };
      /** Title grey (no carry), description escalated on its round-1 comment. */
      const escalatedView = () =>
        withThread({ decision: escalate }, [], withField('general.title', (f) => ({ ...f, effectiveValidated: false, carried: false })));

      it('409 ASSESSMENT_CORE_UNDECIDED: the undecided field keys come back and the view is read again', async () => {
        api.finish.mockReturnValueOnce(refusal(409, 'ASSESSMENT_CORE_UNDECIDED', 'raw server text', ['general.description']));
        const outcome = await store.finish();
        expect(outcome).toEqual({ ok: false, message: 'raw server text', code: 'ASSESSMENT_CORE_UNDECIDED', coreKeys: ['general.description'] });
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(toasts.error).not.toHaveBeenCalled();
      });

      it('Check all with an escalated core field sends the grey fields that are not escalated (fieldKeys), never all', async () => {
        api.view.mockReturnValue(of(escalatedView()));
        await store.load('9890', '29');
        await store.setAllValidated(true);
        expect(api.setValidations).toHaveBeenCalledTimes(1);
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, fieldKeys: ['general.title'] });
      });

      it('Check all with nothing left to validate (the rest is green or escalated) sends nothing and says so', async () => {
        api.view.mockReturnValue(of(withThread({ decision: escalate })));
        await store.load('9890', '29');
        expect(await store.setAllValidated(true)).toBe(false);
        expect(api.setValidations).not.toHaveBeenCalled();
        expect(toasts.info).toHaveBeenCalledWith('Every core field is already validated or escalated to TPB.');
      });

      it('Check all refused whole with ASSESSMENT_FIELD_ESCALATED (an escalate the page did not know): read again, then sent once with fieldKeys', async () => {
        // The page still shows nothing escalated; the server holds the description escalated.
        api.view.mockReturnValue(of(withField('general.title', (f) => ({ ...f, effectiveValidated: false, carried: false }))));
        await store.load('9890', '29');
        api.view.mockClear();
        api.view.mockReturnValue(of(escalatedView()));
        api.setValidations
          .mockReturnValueOnce(refusal(409, 'ASSESSMENT_FIELD_ESCALATED', 'raw'))
          .mockReturnValueOnce(of(summary({ validations: [{ fieldKey: 'general.title', validated: true }] })));
        expect(await store.setAllValidated(true)).toBe(true);
        expect(api.view).toHaveBeenCalled();
        expect(api.setValidations.mock.calls.map((c) => c[2])).toEqual([
          { validated: true, all: true },
          { validated: true, fieldKeys: ['general.title'] },
        ]);
        expect(toasts.error).not.toHaveBeenCalled();
      });

      it('Uncheck all is never refused by an escalate: it stays one request for every field', async () => {
        api.view.mockReturnValue(of(escalatedView()));
        await store.load('9890', '29');
        await store.setAllValidated(false);
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: false, all: true });
      });

      it('round 1: Check all stays one request for every field', async () => {
        api.view.mockReturnValue(of(viewFixture()));
        await store.load('9890', '29');
        await store.setAllValidated(true);
        expect(api.setValidations).toHaveBeenCalledWith(29, 9890, { validated: true, all: true });
      });
    });

    describe("the Lead's own comment and the delete (tramo 4, contract § 3.2, § 4.4, § 4.5)", () => {
      const own = () => field('general.description').comments.find((c) => c.id === 8101)!;

      it("escalating its own comment paints the decision on the comment itself before the re-read lands", async () => {
        api.view.mockReturnValue(new Subject<AssessmentView>());
        api.decide.mockReturnValueOnce(
          of(decisionResultFixture({ validations: [], decision: { decision: 'escalate', body: 'Mine.', decidedAt: '2026-11-25T11:00:00.000Z' } })),
        );
        const outcome = store.decide(8101, 'escalate', 'Mine.');
        await Promise.resolve();
        await Promise.resolve();
        expect(api.decide).toHaveBeenCalledWith(29, 9890, 8101, 'escalate', 'Mine.');
        expect(own().decision?.decision).toBe('escalate');
        void outcome;
      });

      it('a comment added in round 2 reads the view again: its decidable / choices come only from the view', async () => {
        await store.addComment('general.title', 'The title is wrong.');
        expect(api.view).toHaveBeenCalledTimes(1);
      });

      it('withdrawing its own comment in round 2 reads the view again (a decision on it is dropped)', async () => {
        await store.withdrawComment(8101);
        expect(api.view).toHaveBeenCalledTimes(1);
      });

      it('delete: POST once, busy on that comment, then the view is read again', async () => {
        const slow = new Subject<AssessmentComment>();
        api.deleteComment.mockReturnValueOnce(slow);
        const deleted = store.deleteComment(41);
        expect(store.deleting()).toBe(41);
        // A second tap, on it or on another comment, sends nothing while the first is on its way.
        expect(await store.deleteComment(41)).toEqual({ ok: false, message: '' });
        expect(await store.deleteComment(8101)).toEqual({ ok: false, message: '' });
        slow.next(comment({ id: 41 }));
        slow.complete();
        expect(await deleted).toEqual({ ok: true });
        expect(api.deleteComment).toHaveBeenCalledTimes(1);
        expect(api.deleteComment).toHaveBeenCalledWith(41);
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(store.deleting()).toBeNull();
      });

      it('no delete while a decision is on its way, and no decision while a delete is', async () => {
        const slow = new Subject<DecisionResult>();
        api.decide.mockReturnValueOnce(slow);
        const deciding = store.decide(41, 'escalate', 'Escalate it.');
        expect(await store.deleteComment(41)).toEqual({ ok: false, message: '' });
        slow.next(decisionResultFixture());
        slow.complete();
        await deciding;
        const slowDelete = new Subject<AssessmentComment>();
        api.deleteComment.mockReturnValueOnce(slowDelete);
        const deleting = store.deleteComment(41);
        expect(await store.decide(41, 'escalate', 'Again.')).toEqual({ ok: false, message: '' });
        expect(await store.finish()).toEqual({ ok: false, message: '' });
        expect(await store.setValidated('general.description', false)).toBe(false);
        slowDelete.next(comment({ id: 41 }));
        slowDelete.complete();
        await deleting;
        expect(api.decide).toHaveBeenCalledTimes(1);
        expect(api.finish).not.toHaveBeenCalled();
      });

      it('a delete that ends the review: the re-read shows the end and a toast says so', async () => {
        api.view.mockReturnValueOnce(of(endedRoundTwo('quality_assessed')));
        await store.deleteComment(41);
        expect(store.view()!.writable).toBe(false);
        expect(toasts.success).toHaveBeenCalledWith('Assessment finished: Quality Assessed.');
      });

      it('409 ASSESSMENT_COMMENT_NOT_DELETABLE: a message by code next to the control, and the view is read again', async () => {
        api.deleteComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_COMMENT_NOT_DELETABLE', 'raw server text'));
        const outcome = await store.deleteComment(41);
        expect(outcome.ok).toBe(false);
        expect(store.deleteErrors().get(41)).toBe(
          'This comment can no longer be deleted: the program already answered it, or it was withdrawn or deleted. The page now shows it as it is.',
        );
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(toasts.error).not.toHaveBeenCalled();
        // The next try on that comment starts clean.
        await store.deleteComment(41);
        expect(store.deleteErrors().has(41)).toBe(false);
      });

      it('409 ASSESSMENT_FINISHED on a delete: someone ended it first; read again and said next to the control', async () => {
        api.deleteComment.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'raw'));
        await store.deleteComment(41);
        expect(store.deleteErrors().get(41)).toBe('This review has already finished. The page now shows its final state.');
        expect(api.view).toHaveBeenCalledTimes(1);
      });

      it('a delete whose answer never arrived reads the page again (the server may have done it)', async () => {
        api.deleteComment.mockReturnValueOnce(refusal(0, 'NETWORK', 'Could not reach the server.'));
        await store.deleteComment(41);
        expect(api.view).toHaveBeenCalledTimes(1);
        expect(store.deleteErrors().get(41)).toBe('Could not reach the server.');
      });
    });
  });
});
