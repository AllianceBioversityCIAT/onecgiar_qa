# Front contract — round 2 (Lead Assessor)

What the front may rely on for the Lead Assessor's review of a re-submitted result. Every shape below was read from the DTOs, the OpenAPI models, the controller and `assessment.errors.ts`, not from `design.md`. If the code and this file disagree, the code wins and this file is a defect. It adds to `docs/specs/assessment/step-1-assessment/front-contract.md` (the envelope, the scope 404, the write order and the unchanged routes live there); read that file first.

## 1. Quick path

1. Open the result with the step-1 view route. A Lead's row is round 2: `round` is `2`.
2. Draw only fields with `actionable: true` as actionable. Every other field is context.
3. Per core field, show `thread[]`. Show the decision controls on an item only when `writable && item.decidable`; offer exactly `item.choices`.
4. Write a decision with `PUT …/assessment/decisions/:commentId`; clear it with `DELETE` on the same path.
5. Finish with `POST …/assessment/finish`. Read `data.status`: `quality_assessed` or `escalated`.
6. Read `error.code` on every refusal (section 7). Never parse `error.message`.

## 2. Who writes, and when

| Caller | Round-2 view | Writes |
|---|---|---|
| LEAD_ASSESSOR with an enabled row covering the result | Yes, `round: 2` | While the lead-assessors step (step 3) is open |
| ASSESSOR | Round 1 only | Unchanged |
| ADMIN | Latest round by default (`?round=1\|2` to pick); read only | Never. `choices` is always `[]` |
| TPB, PPU | Designed only, not built (section 8) | None |

`…` stands for `/timelines/:timelineId/results/:resultCode`. The write order of step-1 section 6 applies unchanged (404, 403, 409 step closed, 409 finished).

## 3. View additions (`GET …/assessment`)

Top level: `round` (number; `1` or `2`).

Per field (all present in both rounds, with the round-1 values in the last column):

| Property | Round-2 meaning | Round 1 |
|---|---|---|
| `updated` | The key is in the membership's changed fields since round 1. Never true on a new round-2 result | `false` |
| `actionable` | An Assessed **core** field: the only kind that takes a validation, comment or decision | Assessed field |
| `effectiveValidated` | The stored mark, else the carried green | equals `validated` |
| `carried` | The green is the round-1 one, because the Lead stored nothing | `false` |
| `thread` | The round-1 thread of a core field | `[]` |

`validated` stays the stored mark. Draw the check from `effectiveValidated`, and the hint "Green in round 1, unchanged" when `carried`. A field is carried green only when it was green in round 1, had no round-1 comment and is not in the changed fields.

### 3.1 `thread[]` item

Comments neither withdrawn nor deleted, ordered by comment.

```
{ commentId, author: { id, nickname }, createdAt, body,
  valueCopy: { value, labels? }, valueTruncated,
  state,
  response?: { id, kind, body: string | null, respondedBy: { name }, respondedAt },
  clarifications: [{ requestId, question, requestedAt, answer: { body, answeredAt } | null }],
  decision?: { decision, body: string | null, decidedAt },
  decidable: boolean, choices: ('agree_program' | 'escalate')[] }
```

| Part | Rule |
|---|---|
| `valueCopy` | The value when the assessor wrote the comment. The value now is the field's own `value` |
| `response` | The program's latest response; absent when none. The responder is named, never an email |
| `clarifications` | Every request with its answer, oldest first |
| `decision` | The Lead's current decision; absent when none |
| `decidable` | The comment can take a decision from this caller. It ignores `writable` |
| `choices` | The decisions to offer. `[]` when not decidable and always for ADMIN |

Decidable round-1 comments are those in state `disagreed`, `open` or `clarification_requested` on an actionable field: `choices` is `['agree_program', 'escalate']`. The Lead's own round-2 comment takes `['escalate']` only. Gate every decision control on **`writable && decidable`**: `decidable` alone is true on a finished or closed review.

## 4. Routes

