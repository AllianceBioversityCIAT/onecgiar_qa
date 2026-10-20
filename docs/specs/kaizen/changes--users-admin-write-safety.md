# Kaizen Entry — changes/users-admin-write-safety

## Document Control

| Field | Value |
|---|---|
| Spec Path | `changes/users-admin-write-safety` |
| Date | 2026-10-20 |
| Branch | feat/users-admin-write-safety |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 8 (+ 1 user-approved T-1 amendment) | tasks.md, execution.md |
| Reviewer FAIL rework attempts | 4 (T-2 ×1 DI token + `common`→`users` import; T-7 ×1 NFR-3 evidence; T-8 ×2 record over-claims) | execution.md |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0 | execution.md |
| PRODUCT_BUGs | n/a (no `test-report.md`) | — |
| Judgment-day severe findings | n/a | — |
| Validation FAIL / WARN | n/a (no `validation-report.md`, accepted) | — |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Escaped defects (§3) | 1 found at HITL: replayed `data` key order (MySQL `JSON` normalizes keys) — invisible to the in-memory store | execution.md — T-8 |
| Budget | ≈ 8,200 LOC vs ~3,600 planned (×2.3); 20 Reviewer verdicts vs ~14 | design.md § 2, execution.md — Budget Tripwire |
| Drift attributable | none recorded (no audit report) | docs/specs/audits/ |

## Lessons

- **KZ-changes--users-admin-write-safety-1 — Storage-dependent requirements were gated on a harness without the storage engine.** (Product + Methodology, Medium)
  - Root cause: `tasks.md` assigned NFR-3 (overhead) to "the e2e app" and FR-3 replay equality to e2e tests, both running on the in-memory key store. The defect-class table had no row for properties that depend on MySQL itself (round-trip cost, `JSON` serialization). So T-7's measurement could not evaluate NFR-3, and the key-order difference surfaced only at HITL.
  - Evidence: execution.md — T-7 attempt 1 FAIL ("comes from the in-memory key store … cannot measure what dominates the real cost") and Leader adjudication (spec tension); T-8 "Finding — replayed `data` key order".
  - Standardization: → P1 (local template) and P2 (upstream)

- **KZ-changes--users-admin-write-safety-2 — The HITL plan had no secure hand-over for an admin session.** (Product, Low)
  - Root cause: T-8 needed an admin access token to call the API, but its scope never said how to hand one over. The Leader proposed a file outside the repo mid-run, and the token was pasted in chat anyway. This repeats a "noted, not a lesson" item from `auth--user-management--core` (credentials pasted in chat three times).
  - Evidence: execution.md — T-8 (token "used in memory only, never stored"); `docs/specs/kaizen/auth--user-management--core.md` — Noted, not a lesson, item 1.
  - Standardization: → P3

## Noted, not a lesson

- Recurrence of KZ-auth--user-management--core-2: the budget cited the defect-class gates (`design.md` § 2) and still ran ×2.3. The per-gate estimates missed the SQL-executing driver + contract suite (T-2 ≈ 2,000 LOC vs ≈ 600 estimated). → P4
- Recurrence of KZ-auth--user-management--core-3: T-7's guides had three false claims (lock order, `response_body` "never read", log lines), and the Leader's own T-8 record over-claimed twice (email count, create-replay `data`). → P5
- T-2: an `@Injectable()` class had an untokened constructor parameter — the Nest DI convention exists in `server/AGENTS.md`; one-off.
- T-3: two Reviewer lenses disagreed on whether `response.status()` survives Nest's reply on a replay; T-6's e2e settled it on the real status.
- Invitations to `custom` CGIAR `+alias` addresses never arrived (not even on create) — product deliverability question, outside this spec.
- The T-1 Reviewer advisory on collation became a user-approved amendment before `0002` was applied — an advisory caught early, at no cost.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/requirements.md` — defect-classes table guidance |
| Edit | "For any requirement whose measure depends on the real storage engine or network (latency, serialization, locking), the gate row names the real environment (HITL step), never an in-memory harness; the fake-level check is listed as a substitute, not the gate." |
| Severity | Medium |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` defect-class gates and task planning: classify each gate as *harness-provable* or *engine-dependent*; an engine-dependent gate (perf, serialization, locking) must be assigned to a real-environment step, not to a task that runs on fakes. (Source: KZ-changes--users-admin-write-safety-1.) |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/task.md` — HITL task guidance |
| Edit | "A HITL step that needs a session or credential states the hand-over: the human stores it in a file outside the repo (e.g. `~/.qa-admin-token`, `chmod 600`) and the agent reads it by path — never pasted in chat, never written to the repo." |
| Severity | Low |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-2 |
| Edit | Add source `changes/users-admin-write-safety` (≈ 8,200 vs ~3,600 LOC, tripwire after T-3) — recurrence even with gate-derived estimates: concurrency harnesses (SQL-executing drivers, contract suites run on fake + adapter) are underestimated ×3; keep severity Medium. |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-3 |
| Edit | Add source `changes/users-admin-write-safety` — recurrence: three false guide claims (T-7) and a Leader-authored HITL record that over-claimed twice (T-8); the claims check must cover Leader-written records, not only Implementer docs. Keep severity Medium (now 2 source specs). |
| Severity | Medium |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `AGENTS.md` (root) — `## Module Guides`, `server/src/common/AGENTS.md` entry |
| Edit | `server/src/common/AGENTS.md` — HTTP bootstrap (`configureApp`), the response standard (envelope, error catalog, field errors), request id, and idempotent writes (`@Idempotent()`, key store, `Idempotency-Key` / `Idempotency-Replayed`). |
| Severity | Low |
| Status | pending |

### P7

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `docs/trd/trd.md` — § 5.1 MySQL entities table |
| Edit | Add row: `` `idempotency_keys` `` \| actor_id + idem_key (PK; `ascii_bin`), fingerprint, state (in_progress, executed, completed), owner_token, lease_until, route_status, target_user_id, response_status, response_body (JSON), created_at, expires_at (indexed) — migration `0002`. |
| Severity | Low |
| Status | pending |

### P8

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `docs/trd/trd.md` — § 6 API conventions and § 7 logging |
| Edit | § 6: "Writes accept an optional `Idempotency-Key` (≤ 128 chars, `[A-Za-z0-9-_.:]`, per admin, 24 h); a replay returns the first answer with `Idempotency-Replayed: true`; 409 `IDEMPOTENCY_IN_PROGRESS` (transient, lease 120 s) and 422 `IDEMPOTENCY_KEY_REUSED`; opt-in per route with `@Idempotent()`." § 7: "Decision lines carry `idempotency=none\|taken_over`; the interceptor writes `event:idempotency` lines for replayed / in_progress / reused." |
| Severity | Low |
| Status | pending |

### P9

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `server/test/perf/idempotency-overhead.measure.ts:46` — comment path |
| Edit | `docs/specs/changes/users-admin-write-safety/execution.md` → `docs/specs/archive/2026-10-20-changes--users-admin-write-safety/execution.md` (the spec folder moved at archive). |
| Severity | Low |
| Status | pending |
