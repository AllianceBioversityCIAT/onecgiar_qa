# Front contract — round 2, step 5 (PPU, P2-3917)

What the front may rely on for the PPU's work on a result. Every shape below was read from the code on `feature/P2-3917-ppu-close-cases`:

- the DTO `dto/decide-comment.body.ts`;
- `assessment.service.ts`;
- `assessment-view.ts`;
- `models/assessment.model.ts`;
- `worklist.service.ts`;
- the e2e suites `test/assessment-round-two-ppu*.e2e-spec.ts`.

If the code and this file disagree, the code wins and this file is a defect.

It adds to the TPB contract (`docs/specs/escalation/round-2-tpb/front-contract.md`), which adds to the round-2 one. Read those first. `…` stands for `/timelines/:timelineId/results/:resultCode`.

## 1. Quick path

1. **Worklist:** `GET /timelines/:t/worklist`. A PPU sees the results the TPB ended **Pending PPU**, which read **Unresolved** once step 5 is closed. It keeps seeing them after they end Quality Assessed, read-only. The counters count `pending_ppu` and `unresolved` as pending.
2. **Open:** `GET …/assessment`. `round` is `2`.
3. **Cases:** a case is a `thread[]` item with `decidable: true` and `choices: ['ppu_done']`.
4. **Done:** `PUT …/assessment/decisions/:commentId` with `{ "decision": "ppu_done" }`. The comment is optional: `{ "decision": "ppu_done", "body": "…" }`.
5. **Undo:** `DELETE` on the same path, until the result ends.
6. **There is no Finish.** Read `data.status` after each Done. The last one answers `quality_assessed`.
7. **Errors:** read `error.code` on every refusal (section 6).

## 2. What changes from the TPB's screen

