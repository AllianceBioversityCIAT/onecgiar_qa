# Field configuration — Front contract

For the front lead (P2-3907). Five routes under `/api/v1/cycles/:id/field-config`, ADMIN only, all built. This note says what the Fields screen can rely on. It adds to `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md` (envelope, error format, `Idempotency-Key`, dates as Rome days): read that first. Source of truth for any disagreement: `server/src/admin-config/field-config/` and the OpenAPI document (`/api/v1/docs`). Server line numbers are at HEAD of `feat/field-configuration`. Client files and line numbers are cited from branch `staging-center`; this branch also carries `client/src/app/pages/workspace/fields/*` (checked 2026-10-26: `fields-publish-confirm.ts` and `fields.mock.ts` are identical on both), but check `staging-center` for later edits.

## 1. Quick path

1. `GET /cycles/:id/field-config` returns the fields and the draft `revision`. Keep it.
2. Each edit is `PATCH .../draft` with the whole option set of every field the admin touched. The answer is the new view, with the new `revision`.
3. To publish, `GET .../publish-preview`, show the changes and the two timeline lists, then `POST .../publish` with **the preview's `revision`**. It answers 201.
4. On 409 `FIELD_CONFIG_REVISION_STALE` or `FIELD_CONFIG_NOTHING_TO_PUBLISH`: reload view and preview, show them, let the admin decide again (section 6).

## 2. The routes

| Method and path | Body | Answers | Refusals (besides 401, 403 and a bad `:id` as 400 `VALIDATION_FAILED`) |
|---|---|---|---|
| `GET /cycles/:id/field-config` | none | 200 view | 404 `CYCLES_NOT_FOUND`, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 |
| `PATCH /cycles/:id/field-config/draft` | `{ items }`, 1 to 2,000 (JSON body up to 640 KB; every other route keeps 100 KB) | 200 view | 400 `VALIDATION_FAILED` or `MALFORMED_JSON`, 404, 409 `CYCLES_CLOSED` or `FIELD_CONFIG_CATALOG_MISSING`, 413 `PAYLOAD_TOO_LARGE` (body over 640 KB, refused before validation), 503 |
| `DELETE /cycles/:id/field-config/draft` | none | 200 view | 404, 409 `CYCLES_CLOSED` or `FIELD_CONFIG_CATALOG_MISSING`, 503 |
| `GET /cycles/:id/field-config/publish-preview` | none | 200 preview | 404, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 |
| `POST /cycles/:id/field-config/publish` | `{ revision }` | **201** publish result | 400, 404, 409 `CYCLES_CLOSED`, `FIELD_CONFIG_REVISION_STALE`, `FIELD_CONFIG_NOTHING_TO_PUBLISH`, `FIELD_CONFIG_CATALOG_MISSING`, 409 `IDEMPOTENCY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED`, 503 |

Source: `field-config.controller.ts:95` (view), `:113` (PATCH), `:140` (DELETE), `:162` (preview), `:190-191` (publish); the guard is class-level (`:60`). Codes in `server/src/common/error-codes.ts:276-289`.

- **Reads work in any cycle status** and write nothing. **The three writes work in a `draft` or `active` cycle**; a `closed` cycle is 409 `CYCLES_CLOSED` (`field-config.service.ts:636-643`).
- **Order of answers on a write**, first that applies wins: request-shape 400s from the pipes first (`VALIDATION_FAILED`, `UNKNOWN_FIELD`, `MALFORMED_JSON`, a bad `:id`), then 404, `CYCLES_CLOSED`, catalog (409 or 503), every rule problem in one 400, and for publish only stale then nothing-to-publish (`field-config.service.ts:480-506`).
- The cycle's own year picks the catalog, not today's year (`field-config.service.ts:243`).

## 3. Shapes

**View** (`FieldConfigView`, `field-config.service.ts:102-110`):

