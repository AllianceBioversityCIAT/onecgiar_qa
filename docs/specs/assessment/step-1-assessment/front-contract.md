# Front contract — step-1 assessment

What the front may rely on for the assessment routes. Every shape below was read from the DTOs, the OpenAPI models, the controllers, `assessment.errors.ts`, `common/api-response.ts` and `common/http-exception.filter.ts` (not from `design.md`). Where it goes beyond `design.md` § 6, it is marked **beyond § 6**. If the code and this file disagree, the code wins and this file is a defect.

## 1. Quick path

1. Call `GET /worklist/timelines`, open `defaultTimelineId`.
2. Call `GET /timelines/:timelineId/worklist/options` once, then `GET /timelines/:timelineId/worklist` per page.
3. Open a row with `GET /timelines/:timelineId/results/:resultCode/assessment`; show `writable` and `readOnlyReason`.
4. Write with `PUT …/assessment/validations`, `POST …/assessment/comments` and `POST …/assessment/finish`.
5. Read `error.code` on every refusal (section 9). Never parse `error.message`.

## 2. Envelope and conventions

Prefix `/api/v1`. Every route needs a Bearer token. A 204 never occurs in this module.

| Part | Shape |
|---|---|
| Success | `{ success: true, data, meta: { requestId, timestamp, page? } }` |
| Error | `{ success: false, error: { status, code, message, fields?, retryAfter? }, meta: { requestId, timestamp } }` |
| `meta.requestId` | Also the `x-request-id` header. Quote it to support |
| `meta.page.nextCursor` | Only on the worklist page. `null` on the last page |
| `error.fields` | `ApiFieldError[]` (`{ field, code, message }`) on a `VALIDATION_FAILED`; **`string[]` (field keys) on `ASSESSMENT_CORE_UNCOMMENTED`** (section 6.5). **beyond § 6** |
| Unknown query or body key | 400 `VALIDATION_FAILED` with `fields[].code` `UNKNOWN_FIELD` (nothing extra is accepted) |
| Ids in paths | Positive integers. Anything else is a 400 on that field, never a lookup |
| Times | Step times are Rome wall-clock minutes (`YYYY-MM-DDTHH:mm`, no offset); every other time is an ISO 8601 instant |

Permissions in the tables below:

| Word | Meaning |
|---|---|
| any user | Any authenticated, admitted user (`@ReadAccess()`). The service then applies the scope |
| writer | A caller with an enabled reviewer role row (today only `ASSESSOR`) that covers the result, with that role's step open now. ADMIN alone is never a writer |
| admin | `ADMIN_ACCESS`; anyone else gets 403 `AUTH_PERMISSION_DENIED` before the handler runs |

## 3. Vocabulary

### 3.1 QA status (8 values)

Returned as `status` on worklist rows and the view header; accepted by the `status` filter. The set is closed.

| Key | Label | Produced today |
|---|---|---|
| `pending` | Pending | yes |
| `returned_to_program` | Returned to program | yes |
| `clarification_requested` | Clarification requested | yes |
| `pending_tpb_review` | Pending for TPB review | no (declared for later steps) |
| `pending_ppu` | Pending PPU | no (declared for later steps) |
| `unresolved` | Unresolved | no (declared for later steps) |
| `quality_assessed` | Quality Assessed | yes |
| `auto_validated` | Auto-validated | yes (hidden from the list unless filtered for) |

`status` is `null` for a membership that matches no rule. The worklist never lists one.

### 3.2 Read-only reasons

| Place | Values |
|---|---|
| Worklist row `readOnlyReason` | `admin_read_only`, `step_upcoming`, `step_closed`, `no_step`; `null` when the caller can write |
| Assessment view `readOnlyReason` | the four above, plus `finished` (the assessment ended); `null` when the caller can write |

### 3.3 Other words

