# Step-1 loads — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/ingestion/step-1-loads` |
| Branch | `feat/step-1-loads` |
| Approval Mode | gated (proposal § 1) |
| Leader | Claude Code, `claude-opus-5-5` (T1) |
| Implementer / Reviewer | `akili-implementer` (`sonnet`, T2) / `akili-reviewer` (`opus`, T3) — Step 8E wrappers |
| Started | 2026-11-04 |
| Persona drift at start | `akili doctor --agents` (v2.37.2): `leader.md` primary-instructions + test-harness, `reviewer.md` audit-checklist, `tester.md` prove-behavior OUTDATED; `implementer.md` CURRENT. Not fixed on this branch (shared-file discipline) — pending item: run `akili doctor --agents --fix` on `staging` |

## Task Execution History

### T-1: `postJson` helper and the `RESULTS_FEED` port with its Reporting adapter

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-8 (error kinds), NFR-1 (key never logged), NFR-4 (10 s timeout part), FR-14 (`release` operation exists)

**Attempt 1**
- Files changed:
  - `server/src/users/catalogs/catalog-http.ts` (+51 / −8: `postJson`, private `requestJson`, `UpstreamStatusError`)
  - new `server/src/ingestion/results-feed.port.ts`, `server/src/ingestion/reporting-results-feed.client.ts`, `server/src/ingestion/reporting-results-feed.client.spec.ts`
  - new `server/src/ingestion/fixtures/{results-list,results-details,intake,release}.json` (extracted by script from `onecgiar_pr@654cbab4d:onecgiar-pr-server/docs/qa-catalog.en.md`)
  - new `server/test/support/fake-results-feed.ts`
- Implementer verification: `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → lint clean, build green, `Test Files 64 passed (64)`, `Tests 2530 passed (2530)`.
- Red run (observed in T-1, mutation applied then reverted):
  - Falsifier 1 (401 → `unavailable`): `AssertionError: expected 'unavailable' to be 'unauthorized' // Object.is equality` — `Tests 4 failed | 56 passed (60)`, one per operation.
  - Falsifier 2 (headers in the warn line): `AssertionError: expected [ …(2) ] to deeply equal []` with `+ "upstream_unavailable source=reporting status=401 headers={\"x-api-key\":\"test-key-SHOULD-NOT-LEAK\"}"` — `Tests 1 failed | 59 passed (60)`.
- Consumers (`git grep -ln "catalog-http" -- src test`): `field-config-catalog.ts`, `reporting-qa-catalog.client.ts`, `catalog-http.spec.ts`, `clarisa-science-programs.client.ts`, `reporting-result-types.client.ts` — all green in the full run.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint clean, build green, `Test Files 64 passed (64)`, `Tests 2530 passed (2530)`.
- Reviewer verdict: **PASS** (checklist mode). FR-8 kinds for all four operations including the list GET; `release` exists; 10 s abort proven at 9,999/10,000 ms; `LogSpy` covers every sink and is non-vacuous; existing `getJson` callers unchanged. Fixture provenance checked against the `onecgiar_pr` working-tree contract (key-for-key match; only `catalog_version` 2026.31 vs 2026.33 differs, consistent with v1.29 being earlier); the exact commit could not be read by the Reviewer (no Bash).
- runtime events: none
- spawns: implementer 20 calls, 134,398 tokens, ended complete; reviewer 15 calls, 65,989 tokens, ended complete

**ADVISORY (4R, not gating)**
- RISK: NFR-4 "response size bounded" — `res.json()` reads the whole body with no byte cap. T-1 cites only the timeout part; open gap for a later task (T-8) or the user.
- READABILITY: a 4xx logs `upstream_unavailable … status=401` while the adapter classifies it `unauthorized`/`rejected` (changing it would alter existing callers' log text). `upstream_bad_body source=reporting` does not name the operation.
- RELIABILITY: `FakeResultsFeed.answer` — a scripted function that throws escapes synchronously instead of returning a rejected promise.
- RELIABILITY: `run()` maps any unexpected error to `unavailable`, programming errors included; a comment saying it is intentional would help.
- DOCS: `server/test/AGENTS.md` support list does not mention `support/fake-results-feed.ts` yet (T-11 territory).

**Decisions made**
- Ambiguity resolved by the Leader before spawning: design § 7.7 "same error mapping as `getJson`" read as same abort / redirect / parse / log discipline; the FR-8 kinds are binding for the adapter, list GET included; `getJson` callers unchanged.
- Implementer: `UpstreamStatusError extends UpstreamUnavailableError` carries `httpStatus` (`status` collides with a private member of the base exception); `getJson` and `postJson` share a private `requestJson`.
- Implementer: headers are passed by the caller (P-11 pattern); `x-api-key` is built in the adapter only.
- Implementer: reason fields typed `string` (the contract says new reasons are additive); bad shape / non-JSON → `unavailable` with fixed line `upstream_bad_body source=reporting`.
- **Execute-time spec edit:** `design.md` § 7.7, `postJson` row — amended 2026-11-04 to say headers are passed by the caller (P-11), the helper never logs or echoes them, and non-2xx keeps its status via `UpstreamStatusError`. Reason: the prior text ("key in a header built inside the helper") contradicted P-11 and the shipped `getJson` pattern; Reviewer adjudicated it conformant in substance. Requirement meaning unchanged (NFR-1 still holds). Carried as a named conformance check into the next task's Reviewer brief.
- Skills: as listed in the task (nestjs-expert, api-design-principles, error-handling-patterns); effort medium; no deviation.

**Issues encountered:** none.

**Budget running totals (design § 10):** tasks 1 / 11 · production LOC ≈ 434 (adapter + port + helper; estimate for the adapter line was 200) of ≈ 1,450 · test LOC ≈ 360 + 79 support of ≈ 1,800 · review rounds 1 / 14. Overall budget not exceeded; the adapter line ran ≈ 2× its estimate — watch at T-7/T-8.

**Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → green (64 files, 2,530 tests).
