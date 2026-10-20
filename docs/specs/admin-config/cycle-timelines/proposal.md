# Cycles and QA timelines — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Type | Change |
| Approval Mode | gated |
| Status | Approved (back lead, 2026-10-20) |
| Branch | `feat/cycle-timelines` (from `origin/staging-center` @ `204312e`; `staging` lacks the `users` module this builds on) |
| Source | Jira P2-3903 (story, reporter: BA), backend sub-task P2-3933; epic P2-3902. Back lead discussion 2026-10-20 (data model first; naming follows `server/drizzle`) |
| Builds on | `docs/specs/archive/2026-10-19-auth--user-management--core/` (roles, scopes, `canReview` seam D9) |
| Depends on | none (users core is merged in `staging-center`) |
| Unblocks | P2-3904 (edit timeline), P2-3905 / P2-3906 (loads into step 1 / step 3), P2-3909 (worklist), P2-3913 (overview) |
| Parallel-safe | no — adds the first `admin-config` module, new migration `0003`, and touches the shared error catalog |
| Scope | Server only (`server/`); the front Cycle screen consumes the API in its own task (P2-3934) |
| Date | 2026-10-20 |

## Intent

Give the QA Admin a real backend for the **Cycle** screen: create a cycle, then create its QA timelines (one official, any number of additional ones) with dated steps, rounds, scope (Science Programs and result types) and assigned users — so QA runs without the tech team configuring dates by hand.

## Problem / Current Behavior

1. **No backend exists.** `server/src` has no cycle or timeline code (`git grep -n -iE "cycles|timeline" -- server/src` → only the D9 seam comments in `server/src/users/authorization.service.ts:42,82` and `server/src/users/AGENTS.md:33`).
2. **The front Cycle screen runs on mock data.** Every timeline, step and cycle comes from `client/src/app/pages/workspace/cycle/cycle.mock.ts`; saves emit to the parent and stop at `TODO(api)` (`client/src/app/pages/workspace/cycle/timeline-drawer.ts:300-316`, `client/src/app/pages/workspace/cycle/cycle-view.ts`).
3. **The TRD model does not match the story.** TRD § 5.1 defines `cycles → windows → batches` (`docs/trd/trd.md:174-176`), with `results.batch_id` (`docs/trd/trd.md:178`). P2-3903 instead defines *Cycle → Timeline (official / additional, scoped by SP and result type) → Steps (≤ 5, dated, grouped in rounds)*, and treats loading results as separate stories (P2-3905, P2-3906). Windows have no scope and batches hang from windows, so the TRD cannot express "SP02 runs its own dates".
4. **The front prototype diverges from the story** (from the P2-3903 vs front review, 2026-10-20), so the API must own the rules instead of mirroring the mock:
   - "Add step" has no limit (`timeline-drawer.ts:285`); the story caps at 5.
   - Step 1's load switch can be turned off (`timeline-drawer.ts:241`); the story requires it.
   - Rounds are derived from load flags (`client/src/app/pages/workspace/cycle/cycle.logic.ts:257`); the story makes rounds explicit and editable.
   - Steps without an opening date are silently dropped on save (`timeline-drawer.ts:313`); the story requires every date.
   - Step 2 is "Science programs correct in the reporting tool" with audience "Nobody in QA" (`cycle.mock.ts:133-134`); the story names it "QA open for Science Programs", worked by SP users.
5. **The visibility seam is waiting for this spec.** `canReview` accepts extra predicates "the timeline rule will be one" (`server/src/users/authorization.service.ts:42-48,78-83`; archived requirements D9).

## Proposed Outcome

- A QA Admin can **create a cycle**, list cycles, and mark one as the active cycle.
- Inside a cycle, a QA Admin can **create a timeline**. The server makes the first one **official** and every later one **additional**; the client never chooses.
- A new timeline is proposed with the **5 default steps** and default rounds (R1 = 1–2, R2 = 3–5). The admin can rename steps, remove steps (≥ 1, ≤ 5), set dates, choose which steps load results (step 1 always), and regroup rounds.
- The server **refuses** an invalid timeline and names every missing or wrong field: no name, no SP / result type (or "all"), a step without dates, a step that closes before it opens, steps that overlap or are out of order, more than 5 steps.
- A QA Admin can **assign and remove users** (Assessor, Lead Assessor, TPB, PPU) on a timeline at any time.
- Listing a cycle's timelines returns name, kind, scope, steps with dates, **current step** and **readiness** ("No results loaded", "No assessor assigned"…), all **computed from dates and data** — nothing opens or closes a step by hand.
- The official and several additional timelines can be live at the same time.

## Scope

