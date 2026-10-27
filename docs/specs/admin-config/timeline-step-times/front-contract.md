# Timeline step times — Front contract

For the front lead (P2-4021). The server side is built and documented in the OpenAPI document (`/api/v1/docs`); this note says what the screens can rely on, what changed, and what the front must do. It adds to the contracts of `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md` and `docs/specs/admin-config/timeline-edit/front-contract.md` (envelope, `Idempotency-Key`, error format, edit flow): read those first. Source of truth for any disagreement: `server/src/admin-config/timelines/` and `server/src/admin-config/rome-date.ts`.

## 1. Quick path

1. Read `steps[].opensAt` / `closesAt` and `timeZone` from the timeline. They are Rome wall-clock minutes, `YYYY-MM-DDTHH:mm`.
2. Write the same two keys, one per boundary. Show the time in every label (section 7).
3. Until your screens move, nothing breaks: `opensOn` / `closesOn` are still returned and still accepted (section 4).

## 2. The fields

On the `Timeline` response (`TimelineModel`, also inside `TimelineDetailModel`):

| Field | Type | Meaning |
|---|---|---|
| `timeZone` | string, always `Europe/Rome` | The zone of every moment and day of this timeline. Show it next to times, never convert |
| `steps[].opensAt` | `YYYY-MM-DDTHH:mm` | The first minute the step is open (second :00) |
| `steps[].closesAt` | `YYYY-MM-DDTHH:mm` | The last minute the step is open: it stays open until second :59 of that minute |
| `steps[].opensOn` | `YYYY-MM-DD`, **deprecated** | The date part of `opensAt` |
| `steps[].closesOn` | `YYYY-MM-DD`, **deprecated** | The date part of `closesAt` |

- Moments carry **no offset and no seconds**. They are not instants: do not build a `Date` from them in the browser zone.
- Cycles are unchanged: `startsOn` / `endsOn` stay days (the date part of the earliest opening and the latest closing).
- Field-configuration `preview` / `keep` entries keep `opensOn` as the opening **day** of step 1. No time is added there.
- `state`, `status`, `currentStep`, `nextStep` are now judged to the minute, still computed on every read. A step is `in_progress` from its opening minute to second :59 of its closing minute, **unless the timeline is on hold**. The hold still wins over step 1's window: with no load, status is `waiting_for_load` from step 1's opening minute and every step is `upcoming` (see the earlier contracts). The hold now starts at the opening minute, not at 00:00 of the opening day. Until loads exist (P2-3905) that is every timeline whose step 1 has opened. Two steps may share a day (section 6).

Request keys, per step, on `POST /cycles/:id/timelines` and `PATCH /timelines/:id`:

| Key | Type | Meaning |
|---|---|---|
| `opensAt` / `closesAt` | `YYYY-MM-DDTHH:mm` | The moment |
| `opensOn` / `closesOn` | `YYYY-MM-DD` | Day-only form. Means 00:00 when it opens a step and 23:59 when it closes one |

## 3. Codes

| Code | Status | What changed |
|---|---|---|
| `DST_HOUR` | 400, field error. **New** | A time from 02:00 to 02:59 on one of the two Rome clock-change days is refused: the hour does not exist (spring) or happens twice (autumn). `01:59` and `03:00` are fine. Message: "This time does not exist or happens twice in Rome on this day (daylight-saving change). Choose another time." |
| `BEFORE_TODAY` | same code | Now judged to the **minute**, not the day. A first step may open at the current minute. It is then `in_progress` at once **only if the timeline has a load**; with no load the timeline is `waiting_for_load` (the hold) and every step is `upcoming`. Loads are not built yet, so today that is always the hold. The same applies to the edit locks (an `upcoming` step cannot move to open before now; an `in_progress` step cannot close before now). The message still says "date" |
| `CLOSES_BEFORE_OPENS` | same code | Now **strict**: closing at the same minute as opening is refused too. Same-day close is fine at a later minute. The message still says "before" |
| `OVERLAPS_PREVIOUS_STEP` | same code | Unchanged in name; a step must open strictly after the previous step's closing minute, so it may open later on the same day (S-1) |
| `INVALID` | same code | New case: both forms for one boundary (`opensAt` and `opensOn`, or `closesAt` and `closesOn`) |

Show messages from the server where you can; `DST_HOUR` is the only one whose wording is new. Add `DST_HOUR` to the code list in `client/src/app/core/http/api-envelope.ts` (comment on `ApiFieldError.code`) and its mapping wherever the form maps codes to messages.

## 4. Compatibility window

The additive API lets the current front keep working until P2-4021 ships.

| Rule | Detail |
|---|---|
| Day-only writes still work | `opensOn` means `…T00:00`, `closesOn` means `…T23:59` (S-6). Every rule then judges that moment |
| **One key per boundary** | Send `…At` or `…On`, never both, even when they agree: `INVALID` on the day-only key. A `null` key **counts as sent**, so `opensAt: '2026-11-10T09:00', opensOn: null` is `INVALID` on `opensOn`. This holds for both families |
| Response keeps both | `opensOn` / `closesOn` are deprecated in the response (marked so in OpenAPI). The request day-only keys are accepted and are **not** marked deprecated |
| A day-only edit over a stored time | A `closesOn` equal to the stored day, over a stored `17:30`, is a **change** to `23:59` and meets the edit locks. Resending the day you read from `closesOn` after the server stored a time rewrites the time. A client that only changes a name must leave the dates out |
| Cleanup | Guidance, not spec: design DD-7 (7.7) says "clean-up later" and fixes no date. The intent is to drop the day-only keys in a later spec, after P2-4021 ships; do not build new code on `opensOn` / `closesOn` |