| Key | Meaning |
|---|---|
| `cycleId`, `year`, `catalogVersion` | The cycle, and the Reporting catalog version the view was built from |
| `revision` | Draft revision. **0 for a cycle never edited**. Send it back to publish |
| `latestVersion` | `{ number, publishedAt }` or `null` before the first publication |
| `resultTypes[]` | `{ key, label, level, sections[] }`; each section `{ key, label, fields[] }` in catalog order |
| `notInCatalog[]` | `{ resultTypeKey, fieldKey, draft }`: a draft row whose field the catalog no longer lists for that type (`:316-323`). Show it read-only; it leaves the diff and the published rows |

**Field** (`FieldView`, `field-config.service.ts:71-80`):

| Key | Meaning |
|---|---|
| `key`, `label`, `description?` | `description` is absent when Reporting sends none (`field-config-catalog.ts:138`) |
| `requirement` | `required` · `conditional` · `optional` (section 5) |
| `isNew` | Boolean, **always `false` today**: Reporting sends no flag (S-6, section 9) |
| `unclassified` | True when the draft has no row for the field (`:295`). It reads `hidden` with both flags off |
| `draft` | `{ visibility, isCore, isAiInput }`, what the admin is editing |
| `published` | The same shape from the latest version, or `null` before any publication |

`visibility` is `hidden` · `view_only` · `assessed`. Note `view_only`, not the mock's `view`.

**Preview** (`FieldConfigPreview`, `:119-128`): `{ revision, basedOn, changes[], timelines: { receive[], keep[] } }`.

- `basedOn` is the latest version number, `null` for the first publication.
- `changes[]` is `{ resultTypeKey, fieldKey, before, after }`. `before` is `null` when the latest version has no row for the field; a missing row and `hidden` count as equal (`field-config-diff.ts:60-92`), so a first publication lists only what the draft raises above `hidden`.
- `receive[]` is `{ id, name, opensOn }`. `keep[]` adds `version`, **which may be `null`** (a started timeline that resolves to no version, `:212`).
- `opensOn` is step 1's opening day (`YYYY-MM-DD`, Rome) or `null` for a timeline with no steps.

**Publish result** (`PublishResult`, `:131-134`): `{ version: { number, publishedAt, catalogVersion }, timelines: { receive, keep } }`. The lists are the ones the publish computed, which can differ from the preview if a timeline changed in between: show these in the confirmation, not the preview's.

## 4. Editing the draft

Body: `{ items: [{ resultTypeKey, fieldKey, visibility, isCore?, isAiInput? }] }` (`dto/update-field-config-draft.dto.ts:30-103`).

- **Each item is the whole option set of one field.** A field not listed keeps what the draft has; a field listed twice is a 400.
- **S-14: a flag left out is stored `false`, also on an `assessed` field** (`field-config.service.ts:384-390`). To keep Core or AI input on while changing something else, **send the flag**. Never rely on the old value surviving.
- `isCore` or `isAiInput` `true` with a `visibility` other than `assessed` is 400 code `NOT_ASSESSED` on `items[i].isCore` / `items[i].isAiInput` (`field-config-rules.ts:59-66`; message at `error-codes.ts:357`). Moving a field down to `view_only` or `hidden`: send both flags `false` or leave them out.
- The other codes use `items[i].<field>` paths: `INVALID` for an unknown result type (`items[i].resultTypeKey`), for a field that does not apply to the type, and for a repeated pair (`items[i].fieldKey`) (`field-config-rules.ts:43-55`). `null` on a flag is a shape error (`dto:21-23`). Every problem comes in one 400 and nothing is written.
- **Same values** (nothing differs from the stored rows, and every listed field already has a row) answers 200 with no write and no new `revision` (`field-config.service.ts:399-408`). That read is unlocked, so a concurrent edit can make this 200 show a slightly stale draft: reload on the next `revision` you see.
- A first edit that sets a field to `hidden` is a change: the field stops being `unclassified`.
- `DELETE .../draft` resets the draft to the latest published version, or to nothing classified when there is none (`field-config.service.ts:432-452`). Every field then has a draft row after the first publication, so none reads `unclassified` again (intended, section 10).
- Edit and discard are repeatable and take no `Idempotency-Key`. Both always win: they never answer stale.