| Method | Path | Body | Status and answer |
|---|---|---|---|
| PUT | `…/assessment/decisions/:commentId` | `{ decision: 'agree_program' \| 'escalate', body }`, `body` trimmed, 1 to 2,000 characters | 200 `DecisionResult` |
| DELETE | `…/assessment/decisions/:commentId` | none | 200 `DecisionResult` with `decision: null` |
| POST | `/assessment-comments/:commentId/delete` | none | 200, the `Comment` (step-1 5.2) plus `deletedAt`, `deletedBy` |
| PUT | `…/assessment/validations` | unchanged | 200, `ValidationSummary` plus `effectiveValidated` (4.2) |
| POST | `…/assessment/finish` | none | 200, `ValidationSummary` with `status` (4.3) |

No `Idempotency-Key`: a decision is a PUT (the same body twice gives the same state); a second delete is 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`.

### 4.1 Decisions

`DecisionResult` is the step-1 `ValidationSummary` plus `decision`:

```
{ status, assessedBy: { id, nickname } | null, finishedAt: string | null,
  validations: [{ fieldKey, validated }],
  decision: { decision, body, decidedAt } | null }
```

- A second PUT replaces the decision. A decision can be changed or cleared until the review ends.
- `agree_program` turns the field green in the same call. `escalate` leaves the field grey (on a green field it turns it grey and drops the other agrees on it) and refuses its validation. Clearing an `agree_program` turns the field back to grey unless another live agree still holds it. Clearing where there is none succeeds and changes nothing.
- When an agree leaves every core field green, the same call **ends** the review (`status: 'quality_assessed'`, one `qaed` release). `status` is how the front learns it.
- Comment states change only at the end, not on a decision. Until then the thread shows the decision, not a new `state`.
- `effectiveValidated` is not in this answer. Re-read the view when the state of every field matters.
- The Lead's decision on **their own** comment is not in any thread (the thread holds round-1 comments). Before the end it is visible only in this answer; after the end it shows as the comment's `state` (`escalated`, `lead_sided_program`) in the field's `comments`.

### 4.2 Validations in round 2

Same request as step-1 6.1, on core fields only. In round 2 the answer adds:

```
effectiveValidated: [{ fieldKey, validated }]    // every core field, sorted ascending by fieldKey
```

It is present in round 2 only. `validations` stays the stored rows. `all: true` covers the core fields only. **Check all is refused whole** (409 `ASSESSMENT_FIELD_ESCALATED`, nothing written) once any core field is escalated: send `fieldKeys` instead.

### 4.3 Finish

| Situation | Result |
|---|---|
| No effectively grey core field | `quality_assessed`; one release `qaed`; the Reporting answer ends the membership |
| At least one grey core field, each with a live `escalate` | `escalated`; **no release**; the membership stays active for TPB |
| A grey core field with no `escalate` | 409 `ASSESSMENT_CORE_UNDECIDED`, `error.fields` = `string[]` of the undecided field keys; nothing written |

At the end the Lead's decisions become comment states (`agree_program` → `lead_sided_program`, `escalate` → `escalated`). Round 2 never ends `returned` and makes no comment visible to the program. Of concurrent finishes exactly one succeeds; the others get 409 `ASSESSMENT_FINISHED`.

`error.fields` is a `string[]` for `ASSESSMENT_CORE_UNDECIDED` as for `ASSESSMENT_CORE_UNCOMMENTED`.

### 4.4 Delete

The Lead deletes another reviewer's comment while step 3 is open: a round-1 comment of this result, or another Lead's round-2 comment. The comment leaves the thread, the counts, the end rules and the program view; a decision on it is dropped. The answer does not say whether the review ended: **re-read the view after a delete**, because a delete can end the review. Refused with 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`: the Lead's own comment (withdraw it), one already deleted or withdrawn, one the program already answered.

### 4.5 Withdraw

`POST /assessment-comments/:id/withdraw` (step-1 6.3) also works for a Lead's own round-2 comment while step 3 is open. After the end, the withdraw of an **escalated** own comment answers 409 `ASSESSMENT_COMMENT_NOT_OPEN` (the state moved), not `ASSESSMENT_FINISHED`; an own comment still `open` at the end answers `ASSESSMENT_FINISHED` while step 3 is open, and `ASSESSMENT_STEP_CLOSED` after it closes.

