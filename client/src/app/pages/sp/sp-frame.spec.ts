import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FakeParent, SP01, SP02, SP_API, fakeParent, meData, sessionData, setupSpTesting, spOk, until } from '../../core/sp/sp-testing';
import { SpContext } from './sp-context';
import { fileNameFrom } from './sp-csv-download';
import { spResults, spTimelines } from './sp-fixtures';
import { SpFrame } from './sp-frame';
import { SpResultsPage } from './sp-results-page';

describe('SpFrame and SpResultsPage', () => {
  let http: HttpTestingController;
  let parent: FakeParent;
  let harness: RouterTestingHarness;

  const el = () => harness.fixture.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      harness.detectChanges();
    }
  }

  async function openFrame(url: string): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
  }

  async function exchange(data = sessionData()): Promise<void> {
    (await until(() => http.expectOne(`${SP_API}/sp-access/session`))).flush(spOk(data));
    await settle();
  }

  beforeEach(() => {
    parent = fakeParent();
    http = setupSpTesting(parent, [], [{ path: '', component: SpFrame, children: [{ path: '', component: SpResultsPage }] }]);
  });
  afterEach(() => http.verify());

  it('without a code: the full-page "link expired" state and one code_invalid message', async () => {
    await openFrame('/sp');
    expect(el().textContent).toContain('Your Quality Assurance link has expired.');
    expect(el().textContent).toContain('Open Quality Assurance again from the Reporting Tool.');
    expect(parent.messages).toEqual([{ type: 'qa-sp:reload-required', reason: 'code_invalid' }]);
  });

  it('a non-admin sees its program fixed, the step window and the results; no programId is sent', async () => {
    await openFrame('/sp?code=abc');
    expect(TestBed.inject(Router).url).toBe('/sp');
    await exchange();
    (await until(() => http.expectOne(`${SP_API}/sp/me`))).flush(spOk(meData()));
    await settle();
    const timelines = await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines`));
    expect(timelines.request.params.has('programId')).toBe(false);
    timelines.flush(spOk(spTimelines()));
    await settle();
    const results = await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results`));
    expect(results.request.params.has('programId')).toBe(false);
    results.flush(spOk(spResults()));
    await settle();

    expect(el().querySelector('[data-testid=sp-program]')?.textContent).toContain('SP01 · Breeding for Tomorrow');
    expect(el().querySelector('#sp-program-select')).toBeNull();
    expect(el().querySelector('[data-testid=sp-step]')?.textContent).toContain('Open for responses');
    expect(el().querySelector('[data-testid=sp-step]')?.textContent).toContain('11 Nov 2026, 00:00 – 30 Nov 2026, 17:30 (Rome time)');
    const rows = el().querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Updated');
    expect(rows[0].textContent).toContain('Returned to program');
    expect(rows[0].textContent?.replace(/\s+/g, ' ')).toContain('1 / 3');
    expect(rows[1].textContent).toContain('Quality Assessed');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/sp/timelines/7/results/123');
  });

  it('a Reporting admin must pick a program, then every call sends its programId', async () => {
    await openFrame('/sp?code=abc');
    await exchange(sessionData({ isReportingAdmin: true, program: null }));
    (await until(() => http.expectOne(`${SP_API}/sp/me`))).flush(spOk(meData({ isReportingAdmin: true, program: null, programs: [SP01, SP02] })));
    await settle();

    expect(el().querySelector('label[for=sp-program-select]')?.textContent).toContain('Science Program');
    expect(el().querySelector('#sp-program-select')).not.toBeNull();
    expect(el().querySelector('[data-testid=sp-pick-program]')).not.toBeNull();
    http.expectNone((r) => r.url === `${SP_API}/sp/timelines`);

    // What the program select does on change.
    TestBed.inject(SpContext).chooseProgram(SP02.id);
    await settle();
    const timelines = await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines`));
    expect(timelines.request.params.get('programId')).toBe('102');
    timelines.flush(spOk(spTimelines()));
    await settle();
    const results = await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results`));
    expect(results.request.params.get('programId')).toBe('102');
    results.flush(spOk(spResults()));
    await settle();
    expect(el().querySelector('tbody tr a')?.getAttribute('href')).toBe('/sp/timelines/7/results/123?programId=102');
  });

  it('an admin whose code named a program opens on it', async () => {
    await openFrame('/sp?code=abc');
    await exchange(sessionData({ isReportingAdmin: true, program: SP02 }));
    (await until(() => http.expectOne(`${SP_API}/sp/me`))).flush(spOk(meData({ isReportingAdmin: true, program: SP02, programs: [SP01, SP02] })));
    await settle();
    const timelines = await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines`));
    expect(timelines.request.params.get('programId')).toBe('102');
    timelines.flush(spOk(spTimelines({ timelines: [], defaultTimelineId: null })));
    await settle();
    expect(el().textContent).toContain('There is no QA timeline for this program');
  });

  it('"Export comments" downloads the CSV through an object URL with the server file name', async () => {
    const created: Blob[] = [];
    const revoked: string[] = [];
    const clicked: { download: string; href: string }[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return 'blob:sp-test';
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    try {
      await openFrame('/sp?code=abc');
      await exchange();
      (await until(() => http.expectOne(`${SP_API}/sp/me`))).flush(spOk(meData()));
      await settle();
      (await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines`))).flush(spOk(spTimelines()));
      await settle();
      (await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results`))).flush(spOk(spResults()));
      await settle();

      const button = el().querySelector<HTMLButtonElement>('button[aria-label="Export comments of result 123"]')!;
      button.click();
      await settle();
      const req = http.expectOne((r) => r.url === `${SP_API}/sp/timelines/7/results/123/comments.csv`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer sp-token-1');
      req.flush(new Blob(['Section,Field\n'], { type: 'text/csv' }), {
        headers: { 'Content-Disposition': 'attachment; filename="result-123-qa-comments.csv"' },
      });
      await settle();

      expect(created.length).toBe(1);
      expect(clicked).toEqual([{ download: 'result-123-qa-comments.csv', href: 'blob:sp-test' }]);
      expect(revoked).toEqual(['blob:sp-test']);
      expect(el().querySelector('a[download]')).toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });

  it('reads the file name from Content-Disposition, with a fallback', () => {
    expect(fileNameFrom('attachment; filename="result-9-qa-comments.csv"', 'x.csv')).toBe('result-9-qa-comments.csv');
    expect(fileNameFrom("attachment; filename*=UTF-8''a%20b.csv", 'x.csv')).toBe('a b.csv');
    expect(fileNameFrom(null, 'result-9-qa-comments.csv')).toBe('result-9-qa-comments.csv');
    expect(fileNameFrom('attachment; filename="../../evil.csv"', 'x.csv')).toBe('.._.._evil.csv');
  });
});
