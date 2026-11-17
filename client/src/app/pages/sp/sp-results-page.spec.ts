import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { SP_API, meData, setupSpTesting, spOk, startSpSession, until } from '../../core/sp/sp-testing';
import { SpContext } from './sp-context';
import { SpCsvDownload } from './sp-csv-download';
import { spResults, spTimelines } from './sp-fixtures';
import { SpResultsPage } from './sp-results-page';

describe('SpResultsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let downloads: { resultCode: number; done: () => void }[];

  const el = () => harness.routeNativeElement as HTMLElement;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      harness.detectChanges();
    }
  }

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/sp');
    (await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines`))).flush(spOk(spTimelines()));
    await settle();
  }

  async function flushResults(timelineId: number, data = spResults()): Promise<void> {
    (await until(() => http.expectOne((r) => r.url === `${SP_API}/sp/timelines/${timelineId}/results`))).flush(spOk(data));
    await settle();
  }

  beforeEach(async () => {
    downloads = [];
    const fakeCsv = {
      download: (_timelineId: number, resultCode: number) =>
        new Promise<void>((resolve) => {
          downloads.push({ resultCode, done: resolve });
        }),
    };
    http = setupSpTesting(undefined, [{ provide: SpCsvDownload, useValue: fakeCsv }], [{ path: '', component: SpResultsPage }]);
    await startSpSession(http);
    TestBed.inject(SpContext).setMe(meData());
  });
  afterEach(() => http.verify());

  it("while another timeline loads, the old timeline's step and filters are not shown", async () => {
    await open();
    await flushResults(7);
    expect(el().querySelector('[data-testid=sp-step]')?.textContent).toContain('Open for responses');
    expect(el().querySelectorAll('qa-multi-select').length).toBe(2);

    TestBed.inject(SpContext).timelineId.set(8);
    await settle();
    expect(el().querySelector('[data-testid=sp-step]')).toBeNull();
    expect(el().querySelector('[data-testid=sp-step-loading]')).not.toBeNull();
    expect(el().querySelector('[data-testid=sp-filters-loading]')).not.toBeNull();
    expect(el().querySelectorAll('qa-multi-select').length).toBe(0);
    expect(el().querySelector('qa-sp-results-rows-skeleton')).not.toBeNull();

    await flushResults(8, spResults({ step: null }));
    expect(el().querySelector('[data-testid=sp-step-loading]')).toBeNull();
    expect(el().querySelector('[data-testid=sp-step]')).toBeNull();
    expect(el().textContent).toContain('This timeline has no response step for programs.');
    expect(el().querySelectorAll('qa-multi-select').length).toBe(2);
  });

  it('a new filter on the same timeline keeps the step and the filters while it loads', async () => {
    await open();
    await flushResults(7);
    TestBed.inject(SpContext).statuses.set(['quality_assessed']);
    await settle();
    expect(el().querySelector('[data-testid=sp-step]')).not.toBeNull();
    expect(el().querySelector('[data-testid=sp-filters-loading]')).toBeNull();
    await flushResults(7);
  });

  it('while one row exports, the other rows cannot export', async () => {
    await open();
    await flushResults(7, spResults({ rows: [spResults().rows[0], { ...spResults().rows[0], resultCode: 125, comments: 2 }] }));
    const exportButton = (code: number) => el().querySelector<HTMLButtonElement>(`button[aria-label="Export comments of result ${code}"]`)!;
    expect(exportButton(125).disabled).toBe(false);

    exportButton(123).click();
    await settle();
    expect(downloads.map((d) => d.resultCode)).toEqual([123]);
    expect(exportButton(123).disabled).toBe(true);
    expect(exportButton(125).disabled).toBe(true);

    exportButton(125).click();
    await settle();
    expect(downloads.length).toBe(1);

    downloads[0].done();
    await settle();
    expect(exportButton(123).disabled).toBe(false);
    expect(exportButton(125).disabled).toBe(false);
  });

  it('the table fits narrow widths: no fixed minimum below the md breakpoint', async () => {
    await open();
    await flushResults(7);
    const table = el().querySelector('table')!;
    expect(table.className).not.toMatch(/(^|\s)min-w-\[820px\]/);
    expect(table.className).toContain('md:min-w-[820px]');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
  });
});