## 5. Mock states: `third` and `conditional`

The mock on `staging-center` (`client/src/app/pages/workspace/fields/fields.mock.ts`) has four states, `FieldState = 'hidden' | 'view' | 'assessed' | 'third'` (line 4; options at 55-60). The server has three, plus two flags.

| Mock | Server |
|---|---|
| `hidden` | `visibility: 'hidden'` |
| `view` | `visibility: 'view_only'` |
| `assessed` | `visibility: 'assessed'` |
| `third` | **`visibility: 'assessed'` with `isCore: true`** (S-2). There is no "third-party" state: a core field travels through the escalation chain to TPB, then PPU |

- The mock's `characterization` row is `third` with `core` false (line 119), so the front must send `isCore: true` explicitly for it.
- Drop the `Third-party` option (line 59) and its legend line (line 151). Line 155 says core fields are "sent to third-party correction": reword it to the chain above (TPB, then PPU).
- `requirement` is `required` when Reporting marks the field required, `conditional` when it is not required but has a `required_when` rule, else `optional` (`field-config-catalog.ts:132-137`). The mock only has `required: boolean` (line 31): add the third value. The server does not send the rule itself, so show `conditional` as a label and do not state the condition. The "required but hidden" warning (mock line 163) fits `required` only.

## 6. The revision round trip and the two 409s

`revision` is a counter on the draft. Every applied edit, every discard and every publish raises it by one; a no-op edit does not.

| Step | Do |
|---|---|
| Read | `GET` view or preview; keep `revision` |
| Edit | `PATCH` / `DELETE`; take the new `revision` from the answer |
| Review | `GET .../publish-preview`; show `changes` and the two lists; keep **its** `revision` |
| Publish | `POST` with that `revision` (`dto/publish-field-config.dto.ts:15-18`: integer, 0 or more) |
| After a 201 | Reload the view; the 201 does not carry the new `revision` |

| Code | When | Writes | Recovery |
|---|---|---|---|
| `FIELD_CONFIG_REVISION_STALE` | The draft moved after the admin reviewed it (an edit, a discard or another publication), or two publishes raced and the other took the version number (`field-config.service.ts:486-489, 551-566`) | Nothing | Reload view and preview, tell the admin the draft changed, show the new changes, and let them confirm again under a **fresh key**. Do not resend with the new `revision` on your own: the admin has not seen what changed |
| `FIELD_CONFIG_NOTHING_TO_PUBLISH` | The draft equals the latest version (`:506`) | Nothing | Reload; disable Publish when the preview's `changes` is empty |

Stale is judged first, so an old `revision` never reads as nothing-to-publish.

## 7. Receive and keep: what a publication reaches

**A publication reaches only timelines that have not started. A timeline that has started keeps the version it started with until it finishes** (FR-9, S-13). The rule is `versionFor` (`field-config-versions.ts:96-117`) and the split is `receiveAndKeep` (`:127-151`).

| List | Timelines |
|---|---|
| `receive` | Cover a changed result type (all types, or a scope row of one) and have **not started**: they will use the new version |
| `keep` | Cover a changed type, **have started** and not finished: they keep the version they started with (`version`, or `null` for none) |
| neither | Finished timelines, and timelines that cover no changed type |

- **Started means 00:00 Rome on step 1's `opensOn`, also while the timeline is `waiting_for_load`** (`:54-56`). A timeline with no steps has not started.
- **A version published on a timeline's opening day, at any hour, does not reach it**: a version counts when the Rome day of its `publishedAt` is before `opensOn` (`:108-113`).
- `version: null` in `keep` means the timeline started and no version was published before its start. It has **no** field configuration; it does not fall back to the new version. Say so in the dialog.

**Publish dialog wording.** `client/src/app/pages/workspace/fields/fields-publish-confirm.ts:11` on `staging-center` says `subtitle="Applies to results loaded from now on. Results already under assessment are not affected."` That is wrong for this server: reaching a timeline depends on when it starts, not on when results load. Replace it with the lists. Suggested copy:

