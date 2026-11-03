import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { NO_QUEUE, SILENT_ERRORS, UNSENT_LABEL } from '../http/request-context';
import { FieldConfigApi } from './field-config-api';

const API = 'https://api.test/api/v1';
const FC = `${API}/cycles/34/field-config`;
const meta = { requestId: 'r', timestamp: 't' };

describe('FieldConfigApi', () => {
  let http: HttpTestingController;
  let api: FieldConfigApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(FieldConfigApi);
  });
  afterEach(() => http.verify());

  it('reads the view (silent: the screen shows its own states) and the preview', async () => {
    const view = firstValueFrom(api.view(34));
    const viewReq = http.expectOne(FC);
    expect(viewReq.request.context.get(SILENT_ERRORS)).toBe(true);
    viewReq.flush({ success: true, data: { revision: 3 }, meta });
    expect((await view).revision).toBe(3);
    void firstValueFrom(api.preview(34));
    http.expectOne(`${FC}/publish-preview`).flush({ success: true, data: { revision: 3 }, meta });
  });

  it('writes go to the contract routes, silent and labelled; only publish may be queued', () => {
    const items = [{ resultTypeKey: 'policy_change', fieldKey: 'title', visibility: 'assessed' as const, isCore: true, isAiInput: false }];
    void firstValueFrom(api.editDraft(34, items));
    void firstValueFrom(api.discardDraft(34));
    void firstValueFrom(api.publish(34, 7));
    const reqs = http.match((r) => r.url.startsWith(FC));
    expect(reqs.map((r) => `${r.request.method} ${r.request.url}`)).toEqual([
      `PATCH ${FC}/draft`,
      `DELETE ${FC}/draft`,
      `POST ${FC}/publish`,
    ]);
    expect(reqs[0].request.body).toEqual({ items });
    expect(reqs[2].request.body).toEqual({ revision: 7 });
    expect(reqs.map((r) => r.request.context.get(UNSENT_LABEL))).toEqual([
      'Change a field in QA',
      'Discard the field changes',
      'Publish the fields in QA',
    ]);
    // A late replay of an edit or a discard would overwrite newer edits: never queued.
    expect(reqs.map((r) => r.request.context.get(NO_QUEUE))).toEqual([true, true, false]);
    for (const r of reqs) {
      expect(r.request.context.get(SILENT_ERRORS)).toBe(true);
      r.flush({ success: true, data: {}, meta });
    }
  });
});