- New module `server/src/admin-config/` (TRD § 4) with ports + Drizzle adapters, following `server/AGENTS.md`.
- Migration `0003` with the tables below (names follow `server/drizzle`: plural snake_case, `<parent>_<children>` join tables, `uq_`/`chk_`/`idx_` constraints, generated `*_key` columns for partial uniqueness).

  | Table | Holds | Key rules |
  |---|---|---|
  | `cycles` | `year`, status (`draft` / `active` / `closed`), audit columns | One `active` cycle (generated key); unique `year` (D-5) |
  | `timelines` | `cycle_id`, name, kind (`official` / `additional`), `is_test`, audit columns | One `official` per cycle (generated key); unique name per cycle |
  | `timeline_programs` · `timeline_result_types` | Scope, PK (`timeline_id`, `program_id` / `result_type_key`) | **No rows = all**, same convention as `user_programs`; `result_type_key` as in `role_assignments` |
  | `timeline_steps` | `timeline_id`, `position` (1–5), name, audience role, `opens_on`, `closes_on`, `requires_load`, `round` | Unique (`timeline_id`, `position`); CHECK `closes_on >= opens_on`; CHECK `position = 1 ⇒ requires_load`; order/overlap checked in the service inside the create transaction |
  | `timeline_users` | `timeline_id`, `user_id`, `role_id`, audit columns | Unique active (timeline, user, role); the user must hold that role |

- Endpoints (admin-only, `ADMIN_ACCESS`), with OpenAPI and error codes:
  `POST/GET /cycles`, `POST /cycles/:id/activate`, `POST/GET /cycles/:cycleId/timelines`, `GET /timelines/:id`, `PUT /timelines/:id/users` (or add/remove routes — decided in design).
- Default step names and audiences served by the API (single source for the front).
- Idempotency opt-in on the create routes (mechanism from `users-admin-write-safety`).
- TRD § 4 / § 5.1 / § 6 updated to the new model as a named deliverable of this spec.

## Non-Goals

- **Loading results** into a step (`timeline_loads`, `timeline_results`) — P2-3905, P2-3906. This spec only reserves the shape (see Recommended Approach).
- Editing dates or steps of an existing timeline — P2-3904.
- Enforcing the timeline visibility predicate on results — lands with the worklist (P2-3909), when results exist; this spec exposes the data it needs.
- Pausing, closing early, "extended access" per SP, or manual advance/hold — out of scope in P2-3903. The front's "Close timeline" and "Extended access" have no backing story.
- Email alerts on step dates; test-timeline cleanup ("Clear test results" needs loads).
- Any front change (P2-3934).

## Affected Users, Systems, And Specs

| Affected | How |
|---|---|
| QA Admin | Creates cycles and timelines without the tech team |
| Assessors, Leads, TPB, PPU | Get assigned to timelines (visible effect arrives with the worklist) |
| `server/src/admin-config/` (new) | Module, services, stores, controllers |
| `server/src/database/drizzle/schema/`, `server/drizzle/0003_*` | New tables; `schema.spec.ts` pins the DDL |
| `server/src/common/error-codes.ts` | New `CYCLES_*` / `TIMELINES_*` codes |
| `server/src/users/` | Read-only use: role catalog, user lookup; D9 seam untouched until P2-3909 |
| `docs/trd/trd.md` | § 4, § 5.1, § 6 replace windows/batches with timelines/steps/loads |
| Front Cycle screen (P2-3934) | Consumes the API; must drop rules the server now owns |

## Visual Reference

- Source: existing mockup and its Angular port.
- Location: `client/src/app/pages/workspace/cycle/` (Cycle view, timeline drawer, step drawer); design sub-task P2-3971.
- Notes: backend-only change; the screen already exists on mock data.

## Requirement Delta Preview

### ADDED Requirements

- Create / list / activate cycles; exactly one active cycle.
- Create a timeline inside a cycle; first = official, later = additional (server-assigned, race-safe).
- Steps: 1–5, default names, rename, remove, dates required, `closes_on >= opens_on`, no overlap, ordered, step 1 requires load.
- Rounds: defaults R1 = 1–2, R2 = 3–5; editable; contiguous and non-decreasing by position.
- Scope: one, several or all SPs and result types, validated against the catalogs (`server/src/users/catalogs/`).
- Validation errors list every offending field in our words (TRD § 6).
- Assign / remove users per timeline (Assessor, Lead Assessor, TPB, PPU).
- Read model: current step and readiness computed at read time from dates, assignments and (later) loads.

### MODIFIED Requirements

- TRD data model: `cycles → windows → batches` becomes `cycles → timelines → timeline_steps`, with loads (`timeline_loads`) under a timeline step.

### REMOVED Requirements

- `windows` (TRD § 5.1) — replaced by `timeline_steps`; nothing implements it today.

## Approach Options

