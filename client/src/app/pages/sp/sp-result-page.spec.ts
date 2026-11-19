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
    // Counted as validated and sent: trimmed.
    expect(el().textContent).toContain('22 / 2000');
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

  it('Save without a choice announces the error and moves focus to the options', async () => {
    await open(spResult());
    submit().click();
    await settle();
    http.expectNone(`${SP_API}/sp/comments/501/response`);
    const describedBy = el().querySelector('fieldset')?.getAttribute('aria-describedby');
    const alert = el().querySelector(`[id="${describedBy}"]`);
    expect(alert?.textContent).toContain('Choose a response.');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(document.activeElement).toBe(radio('accept'));
  });

  it('the character counter counts the trimmed text, like the validation', async () => {
    await open(spResult());
    radio('disagree').click();
    await settle();
    await type('   ');
    expect(el().textContent).toContain('0 / 2000');
    await type(`  ${'x'.repeat(2000)}  `);
    expect(el().textContent).toContain('2000 / 2000');
    expect(el().textContent).not.toContain('Keep it to 2000 characters or fewer.');
  });

  it('comment dates show on the Rome clock', async () => {
    await open(spResult());
    // 09:00 UTC on 10 Nov 2026 is 10:00 in Rome (CET).
    expect(el().querySelector('qa-sp-comment-thread')?.textContent).toContain('10 Nov 2026, 10:00');
  });

  describe('two comments', () => {
    const answered = {
      id: 30,
      kind: 'disagree' as const,
      body: 'It is right.',
      respondedBy: { name: 'Sam Program' },
      respondedAt: '2026-11-12T08:00:00.000Z',
    };
    const twoComments = () =>
      spResult({}, [spComment(), spComment({ id: 502, body: 'Second remark.' }), spComment({ id: 503, body: 'Third remark.', state: 'disagreed', response: answered, history: [answered] })]);
    const thread = (i: number) => el().querySelectorAll<HTMLElement>('qa-sp-comment-thread')[i];
    const radioIn = (i: number, kind: string) => thread(i).querySelector<HTMLInputElement>(`input[type=radio][value=${kind}]`)!;
    const boxIn = (i: number) => thread(i).querySelector<HTMLTextAreaElement>('textarea');
    const button = (i: number, text: string) => [...thread(i).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;

    it("a 404 on one comment reloads the result but keeps the other forms' unsaved drafts", async () => {
      await open(twoComments());
      // Draft on the second comment.
      radioIn(1, 'disagree').click();
      await settle();
      boxIn(1)!.value = 'Half-written reason';
      boxIn(1)!.dispatchEvent(new Event('input'));
      // "Change response" open on the third, with a new draft.
      button(2, 'Change response').click();
      await settle();
      radioIn(2, 'accept_with_comment').click();
      await settle();
      boxIn(2)!.value = 'Changed my mind';
      boxIn(2)!.dispatchEvent(new Event('input'));
      // The first comment's save fails with 404.
      radioIn(0, 'accept').click();
      await settle();
      button(0, 'Save response').click();
      await settle();
      http.expectOne(`${SP_API}/sp/comments/501/response`).flush(spErr(404, 'SP_NOT_FOUND'), { status: 404, statusText: 'x' });
      await settle();
      (await until(() => http.expectOne((r) => r.url === RESULT_URL))).flush(spOk(twoComments()));
      await settle();

      expect(el().textContent).toContain('This comment is no longer available.');
      // The failed comment follows the server: nothing chosen.
      expect(radioIn(0, 'accept').checked).toBe(false);
      // The others keep what was typed.
      expect(radioIn(1, 'disagree').checked).toBe(true);
      expect(boxIn(1)?.value).toBe('Half-written reason');
      expect(radioIn(2, 'accept_with_comment').checked).toBe(true);
      expect(boxIn(2)?.value).toBe('Changed my mind');
    });

    it('a draft is replaced when that comment changed on the server', async () => {
      await open(twoComments());
      radioIn(1, 'disagree').click();
      await settle();
      boxIn(1)!.value = 'Half-written reason';
      boxIn(1)!.dispatchEvent(new Event('input'));
      radioIn(0, 'accept').click();
      await settle();
      button(0, 'Save response').click();
      await settle();
      http.expectOne(`${SP_API}/sp/comments/501/response`).flush(spErr(404, 'SP_NOT_FOUND'), { status: 404, statusText: 'x' });
      await settle();
      const other = { ...answered, id: 31, kind: 'accept' as const, body: null };
      (await until(() => http.expectOne((r) => r.url === RESULT_URL))).flush(
        spOk(spResult({}, [spComment(), spComment({ id: 502, body: 'Second remark.', state: 'accepted', response: other, history: [other] })])),
      );
      await settle();
      // Someone else answered the second comment: it now shows that answer behind "Change response".
      expect(boxIn(1)).toBeNull();
      expect(button(1, 'Change response')).toBeDefined();
    });
  });

  describe('"Only fields with comments"', () => {
    const toggle = async () => {
      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await settle();
    };
    const navLabels = () => [...el().querySelectorAll('[data-testid=sp-section-nav] button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim());

    it('hides sections with no commented field from the navigation too', async () => {
      const result = spResult();
      await open({
        ...result,
        sections: [
          ...result.sections,
          { key: 'impact', label: 'Impact', fields: [{ ...result.sections[0].fields[1], key: 'impact_area', label: 'Impact area' }] },
        ],
      });
      expect(navLabels().length).toBe(2);
      await toggle();
      expect(navLabels().length).toBe(1);
      expect(navLabels()[0]).toContain('General information');
      expect(el().querySelector('#sp-section-impact')).toBeNull();
      expect(el().textContent).not.toContain('Description');
    });

    it('shows an empty state when the result has no comments', async () => {
      await open(spResult({}, []));
      expect(el().querySelector('[data-testid=sp-empty]')).toBeNull();
      await toggle();
      expect(el().querySelector('[data-testid=sp-empty]')?.textContent).toContain('No comments on this result yet.');
      expect(navLabels().length).toBe(0);
      // The filter stays reachable to undo it.
      expect(el().querySelector('input[type=checkbox]')).not.toBeNull();
    });
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
