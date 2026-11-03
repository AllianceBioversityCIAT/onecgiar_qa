import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { SILENT_ERRORS } from '../http/request-context';
import { GrantableRole, ResultTypeOption, ScienceProgramOption } from './users.models';

/**
 * Catalogs the admin forms are built from (`/api/v1/catalogs`). Result types come from the
 * Reporting Tool and programs from CLARISA through the server; either can answer 503. Silent: the
 * screen that asked says what is missing (no extra toast on top of it).
 */
@Service()
export class CatalogsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_CONFIG).apiBaseUrl}/catalogs`;
  private readonly context = new HttpContext().set(SILENT_ERRORS, true);

  roles(): Observable<readonly GrantableRole[]> {
    return this.http.get<ApiEnvelope<readonly GrantableRole[]>>(`${this.base}/roles`, { context: this.context }).pipe(unwrap<readonly GrantableRole[]>());
  }

  resultTypes(): Observable<readonly ResultTypeOption[]> {
    return this.http
      .get<ApiEnvelope<readonly ResultTypeOption[]>>(`${this.base}/result-types`, { context: this.context })
      .pipe(unwrap<readonly ResultTypeOption[]>());
  }

  sciencePrograms(): Observable<readonly ScienceProgramOption[]> {
    return this.http
      .get<ApiEnvelope<readonly ScienceProgramOption[]>>(`${this.base}/science-programs`, { context: this.context })
      .pipe(unwrap<readonly ScienceProgramOption[]>());
  }
}