| Field | Values |
|---|---|
| Step `state` | `upcoming`, `in_progress`, `closed` |
| Assessment `status` | `pending`, `quality_assessed`, `returned` |
| Field `mode` | `view` (value only), `assessed` (value, green mark, comment action) |
| Comment `state` | `open`, `withdrawn`, `clarification_requested`, `accepted`, `accepted_with_comment`, `disagreed`, `escalated`, `tpb_sided_program`, `tpb_sided_assessor`, `done`. This step writes `open` and `withdrawn` only |
| Release `outcome` | `qaed`, `not_qaed` |
| Release `status` | `pending`, `sent`, `refused` |
| Release `reason` | `null`, or on a refused row Reporting's word (`not_found`, `other_phase`, `not_submitted`) |
| Quick-comment `role` | `ASSESSOR`, `LEAD_ASSESSOR`, `TPB`, `PPU`. Any live grant of one of the four can use that role's quick comments; only `ASSESSOR` can write assessment comments today |

## 4. Worklist routes

### 4.1 `GET /worklist/timelines`

Permission: any user. Query: none. Never a 404: a caller with no timeline gets an empty list.

```
data: {
  timelines: [{
    id, name, kind: 'official' | 'additional',
    roles: string[],
    step: { position, name, opensAt, closesAt, state } | null
  }],
  defaultTimelineId: number | null,
  timeZone: 'Europe/Rome'
}
```

- `roles` holds the caller's enabled reviewer roles on that timeline (`['ASSESSOR']`) and, for a caller with the admin permission, `'ADMIN'` as well. An admin not assigned to a timeline sees `['ADMIN']`. **beyond § 6**
- `step` is the step of the caller's role (`null` when the timeline has none).
- `defaultTimelineId` is the official timeline when offered, else the one whose first step opens earliest, else `null`.
- Errors: 401 `AUTH_TOKEN_INVALID`, `AUTH_USER_NOT_ADMITTED`.

### 4.2 `GET /timelines/:timelineId/worklist`

Permission: any user. A timeline that is not offered to the caller, or does not exist, is the same 404 `TIMELINES_NOT_FOUND`.

| Query | Type | Notes |
|---|---|---|
| `status` | csv of statuses (3.1) | At most 50 values. Auto-validated rows are hidden unless this names `auto_validated` |
| `programId` | csv of positive integers, at most 50 values | CLARISA program ids |
| `resultTypeKey` | csv of strings, each at most 255 characters | At most 50 values |
| `q` | string, at most 200 | Result code (exact or prefix) or title (contains) |
| `sort` | `code` (default), `title`, `program`, `resultType`, `comments`, `answered`, `assessedBy`, `status` | Ties break by result code |
| `dir` | `asc` (default), `desc` | |
| `limit` | integer 1 to 100, default 25 | |
| `cursor` | string, at most 512 | The previous `meta.page.nextCursor`. Valid only with the same `sort` and `dir` |

Filters combine with AND. A list filter also accepts a repeated key (`status=a&status=b`).

```
data: {
  rows: [{
    membershipId, resultCode, title: string | null, updated: boolean,
    program: { id, code, name },
    resultType: { key, label },
    comments: number,            // open comments
    answeredBySp: 0,             // always 0 for now
    assessedBy: { id, nickname: string | null } | null,
    status, canOpen: true,
    readOnlyReason: string | null
  }],
  counters: { pending, finished, total },
  writable: boolean,
  noActiveRole: boolean
}
meta.page.nextCursor: string | null
```

| Field | Rule |
|---|---|
| `updated` | A round-2 re-entry whose fields changed since the previous round. The changed keys never leave the server |
| `counters.pending` | Rows with status `pending` |
| `counters.finished` | `quality_assessed`, `returned_to_program` and `clarification_requested` |
| `counters.total` | Every membership of the caller's scope under the Auto-validated hiding. **beyond § 6** |
| counters | Ignore the filters and the page. They follow the Auto-validated hiding only |
| `writable` | The caller can write now: an enabled reviewer role whose step is open. An admin with no reviewer row is never writable |
| `noActiveRole` | The caller is assigned to the timeline but no enabled role of theirs has a worklist (the page is empty). **beyond § 6** |

