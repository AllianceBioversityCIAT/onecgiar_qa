import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { ActingRoleState } from '../../../core/api/acting-role';
import { AssessmentApi } from '../../../core/api/assessment-api';
import { AssessmentView, CommentThread, QuickComment } from '../../../core/api/assessment.models';
import { AuthSession } from '../../../core/auth/auth-session';
import { Toasts } from '../../../core/http/toasts';
import { viewFixture } from './review.api-fixture';
import { ReviewStore } from './review-store';

/** What the server answers an Admin: read only with no role, writable as the role it sent. */
const adminView = (actingRole: 'ASSESSOR' | null): AssessmentView =>
  viewFixture({
    writable: actingRole !== null,
    readOnlyReason: actingRole === null ? 'admin_read_only' : null,
    actingRoles: ['ASSESSOR'],
    actingRole,
  });

describe('ReviewStore: the Admin acting as a reviewer (admin/acts-as-reviewer)', () => {
  let acting: ActingRoleState;
  let store: ReviewStore;
  const makeApi = () => ({
    // The fake transport answers as the server would for the header the interceptor would send.
    view: vi.fn<(t: number, c: number) => Observable<AssessmentView>>(() =>
      of(adminView(acting.pick()?.role === 'ASSESSOR' ? 'ASSESSOR' : null)),
    ),
    quickComments: vi.fn<(role: string) => Observable<readonly QuickComment[]>>(() => of([])),
    programResponses: vi.fn<(t: number, c: number) => Observable<readonly CommentThread[]>>(() => of([])),
  });
  let api: ReturnType<typeof makeApi>;

  beforeEach(async () => {
    api = makeApi();
    TestBed.configureTestingModule({
      providers: [
        ReviewStore,
        { provide: AssessmentApi, useValue: api },
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
        { provide: AuthSession, useValue: { user: signal({ id: 1 }) } },
      ],
    });
    acting = TestBed.inject(ActingRoleState);
    store = TestBed.inject(ReviewStore);
    await store.load('9890', '29');
  });

  it('reads only until the Admin picks a role, and offers the roles of the result', () => {
    expect(acting.pick()).toBeNull();
    expect(store.actingRoles()).toEqual(['ASSESSOR']);
    expect(store.actingRole()).toBeNull();
    expect(store.view()!.writable).toBe(false);
  });

  it('a pick is kept for this result and the view is read again, built for the role', async () => {
    await store.actAs('ASSESSOR');
    expect(acting.pick()).toEqual({ timelineId: 29, resultCode: 9890, role: 'ASSESSOR' });
    expect(api.view).toHaveBeenCalledTimes(2);
    expect(store.actingRole()).toBe('ASSESSOR');
    expect(store.view()!.writable).toBe(true);
    expect(store.switchingRole()).toBe(false);
  });

  it('back to Read only drops the role', async () => {
    await store.actAs('ASSESSOR');
    await store.actAs(null);
    expect(acting.pick()).toBeNull();
    expect(store.actingRole()).toBeNull();
  });

  it('refuses a role the result does not offer', async () => {
    await store.actAs('LEAD_ASSESSOR');
    expect(acting.pick()).toBeNull();
    expect(api.view).toHaveBeenCalledTimes(1);
  });

  it('quick comments follow the picked role', async () => {
    await store.actAs('ASSESSOR');
    await store.loadQuickComments();
    expect(api.quickComments).toHaveBeenCalledWith('ASSESSOR');
  });

  it('the pick never travels to another result', async () => {
    await store.actAs('ASSESSOR');
    await store.load('9891', '29');
    expect(acting.pick()).toBeNull();
  });

  it('leaving the page drops the pick', async () => {
    await store.actAs('ASSESSOR');
    store.ngOnDestroy();
    expect(acting.pick()).toBeNull();
  });
});
