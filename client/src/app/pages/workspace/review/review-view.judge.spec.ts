// @akili-spec escalation/round-2
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of } from 'rxjs';
import { AiSuggestionsApi } from '../../../core/api/ai-suggestions-api';
import { AiSuggestionEvent, AiSuggestionView } from '../../../core/api/ai-suggestions.models';
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
import { Toasts } from '../../../core/http/toasts';
import { ReviewView } from './review-view';
import { judgeDecisionResult, ppuItem, ppuViewFixture, tpbItem, tpbLeadOwnItem, tpbViewFixture } from './review.round2-judge-fixture';

class FakeApi {
  view = vi.fn<(t: number, c: number) => Observable<AssessmentView>>(() => of(tpbViewFixture()));
  timelines = vi.fn(() => of({ timelines: [], defaultTimelineId: 29, timeZone: 'Europe/Rome' as const }));
  decide = vi.fn<(t: number, c: number, id: number, d: DecisionKind, body: string | null) => Observable<DecisionResult>>(() => of(judgeDecisionResult()));
  clearDecision = vi.fn<(t: number, c: number, id: number) => Observable<DecisionResult>>(() => of(judgeDecisionResult({ decision: null })));
  finish = vi.fn<(t: number, c: number) => Observable<ValidationSummary>>(() => of({ status: 'escalated', assessedBy: null, finishedAt: null, validations: [] }));
  quickComments = vi.fn<(role: string) => Observable<readonly QuickComment[]>>(() => of([]));
  programResponses = vi.fn<(t: number, c: number) => Observable<readonly CommentThread[]>>(() => of([]));
  setValidations = vi.fn();
  addComment = vi.fn();
}

class FakeAiApi {
  list = vi.fn<(t: number, c: number) => Observable<readonly AiSuggestionView[]>>(() => of([]));
  sendEvent = vi.fn<(t: number, c: number, id: string, e: AiSuggestionEvent) => Observable<void>>(() => of(undefined));
}

const SUGGESTION: AiSuggestionView = {
  status: 'available',
  fieldKey: 'general.description',
  suggestionId: 's1',
  signal: 'red',
  valueKind: 'level',
  suggestedValue: 0,
  explanation: 'The description names an activity, not a change.',
  evidenceQuote: 'trained farmers',
  quoteVerified: true,
  evidenceSource: null,
  promptVersion: 'v2-1.0.0',
  modelId: 'anthropic.claude-haiku-5-5',
};

const tpbProgram = { decision: 'tpb_agree_program' as const, body: 'Program.', decidedAt: '2026-11-30T10:00:00.000Z' };
const tpbAssessor = { decision: 'tpb_agree_assessor' as const, body: 'Assessor.', decidedAt: '2026-11-30T10:00:00.000Z' };