Errors: 400 `VALIDATION_FAILED` (bad filter, `limit`, `cursor`, or a cursor used with another `sort` or `dir`), 401, 404 `TIMELINES_NOT_FOUND`.

**Known gap (DD-13).** The Overview and Notifications screens build deep links with `?stage=…`. That value is not a status of the new vocabulary, so the front drops it and the list opens unfiltered. Those two screens stay on mock data until P2-3913.

### 4.3 `GET /timelines/:timelineId/worklist/options`

Permission: any user. Same 404 rule as 4.2.

```
data: {
  programs:    [{ id, code, name }],
  resultTypes: [{ key, label }],
  statuses:    [{ key, label }]     // all 8 statuses of 3.1, in that order; all three lists are empty when the caller has no enabled reviewer role and is not an admin
}
```

The shapes differ on purpose (**beyond § 6**): programs are `{ id, code, name }`, result types and statuses are `{ key, label }`. Programs and result types are limited to the caller's scope. Errors: 401, 404 `TIMELINES_NOT_FOUND`.

## 5. Assessment view

### 5.1 `GET /timelines/:timelineId/results/:resultCode/assessment`

Permission: any user. A read never creates the assessment.

| Query | Notes |
|---|---|
| `round` | Integer 1 or 2. ADMIN only; an admin reads the latest round by default. Ignored for a reviewer, whose own row decides |

```
data: {
  header: {
    resultCode, title: string | null,
    program: { id, code, name }, resultType: { key, label },
    timeline: { id, name },
    step: { position, name } | null,
    status
  },
  sections: [{ key, label, fields: Field[] }],
  other: Field[],
  writable: boolean,
  readOnlyReason: string | null,          // 3.2
  assessment: { status, assessedBy: { id, nickname } | null, finishedAt: string | null } | null
}
```

`assessment` is `null` until the first write creates the assessment.

`Field`:

| Property | Type and rule |
|---|---|
| `key`, `label`, `type` | Catalog key, label and type. `type` is `unknown` under `other` |
| `mode` | `view` or `assessed`. A Hidden field is never returned, except the Theory of Change group, which is shown as `view` |
| `core` | The "Core" tag; only meaningful on an `assessed` field |
| `value` | Any JSON value, as the snapshot holds it. `null` when `notApplicable` |
| `labels` | `{ [controlList]: { [id]: string \| null } } \| null`. Display labels of the ids in `value`; a `null` label is an id with no row. The whole object is `null` when the snapshot has none, and the front then shows the ids |
| `validated` | The green mark. Always `false` on a `view` field |
| `comments` | `Comment[]` (5.2) |
| `notApplicable` | The catalog has the field and the snapshot has no key for it |

Sections come in catalog order, only for fields that apply to the result type. The Theory of Change group is one section with key `theory_of_change`, at the position of its first field. `other` holds snapshot keys missing from the catalog, read only.

Errors: 400 `VALIDATION_FAILED`, 401, 404 `ASSESSMENT_NOT_FOUND`, 409 `ASSESSMENT_NO_FIELD_CONFIG`, 503 `SERVICE_UNAVAILABLE`.

### 5.2 `Comment`

```
{ id, fieldKey, author: { id, nickname: string | null }, body,
  state, stepPosition, round,
  valueCopy: { value, labels? }, valueTruncated: boolean,
  createdAt, withdrawnAt: string | null }
```

Authors are shown by nickname only. `valueCopy` is the field value (and its labels when the snapshot had them) as the author saw it; a value over 64 KiB is stored cut, with `valueTruncated: true`.

## 6. Write routes