**Accepted consequence (S-6 with FR-5).** With day-only writes meaning 00:00, the current front cannot create a timeline whose step 1 opens **today** once Rome is past 00:00: it gets `BEFORE_TODAY` on step 1's opening key until the time picker ships. Starting tomorrow works.

## 5. Error keys (the rule that keeps the current front working)

A 400 `VALIDATION_FAILED` lists `fields: [{ field, code, message }]` as before. **An error names the key the client sent** (DD-5): a client that sent `steps[0].opensOn` gets `steps[0].opensOn`, one that sent `steps[0].opensAt` gets `steps[0].opensAt`.

| Situation | Field reported |
|---|---|
| The boundary was sent | The key that was sent |
| Both forms sent | The day-only key (`…On`), code `INVALID` |
| The boundary was **not** sent (missing on create, stored on edit) and the request sent only day-only keys | `…On` |
| The boundary was not sent and the request sent at least one `…At` key | `…At` |

Step paths otherwise follow the earlier contracts (`steps[i]` by request index on create; `steps[position - 1]` on edit, except a bad `position`). A form that sends moments must map `…At` keys to its picker fields; a form that sends days keeps mapping `…On`.

## 6. Same-day steps (the reversion challenge)

One shipped rule is gone: "two steps never share a day". "A step may open and close on the same day" still holds.

- Two steps **may share a day**: step 2 opens strictly after step 1's closing minute, even the same day.
- A step may open and close on the same day at different minutes. The same minute is `CLOSES_BEFORE_OPENS`.
- The server contract holds. What breaks is the screen: a card that shows only a day range now shows the same day twice, and a "day N of M" calculation, an overlap pre-check by day or a sort by day becomes ambiguous. The day-based checks in the front (`todayInRome`, `parseDate`, `compareDates`) are comfort pre-checks only; the server decides.

## 7. For P2-4021: what the screens must do

**AC 1: pick hour and minute.** `qa-date-picker` picks days only (`client/src/app/pages/workspace/cycle/step-drawer.ts:112,120`). The step drawer needs an hour and minute input per boundary, 24-hour, minute precision, sending `…At`. Refuse or warn on 02:00-02:59 on the clock-change days before sending (comfort only; the server answers `DST_HOUR`).

**AC 2: labels show the stored times.** `opensLabel` / `closesLabel` in `client/src/app/core/domain/rome-date.ts:55-62` print a fixed `00:00` and `23:59`. They must print the stored hour and minute plus the zone (CET or CEST, from the date), for example `Opens 12 Nov 2026, 14:00 CET (Rome)`. Where a label has only the day today (cards, overview attention list), add the time.

**AC 7: "Reset to official timeline" keeps the times.** `officialRelative` in `client/src/app/pages/workspace/cycle/cycle.logic.ts:172-182` shifts whole days and drops the time of day. It must keep each official step's `HH:mm` when it shifts the dates, and keep the gap between two moments (a same-day official step stays same-day; this follows from keeping `HH:mm`).

**Reading the audit (section 8) and the P-8 files.** These nine files read `opensOn` / `closesOn` and the error paths. Update them when moving to moments:

| File | Change |
|---|---|
| `client/src/app/core/api/cycles.models.ts` | Add `opensAt`, `closesAt` on the step, `timeZone` on the timeline, the request keys; mark `opensOn` / `closesOn` deprecated; fix the file comment that says step dates are days |
| `client/src/app/core/http/api-envelope.ts` | Add `DST_HOUR` to the code list; the `field` comment names `…At` paths |
| `client/src/app/pages/workspace/cycle/cycle.mapper.ts` | Map the moments; send `…At` |
| `client/src/app/pages/workspace/cycle/cycle-store.ts` | Map error keys per section 5 |
| `client/src/app/pages/workspace/overview/ov-attention.ts` | Judge by moment where it judges by day |
| `client/src/app/pages/workspace/overview/overview-view.ts` | Show times |
| `client/src/app/core/api/cycles-api.spec.ts` | Fixtures and request keys |
| `client/src/app/pages/workspace/cycle/cycle-store.spec.ts` | Error-key cases |
| `client/src/app/pages/workspace/cycle/cycle.mapper.spec.ts` | Mapping cases |

## 8. The audit key change

`timeline_audit_events.changes` (no screen or endpoint reads it yet) holds two key families:

| Records | Keys | Values |
|---|---|---|
| Older | `steps.<position>.opensOn`, `steps.<position>.closesOn` | days, `YYYY-MM-DD` |
| From now on | `steps.<position>.opensAt`, `steps.<position>.closesAt` | minutes, `YYYY-MM-DDTHH:mm` |

Old records are not rewritten (FR-12). A history screen must read both. A change of time only on the same day is one `…At` entry; it never also writes the `…On` key.

## 9. Open points

- The messages of `CLOSES_BEFORE_OPENS` and `BEFORE_TODAY` (in `server/src/common/error-codes.ts`) still say "date" and "before"; they fit but are not exact about minutes. Whether to reword them is open.
