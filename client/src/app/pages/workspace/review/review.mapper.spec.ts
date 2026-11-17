// @akili-spec assessment/step-1-assessment
import { FieldVm } from './review-model';
import { comment, field, viewFixture } from './review.api-fixture';
import { formatValue, readOnlyBanner, toCommentVm, toFieldVm, toReviewVm } from './review.mapper';

const byLabel = (fields: readonly FieldVm[], label: string): FieldVm => fields.find((f) => f.label === label)!;
const chipLabels = (f: FieldVm): string[] => f.states.map((s) => s.label);

describe('review.mapper (API assessment view → Review view models)', () => {
  describe('sections (FR-8)', () => {
    it('keeps the API section order, the ToC group in place, and "Other fields" last, read only', () => {
      const vm = toReviewVm(viewFixture());
      expect(vm.sections.map((s) => s.name)).toEqual(['General information', 'Theory of Change', 'Geographic location', 'Other fields']);
      expect(vm.sections.map((s) => s.isToc)).toEqual([false, true, false, false]);
      const other = vm.sections[3].fields[0];
      expect(other.isView).toBe(true);
      expect(other.actions).toBeNull();
      expect(other.value).toBe('kept');
    });

    it('counts per section the Assessed fields still neither green nor commented, and the page totals', () => {
      const vm = toReviewVm(viewFixture());
      // general: title green, description commented → 0; ToC: toc.entries grey → 1; geo: countries + regions grey → 2.
      expect(vm.sections.map((s) => s.open)).toEqual([0, 1, 2, 0]);
      expect([vm.resolved, vm.total, vm.commented]).toEqual([2, 5, 1]);
      expect(vm.canFinish).toBe(true);
    });
  });

  describe('view vs assessed, Core tag (FR-9)', () => {
    const general = () => toReviewVm(viewFixture()).sections[0].fields;

    it('a View only field has the value only: no validation mark, no comment action, no Core tag', () => {
      const f = byLabel(general(), 'Result code');
      expect(f.isView).toBe(true);
      expect(f.states).toEqual([]);
      expect(f.actions).toBeNull();
      expect(f.isCore).toBe(false);
      expect(f.value).toBe('9890');
    });

    it('an Assessed field carries the green or grey mark by name, and the Core tag only when core', () => {
      const title = byLabel(general(), 'Title of Result');
      const description = byLabel(general(), 'Description of Result');
      expect(chipLabels(title)).toEqual(['Validated']);
      expect(title.states[0].kind).toBe('ok');
      expect(title.isCore).toBe(true);
      expect(chipLabels(description)).toEqual(['Not validated', 'Commented']);
      expect(description.states[0].kind).toBe('not');
      expect(description.isCore).toBe(false);
    });

    it('a core flag on a View only field never shows the Core tag', () => {
      expect(toFieldVm(field({ key: 'k', label: 'K', mode: 'view', core: true }), true).isCore).toBe(false);
    });

    it('withdrawn comments leave the count', () => {
      expect(byLabel(general(), 'Description of Result').states[1].count).toBe(1);
      expect(byLabel(general(), 'Description of Result').actions?.count).toBe(1);
    });

    it('writable: Approve on a grey field, Undo on a green one, Add/View comments', () => {
      const title = byLabel(general(), 'Title of Result').actions!;
      const description = byLabel(general(), 'Description of Result').actions!;
      expect([title.approve, title.undo, title.secondaryLabel]).toEqual([false, 'approval', 'Add comment']);
      expect([description.approve, description.undo, description.secondaryLabel]).toEqual([true, null, 'View comments']);
    });

    it('read only (FR-2): no Approve or Undo; "View comments" only where there are comments', () => {
      const fields = toReviewVm(viewFixture({ writable: false, readOnlyReason: 'step_closed' })).sections[0].fields;
      expect(byLabel(fields, 'Title of Result').actions).toBeNull();
      const description = byLabel(fields, 'Description of Result').actions!;
      expect([description.approve, description.undo, description.secondaryLabel]).toEqual([false, null, 'View comments']);
    });

    it('AI is not connected: every card has ai null', () => {
      const vm = toReviewVm(viewFixture());
      const cards = vm.sections.flatMap((s) => [...s.fields, ...(s.toc?.groups.flatMap((g) => g.items) ?? [])]);
      expect(cards.length).toBeGreaterThan(5);
      expect(cards.every((c) => c.ai === null)).toBe(true);
    });
  });

  describe('Theory of Change groups (FR-9, OQ-7)', () => {
    const toc = () => toReviewVm(viewFixture()).sections[1].toc!;

    it('shows every contribution: one card per toc.entries item and a group per contributing program', () => {
      const t = toc();
      expect(t.groups.map((g) => [g.name, g.showHead, g.items.length])).toEqual([
        ['', false, 3],
        ['SP06 Climate Action', true, 1],
      ]);
      expect(t.count).toBe(3);
      expect(t.programs).toBe(1);
      expect(t.reviewed).toBe(0);
    });

    it('a contribution card carries the level chip, the labelled chain, contribution and target', () => {
      const [, first, second] = toc().groups[0].items;
      expect(first.eyebrow).toBe('Contribution 1');
      expect(first.levelChip).toBe('Outcome');
      expect(first.links.map((l) => [l.label, l.value])).toEqual([
        ['Level', 'Outcome'],
        ['Output/Outcome', 'Seed policy adopted'],
        ['KPI statement', '9001'],
      ]);
      expect([first.contrib, first.target]).toEqual([4, 10]);
      // A null label shows the id (FR-20).
      expect(second.links.find((l) => l.label === 'Output/Outcome')?.value).toBe('802');
      expect(second.links.find((l) => l.label === 'High Level Output Statement')?.value).toBe('More seed sold');
    });

    it('the field mark and buttons sit on the first card of the field only', () => {
      const [answer, first, second] = toc().groups[0].items;
      expect(answer.id).toBe('toc.planned_result');
      expect(answer.states).toEqual([]);
      expect(answer.links).toEqual([{ label: 'Answer', code: '', value: 'Yes' }]);
      expect(first.id).toBe('toc.entries');
      expect(first.states.map((s) => s.label)).toEqual(['Not validated']);
      expect(first.actions?.approve).toBe(true);
      expect(second.id).toBe('toc.entries#1');
      expect(second.states).toEqual([]);
      expect(second.actions).toBeNull();
    });

    it('a program group lists the program answers, then its contributions', () => {
      const card = toc().groups[1].items[0];
      expect(card.links.map((l) => l.label)).toEqual(['Science Program', 'Identified in the ToC', 'Can this result be mapped to a ToC KPI?', 'Level', 'Output/Outcome']);
      expect(card.links[0].value).toBe('SP06 Climate Action');
      expect([card.contrib, card.target]).toEqual([2, 3]);
    });
  });

  describe('values and labels (FR-8, FR-20)', () => {
    it('labels when the snapshot has them, the id for a null label or no labels, "Not applicable" when absent', () => {
      const geo = toReviewVm(viewFixture()).sections[2].fields;
      expect(byLabel(geo, 'Countries').value).toBe('Colombia, 999');
      expect(byLabel(geo, 'Regions').value).toBe('1, 2');
      expect(byLabel(geo, 'Geographic scope').value).toBe('Not applicable');
    });

    it('booleans read Yes/No and empty values a dash', () => {
      expect(formatValue({ value: false, labels: null, notApplicable: false })).toBe('No');
      expect(formatValue({ value: null, labels: null, notApplicable: false })).toBe('—');
      expect(formatValue({ value: [], labels: null, notApplicable: false })).toBe('—');
    });
  });

  describe('header and read-only banner (FR-2, FR-23)', () => {
    it('header from the API: code, title, type, FR-5 status label, step and timeline in the details', () => {
      const h = toReviewVm(viewFixture()).header;
      expect([h.code, h.title, h.type, h.status]).toEqual(['9890', 'Seed systems for maize', 'Policy change', 'Pending']);
      expect(h.details).toEqual([
        { label: 'Science program', value: 'SP05 Better Diets and Nutrition' },
        { label: 'Timeline', value: 'Official timeline 2026' },
        { label: 'Step', value: 'Step 1 · Assessment' },
        { label: 'Assessed by', value: '—' },
      ]);
      expect(h.showAssessedBy).toBe(false);
    });

    it.each([
      ['admin_read_only', 'View only for admins'],
      ['step_upcoming', 'Step 1 · Assessment has not opened yet'],
      ['step_closed', 'Step 1 · Assessment is closed'],
      ['no_step', 'Your role has no step'],
    ] as const)('%s → banner "%s…"', (reason, text) => {
      expect(readOnlyBanner(reason, viewFixture())).toContain(text);
    });

    it('finished: "Finished by <nickname>", Assessed by shown, no finish offered', () => {
      const view = viewFixture({
        writable: false,
        readOnlyReason: 'finished',
        header: { ...viewFixture().header, status: 'quality_assessed' },
        assessment: { status: 'quality_assessed', assessedBy: { id: 1053, nickname: 'mchen' }, finishedAt: '2026-11-12T20:12:29.000Z' },
      });
      const vm = toReviewVm(view);
      expect(vm.banner).toBe('Finished by mchen on 12 Nov 2026.');
      expect(vm.header.status).toBe('Quality Assessed');
      expect(vm.header.showAssessedBy).toBe(true);
      expect(vm.header.assessor).toBe('mchen');
      expect(vm.canFinish).toBe(false);
    });

    it('an assessor with no nickname reads "—", never a name', () => {
      const view = viewFixture({ assessment: { status: 'returned', assessedBy: { id: 7, nickname: null }, finishedAt: null }, readOnlyReason: 'finished', writable: false });
      expect(toReviewVm(view).header.assessor).toBe('—');
      expect(readOnlyBanner('finished', view)).toBe('Finished by —.');
    });

    it('writable view: no banner', () => {
      expect(toReviewVm(viewFixture()).banner).toBeNull();
    });
  });

  it('a comment is shown by nickname only (or "—") with its date', () => {
    expect(toCommentVm(comment())).toMatchObject({ id: 1, authorId: 1053, who: 'mchen', role: 'Assessor', date: '12 Nov 2026', text: 'Add the evidence link.', open: true });
    expect(toCommentVm(comment({ author: { id: 9, nickname: null } })).who).toBe('—');
  });
});
