# Front contract — round 2, step 4 (Third-Party Broker, P2-3916)

What the front may rely on for the TPB's review. Every shape below was read from the code on `feature/P2-3916-tpb-review`:

- the DTO `dto/decide-comment.body.ts`;
- `assessment.service.ts`;
- `assessment-view.ts`;
- `worklist.service.ts`;
- the e2e suites `test/assessment-round-two-tpb*.e2e-spec.ts`.

If the code and this file disagree, the code wins and this file is a defect.

It adds to the round-2 contract (`docs/specs/escalation/round-2/front-contract.md`). The view shape, the thread items, the routes and the envelope live there. Read that file first. `…` stands for `/timelines/:timelineId/results/:resultCode`.

## 1. Quick path

1. **Worklist:** `GET /timelines/:t/worklist`, as today. A TPB sees the results the Lead ended **Pending for TPB review**, and keeps seeing them after it finishes them (Quality Assessed or Pending PPU, read-only). The counters count `pending_tpb_review` as pending.
2. **Open:** `GET …/assessment`. `round` is `2`.
3. **Decide:** draw the decision controls on a `thread[]` item only when `item.decidable`. Offer exactly `item.choices` (`tpb_agree_program`, `tpb_agree_assessor`).
4. **Write:** `PUT …/assessment/decisions/:commentId` with `{ decision, body }`. The reason is required. Clear with `DELETE` on the same path.
5. **Finish:** `POST …/assessment/finish`. Read `data.status`: `quality_assessed` or `escalated` (Pending PPU).
6. **Errors:** read `error.code` on every refusal (section 6).

## 2. What changes from the Lead's screen

