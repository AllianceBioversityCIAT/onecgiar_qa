// @akili-spec assessment/step-1-assessment
import { AssessmentField, AssessmentView } from '../../../core/api/assessment.models';
import { FieldVm } from './review-model';
import { clarificationThread, comment, field, programResponse, viewFixture } from './review.api-fixture';
import { roundTwoViewFixture, threadItem as threadItemOf, withThread } from './review.round2-fixture';
import { coreUncommentedMessage, coreUndecidedMessage, deleteOpen, findField, formatValue, pendingAnswers, pendingAnswersBanner, readOnlyBanner, returnsOnAnyComment, toCommentVm, toDrawerVm, toFieldVm, toReviewVm, withPendingAnswers, withdrawOpen } from './review.mapper';

const byLabel = (fields: readonly FieldVm[], label: string): FieldVm =>
  fields.find((f) => f.label === label)!;
const chipLabels = (f: FieldVm): string[] => f.states.map((s) => s.label);

describe('review.mapper (API assessment view → Review view models)', () => {
  describe('sections (FR-8)', () => {
    it('keeps the API section order, the ToC group in place, and "Other fields" last, read only', () => {
      const vm = toReviewVm(viewFixture());
      expect(vm.sections.map((s) => s.name)).toEqual([
        'General information',
        'Theory of Change',
        'Geographic location',
        'Other fields',
      ]);
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
      expect(
        toFieldVm(field({ key: 'k', label: 'K', mode: 'view', core: true }), true).isCore,
      ).toBe(false);
    });

    it('withdrawn comments leave the count', () => {
      expect(byLabel(general(), 'Description of Result').states[1].count).toBe(1);
      expect(byLabel(general(), 'Description of Result').actions?.count).toBe(1);
    });

    it('writable: Approve on a grey field, Undo on a green one, Add/View comments', () => {
      const title = byLabel(general(), 'Title of Result').actions!;
      const description = byLabel(general(), 'Description of Result').actions!;
      expect([title.approve, title.undo, title.secondaryLabel]).toEqual([
        false,
        'approval',
        'Add comment',
      ]);
      expect([description.approve, description.undo, description.secondaryLabel]).toEqual([
        true,
        null,
        'View comments',
      ]);
    });

    it('read only (FR-2): no Approve or Undo; "View comments" only where there are comments', () => {
      const fields = toReviewVm(viewFixture({ writable: false, readOnlyReason: 'step_closed' }))
        .sections[0].fields;
      expect(byLabel(fields, 'Title of Result').actions).toBeNull();
      const description = byLabel(fields, 'Description of Result').actions!;
      expect([description.approve, description.undo, description.secondaryLabel]).toEqual([
        false,
        null,
        'View comments',
      ]);
    });

    it('writes off: a writable view offers no Approve, Undo, Add comment or Finish, and still shows the comments', () => {
      const vm = toReviewVm(viewFixture(), false);
      const fields = vm.sections[0].fields;
      expect(byLabel(fields, 'Title of Result').actions).toBeNull();
      const description = byLabel(fields, 'Description of Result').actions!;
      expect([description.approve, description.undo, description.secondaryLabel]).toEqual([
        false,
        null,
        'View comments',
      ]);
      expect(vm.canFinish).toBe(false);
      expect(vm.header.locked).toBe(false);
      // What the API said stays: the caller may write, so there is no read-only banner.
      expect(vm.writable).toBe(true);
      expect(vm.banner).toBeNull();
    });

    it('the tooltip is the catalog help text; none when the API sends no description', () => {
      const view = viewFixture();
      const [title, description] = view.sections[0].fields;
      expect(toFieldVm({ ...title, description: 'A short, clear title.' }, true).tip).toBe(
        'A short, clear title.',
      );
      expect(toFieldVm(description, true).tip).toBe('');
    });

    it('AI is not connected: every card has ai null', () => {
      const vm = toReviewVm(viewFixture());
      const cards = vm.sections.flatMap((s) => [
        ...s.fields,
        ...(s.toc?.groups.flatMap((g) => g.items) ?? []),
      ]);
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
      expect(second.links.find((l) => l.label === 'High Level Output Statement')?.value).toBe(
        'More seed sold',
      );
    });

    it('counts the Assessed ToC fields (0 = the section is shown for context only)', () => {
      expect(toc().assessed).toBe(1);
      const view = viewFixture();
      const contextOnly = {
        ...view,
        sections: view.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) => ({ ...f, mode: 'view' as const })),
        })),
      };
      expect(toReviewVm(contextOnly).sections[1].toc!.assessed).toBe(0);
    });

    it('an entry with every value empty is no contribution (what the API sends when the result is not mapped to the ToC)', () => {
      const blank = {
        level: null,
        toc_result: null,
        hlo_statement: null,
        kpi: null,
        indicator_typology: null,
        unit_of_measurement: null,
        target: null,
        contribution_to_target: null,
      };
      const view = viewFixture();
      const withBlank = {
        ...view,
        sections: view.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) =>
            f.key === 'toc.entries'
              ? { ...f, value: [blank], labels: null }
              : f.key === 'contributors.science_programs'
                ? { ...f, value: [] }
                : f,
          ),
        })),
      };
      const vm = toReviewVm(withBlank).sections[1].toc!;
      const cards = vm.groups.flatMap((g) => g.items);
      expect(vm.count).toBe(0);
      expect(cards.map((c) => c.eyebrow)).not.toContain('Contribution 1');
      const entries = cards.find((c) => c.eyebrow === 'ToC contributions')!;
      expect(entries.links).toEqual([{ label: 'Answer', code: '', value: '—' }]);
      expect(formatValue({ value: [blank], labels: null, notApplicable: false })).toBe('—');
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
      expect(card.links.map((l) => l.label)).toEqual([
        'Science Program',
        'Identified in the ToC',
        'Can this result be mapped to a ToC KPI?',
        'Level',
        'Output/Outcome',
      ]);
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

    it('labels the ids of a list entry by the subfield lists of the field, and keeps the id without them', () => {
      const value = [{ actor_type: 1, how_many: 1200 }];
      const labels = { actor_types: { '1': 'Farmers' } };
      expect(
        formatValue({
          value,
          labels,
          notApplicable: false,
          subfieldLists: { actor_type: 'actor_types' },
        }),
      ).toBe('Actor type: Farmers · How many: 1200');
      expect(formatValue({ value, labels, notApplicable: false })).toBe(
        'Actor type: 1 · How many: 1200',
      );
    });

    it('booleans read Yes/No and empty values a dash', () => {
      expect(formatValue({ value: false, labels: null, notApplicable: false })).toBe('No');
      expect(formatValue({ value: null, labels: null, notApplicable: false })).toBe('—');
      expect(formatValue({ value: [], labels: null, notApplicable: false })).toBe('—');
    });

    it('reads an instant from Reporting as Rome wall time, not raw ISO (23-nov demo)', () => {
      expect(formatValue({ value: '2026-11-23T13:45:47.371Z', labels: null, notApplicable: false })).toBe('23 Nov 2026, 14:45 CET');
      expect(formatValue({ value: '2026-07-06T08:00:00Z', labels: null, notApplicable: false })).toBe('06 Jul 2026, 10:00 CEST');
      expect(formatValue({ value: '2026-11-23', labels: null, notApplicable: false })).toBe('2026-11-23');
    });

    it('reads a directory person once, not "Value: … · Directory user: …" (23-nov demo)', () => {
      const person = 'Jarrin, Angel Alberto (Alliance)';
      expect(formatValue({ value: { value: person, directory_user: person }, labels: null, notApplicable: false })).toBe(person);
      expect(formatValue({ value: { value: person, directory_user: null }, labels: null, notApplicable: false })).toBe(person);
      expect(formatValue({ value: { value: 'x', role: 'Lead' }, labels: null, notApplicable: false })).toBe('Value: x · Role: Lead');
    });
  });

  describe('header and read-only banner (FR-2, FR-23)', () => {
    it('header from the API: code, title, type, FR-5 status label, step and timeline in the details', () => {
      const h = toReviewVm(viewFixture()).header;
      expect([h.code, h.title, h.type, h.status]).toEqual([
        '9890',
        'Seed systems for maize',
        'Policy change',
        'Pending',
      ]);
      expect(h.details).toEqual([
        { label: 'Science program', value: 'SP05 Better Diets and Nutrition' },
        { label: 'Timeline', value: 'Official timeline 2026' },
        { label: 'Step', value: 'Step 1 · Assessment' },
        { label: 'Assessed by', value: '—' },
      ]);
      expect(h.showAssessedBy).toBe(false);
    });

    it('P2-4136 AC3: the header carries the Science Program and the timeline to show them, not only the ⓘ details', () => {
      const h = toReviewVm(viewFixture()).header;
      expect([h.programCode, h.programName, h.timeline, h.step]).toEqual([
        'SP05',
        'SP05 Better Diets and Nutrition',
        'Official timeline 2026',
        'Step 1 · Assessment',
      ]);
    });

    it('P2-4136: no step on the timeline reads "No step" in the header, never a blank', () => {
      const v = viewFixture();
      const h = toReviewVm({ ...v, header: { ...v.header, step: null } }).header;
      expect(h.step).toBe('No step');
    });

    it.each([
      ['admin_read_only', 'View only for admins'],
      ['step_upcoming', 'Step 1 · Assessment has not opened yet'],
      ['step_closed', 'Step 1 · Assessment is closed'],
      ['no_step', 'Your role has no step'],
      ['auto_validated', 'Auto-validated: this result is not assessed'],
    ] as const)('%s → banner "%s…"', (reason, text) => {
      expect(readOnlyBanner(reason, viewFixture())).toContain(text);
    });

    it('finished: "Finished by <nickname>", Assessed by shown, no finish offered', () => {
      const view = viewFixture({
        writable: false,
        readOnlyReason: 'finished',
        header: { ...viewFixture().header, status: 'quality_assessed' },
        assessment: {
          status: 'quality_assessed',
          assessedBy: { id: 1053, nickname: 'mchen' },
          finishedAt: '2026-11-12T20:12:29.000Z',
        },
      });
      const vm = toReviewVm(view);
      expect(vm.banner).toBe('Finished by mchen on 12 Nov 2026.');
      expect(vm.header.status).toBe('Quality Assessed');
      expect(vm.header.showAssessedBy).toBe(true);
      expect(vm.header.assessor).toBe('mchen');
      expect(vm.canFinish).toBe(false);
    });

    it('an assessor with no nickname reads "—", never a name', () => {
      const view = viewFixture({
        assessment: { status: 'returned', assessedBy: { id: 7, nickname: null }, finishedAt: null },
        readOnlyReason: 'finished',
        writable: false,
      });
      expect(toReviewVm(view).header.assessor).toBe('—');
      expect(readOnlyBanner('finished', view)).toBe('Finished by —.');
    });

    it('writable view: no banner', () => {
      expect(toReviewVm(viewFixture()).banner).toBeNull();
    });
  });

  describe('auto-validated result: not assessed, so every field is context (seen on TEST: 9039, 9816 in timeline 34)', () => {
    // What the API sends for it: status `auto_validated`, no assessment row, its Assessed fields all grey.
    const auto = (over: Parameters<typeof viewFixture>[0] = {}) =>
      viewFixture({ ...over, header: { ...viewFixture().header, status: 'auto_validated' } });

    it('counts nothing as pending: no "N pending" per section and no "0 of N fields resolved"', () => {
      const vm = toReviewVm(auto());
      expect(vm.sections.map((s) => s.open)).toEqual([0, 0, 0, 0]);
      expect([vm.resolved, vm.total, vm.commented, vm.validated]).toEqual([0, 0, 0, 0]);
    });

    it('no field carries a "Not validated" mark, a Core tag or a button, even for a caller who may write', () => {
      const vm = toReviewVm(auto({ writable: true, readOnlyReason: null }));
      const fields = vm.sections.flatMap((s) => s.fields);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.flatMap(chipLabels)).toEqual([]);
      expect(fields.every((f) => f.actions === null && !f.isCore)).toBe(true);
      const toc = vm.sections.find((s) => s.isToc)!.toc!;
      expect(toc.assessed).toBe(0);
      expect(vm.canFinish).toBe(false);
      expect(vm.header.locked).toBe(false);
    });

    it('says why there is nothing to do, whatever the read-only reason of the caller', () => {
      const text = 'Auto-validated: this result is not assessed.';
      expect(toReviewVm(auto({ writable: true, readOnlyReason: null })).banner).toBe(text);
      expect(toReviewVm(auto({ writable: false, readOnlyReason: 'admin_read_only' })).banner).toBe(text);
      expect(toReviewVm(auto()).header.instructions).toContain('auto-validated');
    });

    it('the values are still shown', () => {
      const general = toReviewVm(auto()).sections[0].fields;
      expect(byLabel(general, 'Title of Result').value).toBe('Seed systems for maize');
    });
  });

  describe('thread of a field (FR-11, FR-13)', () => {
    const thread = (me: number | null, canWithdraw: boolean) =>
      toDrawerVm(findField(viewFixture(), 'general.description')!, 'comment', { me, canWithdraw }).comments;

    it('only the author can take back an own open comment, and only while their step allows it', () => {
      expect(thread(1053, true).map((c) => c.canWithdraw)).toEqual([true]);
      expect(thread(7, true).map((c) => c.canWithdraw)).toEqual([false]); // someone else's
      expect(thread(1053, false).map((c) => c.canWithdraw)).toEqual([false]); // step closed, admin…
      expect(thread(null, true).map((c) => c.canWithdraw)).toEqual([false]); // no session yet
    });

    it('a comment can be taken back while writing and after the end, never for another read-only reason', () => {
      expect(withdrawOpen({ writable: true, readOnlyReason: null })).toBe(true);
      expect(withdrawOpen({ writable: false, readOnlyReason: 'finished' })).toBe(true);
      expect(withdrawOpen({ writable: false, readOnlyReason: 'step_closed' })).toBe(false);
      expect(withdrawOpen({ writable: false, readOnlyReason: 'admin_read_only' })).toBe(false);
    });
  });

  describe("the program's responses in the thread (P2-3911)", () => {
    const found = (state: 'open' | 'clarification_requested' | 'accepted' = 'clarification_requested', author = 1053) =>
      findField(
        viewFixture({
          sections: [{ key: 'general_information', label: 'General information', fields: [field({ key: 'general.description', label: 'Description of Result', comments: [comment({ state, author: { id: author, nickname: 'mchen' } })] })] }],
        }),
        'general.description',
      )!;
    const reader = (me: number | null) => ({ me, canWithdraw: true });
    const threads = (thread = clarificationThread()) => new Map([[thread.commentId, thread]]);

    it("puts each response under its comment, oldest first, with the program's name, email and what it chose", () => {
      const accept = programResponse({ id: 71, kind: 'accept', body: null, respondedAt: '2026-11-19T09:00:00.000Z' });
      const disagree = programResponse({ id: 69, kind: 'disagree', body: 'The link is already there.', respondedAt: '2026-11-17T09:00:00.000Z' });
      const thread = clarificationThread({ state: 'accepted', response: accept, history: [disagree, programResponse(), accept] });
      const rows = toDrawerVm(found('accepted'), 'read', reader(1053), threads(thread)).comments;
      expect(rows.map((c) => [c.role, c.who, c.reply ?? null, c.text])).toEqual([
        ['Assessor', 'mchen', null, 'Add the evidence link.'],
        ['Program', 'Pepa Program', 'disagreed', 'The link is already there.'],
        ['Program', 'Pepa Program', 'clarification', 'Which evidence link do you mean?'],
        ['Program', 'Pepa Program', 'accepted', ''],
      ]);
      expect(rows[1].email).toBe('pepa@program.org');
      expect(rows[1].date).toBe('17 Nov 2026');
    });

    it("shows the author's answer right under the clarification it answers", () => {
      const request = programResponse();
      const thread = clarificationThread({
        state: 'open',
        clarifications: [{ requestId: request.id, question: 'Which evidence link do you mean?', requestedAt: request.respondedAt, answer: { body: 'The one in the evidence section.', answeredAt: '2026-11-19T10:00:00.000Z' } }],
      });
      const rows = toDrawerVm(found('open'), 'read', reader(1053), threads(thread)).comments;
      expect(rows.map((c) => [c.role, c.answer ?? false, c.text])).toEqual([
        ['Assessor', false, 'Add the evidence link.'],
        ['Program', false, 'Which evidence link do you mean?'],
        ['Assessor', true, 'The one in the evidence section.'],
      ]);
    });

    it('asks the author for the answer on a read-only assessment, and nobody else', () => {
      const mine = toDrawerVm(found(), 'read', reader(1053), threads());
      expect(mine.mode).toBe('clarify');
      expect(mine.clarify).toEqual({ commentId: 1, question: 'Which evidence link do you mean?' });

      expect(toDrawerVm(found(), 'read', reader(7), threads()).mode).toBe('read'); // another assessor reads it
      expect(toDrawerVm(found(), 'read', reader(null), threads()).mode).toBe('read'); // no session yet
      expect(toDrawerVm(found('clarification_requested', 7), 'read', reader(1053), threads()).mode).toBe('read'); // not my comment
    });

    it('follows the server when it says whether the caller can answer now (programs step open, author, pending)', () => {
      // Step 2 closed: the comment is still clarification_requested and mine, but the POST would be refused.
      const closed = toDrawerVm(found(), 'read', reader(1053), threads(clarificationThread({ answerable: false })));
      expect(closed.mode).toBe('read');
      expect(closed.comments).toHaveLength(2);
      expect(toDrawerVm(found(), 'read', reader(1053), threads(clarificationThread({ answerable: true }))).mode).toBe('clarify');
      // A server that does not send the flag: what the page can tell (author + state).
      expect(toDrawerVm(found(), 'read', reader(1053), threads()).mode).toBe('clarify');
    });

    it('does not offer the form once the server said the programs step is closed', () => {
      const closed = toDrawerVm(found(), 'read', { me: 1053, canWithdraw: true, canClarify: false }, threads());
      expect(closed.mode).toBe('read');
      expect(closed.clarify).toBeNull();
      expect(closed.comments).toHaveLength(2); // the thread is still there to read
    });

    it('does not ask again once it is answered, nor before the responses are read', () => {
      const request = programResponse();
      const answered = clarificationThread({ state: 'open', clarifications: [{ requestId: request.id, question: 'Which?', requestedAt: request.respondedAt, answer: { body: 'That one.', answeredAt: '2026-11-19T10:00:00.000Z' } }] });
      expect(toDrawerVm(found('open'), 'read', reader(1053), threads(answered)).mode).toBe('read');
      expect(toDrawerVm(found(), 'read', reader(1053)).mode).toBe('read');
      expect(toDrawerVm(found(), 'read', reader(1053)).comments).toHaveLength(1);
    });
  });

  describe('the answers the caller owes the program, page-wide (P2-3911)', () => {
    const ME = 1053;
    /** Comment 1 on Description (General information) and comment 5 on Regions (Geographic location). */
    const askedTwice = (author = ME): AssessmentView => {
      const v = viewFixture({ writable: false, readOnlyReason: 'step_closed' });
      const mine = (id: number, fieldKey: string) => comment({ id, fieldKey, state: 'clarification_requested', author: { id: author, nickname: 'mchen' } });
      return {
        ...v,
        sections: v.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) =>
            f.key === 'general.description' ? { ...f, comments: [mine(1, f.key)] } : f.key === 'geo.regions' ? { ...f, comments: [mine(5, f.key)] } : f,
          ),
        })),
      };
    };
    const both = () =>
      new Map([
        [1, clarificationThread()],
        [5, clarificationThread({ commentId: 5, fieldKey: 'geo.regions' })],
      ]);

    it('none: no thread asks for a clarification', () => {
      expect(pendingAnswers(askedTwice(), ME, new Map())).toEqual([]);
      expect(pendingAnswers(viewFixture(), ME, new Map())).toEqual([]);
    });

    it('one: the field, its section and the comment', () => {
      expect(pendingAnswers(askedTwice(), ME, new Map([[1, clarificationThread()]]))).toEqual([
        { sectionKey: 'general_information', fieldKey: 'general.description', fieldLabel: 'Description of Result', commentId: 1 },
      ]);
    });

    it('two in different sections, in page order', () => {
      expect(pendingAnswers(askedTwice(), ME, both()).map((p) => [p.sectionKey, p.fieldKey, p.commentId])).toEqual([
        ['general_information', 'general.description', 1],
        ['geographic_location', 'geo.regions', 5],
      ]);
    });

    it("another author's comment, or no session, owes nothing", () => {
      expect(pendingAnswers(askedTwice(7), ME, both())).toEqual([]);
      // Even where the server would let someone answer: without a session the page asks nothing.
      expect(pendingAnswers(askedTwice(), null, new Map([[1, clarificationThread({ answerable: true })]]))).toEqual([]);
    });

    it('follows the server flag: answerable false owes nothing, answerable true does', () => {
      const closed = new Map([[1, clarificationThread({ answerable: false })]]);
      expect(pendingAnswers(askedTwice(), ME, closed)).toEqual([]);
      expect(pendingAnswers(askedTwice(), ME, new Map([[1, clarificationThread({ answerable: true })]]))).toHaveLength(1);
    });

    it('the banner names the field for one, and counts for several', () => {
      const one = pendingAnswers(askedTwice(), ME, new Map([[1, clarificationThread()]]));
      expect(pendingAnswersBanner(one)).toBe(
        "The program asked for a clarification on your comment in “Description of Result”. You can answer it while the program's step is open.",
      );
      expect(pendingAnswersBanner(pendingAnswers(askedTwice(), ME, both()))).toBe(
        "The program asked for a clarification on 2 of your comments. You can answer them while the program's step is open.",
      );
      expect(pendingAnswersBanner([])).toBeNull();
    });

    it('relabels only the owing cards and names the exception in the read-only note', () => {
      const view = askedTwice();
      const page = withPendingAnswers(toReviewVm(view), pendingAnswers(view, ME, new Map([[1, clarificationThread()]])));
      const general = page.sections.find((s) => s.key === 'general_information')!.fields;
      const geo = page.sections.find((s) => s.key === 'geographic_location')!.fields;
      expect(byLabel(general, 'Description of Result').actions).toMatchObject({ secondaryLabel: 'Answer clarification', count: 1 });
      expect(byLabel(geo, 'Regions').actions).toMatchObject({ secondaryLabel: 'View comments', count: 1 });
      expect(page.header.instructions).toBe('This assessment is read only for you, except for the clarification the program asked on your comment.');
      // Nothing owed: the page as it was.
      const plain = toReviewVm(view);
      expect(withPendingAnswers(plain, [])).toBe(plain);
      expect(plain.header.instructions).toBe('This assessment is read only for you. You can read every field and its comments.');
    });
  });

  describe('finishing now: the status the footer announces before Finish (FR-15)', () => {
    const everyField = (v: AssessmentView, change: (f: AssessmentField) => AssessmentField): AssessmentView => ({
      ...v,
      sections: v.sections.map((s) => ({ ...s, fields: s.fields.map(change) })),
    });
    const coreGreen = (v: AssessmentView): AssessmentView => everyField(v, (f) => (f.core ? { ...f, validated: true } : f));
    const atStep = (v: AssessmentView, position: number): AssessmentView => ({ ...v, header: { ...v.header, step: { position, name: 'Step' } } });

    /** toc.entries (core, grey in the fixture) with a comment that still stands. */
    const tocCommented = (v: AssessmentView): AssessmentView =>
      everyField(v, (f) => (f.key === 'toc.entries' ? { ...f, comments: [comment({ id: 9 })] } : f));

    it('P2-4138: a grey core field with no comment is refused by the server, so no outcome is announced and the field is named', () => {
      const page = toReviewVm(viewFixture()); // toc.entries is core, grey and has no comment
      expect(page.finishTo).toBe('');
      expect(page.finishBlockedBy).toEqual(['ToC contributions']);
    });

    it('P2-4138: a core field whose only comment was withdrawn still blocks it (the server reads non-withdrawn comments)', () => {
      const withdrawn = everyField(viewFixture(), (f) =>
        f.key === 'toc.entries' ? { ...f, comments: [comment({ id: 9, state: 'withdrawn', withdrawnAt: '2026-11-12T11:00:00.000Z' })] } : f,
      );
      expect(toReviewVm(withdrawn).finishBlockedBy).toEqual(['ToC contributions']);
      expect(toReviewVm(withdrawn).finishTo).toBe('');
    });

    it('a grey core field WITH a comment that still stands is Returned to program, nothing blocks it', () => {
      const page = toReviewVm(tocCommented(viewFixture()));
      expect(page.finishBlockedBy).toEqual([]);
      expect(page.finishTo).toBe('Returned to program');
    });

    it('names every blocking core field, in page order', () => {
      const two = everyField(viewFixture(), (f) => (f.key === 'general.title' ? { ...f, validated: false } : f));
      expect(toReviewVm(two).finishBlockedBy).toEqual(['Title of Result', 'ToC contributions']);
    });

    it('every core green and no comment at all: Quality Assessed, nothing blocks it', () => {
      const clean = everyField(coreGreen(viewFixture()), (f) => ({ ...f, comments: [] }));
      expect(toReviewVm(clean).finishBlockedBy).toEqual([]);
      expect(toReviewVm(clean).finishTo).toBe('Quality Assessed');
    });

    it('step 1: a comment that still stands, on a field that is not core, returns it even with every core green', () => {
      // The fixture: step 1, one open comment on general.description (not core).
      expect(toReviewVm(coreGreen(viewFixture())).finishTo).toBe('Returned to program');
    });

    it('step 1: a comment on a key outside the catalog ("Other fields") counts too', () => {
      const clean = everyField(coreGreen(viewFixture()), (f) => ({ ...f, comments: [] }));
      const view = { ...clean, other: [field({ key: 'legacy.note', label: 'legacy.note', mode: 'view', comments: [comment()] })] };
      expect(toReviewVm(view).finishTo).toBe('Returned to program');
    });

    it('step 1: with no comment left (none, or only withdrawn ones) every core green is Quality Assessed', () => {
      const none = everyField(coreGreen(viewFixture()), (f) => ({ ...f, comments: [] }));
      expect(toReviewVm(none).finishTo).toBe('Quality Assessed');
      const withdrawnOnly = everyField(coreGreen(viewFixture()), (f) => ({ ...f, comments: f.comments.filter((c) => c.state === 'withdrawn') }));
      expect(toReviewVm(withdrawnOnly).finishTo).toBe('Quality Assessed');
    });

    it('a later step counts the core fields only: every core green is Quality Assessed, comments or not', () => {
      expect(toReviewVm(atStep(coreGreen(viewFixture()), 3)).finishTo).toBe('Quality Assessed');
      expect(toReviewVm(atStep(tocCommented(viewFixture()), 3)).finishTo).toBe('Returned to program'); // toc.entries grey, commented
      expect(toReviewVm(atStep(viewFixture(), 3)).finishTo).toBe(''); // toc.entries grey with no comment: refused
    });

    it('coreUncommentedMessage: the same words the page shows for the 409 ASSESSMENT_CORE_UNCOMMENTED', () => {
      expect(coreUncommentedMessage(['Result level'])).toBe('Validate or comment this core field first: Result level.');
      expect(coreUncommentedMessage(['Result level', 'Title of Result'])).toBe('Validate or comment these core fields first: Result level, Title of Result.');
      expect(coreUncommentedMessage([])).toBe('');
    });

    it('returnsOnAnyComment: only step 1, only a comment that still stands', () => {
      expect(returnsOnAnyComment(viewFixture())).toBe(true);
      expect(returnsOnAnyComment(atStep(viewFixture(), 3))).toBe(false);
      expect(returnsOnAnyComment({ ...viewFixture(), header: { ...viewFixture().header, step: null } })).toBe(false);
      expect(returnsOnAnyComment(everyField(viewFixture(), (f) => ({ ...f, comments: f.comments.filter((c) => c.state === 'withdrawn') })))).toBe(false);
    });
  });

  describe('round 2: the Lead reads a re-submitted result (P2-3912, round-2 contract § 3, § 4.3)', () => {
    const general = (v: AssessmentView = roundTwoViewFixture()) => toReviewVm(v).sections[0].fields;
    const withField = (key: string, change: (f: AssessmentField) => AssessmentField, v = roundTwoViewFixture()): AssessmentView => ({
      ...v,
      sections: v.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.key === key ? change(f) : f)) })),
    });

    it('a field that is not actionable is context: no mark, no Core tag, no button, not counted', () => {
      const regions = byLabel(general(), 'Regions');
      expect(regions.isView).toBe(true);
      expect(regions.states).toEqual([]);
      expect(regions.actions).toBeNull();
      expect(regions.isCore).toBe(false);
      expect(toReviewVm(roundTwoViewFixture()).total).toBe(2);
    });

    it('a core field not actionable is context too, even with its core flag', () => {
      const v = withField('general.title', (f) => ({ ...f, actionable: false }));
      const title = byLabel(general(v), 'Title of Result');
      expect([title.isView, title.isCore, title.actions]).toEqual([true, false, null]);
    });

    it('round 1: actionable false changes nothing (the round-2 rule only)', () => {
      const plain = viewFixture();
      const v: AssessmentView = { ...plain, sections: plain.sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, actionable: false })) })) };
      expect(toReviewVm(v)).toEqual(toReviewVm(plain));
    });

    it('the check follows effectiveValidated: a carried green with validated false reads Validated, offers Undo', () => {
      const title = byLabel(general(), 'Title of Result');
      expect(title.states[0]).toEqual({ kind: 'ok', label: 'Validated', count: 0 });
      expect(title.actions).toMatchObject({ approve: false, undo: 'approval' });
    });

    it('a stored green the Lead took back (effectiveValidated false over validated true) reads Not validated', () => {
      const v = withField('general.title', (f) => ({ ...f, validated: true, effectiveValidated: false, carried: false }));
      const title = byLabel(general(v), 'Title of Result');
      expect(title.states[0].kind).toBe('not');
      expect(title.actions).toMatchObject({ approve: true, undo: null });
    });

    it('counts, section open and resolved read the effective green', () => {
      const vm = toReviewVm(roundTwoViewFixture());
      // title: carried green (validated false); description: grey with the Lead's own open comment, not escalated, so
      // still to do (tramo 5: in round 2 only green or escalated is done, contract § 4.3).
      expect([vm.resolved, vm.total, vm.validated, vm.commented]).toEqual([1, 2, 1, 1]);
      const noComment = withField('general.description', (f) => ({ ...f, comments: [] }));
      const vm2 = toReviewVm(noComment);
      expect(vm2.sections[0].open).toBe(1); // description only: the carried title is green
      expect([vm2.resolved, vm2.validated]).toEqual([1, 1]);
    });

    it('the ToC "reviewed" count reads the effective green', () => {
      const v: AssessmentView = {
        ...roundTwoViewFixture(),
        sections: [
          {
            key: 'theory_of_change',
            label: 'Theory of Change',
            fields: [field({ key: 'toc.entries', label: 'ToC contributions', core: true, value: 'x', validated: false, effectiveValidated: true, carried: true, actionable: true })],
          },
        ],
      };
      expect(toReviewVm(v).sections[0].toc?.reviewed).toBe(1);
    });

    it('exposes carried and updated on the field, with the hint and "Updated" as existing chips', () => {
      const title = byLabel(general(), 'Title of Result');
      const description = byLabel(general(), 'Description of Result');
      expect([title.carried, title.updated]).toEqual([true, false]);
      expect([description.carried, description.updated]).toEqual([false, true]);
      expect(chipLabels(title)).toEqual(['Validated', 'Green in round 1, unchanged']);
      expect(chipLabels(description)).toEqual(['Not validated', 'Updated', 'Commented']);
      expect(description.states.find((c) => c.label === 'Updated')?.kind).toBe('changes');
      expect(title.states.find((c) => c.label === 'Green in round 1, unchanged')?.kind).toBe('agreed');
    });

    it('carried is never shown on a field that is not green, nor on a context field', () => {
      const grey = withField('general.title', (f) => ({ ...f, effectiveValidated: false }));
      expect(byLabel(general(grey), 'Title of Result').carried).toBe(false);
      const ctx = withField('general.title', (f) => ({ ...f, actionable: false }));
      expect(byLabel(general(ctx), 'Title of Result').carried).toBe(false);
    });

    it('finish outcome: Pending for TPB review while a core field is effectively grey (and escalated)', () => {
      const escalated = withThread({ decision: { decision: 'escalate', body: 'TPB.', decidedAt: '2026-11-25T11:00:00.000Z' } });
      expect(toReviewVm(escalated).finishTo).toBe('Pending for TPB review');
    });

    describe('Finish for the Lead (tramo 5, contract § 4.3)', () => {
      const escalate = { decision: 'escalate' as const, body: 'TPB.', decidedAt: '2026-11-25T11:00:00.000Z' };
      const ownEscalated = withField('general.description', (f) => ({
        ...f,
        thread: [threadItemOf({ decision: { decision: 'agree_program', body: 'Ok.', decidedAt: '2026-11-25T11:00:00.000Z' } })],
        comments: f.comments.map((c) => ({ ...c, decision: escalate })),
      }));

      it('a grey core field with no escalate blocks Finish (ASSESSMENT_CORE_UNDECIDED), even with the Lead\'s own comment on it', () => {
        const vm = toReviewVm(roundTwoViewFixture());
        expect(vm.finishBlockedBy).toEqual(['Description of Result']);
        expect(vm.finishBlockedFields).toEqual([{ key: 'general.description', label: 'Description of Result' }]);
        expect(vm.finishTo).toBe('');
        // Not resolved yet: it counts as open in its section and in the footer.
        expect(vm.resolved).toBe(1);
        expect(vm.sections[0].open).toBe(1);
      });

      it('an escalate on a round-1 comment, or on the own comment, lets Finish go to Pending for TPB review', () => {
        for (const v of [withThread({ decision: escalate }), ownEscalated]) {
          const vm = toReviewVm(v);
          expect(vm.finishBlockedBy).toEqual([]);
          expect(vm.finishTo).toBe('Pending for TPB review');
          expect(vm.resolved).toBe(2);
          expect(vm.sections[0].open).toBe(0);
        }
      });

      it('a withdrawn own comment carries no escalate', () => {
        const withdrawn = withField('general.description', (f) => ({
          ...f,
          comments: f.comments.map((c) => ({ ...c, state: 'withdrawn' as const, decision: escalate })),
        }));
        expect(toReviewVm(withdrawn).finishBlockedBy).toEqual(['Description of Result']);
      });

      it('the message names what the Lead must do: validate or escalate', () => {
        expect(coreUndecidedMessage(['Description of Result'])).toBe('Validate or escalate this core field first: Description of Result.');
        expect(coreUndecidedMessage(['A', 'B'])).toBe('Validate or escalate these core fields first: A, B.');
        expect(coreUndecidedMessage([])).toBe('');
      });

      it('round 1 keeps its rule and lists the blocked fields with their keys', () => {
        const vm = toReviewVm(viewFixture());
        expect(vm.finishBlockedBy).toEqual(['ToC contributions']);
        expect(vm.finishBlockedFields).toEqual([{ key: 'toc.entries', label: 'ToC contributions' }]);
      });
    });

    it('finish outcome: Quality Assessed when every core field is effectively green, comments or not', () => {
      // The description keeps the Lead's own open comment: round 1 would return it, round 2 does not.
      const v = withField('general.description', (f) => ({ ...f, effectiveValidated: true }));
      expect(toReviewVm(v).finishTo).toBe('Quality Assessed');
    });

    it("the Lead's own-comment keys (decision, decidable, choices) change only the own-comment block of the card (tramo 4)", () => {
      const bare = roundTwoViewFixture();
      const stripped: AssessmentView = {
        ...bare,
        sections: bare.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) => ({ ...f, comments: f.comments.map(({ decision: _d, decidable: _x, choices: _c, ...c }) => c) })),
        })),
      };
      const withoutOwn = (vm: ReturnType<typeof toReviewVm>) => ({
        ...vm,
        sections: vm.sections.map((s) => ({ ...s, fields: s.fields.map(({ leadOwn: _o, ...f }) => f) })),
      });
      expect(withoutOwn(toReviewVm(bare))).toEqual(withoutOwn(toReviewVm(stripped)));
      expect(toReviewVm(stripped).sections[0].fields.every((f) => f.leadOwn.length === 0)).toBe(true);
    });

    describe('the round-1 thread on a ToC core field (open item of tramo 3)', () => {
      /** Round 2 with the step-1 fixture's ToC section: toc.entries core and actionable, with one round-1 comment. */
      const tocRoundTwo = (thread = [threadItemOf({ commentId: 61 })], comments: AssessmentView['sections'][number]['fields'][number]['comments'] = []): AssessmentView => {
        const toc = viewFixture().sections.find((s) => s.key === 'theory_of_change')!;
        return roundTwoViewFixture({
          sections: [
            ...roundTwoViewFixture().sections,
            {
              ...toc,
              fields: toc.fields.map((f) =>
                f.key === 'toc.entries'
                  ? { ...f, actionable: true, effectiveValidated: false, carried: false, updated: false, thread, comments }
                  : { ...f, actionable: false, thread: [] },
              ),
            },
          ],
        });
      };
      const tocCards = (v: AssessmentView, writes = true) => toReviewVm(v, writes).sections.find((s) => s.isToc)!.toc!.groups.flatMap((g) => g.items);

      it("the field's first card carries the round-1 thread with its choices, open while it waits; its other cards none", () => {
        const cards = tocCards(tocRoundTwo());
        const first = cards.find((c) => c.id === 'toc.entries')!;
        expect(first.leadThread?.map((t) => t.commentId)).toEqual([61]);
        expect(first.leadThread?.[0].choices.map((c) => c.kind)).toEqual(['agree_program', 'escalate']);
        expect(first.threadOpen).toBe(true);
        expect(cards.filter((c) => c.id !== 'toc.entries').every((c) => !c.leadThread?.length)).toBe(true);
      });

      it("the Lead's own round-2 comment on a ToC core field shows there too, to escalate", () => {
        const own = comment({ id: 8301, fieldKey: 'toc.entries', author: { id: 14, nickname: 'lea' }, stepPosition: 3, round: 2, decision: null, decidable: true, choices: ['escalate'] });
        const first = tocCards(tocRoundTwo([], [own])).find((c) => c.id === 'toc.entries')!;
        expect(first.leadOwn?.map((t) => [t.commentId, t.choices.map((c) => c.kind)])).toEqual([[8301, ['escalate']]]);
      });

      it('a page with no writes shows the thread with no control; round 1 ToC cards carry no thread', () => {
        const first = tocCards(tocRoundTwo(), false).find((c) => c.id === 'toc.entries')!;
        expect(first.leadThread?.[0].choices).toEqual([]);
        expect(toReviewVm(viewFixture()).sections.find((s) => s.isToc)!.toc!.groups.flatMap((g) => g.items).every((c) => !c.leadThread?.length)).toBe(true);
      });
    });

    describe("the Lead's own comment and the delete (tramo 4, contract § 3.2, § 4.4)", () => {
      const LEAD = 14;
      const description = (v: AssessmentView = roundTwoViewFixture(), writes = true) =>
        byLabel(toReviewVm(v, writes, LEAD, true).sections[0].fields, 'Description of Result');
      const escalation = { decision: 'escalate' as const, body: 'Mine to escalate.', decidedAt: '2026-11-25T11:00:00.000Z' };
      const ownWith = (over: Partial<AssessmentView['sections'][number]['fields'][number]['comments'][number]>, view?: AssessmentView) =>
        withField('general.description', (f) => ({ ...f, comments: f.comments.map((c) => (c.id === 8101 ? { ...c, ...over } : c)) }), view);

      it('the own round-2 comment is listed on its own, offering only "Escalate to TPB" (exactly its choices)', () => {
        const f = description();
        expect(f.leadOwn).toEqual([
          expect.objectContaining({
            commentId: 8101,
            own: true,
            who: 'lea',
            text: 'The core field is still wrong.',
            response: null,
            decision: null,
            choices: [{ kind: 'escalate', label: 'Escalate to TPB' }],
            pending: false,
            agreeEnds: false,
            canDelete: false,
          }),
        ]);
        // It is not one of the round-1 comments.
        expect(f.leadThread.map((t) => t.commentId)).toEqual([41]);
      });

      it('after a reload the escalate shows from the comment itself, with Change / Clear still offered', () => {
        const f = description(ownWith({ decision: escalation }));
        expect(f.leadOwn[0].decision).toEqual({ kind: 'escalate', label: 'Escalated to TPB', text: 'Mine to escalate.', date: '25 Nov 2026' });
        expect(f.leadOwn[0].choices).toHaveLength(1);
      });

      it('not decidable (ended, read only) or a page with no writes: the decision is kept, no control', () => {
        expect(description(ownWith({ decision: escalation, decidable: false, choices: [] })).leadOwn[0].choices).toEqual([]);
        expect(description(roundTwoViewFixture(), false).leadOwn[0].choices).toEqual([]);
      });

      it('a withdrawn own comment, and any comment without the own-comment keys, is not listed', () => {
        expect(description(ownWith({ state: 'withdrawn', decision: null, decidable: false, choices: [] })).leadOwn).toEqual([]);
        const other = withField('general.description', (f) => ({
          ...f,
          comments: [comment({ id: 8200, fieldKey: 'general.description', author: { id: 15, nickname: 'leo' }, stepPosition: 3, round: 2 })],
        }));
        expect(description(other).leadOwn).toEqual([]);
      });

      it('a round-2 reader who is not the Lead (a TPB) gets no Delete on the thread', () => {
        const unanswered = withThread({ state: 'open', response: undefined });
        expect(byLabel(toReviewVm(unanswered, true, LEAD, false).sections[0].fields, 'Description of Result').leadThread[0].canDelete).toBe(false);
      });

      it('an escalated field offers no Approve (the server refuses its green, ASSESSMENT_FIELD_ESCALATED); clearing it brings Approve back', () => {
        const escalated = description(withThread({ decision: escalation }));
        expect(escalated.actions?.approve).toBe(false);
        expect(escalated.actions?.secondary).toBe(true);
        expect(description().actions?.approve).toBe(true);
        expect(description(ownWith({ decision: escalation })).actions?.approve).toBe(false);
      });

      it('a round-1 comment the program never answered can be deleted while the Lead writes; an answered one cannot', () => {
        expect(description().leadThread[0].canDelete).toBe(false); // answered (Disagreed)
        const unanswered = withThread({ state: 'open', response: undefined });
        expect(description(unanswered).leadThread[0].canDelete).toBe(true);
        expect(description(unanswered, false).leadThread[0].canDelete).toBe(false);
        const ended = withThread({ state: 'open', response: undefined }, [], roundTwoViewFixture({ writable: false, readOnlyReason: 'finished' }));
        expect(description(ended).leadThread[0].canDelete).toBe(false);
        // Never one's own.
        expect(description(withThread({ state: 'open', response: undefined, author: { id: LEAD, nickname: 'lea' } })).leadThread[0].canDelete).toBe(false);
      });

      it("in the drawer: another Lead's open round-2 comment can be deleted, one's own is withdrawn instead", () => {
        const view = withField('general.description', (f) => ({
          ...f,
          comments: [...f.comments, comment({ id: 8200, fieldKey: 'general.description', author: { id: 15, nickname: 'leo' }, stepPosition: 3, round: 2 })],
        }));
        const found = findField(view, 'general.description')!;
        const reader = { me: LEAD, canWithdraw: withdrawOpen(view), canDelete: deleteOpen(view, true) };
        const drawer = toDrawerVm(found, 'comment', reader);
        const byId = (id: number) => drawer.comments.find((c) => (c as { id?: number }).id === id) as { canDelete?: boolean; canWithdraw?: boolean };
        expect(byId(8200).canDelete).toBe(true);
        expect(byId(8200).canWithdraw).toBe(false);
        expect(byId(8101).canDelete).toBe(false);
        expect(byId(8101).canWithdraw).toBe(true);
      });

      it('deleteOpen: only a writable round-2 view; round 1 and a finished round 2 delete nothing', () => {
        expect(deleteOpen(roundTwoViewFixture(), true)).toBe(true);
        expect(deleteOpen(roundTwoViewFixture({ writable: false, readOnlyReason: 'finished' }), true)).toBe(false);
        expect(deleteOpen(viewFixture(), true)).toBe(false);
        // A round-2 reader that is not the Lead (a TPB writes in step 4) deletes nothing (the server answers 403).
        expect(deleteOpen(roundTwoViewFixture(), false)).toBe(false);
      });

      it('round 2 withdraws only while the Lead writes (after the end the server refuses it); round 1 keeps its rule', () => {
        expect(withdrawOpen(roundTwoViewFixture({ writable: false, readOnlyReason: 'finished' }))).toBe(false);
        expect(withdrawOpen(roundTwoViewFixture())).toBe(true);
        expect(withdrawOpen(viewFixture({ writable: false, readOnlyReason: 'finished' }))).toBe(true);
      });
    });

    describe('the round-1 thread in the card (tramo 3)', () => {
      const description = (v: AssessmentView = roundTwoViewFixture(), writes = true) =>
        byLabel(toReviewVm(v, writes).sections[0].fields, 'Description of Result');

      it('maps each round-1 comment: author, date, text, the value then, the program response, and the choices', () => {
        const f = description();
        expect(f.threadOpen).toBe(true);
        expect(f.leadThread).toEqual([
          {
            commentId: 41,
            who: 'mchen',
            date: '12 Nov 2026',
            text: 'The description does not match the evidence.',
            valueThen: 'Old description',
            response: { who: 'Pepa Program', label: 'Disagreed', date: '18 Nov 2026', text: 'The evidence was updated in this submission.' },
            clarifications: [],
            decision: null,
            choices: [
              { kind: 'agree_program', label: 'Agree with the program' },
              { kind: 'escalate', label: 'Escalate to TPB' },
            ],
            pending: true,
            agreeEnds: true,
            own: false,
            mode: 'lead',
            lead: null,
            tpb: null,
            noteOptional: false,
            canDelete: false,
          },
        ]);
      });

      it('an admin author reads "Admin · nickname" (reviewerLabel)', () => {
        const f = description(withThread({ author: { id: 2, nickname: 'ana', admin: true } }));
        expect(f.leadThread[0].who).toBe('Admin · ana');
      });

      it('the value then is left out when it reads the same as now; clarifications are listed oldest first', () => {
        const f = description(
          withThread({
            valueCopy: { value: 'New description' },
            response: undefined,
            clarifications: [
              { requestId: 1, question: 'Which link?', requestedAt: '2026-11-14T10:00:00.000Z', answer: { body: 'The annex.', answeredAt: '2026-11-15T10:00:00.000Z' } },
              { requestId: 2, question: 'And the date?', requestedAt: '2026-11-16T10:00:00.000Z', answer: null },
            ],
          }),
        );
        expect(f.leadThread[0].valueThen).toBeNull();
        expect(f.leadThread[0].response).toBeNull();
        expect(f.leadThread[0].clarifications).toEqual([
          { question: 'Which link?', askedOn: '14 Nov 2026', answer: 'The annex.', answeredOn: '15 Nov 2026' },
          { question: 'And the date?', askedOn: '16 Nov 2026', answer: null, answeredOn: '' },
        ]);
      });

      it('a decided comment shows the decision; its choices stay (for Change and Clear) and it no longer waits', () => {
        const f = description(withThread({ decision: { decision: 'escalate', body: 'TPB should look.', decidedAt: '2026-11-25T11:00:00.000Z' } }));
        expect(f.leadThread[0].decision).toEqual({ kind: 'escalate', label: 'Escalated to TPB', text: 'TPB should look.', date: '25 Nov 2026' });
        expect(f.leadThread[0].choices).toHaveLength(2);
        expect(f.leadThread[0].pending).toBe(false);
        expect(f.threadOpen).toBe(false);
      });

      it('offers exactly the server choices: only "Escalate to TPB" while another comment is escalated', () => {
        const f = description(withThread({ choices: ['escalate'] }));
        expect(f.leadThread[0].choices).toEqual([{ kind: 'escalate', label: 'Escalate to TPB' }]);
      });

      it('gated on decidable alone: not decidable (review ended, admin reading) = no control, decision kept', () => {
        const ended = withThread(
          { decidable: false, choices: [], decision: { decision: 'agree_program', body: null, decidedAt: '2026-11-25T11:00:00.000Z' } },
          [],
          roundTwoViewFixture({ writable: false, readOnlyReason: 'finished' }),
        );
        const f = description(ended);
        expect(f.leadThread[0].choices).toEqual([]);
        expect(f.leadThread[0].decision?.label).toBe('Agreed with the program');
        expect(f.leadThread[0].decision?.text).toBe('');
        expect(f.leadThread[0].pending).toBe(false);
      });

      it('decidable wins over writable: an admin acting as the Lead on a view the contract marks decidable gets the controls', () => {
        const f = description(roundTwoViewFixture({ writable: false, readOnlyReason: 'step_closed' }));
        expect(f.leadThread[0].choices).toHaveLength(2);
      });

      it('a page that offers no writes shows no control', () => {
        expect(description(roundTwoViewFixture(), false).leadThread[0].choices).toEqual([]);
      });

      it('agreeEnds only when every other core field is green and nothing else on the field holds it grey', () => {
        const undecided = threadItemOf({ commentId: 42 });
        expect(description(withThread({}, [undecided])).leadThread[0].agreeEnds).toBe(false);
        const escalated = threadItemOf({ commentId: 42, decision: { decision: 'escalate', body: 'x', decidedAt: '2026-11-25T11:00:00.000Z' } });
        expect(description(withThread({}, [escalated])).leadThread[0].agreeEnds).toBe(false);
        const agreedOther = threadItemOf({ commentId: 42, decision: { decision: 'agree_program', body: 'x', decidedAt: '2026-11-25T11:00:00.000Z' } });
        expect(description(withThread({}, [agreedOther])).leadThread[0].agreeEnds).toBe(true);
        const accepted = threadItemOf({ commentId: 42, state: 'accepted', decidable: false, choices: [] });
        expect(description(withThread({}, [accepted])).leadThread[0].agreeEnds).toBe(true);
        const greyTitle = withThread({}, [], withField('general.title', (t) => ({ ...t, effectiveValidated: false, carried: false })));
        expect(description(greyTitle).leadThread[0].agreeEnds).toBe(false);
      });

      it('no thread on a context field, nor in round 1', () => {
        const ctx = withField('general.description', (f) => ({ ...f, actionable: false }));
        expect(description(ctx).leadThread).toEqual([]);
        const r1 = toReviewVm({ ...viewFixture(), sections: viewFixture().sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, thread: [] })) })) });
        expect(r1.sections.flatMap((s) => s.fields).every((f) => f.leadThread.length === 0 && !f.threadOpen)).toBe(true);
      });
    });

    it('an escalated assessment and a lead_sided_program comment map without error (ended, read only)', () => {
      const v = withField(
        'general.description',
        (f) => ({ ...f, comments: f.comments.map((c) => ({ ...c, state: 'lead_sided_program' as const })) }),
        roundTwoViewFixture({
          writable: false,
          readOnlyReason: 'finished',
          assessment: { status: 'escalated', assessedBy: { id: 14, nickname: 'lea' }, finishedAt: '2026-11-25T12:00:00.000Z' },
          header: { ...roundTwoViewFixture().header, status: 'pending_tpb_review' },
        }),
      );
      const vm = toReviewVm(v);
      expect(vm.canFinish).toBe(false);
      expect(vm.header.status).toBe('Pending for TPB review');
      expect(vm.header.showAssessedBy).toBe(true);
      expect(vm.banner).toBe('Finished by lea on 25 Nov 2026.');
      expect(byLabel(vm.sections[0].fields, 'Description of Result').actions?.count).toBe(1);
    });

    it('round 1 unchanged: a round-1 view with every round-2 key at its round-1 value maps exactly as without them', () => {
      const plain = viewFixture();
      const explicit: AssessmentView = {
        ...plain,
        round: 1,
        sections: plain.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) => ({ ...f, updated: false, actionable: f.mode === 'assessed', effectiveValidated: f.validated, carried: false, thread: [] })),
        })),
      };
      const vm = toReviewVm(plain);
      expect(toReviewVm(explicit)).toEqual(vm);
      const all = vm.sections.flatMap((s) => s.fields);
      expect(all.every((f) => !f.carried && !f.updated)).toBe(true);
      // P2-4138: the fixture's ToC core field is grey with no comment, so Finish is refused (no outcome announced).
      expect(vm.finishBlockedBy).toEqual(['ToC contributions']);
      expect(vm.finishTo).toBe('');
    });
  });

  it('dates are the day and time in Rome, not UTC (23:30 UTC is already the next day there)', () => {
    expect(toCommentVm(comment({ createdAt: '2026-11-12T23:30:00.000Z' })).date).toBe('13 Nov 2026, 00:30 CET');
    expect(toCommentVm(comment({ createdAt: '2026-07-01T10:00:00.000Z' })).date).toBe('01 Jul 2026, 12:00 CEST');
  });

  it('P2-4137 AC14: a comment carries its step and the field value as the author saw it', () => {
    const vm = toCommentVm(comment({ stepPosition: 2, valueCopy: { value: 'Old' } }));
    expect(vm.step).toBe('Step 2');
    expect(vm.valueCopy).toBe('Old');
    expect(vm.valueTruncated).toBe(false);
  });

  it('P2-4137: the value copy reads with its own labels and the field\'s subfield lists, and says when it was cut', () => {
    const vm = toCommentVm(
      comment({ valueCopy: { value: [{ actor_type: 7 }], labels: { actor_types: { '7': 'Farmers' } } }, valueTruncated: true }),
      undefined,
      { subfieldLists: { actor_type: 'actor_types' } },
    );
    expect(vm.valueCopy).toBe(formatValue({ value: [{ actor_type: 7 }], labels: { actor_types: { '7': 'Farmers' } }, notApplicable: false, subfieldLists: { actor_type: 'actor_types' } }));
    expect(vm.valueCopy).toContain('Farmers');
    expect(vm.valueTruncated).toBe(true);
  });

  it('P2-4137: the drawer rows of a field carry the value copy of each comment', () => {
    const v = viewFixture();
    const found = findField(v, 'general.description')!;
    const drawer = toDrawerVm(found, 'comment');
    expect(drawer.comments[0]).toMatchObject({ step: 'Step 1', valueCopy: 'Old', date: '12 Nov 2026, 11:15 CET' });
  });

  it('a comment is shown by nickname only (or "—") with its date and time', () => {
    expect(toCommentVm(comment())).toMatchObject({
      id: 1,
      authorId: 1053,
      who: 'mchen',
      role: 'Assessor',
      date: '12 Nov 2026, 11:15 CET',
      text: 'Add the evidence link.',
      open: true,
    });
    expect(toCommentVm(comment({ author: { id: 9, nickname: null } })).who).toBe('—');
  });
});
