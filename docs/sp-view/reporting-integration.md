# SP view: Reporting integration (P2-3911)

## 1. Flow

1. The SP user clicks "Quality Assurance" in Reporting.
2. The Reporting client asks the Reporting back for a link. This is Reporting's own route, behind its own auth.
3. The Reporting back calls the QA back: `POST /api/v1/sp-access/codes` with the `x-api-key` header. QA answers `201 { code, expiresAt }`. The code works once and lasts 60 s.
4. The Reporting client sets the iframe `src` to `{QA_WEB_URL}/sp?code=<code>`.
5. The QA page in the iframe trades the code for an SP session. Only QA talks to QA here; Reporting has no part in it.

Rules:

- Reporting never sees or stores the QA session. It only carries the code, for at most 60 s.
- There is no CLARISA hop.
- Ask for a NEW code every time the iframe is (re)loaded. Never cache or reuse one.

## 2. Server-to-server call (Reporting back to QA back)

`POST {QA_SP_ACCESS_API_URL}/sp-access/codes`

- Base URL: the QA API with its prefix, e.g. `https://<qa-api-host>/api/v1`.
- Headers: `x-api-key: <QA_SP_ACCESS_API_KEY>`, `Content-Type: application/json`.
- Only the Reporting back calls it, never the browser. Suggested timeout 10 s; no retry on 4xx.

Request body:

```json
{ "email": "user@example.org", "name": "First Last", "programCode": "SP01", "isReportingAdmin": false }
```

| Field | Rule |
| --- | --- |
| `email` | Required, a valid email, at most 320 characters. Stored with each SP response (AC12). |
| `name` | Required, 1 to 200 characters after trim. Shown as the person who responded. |
| `programCode` | The program's official code, e.g. `SP01`, at most 32 characters. Required when `isReportingAdmin` is false. An admin may send `null` (they pick a program in the view) or a code (the view opens on that program). |
| `isReportingAdmin` | Required boolean. When true, the session may read and respond for ANY program. |

Unknown fields get a 400.

Reporting decides who may get a code (Lead, Co-Lead, Coordinator or Member of the program, or a Reporting admin). QA trusts the authenticated machine call and does not check Reporting roles again.

Response `201`:

```json
{ "success": true, "data": { "code": "<43 base64url chars>", "expiresAt": "<ISO-8601>" }, "meta": { "requestId": "..." } }
```

The code is opaque, works once, and lasts 60 s. QA stores only its SHA-256.

Errors use the QA envelope: `{ success: false, error: { status, code, message, fields? }, meta: { requestId } }`.

| Status and code | When | What Reporting shows |
| --- | --- | --- |
| 400 `VALIDATION_FAILED` | A field is missing or bad (`error.fields` names it), or a field is unknown. A bug in the call. | A generic error |
| 400 `SP_PROGRAM_UNKNOWN` | `programCode` is not a Science Program QA knows, or it is `null` for a non-admin | "This program is not in QA yet". Do not retry. |
| 401 `SP_ACCESS_KEY_INVALID` | The key is missing or wrong. A configuration error: log it without the key. | A generic error |
| 503 `SP_ACCESS_DISABLED` | No key is set in this QA environment | "Quality Assurance is not available right now" |
| Any 5xx, timeout or network failure | — | A generic error. "Try again" asks for a NEW code. |

## 3. Iframe

URL: `{QA_WEB_URL}/sp?code=<encodeURIComponent(code)>`

- `QA_WEB_URL` is the QA WEB origin (the Angular app), not the API. In the Reporting client this is the existing `environment.qaUrl`, pointed at the new QA.
- Load the iframe right after the code comes back: the 60 s include the page load.
- Suggested title: "Quality Assurance". No sandbox is needed. If you add one, it must allow `allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox`. These cover the CSV export and the "Open in Reporting" link.

What the QA page does with the code:

- It calls `POST /api/v1/sp-access/session { code }` in the browser, never during server rendering.
- It keeps the bearer token in memory only (no cookies, no storage) and sends it as `Authorization: Bearer`.
- It removes the code from its address bar.
- The session lasts 8 h from when it starts. It covers the code's program only; an admin's session covers every program.

Expiry and errors inside the iframe:

- The QA page shows a "link expired" message when the code was already used, is older than 60 s, or the session later expires or is refused.
- It then posts one message to the parent window: `{ type: 'qa-sp:reload-required', reason: 'code_invalid' | 'session_expired' }`. The message carries no personal data and no token.
- Reporting should listen for it:

  ```js
  window.addEventListener('message', e => {
    if (e.origin !== QA_WEB_ORIGIN) return;
    if (e.data?.type === 'qa-sp:reload-required') {
      /* get a NEW code, then set iframe.src again */
    }
  });
  ```

- Reload automatically at most once per user action, then show a Reload button, so a QA outage cannot cause a loop.

## 4. Allowed origins (framing)

- The QA web SSR server sends `Content-Security-Policy: frame-ancestors <origins>` on `/sp` pages. The origins come from `SP_FRAME_ANCESTORS`.
- QA's API CORS does not change. The iframe page lives on the QA web origin, and the server-to-server call has no `Origin` header.
- If CloudFront serves `/sp` HTML from its cache instead of the SSR server, the same header must be set in a CloudFront response-headers policy for `/sp*`. This is an infra step.

## 5. Environment variables

QA side:

| Where | Variable | Meaning |
| --- | --- | --- |
| QA server | `SP_ACCESS_API_KEY` | Optional; when unset, SP access is off and `/sp-access/codes` answers 503. A secret of at least 32 random characters, with the same value as Reporting's `QA_SP_ACCESS_API_KEY`. Keep it in the secret store or `.env` only. |
| QA server | `SP_REPORTING_RESULT_URL` | Optional; when unset there is no "Open in Reporting" link. An `https://` template with `{resultCode}`, e.g. `https://reporting.cgiar.org/result/result-detail/{resultCode}/general-information`. Reporting opens the current phase. |
| QA web SSR | `SP_FRAME_ANCESTORS` | Space-separated exact Reporting origins. When unset it is `'none'`, so `/sp` cannot be framed. |

Reporting side:

| Where | Variable | Meaning |
| --- | --- | --- |
| Reporting server | `QA_SP_ACCESS_API_URL` | The QA API base with its prefix, e.g. `https://<qa-api-host>/api/v1` |
| Reporting server | `QA_SP_ACCESS_API_KEY` | A secret, the same value as QA's `SP_ACCESS_API_KEY` |
| Reporting client | `environment.qaUrl` (existing) | The QA web origin |

Key rotation: set the new value in both secret stores, then redeploy QA, then Reporting. Calls in between answer 401.

## 6. Suggested Reporting back route

For example `GET /api/qa/sp-link?programId=...`, behind Reporting's own auth:

1. Read the user's email and full name from the session.
2. Apply Reporting's rules: Lead, Co-Lead, Coordinator or Member of the program, or a Reporting admin (send `isReportingAdmin=true`). Anyone else gets a 403, and QA is not called.
3. Call `POST /sp-access/codes` and return `{ code, expiresAt }` to the client.
4. Never log the key, the code, or the response body.

## 7. Out of scope for Reporting

- Correcting and resubmitting stays in Reporting under its current rules (AC16). The QA view only links to the result.
- P2-3911 needs nothing new from Reporting for these two points, which come from P2-3906 and the existing `not_qaed` release:
  - "Updated" fields in step 3.
  - Only resubmitted results go to step 3.
