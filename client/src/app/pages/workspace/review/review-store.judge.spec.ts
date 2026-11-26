// @akili-spec escalation/round-2
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ActingRoleState } from '../../../core/api/acting-role';
import { AssessmentApi } from '../../../core/api/assessment-api';
import {
  AssessmentView,
  CommentThread,
  DecisionKind,
  DecisionResult,
  QuickComment,
  ValidationSummary,
} from '../../../core/api/assessment.models';
import { AuthSession } from '../../../core/auth/auth-session';
import { ApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { ReviewStore } from './review-store';
import { closedPpuView, judgeDecisionResult, ppuViewFixture, tpbItem, tpbLeadOwnItem, tpbViewFixture } from './review.round2-judge-fixture';

const refusal = (status: number, code: string, message: string) => throwError(() => new ApiError({ status, code, message }));

class FakeApi {
  view = vi.fn<(t: number, c: number) => Observable<AssessmentView>>(() => of(tpbViewFixture()));
  decide = vi.fn<(t: number, c: number, id: number, d: DecisionKind, body: string | null) => Observable<DecisionResult>>(() => of(judgeDecisionResult()));
  clearDecision = vi.fn<(t: number, c: number, id: number) => Observable<DecisionResult>>(() => of(judgeDecisionResult({ decision: null })));
  finish = vi.fn<(t: number, c: number) => Observable<ValidationSummary>>(() =>
    of({ status: 'escalated', assessedBy: { id: 30, nickname: 'tom' }, finishedAt: '2026-11-30T12:00:00.000Z', validations: [] }),
  );
  quickComments = vi.fn<(role: string) => Observable<readonly QuickComment[]>>(() => of([]));
  programResponses = vi.fn<(t: number, c: number) => Observable<readonly CommentThread[]>>(() => of([]));
}

describe('ReviewStore: the TPB and the PPU (P2-3916, P2-3917)', () => {
  let api: FakeApi;
  let toasts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let store: ReviewStore;
  /** A TPB with no Lead role: the view's thread says who reads it. */
  const user = signal<{ id: number; assignments: readonly { role: string; resultTypeKey?: string }[] }>({ id: 30, assignments: [{ role: 'TPB' }] });

  beforeEach(() => {
    api = new FakeApi();
    toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ReviewStore,
        { provide: AssessmentApi, useValue: api },
        { provide: Toasts, useValue: toasts },
        { provide: AuthSession, useValue: { user } },
      ],
    });
    store = TestBed.inject(ReviewStore);
  });

  describe('header.reviewerRole (front contract § 9.1, DD-T11)', () => {
    afterEach(() => user.set({ id: 30, assignments: [{ role: 'TPB' }] }));

    it('a Lead + TPB on an escalated result reads it as the TPB, read only until step 4 opens: no Lead delete, no write offered', async () => {
      user.set({ id: 30, assignments: [{ role: 'LEAD_ASSESSOR' }, { role: 'TPB' }] });
      const base = tpbViewFixture([tpbItem({ decidable: false, choices: [] })]);
      api.view.mockReturnValue(
        of({ ...base, writable: false, readOnlyReason: 'step_upcoming', header: { ...base.header, status: 'pending_tpb_review', reviewerRole: 'TPB' } }),
      );
      await store.load('9890', '29');
      expect(store.mode()).toBe('tpb');
      expect(store.leadCaller()).toBe(false);
      expect(store.vm()!.canFinish).toBe(false);
    });

    it("a Lead + TPB on a Pending PPU result reads TPB (the furthest role held), even though the thread is a PPU's", async () => {
      user.set({ id: 30, assignments: [{ role: 'LEAD_ASSESSOR' }, { role: 'TPB' }] });
      const base = closedPpuView();
      api.view.mockReturnValue(of({ ...base, header: { ...base.header, reviewerRole: 'TPB' } }));
      await store.load('9890', '29');
      expect(store.mode()).toBe('tpb');
    });
  });

  describe('the TPB', () => {
    beforeEach(async () => {
      await store.load('9890', '29');
      api.view.mockClear();
    });

    it('reads the view as the TPB: no Lead delete, the page model in TPB mode', () => {
      expect(store.mode()).toBe('tpb');
      expect(store.leadCaller()).toBe(false);
      expect(store.vm()!.mode).toBe('tpb');
    });

    it('a TPB decision needs its reason: an empty one sends nothing and says why next to the control', async () => {
      expect(await store.decide(41, 'tpb_agree_program', '  ')).toEqual({ ok: false, message: 'Write a comment before saving the decision.' });
      expect(api.decide).not.toHaveBeenCalled();
    });

    it('a TPB decision goes with its trimmed reason and the view is read again (the green follows effectiveValidated)', async () => {
      expect((await store.decide(41, 'tpb_agree_assessor', '  The assessor is right. ')).ok).toBe(true);
      expect(api.decide).toHaveBeenCalledWith(29, 9890, 41, 'tpb_agree_assessor', 'The assessor is right.');
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it('a second tap while a decision is on its way sends nothing', async () => {
      const slow = new Subject<DecisionResult>();
      api.decide.mockReturnValueOnce(slow);
      const first = store.decide(41, 'tpb_agree_program', 'Right.');
      expect((await store.decide(41, 'tpb_agree_program', 'Right.')).ok).toBe(false);
      slow.next(judgeDecisionResult());
      slow.complete();
      await first;
      expect(api.decide).toHaveBeenCalledTimes(1);
    });

    it('step 4 closed: the refusal names the TPB step, next to the control, and the view is read again', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_STEP_CLOSED', 'raw'));
      await store.decide(41, 'tpb_agree_program', 'Right.');
      expect(store.decisionErrors().get(41)).toBe('The TPB step is closed, so decisions can no longer change.');
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it('Finish ending `escalated` says Pending PPU (not Pending for TPB review)', async () => {
      api.view.mockReturnValueOnce(
        of(tpbViewFixture([tpbItem({ decidable: false, choices: [] }), tpbLeadOwnItem({ decidable: false, choices: [] })], { writable: false, readOnlyReason: 'finished' })),
      );
      expect((await store.finish()).ok).toBe(true);
      expect(toasts.success).toHaveBeenCalledWith('Assessment finished: Pending PPU.');
    });

    it('Finish refused with ASSESSMENT_CORE_UNDECIDED reads the view again and returns the field keys', async () => {
      api.finish.mockReturnValueOnce(throwError(() => new ApiError({ status: 409, code: 'ASSESSMENT_CORE_UNDECIDED', message: 'raw', fields: ['general.description'] })));
      const outcome = await store.finish();
      expect(outcome).toEqual({ ok: false, message: 'raw', code: 'ASSESSMENT_CORE_UNDECIDED', coreKeys: ['general.description'] });
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it("the quick comments are the TPB's list", async () => {
      await store.loadQuickComments();
      expect(api.quickComments).toHaveBeenCalledWith('TPB');
    });
  });

  describe('the PPU', () => {
    beforeEach(async () => {
      api.view.mockReturnValue(of(ppuViewFixture()));
      await store.load('9890', '29');
      api.view.mockClear();
    });

    it('reads the view as the PPU', () => {
      expect(store.mode()).toBe('ppu');
      expect(store.vm()!.canFinish).toBe(false);
    });

    it('Done with no note sends no body; with a note sends it trimmed', async () => {
      api.decide.mockReturnValue(of(judgeDecisionResult({ decision: { decision: 'ppu_done', body: null, decidedAt: '2026-12-04T09:00:00.000Z' } })));
      expect((await store.decide(41, 'ppu_done', '   ')).ok).toBe(true);
      expect(api.decide).toHaveBeenLastCalledWith(29, 9890, 41, 'ppu_done', null);
      expect((await store.decide(41, 'ppu_done', ' Fixed in Reporting. ')).ok).toBe(true);
      expect(api.decide).toHaveBeenLastCalledWith(29, 9890, 41, 'ppu_done', 'Fixed in Reporting.');
    });

    it('a note over 2,000 characters sends nothing', async () => {
      expect((await store.decide(41, 'ppu_done', 'x'.repeat(2001))).ok).toBe(false);
      expect(api.decide).not.toHaveBeenCalled();
    });

    it('the last Done closes the result: read only at once, the view read again, and a notice says so', async () => {
      api.decide.mockReturnValueOnce(
        of(
          judgeDecisionResult({
            status: 'quality_assessed',
            assessedBy: { id: 90, nickname: 'pat' },
            finishedAt: '2026-12-04T10:00:00.000Z',
            decision: { decision: 'ppu_done', body: null, decidedAt: '2026-12-04T10:00:00.000Z' },
          }),
        ),
      );
      api.view.mockReturnValueOnce(of(closedPpuView()));
      expect((await store.decide(41, 'ppu_done', '')).ok).toBe(true);
      expect(store.view()!.writable).toBe(false);
      expect(store.view()!.readOnlyReason).toBe('finished');
      expect(api.view).toHaveBeenCalled();
      expect(toasts.success).toHaveBeenCalledWith('Every case is done: the result is now Quality Assessed.');
      expect(store.vm()!.banner).toBe('Every case is done: pat closed the result as Quality Assessed on 04 Dec 2026.');
    });

    it('Undo clears the Done (DELETE) and reads the view again', async () => {
      expect((await store.clearDecision(41)).ok).toBe(true);
      expect(api.clearDecision).toHaveBeenCalledWith(29, 9890, 41);
      expect(api.view).toHaveBeenCalledTimes(1);
    });

    it('a Done after the result closed elsewhere (409 ASSESSMENT_FINISHED) says so next to the control', async () => {
      api.decide.mockReturnValueOnce(refusal(409, 'ASSESSMENT_FINISHED', 'raw'));
      api.view.mockReturnValueOnce(of(closedPpuView()));
      await store.decide(41, 'ppu_done', '');
      expect(store.decisionErrors().get(41)).toBe('This result is already closed. The page now shows its final state.');
      expect(store.view()!.writable).toBe(false);
    });
  });

  describe('the Admin acting as TPB or PPU', () => {
    it('acts as TPB when the result offers it: the header role is TPB and the page is in TPB mode', async () => {
      api.view.mockReturnValue(of(tpbViewFixture(undefined, { actingRoles: ['TPB'], actingRole: null, writable: false, readOnlyReason: 'admin_read_only' })));
      await store.load('9890', '29');
      api.view.mockReturnValue(of(tpbViewFixture(undefined, { actingRoles: ['TPB'], actingRole: 'TPB' })));
      await store.actAs('TPB');
      expect(TestBed.inject(ActingRoleState).pick()?.role).toBe('TPB');
      expect(store.mode()).toBe('tpb');
    });
  });
});
