import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiEnvelope, unwrap } from '../http/api-envelope';
import { Credentials, LoginResult, Session, UserProfile } from './auth.models';

/**
 * HTTP calls of the auth API (`/api/v1/auth/*`). Only transport: no state here.
 * Cookies (`qa_rt`, `qa_ru`) are handled by the browser; the interceptor adds `withCredentials`.
 */
@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_CONFIG).apiBaseUrl}/auth`;

  login(credentials: Credentials): Observable<LoginResult> {
    return this.http
      .post<ApiEnvelope<LoginResult>>(`${this.base}/login`, {
        email: credentials.email,
        password: credentials.password,
      })
      .pipe(unwrap<LoginResult>());
  }

  completeNewPassword(email: string, newPassword: string, session: string): Observable<Session> {
    return this.http
      .post<ApiEnvelope<Session>>(`${this.base}/complete-new-password`, {
        email,
        newPassword,
        session,
      })
      .pipe(unwrap<Session>());
  }

  providerUrl(redirectUri: string): Observable<{ url: string }> {
    return this.http
      .get<ApiEnvelope<{ url: string }>>(`${this.base}/provider-url`, {
        params: new HttpParams().set('redirectUri', redirectUri),
      })
      .pipe(unwrap<{ url: string }>());
  }

  exchangeCode(code: string, redirectUri: string): Observable<Session> {
    return this.http
      .post<ApiEnvelope<Session>>(`${this.base}/callback`, { code, redirectUri })
      .pipe(unwrap<Session>());
  }

  /** No body: the refresh token travels in the httpOnly cookie. */
  refresh(): Observable<Session> {
    return this.http
      .post<ApiEnvelope<Session>>(`${this.base}/session/refresh`, null)
      .pipe(unwrap<Session>());
  }

  /** 204, no body. */
  logout(): Observable<void> {
    return this.http
      .post<ApiEnvelope<void>>(`${this.base}/session/logout`, null)
      .pipe(unwrap<void>());
  }

  me(): Observable<UserProfile> {
    return this.http.get<ApiEnvelope<UserProfile>>(`${this.base}/me`).pipe(unwrap<UserProfile>());
  }
}
