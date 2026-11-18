# SP view (P2-3911)

Science Program users (Lead, Co-Lead, Coordinator, Member, and Reporting admins) open QA from Reporting's "Quality Assurance" option. The QA page `/sp` is embedded in a Reporting iframe. In step 2 of a result's timeline (audience `programs`) they respond to each assessor comment. Integration contract: [`reporting-integration.md`](reporting-integration.md).

## Decisions (back lead, Jira P2-3911 comment 44992)

- **Access**
  - Reporting back → QA back: `POST /api/v1/sp-access/codes` with `x-api-key`, sending email, name, program official code and `isReportingAdmin`.
  - QA returns a one-time code valid for 60 s.
  - The iframe opens `{QA_WEB}/sp?code=…`. The page exchanges the code once, in the browser, for an SP session scoped to the program (admin: any program).
  - The session is held in memory and sent as a Bearer header. No cookies.
  - `frame-ancestors` comes from `SP_FRAME_ANCESTORS`. There is no CLARISA hop.
- **Changing a response:** allowed while step 2 is open. The latest counts; the history keeps who, date and time.
- **Clarifications:** the comment's author (an assessor) answers while step 2 is open, and the comment goes back to `open`. Unanswered when step 2 closes, it stays for the Lead Assessor (P2-3912).
- **Export:** CSV per result. No assessor names.
- **Storage:** responses are stored so P2-3912 can show all of them and flag Disagree on core fields.

## Endpoints (`/api/v1`)

**SP access (public)**

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /sp-access/codes` | `x-api-key` | Issue a one-time code (Reporting back only) |
| `POST /sp-access/session` | none; 10 per minute per IP | Exchange the code; returns `{ accessToken, expiresAt, user, program, isReportingAdmin }`, 8 h |

**SP session routes** (`Authorization: Bearer`; a non-admin is limited to its own program, anything else is a 404 `SP_NOT_FOUND`; an admin sends `programId`)

| Method and path | Purpose |
| --- | --- |
| `GET /sp/me` | Session context and the programs it can pick |
| `GET /sp/timelines` | The official timeline plus additional ones covering the program, with the step-2 window and state |
| `GET /sp/timelines/:tid/results?status&resultTypeKey` | Rows: code, title, updated, type, comments, answered, QA status; plus filter options |
| `GET /sp/timelines/:tid/results/:code` | Header with `reportingUrl`, sections and fields with SP-visible comments, `writable`, `readOnlyReason`, counts. No assessor identity |
| `PUT /sp/comments/:id/response` | `{ kind, body? }`. Kinds: `accept`, `accept_with_comment`, `disagree`, `request_clarification`. Text is required except for `accept`. Never validates a field or ends an assessment. The same kind and text as the latest response writes nothing (safe retry) |
| `GET /sp/timelines/:tid/results/:code/comments.csv` | CSV columns: Section, Field, Comment, Comment date, Response, Response comment, Responded at |

**Assessor routes** (Cognito)

| Method and path | Purpose |
| --- | --- |
| `POST /assessment-comments/:id/clarification-answer` | The author answers a clarification while step 2 is open |
| `GET /timelines/:tid/results/:code/sp-responses` | The full SP threads, with responder names |

**Error codes:** `SP_ACCESS_DISABLED`, `SP_ACCESS_KEY_INVALID`, `SP_PROGRAM_UNKNOWN`, `SP_CODE_INVALID`, `SP_SESSION_INVALID`, `SP_NOT_FOUND`, `SP_STEP_CLOSED`, `SP_COMMENT_NOT_RESPONDABLE`, `CLARIFICATION_NOT_PENDING`.

## Data model (migration 0011)

- `sp_link_codes`: code hash (unique), email, name, program id, admin flag, `expires_at`, `used_at`. A code is used once through a conditional UPDATE.
- `sp_sessions`: token hash (unique), email, name, program id, admin flag, `expires_at`.
- `sp_comment_responses`: comment, kind, body, responder name and email, program, `created_at`. The history is append-only; the latest row counts.
- `comment_clarification_answers`: comment, the clarification request it answers (unique), author (a user), body.
- `comment_events`:
  - `actor_id` is now nullable, and `sp_response_id` is added.
  - A row must carry one of the two (CHECK).
  - SP transitions use actor role `PROGRAM`.
- **Comment states**
  - Program: from `open`, `accepted`, `accepted_with_comment`, `disagreed` or `clarification_requested` to `accepted`, `accepted_with_comment`, `disagreed` or `clarification_requested`.
  - Author: `clarification_requested` → `open`.
- **Worklist:** `answeredBySp` counts comments in `accepted`, `accepted_with_comment` and `disagreed`.

## Rules

- A comment is SP-visible when `visible_to_program_at` is set, it is not withdrawn, and the programs step has started.
- Responses are accepted only while that step is in progress.
- Nothing about the assessor is sent to the SP.
- Nothing personal (email, name, code, token, key) is logged.
- `POST /sp-access/codes` has no per-IP throttle on purpose: every call comes from the Reporting back (one IP), so a per-IP limit would block all SP users together. The key (at least 32 random characters) is the guard.

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `SP_ACCESS_API_KEY` | QA server | Secret, at least 32 characters. Unset turns SP access off |
| `SP_REPORTING_RESULT_URL` | QA server | Optional; `https://` with `{resultCode}` |
| `SP_FRAME_ANCESTORS` | QA web SSR | Space-separated exact Reporting origins. Unset means `'none'` |

- `SP_ACCESS_API_KEY` is a plain environment variable in both QA and Reporting (no Secrets Manager). TEST has it in both services. PROD does not yet: set the same value in QA and Reporting on the release day, then redeploy QA, then Reporting.
- The `/sp-access/session` throttle keys on the client IP through `trust proxy = 1` (one Apache reverse proxy in TEST and PROD, verified 2026-11-18). Its store is in memory per process, so N processes give N × 10 per minute.

## Not in this story

- "Updated" fields in step 3 and "only resubmitted results go to step 3": P2-3906.
- The Lead Assessor view: P2-3912.
- The full Excel export: P2-3914.
- Notifications, and change requests on QA'd results.