describe('ReviewView for the TPB and the PPU (P2-3916, P2-3917)', () => {
  let api: FakeApi;
  let ai: FakeAiApi;
  let harness: RouterTestingHarness;

  const open = async () => {
    harness = await RouterTestingHarness.create('/results/9890?timeline=29');
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      harness.detectChanges();
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttons = (el: Element) => [...el.querySelectorAll('button')];
  const byName = (el: Element, name: string) => buttons(el).find((b) => (b.getAttribute('aria-label') ?? text(b)) === name);
  const card = (el: Element, label: string) => [...el.querySelectorAll('qa-review-field-card')].find((c) => text(c).startsWith(label))!;
  const thread = (el: Element) => card(el, 'Description of Result').querySelector('[data-testid="lead-thread"]')!;
  const footer = (el: Element) => el.querySelector('qa-review-footer')!;
  const write = (id: number, value: string) => {
    const box = document.querySelector<HTMLTextAreaElement>(`#lead-decision-${id}`)!;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    harness.detectChanges();
  };

  beforeEach(() => {
    api = new FakeApi();
    ai = new FakeAiApi();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'results', children: [] },
          { path: 'results/:code', component: ReviewView },
        ]),
        { provide: AssessmentApi, useValue: api },
        { provide: AiSuggestionsApi, useValue: ai },
        { provide: AuthSession, useValue: { user: signal({ id: 30, assignments: [{ role: 'TPB' }] }) } },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn(), bottomOffset: signal(null) } },
      ],
    });
  });

  describe('the TPB (step 4)', () => {
    it('no check, no Check all, no comment button: the escalated items with the Lead\'s reason and the two choices', async () => {
      const el = await open();
      expect(byName(el, 'Check all')).toBeUndefined();
      const description = card(el, 'Description of Result');
      expect(byName(description, 'Add comment for Description of Result')).toBeUndefined();
      expect(buttons(description).some((b) => /Approve|Validate/.test(text(b)))).toBe(false);
      const t = thread(el);
      expect(text(t)).toContain('Escalated comments');
      expect(text(t)).toContain('Escalated to TPB by the Lead');
      expect(text(t)).toContain('TPB should check the evidence.');
      expect(text(t)).toContain('lea · Lead assessor');
      expect(byName(t, 'Side with the program')).toBeDefined();
      expect(byName(t, 'Side with the assessor')).toBeDefined();
    });

    it('a reason is required; Save sends the TPB decision with it, spinning while on its way (one write)', async () => {
      const slow = new Subject<DecisionResult>();
      api.decide.mockReturnValueOnce(slow);
      const el = await open();
      byName(thread(el), 'Side with the assessor')!.click();
      harness.detectChanges();
      expect(text(thread(el))).toContain('Why side with the assessor?');
      byName(thread(el), 'Save decision')!.click();
      await settle();
      expect(api.decide).not.toHaveBeenCalled();
      expect(text(thread(el).querySelector('[role="alert"]')!)).toBe('Write a comment before saving the decision.');
      write(41, 'The evidence backs the assessor.');
      const save = byName(thread(el), 'Save decision')!;
      save.click();
      harness.detectChanges();
      expect(save.getAttribute('aria-busy')).toBe('true');
      save.click();
      slow.next(judgeDecisionResult({ decision: tpbAssessor }));
      slow.complete();
      await settle();
      expect(api.decide).toHaveBeenCalledTimes(1);
      expect(api.decide).toHaveBeenCalledWith(29, 9890, 41, 'tpb_agree_assessor', 'The evidence backs the assessor.');
    });

    it('Finish while an escalated item is undecided names the field and offers no finish', async () => {
      const el = await open();
      byName(el, 'Finish assessment')!.click();
      await settle();
      byName(el, 'Finish anyway')!.click();
      await settle();
      expect(text(footer(el).querySelector('[role="alert"]')!)).toBe('Decide the escalated comments first on: Description of Result.');
      expect(byName(footer(el), 'Finish assessment')!.disabled).toBe(true);
    });

    it('every item decided, one with the assessor: the confirm step says Pending PPU', async () => {
      api.view.mockReturnValue(of(tpbViewFixture([tpbItem({ decision: tpbProgram }), tpbLeadOwnItem({ decision: tpbAssessor })])));
      const el = await open();
      byName(el, 'Finish assessment')!.click();
      await settle();
      expect(text(el.querySelector('[role="alertdialog"]')!)).toContain('The result becomes Pending PPU. This cannot be undone.');
    });

    it('the AI suggestion is read only: no "Copy to comment", and no usage event is sent', async () => {
      ai.list.mockReturnValue(of([SUGGESTION]));
      const el = await open();
      await settle();
      expect(byName(card(el, 'Description of Result'), 'Copy to comment')).toBeUndefined();
      expect(ai.sendEvent).not.toHaveBeenCalled();
    });
  });

  describe('the PPU (step 5)', () => {
    beforeEach(() => api.view.mockReturnValue(of(ppuViewFixture())));

    it('no Finish and no AI; the case shows the Lead\'s and the TPB\'s decisions and the Reporting change', async () => {
      ai.list.mockReturnValue(of([SUGGESTION]));
      const el = await open();
      expect(byName(el, 'Finish assessment')).toBeUndefined();
      expect(byName(el, 'Check all')).toBeUndefined();
      expect(ai.list).not.toHaveBeenCalled();
      expect(card(el, 'Description of Result').querySelector('qa-ai-chip')).toBeNull();
      expect(text(card(el, 'Description of Result'))).toContain('Changed in Reporting Tool on 03 Dec 2026');
      const t = thread(el);
      expect(text(t)).toContain('Cases');
      expect(text(t)).toContain('TPB sided with the assessor');
      expect(text(t)).toContain('The assessor is right.');
      expect(text(t)).toContain('Escalated to TPB by the Lead');
      expect(text(footer(el))).toContain('1 field needs your attention');
    });

    it('Done takes an optional note: an empty one sends the Done with no body', async () => {
      const el = await open();
      byName(thread(el), 'Mark as done')!.click();
      harness.detectChanges();
      expect(text(thread(el))).toContain('Note (optional)');
      byName(thread(el), 'Mark as done')!.click();
      await settle();
      expect(api.decide).toHaveBeenCalledWith(29, 9890, 41, 'ppu_done', null);
    });

    it('a Done case offers Undo (not Change), which clears it', async () => {
      api.view.mockReturnValue(of(ppuViewFixture([ppuItem({ decision: { decision: 'ppu_done', body: 'Fixed.', decidedAt: '2026-12-04T09:00:00.000Z' } })])));
      const el = await open();
      expect(text(thread(el))).toContain('Done');
      expect(byName(thread(el), 'Change')).toBeUndefined();
      byName(thread(el), 'Undo')!.click();
      await settle();
      expect(api.clearDecision).toHaveBeenCalledWith(29, 9890, 41);
    });
  });
});
