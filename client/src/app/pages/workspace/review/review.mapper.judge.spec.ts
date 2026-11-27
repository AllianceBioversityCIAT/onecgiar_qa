// @akili-spec escalation/round-2
import { roundTwoViewFixture } from './review.round2-fixture';
import { closedPpuView, ppuItem, ppuViewFixture, tpbItem, tpbLeadOwnItem, tpbViewFixture } from './review.round2-judge-fixture';
import { escalatedUndecidedMessage, reviewerModeOf, toReviewVm } from './review.mapper';
import { viewFixture } from './review.api-fixture';
import type { AssessmentView } from '../../../core/api/assessment.models';

const ME = 1053;
const fieldOf = (vm: ReturnType<typeof toReviewVm>, label: string) => vm.sections[0].fields.find((f) => f.label === label)!;
const tpbProgram = { decision: 'tpb_agree_program' as const, body: 'The program is right.', decidedAt: '2026-11-30T10:00:00.000Z' };
const tpbAssessor = { decision: 'tpb_agree_assessor' as const, body: 'The assessor is right.', decidedAt: '2026-11-30T10:00:00.000Z' };

describe('reviewerModeOf: who reads a round-2 view (P2-3916, P2-3917)', () => {
  it('the Admin\'s acting role wins', () => {
    expect(reviewerModeOf(roundTwoViewFixture(), 'TPB', false)).toBe('tpb');
    expect(reviewerModeOf(roundTwoViewFixture(), 'PPU', true)).toBe('ppu');
    expect(reviewerModeOf(tpbViewFixture(), 'LEAD_ASSESSOR', false)).toBe('lead');
    expect(reviewerModeOf(viewFixture(), 'ASSESSOR', false)).toBe('assessor');
  });

  it('with no acting role, the thread tells it: tpbDecision = PPU, an item round or the Lead\'s ruling = TPB', () => {
    expect(reviewerModeOf(ppuViewFixture(), null, true)).toBe('ppu');
    expect(reviewerModeOf(tpbViewFixture(), null, true)).toBe('tpb');
    // After the TPB's finish (nothing decidable any more) the items still carry `round` / `leadDecision`.
    expect(reviewerModeOf(tpbViewFixture([tpbItem({ decidable: false, choices: [], decision: tpbProgram })]), null, false)).toBe('tpb');
  });

  it('a Lead view (no round on the items) is the Lead\'s when the caller holds the role; round 1 is the assessor\'s', () => {
    expect(reviewerModeOf(roundTwoViewFixture(), null, true)).toBe('lead');
    expect(reviewerModeOf(roundTwoViewFixture(), null, false)).toBe('assessor');
    expect(reviewerModeOf(viewFixture(), null, true)).toBe('assessor');
  });

  describe('header.reviewerRole (front contract § 9.1, DD-T11): the server says who reads the view', () => {
    const as = (view: AssessmentView, reviewerRole: string | null): AssessmentView => ({ ...view, header: { ...view.header, reviewerRole } as AssessmentView['header'] });

    it('the role wins over the thread, the Lead assignment and the acting role', () => {
      // A Lead + TPB on a TPB-shaped thread: the server says TPB.
      expect(reviewerModeOf(as(roundTwoViewFixture(), 'TPB'), null, true)).toBe('tpb');
      // The thread looks like a PPU's, the server says TPB (a Lead + TPB on a pending_ppu result reads TPB).
      expect(reviewerModeOf(as(ppuViewFixture(), 'TPB'), null, true)).toBe('tpb');
      // A TPB-shaped thread read by a Lead + TPB while the result is still Pending: the Lead.
      expect(reviewerModeOf(as(tpbViewFixture(), 'LEAD_ASSESSOR'), null, false)).toBe('lead');
      expect(reviewerModeOf(as(roundTwoViewFixture(), 'PPU'), 'TPB', true)).toBe('ppu');
      expect(reviewerModeOf(as(viewFixture(), 'ASSESSOR'), null, true)).toBe('assessor');
    });

    it('null (an Admin without Act as, or an acting role outside the round): no acting role nor Lead assignment, the thread only', () => {
      expect(reviewerModeOf(as(roundTwoViewFixture(), null), null, true)).toBe('assessor');
      expect(reviewerModeOf(as(roundTwoViewFixture(), null), 'LEAD_ASSESSOR', true)).toBe('assessor');
      expect(reviewerModeOf(as(tpbViewFixture(), null), null, false)).toBe('tpb');
    });

    it('absent (an older server) or unknown: the old inference', () => {
      expect(reviewerModeOf(roundTwoViewFixture(), null, true)).toBe('lead');
      expect(reviewerModeOf(as(roundTwoViewFixture(), 'SOMETHING_NEW'), null, true)).toBe('lead');
    });
  });
});