| Part | Text |
|---|---|
| Subtitle | `Timelines that have not started will use this version. Timelines already running keep the version they started with.` |
| `receive` list heading | `Will use the new version` (name and opening day) |
| `keep` list heading | `Keep their current version` (name and `Version n`) |
| A `keep` row with `version: null` | `Started with no field configuration` |
| Both lists empty | `No timeline is affected yet.` |

## 8. Retries and the key on publish

`Idempotency-Key` is optional and works as on the other creates. Publish is the only keyed route here.

| Situation | Key |
|---|---|
| Answer lost or timed out after the publish committed, same body | **Same key**: the stored answer is replayed with `Idempotency-Replayed: true` and nothing runs again |
| 5xx, including the 503 busy, same body | **Same key**: a 5xx is never stored and nothing committed, so the key is freed (`idempotency.interceptor.ts:103-111, 305-325`) and the retry **runs again**, with no replay header. A duplicate sent while the first is still running gets 409 `IDEMPOTENCY_IN_PROGRESS` (`:190-192`) |
| Redo after `FIELD_CONFIG_REVISION_STALE` or `FIELD_CONFIG_NOTHING_TO_PUBLISH` | **Fresh key**: a refusal is remembered and replays as it was (`server/src/common/idempotency/idempotency.interceptor.ts:103-112, 309-322`) |
| Same key, other `revision` | 422 `IDEMPOTENCY_KEY_REUSED` |

- **A replay of a publication returns the first lists as recorded.** Their names and `opensOn` are read at replay time (`field-config.service.ts:602-633`): a timeline deleted after the publication shows `name: ''` and `opensOn: null`.
- A replay writes no second audit row. A 503 retry that runs again is a first run: it can still answer stale or nothing-to-publish if the draft moved.

## 9. Catalog states, busy and Reporting data

| State | Answer | Screen |
|---|---|---|
| Reporting has no catalog for the cycle's year | 409 `FIELD_CONFIG_CATALOG_MISSING` on **every** route, writes included (the Reporting 404 maps at `reporting-qa-catalog.client.ts:89`) | Empty state: "No Reporting catalog exists for this cycle's year." A stale copy never covers it |
| Reporting unreachable, or its body malformed | 503 `SERVICE_UNAVAILABLE` (`field-config-catalog.ts:47-52`) | Error state with retry. A copy up to 24 h old is served when Reporting fails (`reporting-qa-catalog.client.ts:62-72`), so a 503 means no usable copy, or a body QA cannot read |
| A write lost a database lock (deadlock or lock wait) | 503 `SERVICE_UNAVAILABLE`, nothing committed (`FieldConfigBusyError`, `field-config.service.ts:192-196, 674-683`) | Retry. For publish, retry with the **same** key (the key was freed, section 8) |

- The draft edit and the discard read the catalog **before** their transaction, so these refusals write nothing.
- **`is_new`** (S-6): QA passes the flag through when Reporting sends a boolean. Today it sends none, so `isNew` is `false` everywhere. A non-boolean `is_new` makes the whole catalog malformed, so a 503 (`field-config-catalog.ts:119-121`). Do not build UI that depends on `isNew` yet.
- **S-1:** only top-level fields are configured; subfields follow their field. A comment covers the field with all its sub-options, never one subfield (carried to the comments spec).

## 10. Decision and not built

- **Decided (back lead, 2026-10-26):** after the first publication and a discard, every field has a draft row, so no field reads `unclassified` again (DD-2 with FR-6). This is intended. The front shows `unclassified` only before a field's first classification.
- **Not built:** applying a configuration in the review screens (only the query `FIELD_CONFIG_EFFECTIVE` exists, server-side), a route to read the audit history, copying a previous cycle's configuration.
- **What the server writes:** one audit row per publication in `field_config_audit_events` (the changed fields and the receive and keep lists). Draft edits are not audited (S-8).