| TPB (step 4) | PPU (step 5) |
|---|---|
| Decides `escalated` items with `tpb_agree_program` / `tpb_agree_assessor`, reason required | Marks `tpb_sided_assessor` items (cases) with `ppu_done`, **comment optional** |
| Ends only with Finish | **No Finish** (403). The last Done ends the result Quality Assessed on its own |
| Writes only while step 4 is open | **No date window**: before, during and after step 5 |
| Items carry `leadDecision` | Items carry `leadDecision` **and `tpbDecision`** (the TPB's decision and justification) |
| AI suggestion read-only with the copy mark | **No AI suggestion** (403 on the AI route) |
| — | A field may carry `changedInReporting: { detectedAt }` ("Changed in Reporting Tool on <date>") |
| — | Status `unresolved` once step 5 is closed with a case open |
| "Act as" `TPB` | "Act as" `PPU` (`X-Acting-Role: PPU`) |

## 3. Who writes, and when

| Caller | View | Writes |
|---|---|---|
| PPU assigned to the timeline. A global role: every result type; the user's program scope applies | Round-2 results the TPB ended `escalated` | Done / undo at **any date**, until the result ends. The timeline must have a `ppu` step |
| ADMIN with `X-Acting-Role: PPU` | As the PPU, any type and program, `actingRole: 'PPU'` | As the PPU. A result the TPB has not escalated is read-only (`admin_read_only`) |
| TPB | Its own step-4 review, read-only. The header follows the current step (`pending_ppu`, `unresolved`, `quality_assessed`) | Never again |
| Lead | Its own step-3 review, read-only. Same header rule | Never again |

A result the TPB has not ended `escalated` is the scope 404 for a PPU.

## 4. View (`GET …/assessment`) for a PPU

| Member | PPU meaning |
|---|---|
| `assessment` | `null` until the PPU's first Done, then the PPU's step-5 row |
| `writable` / `readOnlyReason` | `true` / `null` until the result ends (whatever step 5's dates), then `finished` |
| `header.status` | `pending_ppu`; `unresolved` once step 5 is closed; `quality_assessed` after the last Done |
| `header.reviewerRole` | `PPU` (section 9.1). A person who also holds an earlier role gets `PPU` once the result reached this step |
| field `effectiveValidated` | Takes the first mark that exists: the PPU's own, then the TPB's, then the Lead's. With none, the green carried from round 1 |
| field `changedInReporting` | **Optional.** `{ detectedAt }` when the field's Reporting value differs from the value the Lead and the TPB judged; absent otherwise. `detectedAt` is the first time a PPU view saw the difference |
| field `thread[]` | Every live comment of the round-1 assessment and of the Lead's step-3 one |

**`thread[]` item (PPU)** is the TPB item shape plus one member.

| Member | Type | Meaning |
|---|---|---|
| `tpbDecision` | `{ decision: 'tpb_agree_assessor' \| 'tpb_agree_program', body, decidedAt }`, absent when none | The TPB's decision and its justification |
| `leadDecision` | as for the TPB | The Lead's escalation and its comment |
| `decision` | `{ decision: 'ppu_done', body: string \| null, decidedAt }`, absent when not Done | The PPU's Done and its optional comment |
| `round` | `1 \| 2` | `2` is the Lead's own comment |
| `decidable` / `choices` | `true` / `['ppu_done']` | On an item with `state: 'tpb_sided_assessor'` while the result is open; otherwise `false` / `[]` |

AC3 maps to these members:

| AC3 context | Where it is |
|---|---|
| The result | `header` |
| The field | The field the item sits on |
| The assessor's comment | `body` and `valueCopy` |
| The program's response | `response` and `clarifications` |
| The Lead's escalation comment | `leadDecision.body` |
| The TPB's decision and justification | `tpbDecision` |

## 5. Writes

### Done — `PUT …/assessment/decisions/:commentId`

Request: `{ "decision": "ppu_done" }`, or with `"body"`. When sent, `body` is trimmed, then 1 to 2,000 characters. A blank string is a 400. To give no comment, omit `body` or send `null`.

Response `200`, `data`:

```json
{
  "status": "pending",
  "assessedBy": null,
  "finishedAt": null,
  "validations": [{ "fieldKey": "general.title", "validated": true }],
  "decision": { "decision": "ppu_done", "body": null, "decidedAt": "2026-12-04T10:00:00.000Z" }
}
```

- A field turns green once **every** case on it is Done.
- The Done that leaves no case open ends the result. `status` is then `quality_assessed`, with `assessedBy` (the PPU, `admin: true` for an Admin) and `finishedAt`.
- One `qaed` release goes to Reporting (AC9). Re-read the view after each Done.

### Undo — `DELETE …/assessment/decisions/:commentId`

It returns the same shape with `decision: null`, and the field greys again. It is allowed until the result ends. Clearing where nothing is set is a no-op `200`.

## 6. Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `body` blank or over 2,000 characters; unknown `decision` |
| `ASSESSMENT_READ_ONLY` | 403 | A PPU's Finish, validation, comment or delete; an Admin without `X-Acting-Role` |
| `AI_SUGGESTIONS_FORBIDDEN` | 403 | A PPU on the AI suggestion route (unchanged) |
| `ASSESSMENT_NOT_FOUND` | 404 | Not in the PPU's scope (the TPB has not escalated it, another program), or a comment of another result |
| `ASSESSMENT_DECISION_INVALID` | 409 | The comment is not a case, or another role's value was sent. A Lead or TPB sending `ppu_done` gets it too |
| `ASSESSMENT_FINISHED` | 409 | The result already ended (Done or undo after Quality Assessed) |

There are no new codes.

## 7. Status values

| Key | Label | Meaning |
|---|---|---|
| `pending_ppu` | Pending PPU | The TPB sided with the assessor; the PPU has cases open; step 5 not closed |
| `unresolved` | Unresolved | The same, after step 5 closed. It shows for the PPU, the Admin (worklist status filter and counters) and the Overview once it is wired |
| `quality_assessed` | Quality Assessed | The PPU marked the last case Done |

The Overview has no server endpoint yet: it shows sample data. When it is wired, it reads `unresolved` like any status.

## 8. Checklist for the front

- [ ] The PPU mode hides the check, Check all, the comment box, delete, Finish and the AI suggestion.
- [ ] A "Done" control on items with `decidable`, with an optional comment, and an "Undo" on items whose `decision` is `ppu_done` while `writable`.
- [ ] Each case shows the field value then and now, the assessor's comment, the program's response, `leadDecision.body` and `tpbDecision` (decision and justification).
- [ ] "Changed in Reporting Tool on <date>" from `field.changedInReporting.detectedAt`, when present.
- [ ] After each Done, read `data.status`. On `quality_assessed`, show the result as closed and re-read the view.
- [ ] The worklist shows `unresolved`. For a PPU, `pending_ppu` and `unresolved` are pending.
- [ ] "Act as" offers `PPU` when `actingRoles` lists it.
- [ ] Quick comments use `role=PPU`.
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