describe('toReviewVm for the TPB (P2-3916, step 4)', () => {
  const vm = (view = tpbViewFixture()) => toReviewVm(view, true, ME, 'tpb');

  it('the cards are read only: no check, no undo, no comment button; no Check all; Finish is offered', () => {
    const page = vm();
    for (const f of page.sections[0].fields) expect(f.actions).toBeNull();
    expect(page.canValidate).toBe(false);
    expect(page.canFinish).toBe(true);
    expect(page.tracksOpen).toBe(true);
    expect(page.header.instructions).toBe(
      'Decide each comment the Lead escalated: side with the program or with the assessor, and say why. Finish when every one is decided.',
    );
    expect(page.header.locked).toBe(false);
    expect(page.threadTitle).toBe('Escalated comments');
  });

  it('each escalated item shows the Lead\'s reason, offers exactly the two choices and asks for a reason', () => {
    const [assessor, lead] = fieldOf(vm(), 'Description of Result').leadThread;
    expect(assessor.mode).toBe('tpb');
    expect(assessor.own).toBe(false);
    expect(assessor.lead).toEqual({ label: 'Escalated to TPB by the Lead', text: 'TPB should check the evidence.', date: '25 Nov 2026' });
    expect(assessor.tpb).toBeNull();
    expect(assessor.choices).toEqual([
      { kind: 'tpb_agree_program', label: 'Agree with the program' },
      { kind: 'tpb_agree_assessor', label: 'Agree with the assessor' },
    ]);
    expect(assessor.noteOptional).toBe(false);
    expect(assessor.pending).toBe(true);
    expect(assessor.agreeEnds).toBe(false);
    expect(assessor.canDelete).toBe(false);
    // Round 2 = the Lead's own comment.
    expect(lead.own).toBe(true);
    expect(lead.lead?.text).toBe('Escalating my own finding.');
  });

  it('while an escalated item is undecided, Finish is blocked and names the field; counts follow the escalated fields only', () => {
    const page = vm();
    expect(page.total).toBe(1);
    expect(page.resolved).toBe(0);
    expect(page.finishTo).toBe('');
    expect(page.finishBlockedBy).toEqual(['Description of Result']);
    expect(page.sections[0].open).toBe(1);
    expect(escalatedUndecidedMessage(page.finishBlockedBy)).toBe('Decide the escalated comments first on: Description of Result.');
    expect(escalatedUndecidedMessage([])).toBe('');
  });

  it('every item on the program side: Finish gives Quality Assessed; one on the assessor side: Pending PPU', () => {
    const allProgram = vm(tpbViewFixture([tpbItem({ decision: tpbProgram }), tpbLeadOwnItem({ decision: tpbProgram })]));
    expect(allProgram.finishBlockedBy).toEqual([]);
    expect(allProgram.resolved).toBe(1);
    expect(allProgram.finishTo).toBe('Quality Assessed');
    const oneAssessor = vm(tpbViewFixture([tpbItem({ decision: tpbProgram }), tpbLeadOwnItem({ decision: tpbAssessor })]));
    expect(oneAssessor.finishTo).toBe('Pending PPU');
    const decided = fieldOf(oneAssessor, 'Description of Result').leadThread[1];
    expect(decided.decision).toEqual({ kind: 'tpb_agree_assessor', label: 'Agreed with the assessor', text: 'The assessor is right.', date: '30 Nov 2026' });
    expect(decided.pending).toBe(false);
  });

  it('after the TPB\'s finish (read only, nothing decidable) no control is offered and the banner says who finished', () => {
    const page = vm(
      tpbViewFixture([tpbItem({ decidable: false, choices: [], decision: tpbAssessor })], {
        writable: false,
        readOnlyReason: 'finished',
        header: { ...tpbViewFixture().header, status: 'pending_ppu' },
        assessment: { status: 'escalated', assessedBy: { id: 30, nickname: 'tom' }, finishedAt: '2026-11-30T12:00:00.000Z' },
      }),
    );
    expect(page.canFinish).toBe(false);
    expect(page.tracksOpen).toBe(false);
    expect(fieldOf(page, 'Description of Result').leadThread[0].choices).toEqual([]);
    expect(page.banner).toBe('Finished by tom on 30 Nov 2026.');
    expect(page.header.status).toBe('Pending PPU');
  });
});