| Lead (step 3) | TPB (step 4) |
|---|---|
| Validates core fields (check, Check all) | **No check, no Check all.** A TPB validation is 403 `ASSESSMENT_READ_ONLY`. The green comes from its decisions |
| Writes comments; deletes another reviewer's | **No comment box, no delete.** Both are 403 `ASSESSMENT_READ_ONLY` |
| Decides `disagreed` / `open` / `clarification_requested` round-1 comments and its own, with `agree_program` / `escalate` | Decides `escalated` items only (round-1 ones and the Lead's own), with `tpb_agree_program` / `tpb_agree_assessor` |
| An `agree_program` that leaves every core field green ends the review by itself | **Never ends by itself.** Only Finish ends it (AC9) |
| `thread[]` items carry the Lead's `decision` | Items carry the TPB's `decision`, plus `leadDecision` (the Lead's escalation and its reason) and `round` |
| The Lead's own round-2 comments are in `field.comments[]` | The Lead's own escalated comments are `thread[]` items with `round: 2`; `field.comments[]` is empty |
| "Act as" Lead: `X-Acting-Role: LEAD_ASSESSOR` | "Act as" TPB: `X-Acting-Role: TPB` (`actingRoles` lists it on a round-2 result) |

## 3. Who writes, and when

| Caller | View | Writes |
|---|---|---|
| TPB assigned to the timeline (global role: every result type; the user's program scope applies) | Round-2 results the Lead ended `escalated` | Decisions and Finish while the `tpb` step (step 4) is open |
| The same TPB outside step 4 | Read-only: `readOnlyReason` `step_upcoming` / `step_closed` | Every write is 409 `ASSESSMENT_STEP_CLOSED` |
| ADMIN with `X-Acting-Role: TPB` | As the TPB, any type and program, `actingRole: 'TPB'` | As the TPB, **whatever the step-4 dates**. The result must have reached step 4; otherwise it is read-only (`admin_read_only`) |
| ADMIN without the header | Reads the current step | Never |
| LEAD_ASSESSOR | Its own step-3 review, read-only. The header status follows the current step (`pending_tpb_review`, `pending_ppu`, `quality_assessed`) | Never again on this result (409 `ASSESSMENT_FINISHED` or step closed) |

A round-2 result the Lead has not escalated is the scope 404 for a TPB: it is not listed, and the view and every write answer `ASSESSMENT_NOT_FOUND`.

## 4. View (`GET …/assessment`) for a TPB

| Member | TPB meaning |
|---|---|
| `assessment` | `null` until the TPB's first write, then the TPB's own step-4 row (`status`, `assessedBy`, `finishedAt`) |
| `writable` / `readOnlyReason` | `true` / `null` in step 4 before the end. Then `finished` after Finish, or `step_upcoming` / `step_closed` |
| `header.status` | `pending_tpb_review` while the TPB works (before and after its first write), then `quality_assessed` or `pending_ppu` |
| `header.reviewerRole` | `TPB` (section 9.1). A person who also holds an earlier role gets `TPB` once the result reached this step |
| field `actionable` | Core fields: `true`. A TPB still writes no check or comment on them (section 2) |
| field `effectiveValidated` | The TPB's own mark, else the Lead's mark, else the round-1 green carried. Draw the check from it, read-only |
| field `carried` | Nothing is stored in step 3 or step 4 and the round-1 green is carried |
| field `updated` | The field changed since round 1 ("Updated" tag) |
| field `thread[]` | Every live comment of the round-1 assessment and of the Lead's step-3 one, in field / time order |

**`thread[]` item (TPB):** the round-2 item shape, plus three members.

| Member | Type | Meaning |
|---|---|---|
| `round` | `1 \| 2` | `1` for an assessor's round-1 comment; `2` for the Lead's own comment |
| `leadDecision` | `{ decision: 'escalate' \| 'agree_program', body: string \| null, decidedAt: string }`, absent when none | The Lead's ruling. On an escalated item, `body` is the Lead's comment explaining the escalation |
| `decision` | `{ decision: 'tpb_agree_program' \| 'tpb_agree_assessor', body, decidedAt }`, absent when none | The TPB's current decision |
| `decidable` / `choices` | `true` / `['tpb_agree_program', 'tpb_agree_assessor']` | On an item with `state: 'escalated'` only, while the view is writable. Otherwise `false` / `[]` |

The other members (`author`, `body`, `valueCopy`, `state`, `response`, `clarifications`) are those of the round-2 contract. Together they give AC4's context:

- the value then (`valueCopy`) and now (the field's `value`);
- the assessor's comment;
- the program's response and justification;
- the clarifications.

**AI suggestion:** `GET …/ai-suggestions`, as today. For a TPB each view carries `copiedByReviewer` (boolean) and `editedByReviewer` (boolean or `null`). It is read-only: `POST …/ai-suggestions/:id/events` is 403 `ASSESSMENT_READ_ONLY` for a TPB.

## 5. Writes

### Decide — `PUT …/assessment/decisions/:commentId`

Request:

```json
{ "decision": "tpb_agree_program", "body": "The program's figure matches the evidence" }
```

- `decision`: `tpb_agree_program` or `tpb_agree_assessor`.
- `body`: trimmed, then 1 to 2,000 characters. It is required.

Response `200`, `data`:

```json
{
  "status": "pending",
  "assessedBy": null,
  "finishedAt": null,
  "validations": [{ "fieldKey": "general.title", "validated": true }],
  "decision": { "decision": "tpb_agree_program", "body": "…", "decidedAt": "2026-11-30T10:00:00.000Z" }
}
```

- `validations` are the TPB's own stored marks (step 4).
- A field turns green once **every** escalated item on it is `tpb_agree_program`. Any `tpb_agree_assessor` or undecided item keeps it grey.
- Re-read the view after a decision to redraw `effectiveValidated`.
- `status` stays `pending`: a decision never ends the review.

### Clear — `DELETE …/assessment/decisions/:commentId`

This uses the same response with `decision: null`. Clearing where nothing is set is a no-op `200`.

### Finish — `POST …/assessment/finish`

Every escalated item needs a decision first.

| Decisions | `data.status` | Result |
|---|---|---|
| Every item `tpb_agree_program` | `quality_assessed` | Status Quality Assessed; one `qaed` release to Reporting |
| At least one `tpb_agree_assessor` | `escalated` | Status **Pending PPU**; no release; the result stays in QA for step 5 |

`data` also carries `assessedBy` (the TPB, with `admin: true` when an Admin acted), `finishedAt` and `validations`.

After the end, every decision and Finish is 409 `ASSESSMENT_FINISHED`, and the view is `readOnlyReason: 'finished'`.

## 6. Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `body` empty, blank or over 2,000 characters; unknown `decision` value |
| `ASSESSMENT_READ_ONLY` | 403 | A TPB validation, comment, delete or AI usage event; an Admin without `X-Acting-Role` |
| `ASSESSMENT_NOT_FOUND` | 404 | The result is not in the TPB's scope (not escalated by the Lead, another program), or the comment belongs to another result |
| `ASSESSMENT_DECISION_INVALID` | 409 | The comment is not `escalated`, or a Lead value (`agree_program`, `escalate`) was sent |
| `ASSESSMENT_CORE_UNDECIDED` | 409 | Finish with an escalated item undecided. `error.fields` is the sorted list of those field keys |
| `ASSESSMENT_FINISHED` | 409 | The TPB's review already ended |
| `ASSESSMENT_STEP_CLOSED` | 409 | Step 4 is not open (a non-Admin) |

There are no new codes: all of these are already in `common/error-codes.ts`.

## 7. Status values

| Key | Label | Meaning in step 4 |
|---|---|---|
| `pending_tpb_review` | Pending for TPB review | The Lead escalated it, and the TPB has not finished |
| `pending_ppu` | Pending PPU | The TPB finished with at least one `tpb_agree_assessor` |
| `quality_assessed` | Quality Assessed | The TPB finished with every item on the program's side |

The worklist `status` filter accepts all three. The program (SP view) never sees them (round-2 DD-11).

## 8. Checklist for the front

- [ ] The TPB mode hides the check, Check all, the comment box and delete.
- [ ] Decision controls are gated on `decidable` alone and offer `choices`. A required reason is collected for both.
- [ ] Each escalated item shows the value then and now, the assessor's comment, the program's response and clarifications, `leadDecision.body` (the Lead's reason), the "Updated" tag and the AI suggestion with `copiedByReviewer`.
- [ ] Items with `round: 2` are labelled as the Lead's own comment.
- [ ] Quick comments use `role=TPB` (`GET` / `POST /quick-comments`).
- [ ] The view is re-read after every decision, so the check follows `effectiveValidated`.
- [ ] Finish reads `status: 'escalated'` as Pending PPU, and shows `error.fields` on `ASSESSMENT_CORE_UNDECIDED`.
- [ ] The worklist shows `pending_ppu` and `unresolved` (P2-3917) and counts both as finished for the TPB.
- [ ] "Act as" offers `TPB` when `actingRoles` lists it. The header `X-Acting-Role: TPB` goes on the view and every write.
- [ ] The screen mode comes from `header.reviewerRole` (section 9.1); the worklist chips from `counters.byStatus`; `ASSESSMENT_FIELD_ESCALATED` shows `error.fields`.

## 9. Contract adjustments (2026-11-26, for the round-2 front)

Three additive members. Nothing existing changed shape; no migration.

### 9.1 `header.reviewerRole` (DD-T11)

The reviewer role the view was built for. Draw the screen mode from it (Lead, TPB, PPU), never from the order of the user's roles.

| Caller | `header.reviewerRole` |
|---|---|
| Admin with `X-Acting-Role` | That role when it fits the result's round, else `null` (read-only) |
| Admin without `X-Acting-Role` | `null` |
| A reviewer | The role whose step the result is at, among the roles the person holds: `pending` → `LEAD_ASSESSOR`, `pending_tpb_review` → `TPB`, `pending_ppu` / `unresolved` → `PPU`. A person without that role gets the furthest one they hold (a Lead + TPB on a `pending_ppu` result reads `TPB`). A result that ended reads the role of the step that ended it |

`assessment`, `writable`, `decidable` and `choices` follow the same role, and so do the decisions and the finish: a Lead who is also TPB decides and finishes as the TPB once the result is `pending_tpb_review`. A non-admin's `X-Acting-Role` is ignored.

```json
"header": {
  "resultCode": 4021,
  "title": "Policy brief on seed systems",
  "program": { "id": 1, "code": "SP01", "name": "Breeding for Tomorrow" },
  "resultType": { "key": "policy_change", "label": "Policy change" },
  "timeline": { "id": 1, "name": "Official" },
  "step": { "position": 4, "name": "TPB review" },
  "status": "pending_tpb_review",
  "reviewerRole": "TPB"
}
```

### 9.2 `counters.byStatus` (worklist)

`GET /timelines/:t/worklist` → `data.counters.byStatus`: the memberships of `total` by QA status. Every status is present (0 when none). Same scope as `total`: the filters, the search and the page do not change it, and `pending_tpb_review`, `pending_ppu`, `unresolved` and `auto_validated` are counted. `pending`, `finished`, `total` and `autoValidated` are unchanged.

```json
"counters": {
  "pending": 3,
  "finished": 5,
  "total": 10,
  "autoValidated": 2,
  "byStatus": {
    "pending": 3,
    "returned_to_program": 0,
    "clarification_requested": 1,
    "pending_tpb_review": 2,
    "pending_ppu": 1,
    "unresolved": 0,
    "quality_assessed": 1,
    "auto_validated": 2
  }
}
```

### 9.3 `ASSESSMENT_FIELD_ESCALATED` with `fields`

The Lead's refusal (409) now names the fields, like `ASSESSMENT_CORE_COMMENT_UNDECIDED`: `error.fields` holds the escalated field keys, sorted. On a validation they are the escalated fields the request named (with Check all, every escalated core field). On an `agree_program`, it is the comment's field, escalated by another comment.

```json
{
  "status": 409,
  "code": "ASSESSMENT_FIELD_ESCALATED",
  "message": "This field is escalated and cannot be validated. Remove the escalation first.",
  "fields": ["general.title", "toc.outcomes"]
}
```
