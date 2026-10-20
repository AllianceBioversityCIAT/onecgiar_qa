import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { GrantableRole, ResultTypeOption, ScienceProgramOption } from './users.models';

/**
 * Catalogs the admin forms are built from (`/api/v1/catalogs`). Result types come from the
 * Reporting Tool and programs from CLARISA through the server; either can answer 503.
 */
@Service()
export class CatalogsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_CONFIG).apiBaseUrl}/catalogs`;

  roles(): Observable<readonly GrantableRole[]> {
    return this.http.get<ApiEnvelope<readonly GrantableRole[]>>(`${this.base}/roles`).pipe(unwrap<readonly GrantableRole[]>());
  }

  resultTypes(): Observable<readonly ResultTypeOption[]> {
    return this.http
      .get<ApiEnvelope<readonly ResultTypeOption[]>>(`${this.base}/result-types`)
      .pipe(unwrap<readonly ResultTypeOption[]>());
  }

  sciencePrograms(): Observable<readonly ScienceProgramOption[]> {
    return this.http
      .get<ApiEnvelope<readonly ScienceProgramOption[]>>(`${this.base}/science-programs`)
      .pipe(unwrap<readonly ScienceProgramOption[]>());
  }
}
