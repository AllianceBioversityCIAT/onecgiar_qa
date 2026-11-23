import { comment, viewFixture } from './review.api-fixture';
import { readOnlyBanner, toCommentVm, toReviewVm } from './review.mapper';

describe('review.mapper: the Admin acting as a reviewer (admin/acts-as-reviewer)', () => {
  it('a comment an Admin wrote is shown as the Admin', () => {
    expect(toCommentVm(comment({ author: { id: 9, nickname: 'jd', admin: true } })).who).toBe('Admin · jd');
    expect(toCommentVm(comment({ author: { id: 9, nickname: null, admin: true } })).who).toBe('Admin');
    expect(toCommentVm(comment({ author: { id: 9, nickname: 'mchen' } })).who).toBe('mchen');
  });

  it('a review an Admin finished says so in the header and the banner', () => {
    const view = viewFixture({
      assessment: { status: 'quality_assessed', assessedBy: { id: 9, nickname: 'jd', admin: true }, finishedAt: null },
      readOnlyReason: 'finished',
      writable: false,
    });
    expect(toReviewVm(view).header.assessor).toBe('Admin · jd');
    expect(readOnlyBanner('finished', view)).toBe('Finished by Admin · jd.');
  });

  it('an Admin offered roles is told to pick one; without roles the banner stays as before', () => {
    const offered = viewFixture({ writable: false, readOnlyReason: 'admin_read_only', actingRoles: ['ASSESSOR'], actingRole: null });
    expect(readOnlyBanner('admin_read_only', offered)).toContain('pick a role in "Act as"');
    expect(readOnlyBanner('admin_read_only', viewFixture())).toBe('View only for admins: you are not assigned to assess this timeline.');
  });
});
