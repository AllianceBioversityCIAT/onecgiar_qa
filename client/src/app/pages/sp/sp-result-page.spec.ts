import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { SP_API, meData, setupSpTesting, spErr, spOk, startSpSession, until } from '../../core/sp/sp-testing';
import { SpContext } from './sp-context';
import { spComment, spResult } from './sp-fixtures';
import { SpResultPage } from './sp-result-page';

const RESULT_URL = `${SP_API}/sp/timelines/7/results/123`;

describe('SpResultPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  async function open(answer: object, status = 200): Promise<HTMLElement> {
    harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/sp/timelines/7/results/123');
    const req: TestRequest = await until(() => http.expectOne((r) => r.url === RESULT_URL));
    if (status === 200) req.flush(spOk(answer));
    else req.flush(answer, { status, statusText: 'x' });
    await settle();
    return harness.routeNativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      // Not whenStable: a resource that is loading holds it until its request is flushed.
      harness.detectChanges();
    }
  }

  const el = () => harness.routeNativeElement as HTMLElement;
  const radio = (kind: string) => el().querySelector<HTMLInputElement>(`input[type=radio][value=${kind}]`)!;
  const textarea = () => el().querySelector<HTMLTextAreaElement>('textarea');
  const submit = () => [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Save response'))!;

  async function type(text: string): Promise<void> {
    const box = textarea()!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    await settle();
  }

  beforeEach(async () => {
    http = setupSpTesting(undefined, [], [{ path: 'timelines/:timelineId/results/:resultCode', component: SpResultPage }]);
    await startSpSession(http);
    TestBed.inject(SpContext).setMe(meData());
  });
  afterEach(() => http.verify());

  it('shows the header, the comment next to its field, and never an assessor', async () => {
    const page = await open(spResult());
    expect(page.querySelector('h1')?.textContent).toContain('Improved maize varieties');
    expect(page.textContent).toContain('The title does not say what changed.');
    expect(page.querySelector('[data-testid=sp-counts]')?.textContent?.trim()).toBe('0 / 1');
    const link = page.querySelector<HTMLAnchorElement>('a[target=_blank]')!;
    expect(link.href).toBe('https://reporting.example.org/result/123');
    expect(link.rel).toBe('noopener noreferrer');
    expect(page.textContent).not.toMatch(/by assessor|assessed by|nickname/i);
  });

  it('Accept sends no body; the comment and the counts update in place and focus lands on the response', async () => {
    await open(spResult());
    radio('accept').click();
    await settle();
    expect(textarea()).toBeNull();
    submit().click();
    await settle();

    const req = http.expectOne(`${SP_API}/sp/comments/501/response`);
    expect(req.request.body).toEqual({ kind: 'accept' });
    expect('body' in req.request.body).toBe(false);
    req.flush(
      spOk({
        comment: spComment({
          state: 'accepted',
          response: { id: 9, kind: 'accept', body: null, respondedBy: { name: 'Sam Program' }, respondedAt: '2026-11-17T10:00:00.000Z' },
          history: [{ id: 9, kind: 'accept', body: null, respondedBy: { name: 'Sam Program' }, respondedAt: '2026-11-17T10:00:00.000Z' }],
        }),
        counts: { comments: 1, answered: 1 },
      }),
    );
    await settle();

    expect(el().querySelector('[data-testid=sp-counts]')?.textContent?.trim()).toBe('1 / 1');
    expect(el().textContent).toContain('Accepted');
    expect(el().textContent).toContain('by Sam Program');
    expect(el().textContent).toContain('Response saved: Accepted.');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    expect(el().textContent).toContain('Change response');
  });

  it('every kind but Accept needs a text: nothing is sent while it is empty, then it is sent trimmed', async () => {
    await open(spResult());
    for (const kind of ['accept_with_comment', 'disagree', 'request_clarification']) {
      radio(kind).click();
      await settle();
      expect(textarea(), kind).not.toBeNull();
      await type('   ');
      submit().click();
      await settle();
      http.expectNone(`${SP_API}/sp/comments/501/response`);
      expect(textarea()!.getAttribute('aria-invalid')).toBe('true');
    }
    await type('  Please say which part.  ');
    expect(el().textContent).toContain('26 / 2000');
    submit().click();
    await settle();
    const req = http.expectOne(`${SP_API}/sp/comments/501/response`);
    expect(req.request.body).toEqual({ kind: 'request_clarification', body: 'Please say which part.' });
    req.flush(
      spOk({
        comment: spComment({
          state: 'clarification_requested',
          response: { id: 10, kind: 'request_clarification', body: 'Please say which part.', respondedBy: { name: 'Sam Program' }, respondedAt: '2026-11-17T10:00:00.000Z' },
          history: [],
          clarifications: [{ requestId: 10, question: 'Please say which part.', requestedAt: '2026-11-17T10:00:00.000Z', answer: null }],
        }),
        counts: { comments: 1, answered: 0 },
      }),
    );
    await settle();
    expect(el().textContent).toContain('Clarification requested — waiting for the assessor.');
    expect(el().textContent).toContain("Waiting for the assessor's answer.");
    // The latest response counts, and it can still be changed.
    expect(el().textContent).toContain('Change response');
  });

  it('a text over 2,000 characters is refused before sending', async () => {
    await open(spResult());
    radio('disagree').click();
    await settle();
    await type('x'.repeat(2001));
    submit().click();
    await settle();
    http.expectNone(`${SP_API}/sp/comments/501/response`);
    expect(el().textContent).toContain('Keep it to 2000 characters or fewer.');
  });

  it('a 400 on the body shows next to the field', async () => {
    await open(spResult());
    radio('disagree').click();
    await settle();
    await type('Because.');
    submit().click();
    await settle();
    http
      .expectOne(`${SP_API}/sp/comments/501/response`)
      .flush(spErr(400, 'VALIDATION_FAILED', 'Check the fields.', [{ field: 'body', code: 'TOO_LONG', message: 'This text is too long.' }]), {
        status: 400,
        statusText: 'x',
      });
    await settle();
    expect(el().textContent).toContain('This text is too long.');
  });

  it('409 SP_COMMENT_NOT_RESPONDABLE shows the message', async () => {
    await open(spResult());
    radio('accept').click();
    await settle();
    submit().click();
    await settle();
    http.expectOne(`${SP_API}/sp/comments/501/response`).flush(spErr(409, 'SP_COMMENT_NOT_RESPONDABLE', 'This comment can no longer be answered.'), {
      status: 409,
      statusText: 'x',
    });
    await settle();
    expect(el().querySelector('[role=alert]')?.textContent).toContain('This comment can no longer be answered.');
  });

  it('409 SP_STEP_CLOSED reloads the result read-only with the message', async () => {
    await open(spResult());
    radio('accept').click();
    await settle();
    submit().click();
    await settle();
    http.expectOne(`${SP_API}/sp/comments/501/response`).flush(spErr(409, 'SP_STEP_CLOSED', 'The response period for programs is not open.'), {
      status: 409,
      statusText: 'x',
    });
    await settle();
    (await until(() => http.expectOne((r) => r.url === RESULT_URL))).flush(spOk(spResult({ writable: false, readOnlyReason: 'step_closed' })));
    await settle();
    expect(el().textContent).toContain('The response period for programs is not open.');
    expect(el().querySelector('[data-testid=sp-read-only]')?.textContent).toContain('Step 2 is closed. Responses are read-only.');
    expect(el().querySelector('qa-sp-response-form')).toBeNull();
  });

  it('read-only before the step opens: no form, the opening date', async () => {
    await open(spResult({ writable: false, readOnlyReason: 'step_not_open', step: { position: 2, name: 'Programs review', opensAt: '2026-11-21T09:00', closesAt: '2026-11-30T17:30', state: 'upcoming' } }));
    expect(el().querySelector('qa-sp-response-form')).toBeNull();
    expect(el().querySelector('input[type=radio]')).toBeNull();
    expect(el().querySelector('[data-testid=sp-read-only]')?.textContent).toContain('Responses open on 21 Nov 2026, 09:00 (Rome time).');
  });

  it('404 shows the not-found state', async () => {
    await open(spErr(404, 'SP_NOT_FOUND'), 404);
    expect(el().querySelector('[data-testid=sp-not-found]')).not.toBeNull();
  });

  it('an admin sends programId on the result call', async () => {
    TestBed.inject(SpContext).setMe(meData({ isReportingAdmin: true, program: null }));
    TestBed.inject(SpContext).chooseProgram(102);
    harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/sp/timelines/7/results/123');
    const req = await until(() => http.expectOne((r) => r.url === RESULT_URL));
    expect(req.request.params.get('programId')).toBe('102');
    req.flush(spOk(spResult()));
    await settle();
  });
});