`…` stands for `/timelines/:timelineId/results/:resultCode`. Every write is checked in this order: out of scope or unknown is 404 `ASSESSMENT_NOT_FOUND`, then no writer row is 403 `ASSESSMENT_READ_ONLY`, then a closed step is 409 `ASSESSMENT_STEP_CLOSED`, then an ended assessment is 409 `ASSESSMENT_FINISHED`. A result that no field configuration covers is 409 `ASSESSMENT_NO_FIELD_CONFIG`. A 503 `SERVICE_UNAVAILABLE` is retryable and nothing was committed.

### 6.1 `PUT …/assessment/validations`

Permission: writer. Status 200. The assessment row is created at the first write.

| Body | Rule |
|---|---|
| `validated` | boolean, required. `true` sets green, `false` back to grey |
| `fieldKeys` | 1 to 200 strings, each an Assessed field of the pinned configuration |
| `all` | `true`: every Assessed field |

Send exactly one of `fieldKeys` and `all`. Setting a field to the state it already has succeeds and changes nothing. A View only, Hidden or unknown key is a 400 `VALIDATION_FAILED` whose `fields[]` name each wrong key (`code: 'INVALID'`). A write that leaves every core field green ends the assessment as `quality_assessed` in the same transaction (an assessment with no core field never ends this way).

Response `data` (`ValidationSummary`, also the answer of 6.4):

```
{ status, assessedBy: { id, nickname } | null, finishedAt: string | null,
  validations: [{ fieldKey, validated }] }       // every row the assessment holds
```

`validations` is empty when the assessment does not exist yet. Errors: 400 `VALIDATION_FAILED`, `MALFORMED_JSON`; 401; 403 `ASSESSMENT_READ_ONLY`; 404 `ASSESSMENT_NOT_FOUND`; 409 `ASSESSMENT_STEP_CLOSED`, `ASSESSMENT_FINISHED`, `ASSESSMENT_NO_FIELD_CONFIG`; 413 `PAYLOAD_TOO_LARGE`; 503.

### 6.2 `POST …/assessment/comments` (idempotent)

Permission: writer, in the assessor's own step. Status **201**.

| Body | Rule |
|---|---|
| `fieldKey` | string, 1 to 200, an Assessed field of the pinned configuration. A View only, Hidden or unknown field is a 400 `VALIDATION_FAILED` on `fieldKey` (the key is not echoed) |
| `body` | string, trimmed first, then 1 to 2,000 characters (counted by character, not UTF-16 unit) |

Response `data`: one `Comment` (5.2), `state: 'open'`. Errors: as 6.1, plus the idempotency codes below.

**Idempotency.** `Idempotency-Key` is optional: without it the request runs untouched and nothing is remembered. To make a retry safe, send one (1 to 128 characters: letters, digits, `- _ . :`). The key is scoped to the caller.

| Case | Answer |
|---|---|
| Same key, same request, first run done | The stored first answer, same status, with header `Idempotency-Replayed: true`. Nothing runs again |
| Same key, same caller, different request | 422 `IDEMPOTENCY_KEY_REUSED` |
| Same key still running | 409 `IDEMPOTENCY_IN_PROGRESS` |
| Same key sent by another caller | A fresh comment: keys never cross callers |
| Bad key | 400 `VALIDATION_FAILED` |
| Key store down | 503 `SERVICE_UNAVAILABLE` |
| Crash window (committed, answer not stored) | The comment is re-read **now**, so after a withdraw it shows `withdrawn`; a replay of a completed key shows the stored `open` answer |

`createdAt` and `withdrawnAt` are cut to whole seconds so a replay equals the 201.

**Privacy note.** The stored answer lives in `idempotency_keys.response_body` and keeps the comment body, the value copy and the author's nickname until the key's retention purge (24 hours of replay). A withdraw does not clear it. This is the same pattern as the other keyed writes and is accepted.

### 6.3 `POST /assessment-comments/:commentId/withdraw`

Permission: the comment's author, while the comment is `open` and step 1 or step 2 of the timeline is open. Allowed after the assessment ended. No body. Status 200, `data` is the `Comment` with `state: 'withdrawn'` and `withdrawnAt` set. A withdrawn comment leaves the counts and the program view.

