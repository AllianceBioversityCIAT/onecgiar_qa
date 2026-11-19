import { QA_STATUSES, WorklistRow, WorklistTimeline } from '../../../core/api/assessment.models';
import { NO_NICKNAME, STATUS_CLASSES, STATUS_LABELS, readOnlyReasonOf, readOnlyText, timelineOptions, toRowVm } from './results.mapper';

const row = (patch: Partial<WorklistRow> = {}): WorklistRow => ({
  membershipId: 1,
  resultCode: 9890,
  title: 'Improved bean varieties',
  updated: false,
  program: { id: 7, code: 'SP02', name: 'Breeding for Tomorrow' },
  resultType: { key: 'innovation_development', label: 'Innovation development' },
  comments: 2,
  answeredBySp: 0,
  assessedBy: null,
  status: 'pending',
  canOpen: true,
  readOnlyReason: null,
  ...patch,
});

const timeline = (patch: Partial<WorklistTimeline> = {}): WorklistTimeline => ({
  id: 29,
  name: 'Main 2026',
  kind: 'official',
  roles: ['ASSESSOR'],
  step: { position: 1, name: 'Assessment', opensAt: '2026-11-01T09:00', closesAt: '2026-11-30T18:00', state: 'in_progress' },
  ...patch,
});

describe('results.mapper', () => {
  it('every one of the 8 statuses has its FR-5 label and a pill class', () => {
    for (const status of QA_STATUSES) {
      const vm = toRowVm(row({ status }));
      expect(vm.statusLabel).toBe(STATUS_LABELS[status]);
      expect(vm.statusClass).toBe(STATUS_CLASSES[status]);
    }
    expect(STATUS_LABELS.quality_assessed).toBe('Quality Assessed');
    expect(STATUS_LABELS.pending_tpb_review).toBe('Pending for TPB review');
  });

  it('meta is the program code, plus the nickname once assessed; "—" when the assessor has none', () => {
    expect(toRowVm(row()).meta).toBe('SP02');
    expect(toRowVm(row({ assessedBy: { id: 3, nickname: 'mchen' } })).meta).toBe('SP02 · mchen');
    expect(toRowVm(row({ assessedBy: { id: 3, nickname: null } })).meta).toBe(`SP02 · ${NO_NICKNAME}`);
  });

  it('keeps the open comments count, the Updated flag and the result type label; a missing title shows the code', () => {
    const vm = toRowVm(row({ updated: true, title: null }));
    expect(vm.comments).toBe(2);
    expect(vm.updated).toBe(true);
    expect(vm.type).toBe('Innovation development');
    expect(vm.title).toBe('9890');
  });

  it('the code is text for the table and the link, the row id is the membership (one result can be listed twice)', () => {
    const vm = toRowVm(row({ membershipId: 41 }));
    expect(vm.code).toBe('9890');
    expect(vm.id).toBe(41);
  });

  it('timeline picker: official first, step state as the tag, no "All timelines"', () => {
    const options = timelineOptions([
      timeline({ id: 30, name: 'Extra', kind: 'additional', step: null }),
      timeline(),
    ]);
    expect(options.map((o) => o.value)).toEqual(['29', '30']);
    expect(options[0]).toMatchObject({ group: 'Main batch', tag: 'Open' });
    expect(options[1]).toMatchObject({ group: 'Complementary batches', tag: undefined });
  });

  describe('timeline picker: every option says where the caller\'s step stands and when (Rome clock)', () => {
    const step = timeline().step!;
    const noteOf = (patch: Partial<WorklistTimeline>): string | undefined => timelineOptions([timeline(patch)])[0].description;

    it('open: when it closes', () => {
      expect(noteOf({})).toBe('Open · closes 30 Nov 2026, 18:00 CET (Rome)');
    });

    it('closed: when it closed', () => {
      expect(noteOf({ step: { ...step, state: 'closed', closesAt: '2026-11-05T23:59' } })).toBe('Closed 05 Nov 2026, 23:59 CET (Rome)');
    });

    it('upcoming: when it opens (CEST in summer)', () => {
      expect(noteOf({ step: { ...step, state: 'upcoming', opensAt: '2026-12-01T00:00' } })).toBe('Opens 01 Dec 2026, 00:00 CET (Rome)');
      expect(noteOf({ step: { ...step, state: 'upcoming', opensAt: '2027-07-06T14:00' } })).toBe('Opens 06 Jul 2027, 14:00 CEST (Rome)');
    });

    it('no step for the caller\'s role: no second line', () => {
      expect(noteOf({ step: null })).toBeUndefined();
    });

    it('a moment that is not `YYYY-MM-DDTHH:mm` invents no date: the state alone', () => {
      expect(noteOf({ step: { ...step, closesAt: '' } })).toBe('Open');
      expect(noteOf({ step: { ...step, state: 'closed', closesAt: 'soon' } })).toBe('Closed');
      expect(noteOf({ step: { ...step, state: 'upcoming', opensAt: '2026-02-30T10:00' } })).toBe('Upcoming');
    });

    it('the tag next to the chosen timeline stays the short state', () => {
      expect(timelineOptions([timeline()])[0].tag).toBe('Open');
    });
  });

  it('read-only reason from the timeline: admin only, no step, upcoming, closed; none when writable', () => {
    expect(readOnlyReasonOf(timeline(), true)).toBeNull();
    expect(readOnlyReasonOf(timeline({ roles: ['ADMIN'] }), false)).toBe('admin_read_only');
    expect(readOnlyReasonOf(timeline({ step: null }), false)).toBe('no_step');
    expect(readOnlyReasonOf(timeline({ step: { ...timeline().step!, state: 'upcoming' } }), false)).toBe('step_upcoming');
    expect(readOnlyReasonOf(timeline({ step: { ...timeline().step!, state: 'closed' } }), false)).toBe('step_closed');
    expect(readOnlyText(null)).toBeNull();
    expect(readOnlyText('step_closed')).toContain('closed');
  });
});