## 5. Status and worklist

`pending_tpb_review` ("Pending for TPB review") is produced now: the Lead's assessment ended `escalated`. The step-1 table (3.1) is otherwise unchanged. A round-2 membership's status reads its latest round-2 assessment, so the view header, the worklist and an ADMIN see one status.

| Place | Rule |
|---|---|
| `counters.finished` | **Counts `pending_tpb_review`** as finished, with `quality_assessed`, `returned_to_program` and `clarification_requested` |
| View after the end | `readOnlyReason: 'finished'`, `assessment.status: 'escalated'`, `header.status: 'pending_tpb_review'` |
| Worklist `updated` | True for a round-2 re-entry whose fields changed since round 1 |

`assessment.status` values: `pending`, `quality_assessed`, `returned` (round 1), `escalated` (round 2).

## 6. What the program sees (DD-11)

Round 2 never makes a comment visible to the program, and the Science Program view never shows the Lead's outcome. When a comment's stored state is a review state (`escalated`, `lead_sided_program`), the SP views (counts, detail, CSV) show the state the program last saw: `accepted`, `accepted_with_comment`, `disagreed` or `clarification_requested` from its latest response (`open` when the clarification request already has an answer, and `open` with no response). The SP front needs no change.

## 7. Error codes

New in round 2 (all 409). The step-1 codes keep their meaning; see its section 9.

| Code | Raised by |
|---|---|
| `ASSESSMENT_FIELD_NOT_CORE` | Validation or comment on an Assessed field that is not core (context only) |
| `ASSESSMENT_FIELD_ESCALATED` | Validating a field that carries an `escalate`; an agree on a field another comment escalated; Check all while any core field is escalated |
| `ASSESSMENT_DECISION_INVALID` | A decision that does not apply: the comment is not decidable, or the choice is not in its `choices` |
| `ASSESSMENT_CORE_UNDECIDED` | Finish with grey core fields and no `escalate` on them; carries `error.fields: string[]` |
| `ASSESSMENT_COMMENT_NOT_DELETABLE` | Delete (4.4) |

Also on these routes, unchanged: 400 `VALIDATION_FAILED` (body: empty, blank, over 2,000 characters, unknown decision), `MALFORMED_JSON`; 401; 403 `ASSESSMENT_READ_ONLY`; 404 `ASSESSMENT_NOT_FOUND` (a comment of another result is the same 404 as a missing one); 409 `ASSESSMENT_STEP_CLOSED`, `ASSESSMENT_FINISHED`, `ASSESSMENT_NO_FIELD_CONFIG`; 413 `PAYLOAD_TOO_LARGE`; 503 `SERVICE_UNAVAILABLE`.

## 8. TPB and PPU: designed only

Nothing for TPB or PPU is built in this spec. The design (`design.md` § 12) adds a role row, decision kinds, status rows and end rules; no new table. The only visible trace today is the status `pending_tpb_review`; `pending_ppu` and `unresolved` stay declared and unproduced. Build no TPB or PPU screen from this file.

## 9. Checklist for the front

- [ ] Types accept `round`, per-field `updated`, `actionable`, `effectiveValidated`, `carried`, `thread[]`.
- [ ] Only `actionable` fields take a check or a comment; the rest render as context.
- [ ] The check follows `effectiveValidated`; the hint follows `carried`.
- [ ] Decision controls are gated on `writable && decidable` and offer `choices`.
- [ ] After a decision or a delete, the view is re-read (either can end the review).
- [ ] The finish handler reads `status: 'escalated'` and the 409 `ASSESSMENT_CORE_UNDECIDED` `error.fields`.
- [ ] Check all is replaced by `fieldKeys` once a field is escalated.
- [ ] The worklist counts `pending_tpb_review` as finished.
- [ ] The Lead's decision on their own comment is read from the decision answer, then from the comment `state`.