| Case | Answer |
|---|---|
| The comment does not exist, is outside the caller's scope, or has no assessment row | 404 `ASSESSMENT_NOT_FOUND`, the same body for all three |
| Another user's comment (an admin included) | 403 `ASSESSMENT_NOT_COMMENT_AUTHOR`, only after the scope check |
| The comment is no longer open | 409 `ASSESSMENT_COMMENT_NOT_OPEN` |
| Step 1 and step 2 both closed | 409 `ASSESSMENT_STEP_CLOSED` |

Errors: 400 `VALIDATION_FAILED`, 401, 403, 404, 409, 503.

The 404 answers are byte-equal. They are **not** time-equal: a request that resolves further before refusing takes measurably longer. This is the same accepted pattern as the read in 5.1.

### 6.4 `POST …/assessment/finish`

Permission: writer. No body. Status 200, `data` is the `ValidationSummary` of 6.1 with the end.

| Situation | Result |
|---|---|
| No grey core field (or no core field at all) | `quality_assessed` |
| Every grey core field has a non-withdrawn comment | `returned` |
| Otherwise | 409 `ASSESSMENT_CORE_UNCOMMENTED`, see 6.5 |

The end sets "Assessed by" to the caller, queues one release to Reporting (section 8) and makes every non-withdrawn comment visible to the program. Of several concurrent finishes exactly one succeeds; the others get 409 `ASSESSMENT_FINISHED`. Errors: 400, 401, 403 `ASSESSMENT_READ_ONLY`, 404, 409 `ASSESSMENT_CORE_UNCOMMENTED`, `ASSESSMENT_FINISHED`, `ASSESSMENT_STEP_CLOSED`, `ASSESSMENT_NO_FIELD_CONFIG`, 503.

### 6.5 The 409 `ASSESSMENT_CORE_UNCOMMENTED` body

```
{ success: false,
  error: { status: 409, code: 'ASSESSMENT_CORE_UNCOMMENTED', message,
           fields: ['general.title', …] },       // string[]: the core field KEYS
  meta }
```

**beyond § 6.** `error.fields` is a `string[]` of field keys still to validate or comment on, not the usual `ApiFieldError[]`. Only this code does it. The client's `ApiError.fields` type must accept both (T-17).

## 7. Quick comments