describe('toReviewVm for the PPU (P2-3917, step 5)', () => {
  const vm = (view = ppuViewFixture()) => toReviewVm(view, true, ME, 'ppu');

  it('no check, no comment, no Check all and no Finish; the open cases are still counted', () => {
    const page = vm();
    for (const f of page.sections[0].fields) expect(f.actions).toBeNull();
    expect(page.canValidate).toBe(false);
    expect(page.canFinish).toBe(false);
    expect(page.tracksOpen).toBe(true);
    expect(page.total).toBe(1);
    expect(page.resolved).toBe(0);
    expect(page.threadTitle).toBe('Cases');
    expect(page.header.instructions).toBe(
      'Close each case the TPB sided with the assessor: mark it as done once it is solved. The last one closes the result as Quality Assessed.',
    );
  });

  it('a case shows the Lead\'s escalation and the TPB\'s decision, and offers Done with an optional note', () => {
    const [item] = fieldOf(vm(), 'Description of Result').leadThread;
    expect(item.mode).toBe('ppu');
    expect(item.lead?.label).toBe('Escalated to TPB by the Lead');
    expect(item.tpb).toEqual({ label: 'TPB sided with the assessor', text: 'The assessor is right.', date: '30 Nov 2026' });
    expect(item.choices).toEqual([{ kind: 'ppu_done', label: 'Mark as done' }]);
    expect(item.noteOptional).toBe(true);
    expect(item.pending).toBe(true);
  });

  it('a Done case still offers its undo while the result is open (decidable stays true) and counts as resolved', () => {
    const page = vm(ppuViewFixture([ppuItem({ decision: { decision: 'ppu_done', body: 'Fixed.', decidedAt: '2026-12-04T09:00:00.000Z' } })]));
    const [item] = fieldOf(page, 'Description of Result').leadThread;
    expect(item.decision?.label).toBe('Done');
    expect(item.choices.length).toBe(1);
    expect(item.pending).toBe(false);
    expect(page.resolved).toBe(1);
  });

  it('"Changed in Reporting Tool on <date>" on the field the Reporting value moved', () => {
    const f = fieldOf(vm(), 'Description of Result');
    expect(f.states.map((s) => s.label)).toContain('Changed in Reporting Tool on 03 Dec 2026');
    expect(fieldOf(vm(), 'Title of Result').states.map((s) => s.label).some((l) => l.startsWith('Changed in Reporting'))).toBe(false);
  });

  it('closed by the last Done: read only, and the banner says the result is Quality Assessed', () => {
    const page = vm(closedPpuView());
    expect(page.tracksOpen).toBe(false);
    expect(fieldOf(page, 'Description of Result').leadThread[0].choices).toEqual([]);
    expect(page.banner).toBe('Every case is done: pat closed the result as Quality Assessed on 04 Dec 2026.');
  });
});

describe('toReviewVm: the Lead and the assessor keep their page (regression)', () => {
  it('the Lead still gets Check all, Finish and its thread title', () => {
    const page = toReviewVm(roundTwoViewFixture(), true, ME, true);
    expect(page.canValidate).toBe(true);
    expect(page.canFinish).toBe(true);
    expect(page.threadTitle).toBe('Round 1 comments');
    const [item] = page.sections[0].fields.find((f) => f.label === 'Description of Result')!.leadThread;
    expect(item.mode).toBe('lead');
    expect(item.lead).toBeNull();
    expect(item.noteOptional).toBe(false);
  });

  it('round 1: Check all and Finish as before', () => {
    const page = toReviewVm(viewFixture(), true, ME);
    expect(page.canValidate).toBe(true);
    expect(page.canFinish).toBe(true);
    expect(page.tracksOpen).toBe(true);
  });
});