| | A. Cycle → Timeline → Steps; loads (`timeline_loads`) under a timeline **(recommended)** | B. Keep TRD: Cycle → Window → Batch | C. Cycle → Batch (scope) → one Timeline per batch |
|---|---|---|---|
| Fits P2-3903 | Yes — same vocabulary as the story and the front | No — windows have no SP / type scope; no official vs additional | Partly — batch ≈ timeline, 1:1 |
| Fits loads (P2-3905/06) | Yes — step-1 load, step-3 load and late additions are several loads on one timeline | Batch per window, no scope | No — a 1:1 batch cannot hold the step-3 load or a late addition without a second "batch" concept |
| Naming clash | None. The team says "batch" for a timeline (D-7); loads are named `timeline_loads` (P2-3905 calls them "Loads") so "batch" never names two things | — | "Batch" means two things (scope and load) |
| Cost | New tables only; TRD edit | Smallest TRD change, but the story cannot be built | Extra table that duplicates timeline scope |

## Recommended Approach

**Option A.** It is the only one that expresses the story and the two load stories without duplicate scope, and it matches the vocabulary the front, the BA and the glossary already use.

- **Order of work in this spec:** schema + migration → cycles → timeline create (with steps, rounds, scope) → user assignment → read model (current step, readiness) → TRD update.
- **Reserved for P2-3905/06, not built here:** `timeline_loads` (`timeline_id`, `timeline_step_id`, status, counts, `requested_by`) and `timeline_results` (`timeline_id`, `result_id`, `load_id`). Designing their keys now keeps `0003` from needing a breaking change later; readiness returns "No results loaded" until they exist. D-2 (no result in two overlapping timelines) is a load-time rule over these tables, not a unique key.
- **Dates as `DATE`** (`opens_on` / `closes_on`) in `Europe/Rome` (D-1), so "steps open and close by date" needs no scheduler — the current step is a pure function of today's date in that zone.
- **Race safety:** the official-timeline rule and the active-cycle rule are generated-key unique indexes (pattern from `role_assignments.active_key`), so two admins creating at once cannot produce two officials; the 1062 becomes a typed 409.

## Risks, Dependencies, And Open Questions

| ID | Item | Owner | Blocks |
|---|---|---|---|

### Decisions (back lead, 2026-10-20)

| ID | Decision | Effect on this spec |
|---|---|---|
| D-1 | Step dates follow **Central European Time**, IANA zone `Europe/Rome` (CET / CEST, daylight saving included) | `opens_on` / `closes_on` are dates in `Europe/Rome`; the current step is computed in that zone. **The front must state the zone explicitly** wherever a step date is shown or picked (e.g. "Opens 06 Jul 2026, 00:00 CET (Rome)") — P2-3934 |
| D-2 | A result can be in several timelines of the same cycle, **but never in two at the same time**: it can enter a later timeline only after the dates of the previous one no longer overlap | Not enforced here (no loads yet); recorded as a rule for P2-3905 / P2-3906: a load refuses a result already in a timeline whose dates overlap the target's. Replaces "unique (cycle, result)" |
| D-3 | Step 2 = programs respond to comments in the QA view **embedded in Reporting** and fix the result in Reporting; nobody works in the QA platform itself. QA then brings the updated result back (step 3 load) | The front's reading is right: step 2's audience is the PROGRAM role through the Reporting embed, not a QA-platform role. Default step-2 audience = `PROGRAM (in Reporting)`; the step is not assignable in `timeline_users` |
| D-4 | The story's "QA Admin" is the existing `ADMIN` role | Routes guarded by `ADMIN_ACCESS` |
| D-5 | A cycle needs only its **year** | `cycles`: `year` (unique), status; the display name is derived ("2026 cycle") |
| D-6 | Results that entered the official timeline **stay there**, even if a later timeline is opened for their SP | A timeline's scope only limits **what can be loaded** into it; the load decides where a result is. Nothing moves between timelines (rule for P2-3905 / P2-3906) |
| D-7 | **Every** timeline, official included, covers the SPs and the indicators the admin picks; "indicators" = result types (confirmed) | Same scope rules for official and additional: at least one SP and one result type, or "all" chosen explicitly. The front's "programs optional on the official" (`timeline-drawer.ts:204,249`) changes in P2-3934 |
| R-1 | TRD edit on a spec branch: allowed only because `tasks.md` will name it as a deliverable (`AGENTS.md` write discipline) | Back lead | — |
| R-2 | The front prototype keeps rules the API now owns (unlimited steps, derived rounds) — mismatch until P2-3934 | Front lead | Integration |
| R-3 | `qadb` gets migration `0003` by a human step; agents never run it | Back lead | Manual tests |

## Success Criteria

- Every P2-3903 acceptance criterion in scope (1–14, 16 partially, 17 partially, 18) maps to a requirement with a passing test; out-of-scope ones (15, 19) are recorded with the story that delivers them.
- Two concurrent "create timeline" calls on an empty cycle produce exactly one official timeline (unit/fake test + HITL check on MySQL).
- An invalid timeline returns 400 with every offending field listed; nothing is written.
- `pnpm lint && pnpm build && pnpm test && pnpm test:e2e` green; OpenAPI e2e in step with the router.
- TRD § 4 / § 5.1 / § 6 describe the model that the migration creates.

## Next Step

```text
/akili-specify admin-config/cycle-timelines
```