Reusable comment texts shared by role. Permission: any user at the controller; the service then requires a live grant **of the role named** (an ADMIN's blanket permissions do not count). Any other caller gets 403 `AUTH_PERMISSION_DENIED`.

Quick comments are open to any live grant of `ASSESSOR`, `LEAD_ASSESSOR`, `TPB` or `PPU`, including roles that cannot write assessment comments yet (only `ASSESSOR` can today). **beyond § 6**

| Route | Request | Response |
|---|---|---|
| `GET /quick-comments?role=` | `role`: one of the four roles. Anything else is a 400 | 200, `data: [{ id, body, createdAt }]`, newest first, the same list for everyone with a live grant of the role |
| `POST /quick-comments` | `{ role, body }`; `body` trimmed, 1 to 2,000 characters | **201** with the new entry, or **200** with the existing entry when the same text (case-sensitive) is already saved for the role. Only the first writes an audit row |

Errors: 400 `VALIDATION_FAILED` (and `MALFORMED_JSON` on the POST), 401, 403 `AUTH_PERMISSION_DENIED`, 413 `PAYLOAD_TOO_LARGE` (POST), 503.

## 8. Release outbox (admin)

When an assessment ends, one release row is queued and sent to Reporting in the background; the end never waits for Reporting. Permission on both routes: admin.

### 8.1 `GET /assessment-releases`

| Query | Rule |
|---|---|
| `status` | `pending` or `refused`. Optional, default `pending` |

```
data: [{ id, timeline: { id, name }, resultCode, outcome, status, attempts, reason: string | null, createdAt }]
```

Oldest first. **Capped at 500 rows and the answer does not say it was cut**: an array of 500 may be the whole list or the first 500. A leased row (one a dispatcher claimed a moment ago) counts as `pending`. `attempts` is how many times a dispatch claimed the row (it stops at 255). A `refused` row is final: it is listed, it is not retried, and its membership stays active. Errors: 400 `VALIDATION_FAILED`, 401, 403 `AUTH_PERMISSION_DENIED`, 503.

### 8.2 `POST /assessment-releases/retry`

No body, status 200. Claims the pending rows whose lease has passed, sends and acknowledges them, and answers when the sweep is done.

```
data: { attempted, sent, refused, stillPending }
```

| Field | Meaning |
|---|---|
| `attempted` | Rows claimed |
| `sent` | Acknowledged: released, or already out of QA (`not_in_qa`) |
| `refused` | Turned down by Reporting |
| `stillPending` | Claimed but not acknowledged. Counts **only claimed rows**: rows left unclaimed because the sweep stopped are not in it |

A call runs at most **3 batches** (one batch is one phase year, up to 50 rows), so call again until `attempted` is 0. A row sent a moment ago by another dispatch is not sent twice. Errors: 401, 403 `AUTH_PERMISSION_DENIED`.

For the admin header count, read `GET /assessment-releases?status=pending` and use the array length (at most 500).

## 9. Error codes

### 9.1 Module codes (`assessment.errors.ts`)

| Code | Status | Raised by |
|---|---|---|
| `ASSESSMENT_NOT_FOUND` | 404 | View, every write, withdraw: no such membership, or outside the caller's scope |
| `ASSESSMENT_READ_ONLY` | 403 | Writes by a caller with no writer row (an admin, for example) |
| `ASSESSMENT_STEP_CLOSED` | 409 | Writes while the role's step is not open; withdraw when neither step 1 nor step 2 is open |
| `ASSESSMENT_FINISHED` | 409 | A write on an ended assessment; the losers of concurrent finishes |
| `ASSESSMENT_NO_FIELD_CONFIG` | 409 | View and writes: no field configuration applies to the result type |
| `ASSESSMENT_CORE_UNCOMMENTED` | 409 | Finish (6.5) |
| `ASSESSMENT_NOT_COMMENT_AUTHOR` | 403 | Withdraw of someone else's comment |
| `ASSESSMENT_COMMENT_NOT_OPEN` | 409 | Withdraw of a comment that is no longer open |

### 9.2 Reused codes

| Code | Status | Where |
|---|---|---|
| `TIMELINES_NOT_FOUND` | 404 | Worklist page and options |
| `VALIDATION_FAILED` | 400 | Any route; `fields[]` names the fields |
| `MALFORMED_JSON` | 400 | Bodies that are not JSON |
| `AUTH_TOKEN_INVALID`, `AUTH_USER_NOT_ADMITTED` | 401 | Every route |
| `AUTH_PERMISSION_DENIED` | 403 | Quick comments (no live grant of the role), releases (not admin) |
| `PAYLOAD_TOO_LARGE` | 413 | Bodies |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Comment create (6.2) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Comment create (6.2) |
| `SERVICE_UNAVAILABLE` | 503 | A read or write that could not complete; retry |

## 10. Checklist for the front

- [ ] Types accept `error.fields` as `ApiFieldError[]` or `string[]`.
- [ ] The worklist reads `counters.total` and `noActiveRole`.
- [ ] `roles` may contain `'ADMIN'`; an admin-only caller sees every timeline read-only.
- [ ] The filter options map `{ id, code, name }` and `{ key, label }` separately.
- [ ] The comment form sends an `Idempotency-Key` and treats `Idempotency-Replayed: true` as success.
- [ ] The admin release count does not assume an array under 500 is complete.
- [ ] Overview and Notifications `?stage=…` links open the list unfiltered (DD-13) until P2-3913.
