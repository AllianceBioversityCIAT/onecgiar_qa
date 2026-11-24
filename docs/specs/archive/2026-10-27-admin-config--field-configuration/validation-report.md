# Validation Report — Field configuration per cycle

**Verdict: PASS with warnings. 0 FAIL, 10 WARN.** *Update 2026-10-27: R-1…R-5 are fixed (see `execution.md` → Remediation after validation). R-6 and R-7 remain follow-ups.* Every requirement is implemented and tested at clause level, and the build is green. Before `/akili-archive`, do the spec and doc touch-ups (R-1…R-4, about 30 min). R-5…R-7 are code, test and ops follow-ups. The most important one is R-5: a draft of 2,000 items probably gets a 413 from the 100 KB body limit.

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Branch | `feat/field-configuration` (merged into `staging-center` and `dev`) |
| Date | 2026-10-27 |
| Leader | Claude Code, `claude-opus-5-5`. Ran the build, lint and tests |
| Auditor | `akili-reviewer` (`opus`, T3), read-only. The Implementer was `sonnet` (T2), so author ≠ auditor |
| Inputs reused | `test-report.md` (coverage matrix, spot-checked); `execution.md` (closing records, advisories, PI-1…PI-8) |

## 2. Summary

| Area | Result |
|---|---|
| Task completion (11/11) | PASS (format WARN) |
| File existence | WARN: the design § 4 tree is not amended |
| Build integrity | PASS |
| Requirement coverage (FR-1…FR-14, NFR-1…NFR-8) | PASS, with 2 WARN (FR-8 replay reader, NFR-6 on TEST) |
| Design conformance | PASS, with 2 undocumented drifts (WARN) |
| Cross-document figures | WARN: "200" vs 201, stale counts |
| Front contract vs code | WARN: the 2,000-item bound vs the body limit; wrong OpenAPI examples |
| Security / authz | PASS |
| Guides / TRD | WARN: 4 stale lines in `server/src/admin-config/AGENTS.md` |

## 3. Task Completion

| Task | Evidence | Closing record |
|---|---|---|
| T-1…T-4, T-6…T-8 | Red run, falsifier, Leader re-run VERIFIED | PASS |
| T-5 | Attempt 1 lens FAIL, attempt 2 PASS | `REVIEW_WAIVED` (degraded pair), approved by the back lead |
| T-9 | Attempts 1 and 2 FAIL, attempt 3 PASS | VERIFIED |
| T-10 | Attempt 2 PASS | VERIFIED |
| T-11 | 1 × 201 + 4 × 409 overlapping on TEST; SQL audit count 1 | Disqualifier waived ("acepto la evidencia") |

**WARN (format):**
- T-5, T-9, T-10 and T-11 have no header table.
- T-11 has no "Final verification" line.
- The stale heading "Why T-11 stays `[~]`" is still there.
- The PI-7 row contradicts itself.

## 4. File Existence

Every file in design § 4 exists, with three drifts:
- `dto/cycle-field-config-params` does not exist; the code reuses `CycleIdParams`, as design § 6 says.
- `models/preview.model` and `models/publish.model` are merged into `models/field-config.model.ts`.
- Three files are missing from the tree: `field-catalog.ports.ts`, `field-config.module.spec.ts` and `dto/field-config.dto.spec.ts`.

**WARN:** amend the § 4 tree.

## 5. Build Integrity

Run by the Leader on 2026-10-27 at `8ec2b7f`:

| Command | Result |
|---|---|
| `pnpm build` (server) | exit 0 |
| `pnpm lint` (server, whole project) | exit 0, 0 warnings |
| `pnpm test` | 60 files, **2304 passed** |
| `pnpm test:e2e --maxWorkers=2` | 14 files, **865 passed** |
| `npx ng build` (client) | exit 0 |

## 6. Requirement Coverage

Clause level. The tests cited by `test-report.md` were spot-checked, every `BUT` / `AND IT MUST` clause first.

| Requirement | Verdict | Note |
|---|---|---|
| FR-1, incl. "BUT must NOT reveal whether the cycle exists" | PASS | Same error body for an existing and a missing cycle (e2e) |
| FR-2, incl. "BUT NOT list subfields", "AND IT MUST break ties by array position", "BUT NOT an empty list" | PASS | The subfields clause is tested only at unit level (advisory) |
| FR-3 … FR-7, incl. FR-5 "BUT NOT stop at the first" and FR-7 "BUT NOT write" | PASS | |
| FR-4 "AND IT MUST … even by a direct database write" | PASS | CHECK pinned in the DDL; the direct write on MySQL was not run (accepted gap) |
| FR-8 publish, stale, nothing to publish, two admins | PASS | On real MySQL at T-11. Stores a superset of fields (DD-2) |
| FR-8 replay | **WARN** | Only the stored-answer path is tested. No test calls `replayPublish` / `findPublication` (crash window, DD-9). `test-report.md` § 7 overclaims |
| FR-9 … FR-13 | PASS | |
| FR-14 front contract | WARN | See § 8 |
| NFR-1…NFR-5, NFR-7, NFR-8 | PASS | Per `test-report.md` |
| NFR-6 503 within 10 s | **WARN** | Bounded in the client (unit tests). TEST showed a hang over 45 s; the cause is outside the client and still open |

## 7. Linting & Code Quality

Lint is clean. The **4R findings are advisory** and do not change the verdict.

**New:**
- **RISK:** catalog drift between preview and publish is not guarded. The revision covers only the draft. If the 1 h cache refreshes in between, the diff can change.
- **RELIABILITY:** a duplicate key in the catalog makes the publish fail with an uncaught 1062, so the admin gets a 500.
- **RISK:** TEST cycle 34 permanently holds year 2026 on TEST.
- **READABILITY:** the audit key `"<type>.<field>"` contains dots inside field keys; split on the first dot.
- **RISK:** a DTO imports a runtime constant from the Drizzle schema.

**Carried forward from `execution.md`, unresolved:**
- T-2: `is_new` or `description: null` turns the whole catalog into a 503; `["*","bogus"]` is accepted.
- T-5: `VALUES()` (PI-4); no driver timezone; `bumpRevision(undefined, …)` takes positional arguments.
- T-6: `effectiveFor` reads every timeline (design says step 1).
- T-7: a no-op is answered from an unlocked read.
- T-8: replay names are read at replay time.
- T-9: no HTTP pair for 2,000 / 2,001 items.
- PI-3, PI-7 and PI-8 are still open.

## 8. Design Conformance

| Decision | Verdict |
|---|---|
| DD-6 lock order and conditional `UPDATE … WHERE revision` | PASS |
| 1062 → stale | PASS (the design names only the UNIQUE backstop) |
| 1213 / 1205 → 503, no retry (`FieldConfigBusyError`) | **WARN:** not in `design.md`; recorded only in `execution.md` T-7 |
| DD-5 Rome-date rule, publish instant to the second | PASS |
| DD-5 premise "an edit locks a started step 1" | **WARN:** false for a held timeline, whose step 1 can still move. The timeline then goes back to provisional. Low harm, because there is no review without a load. Add a caveat to DD-5 |
| DD-2, DD-4, DD-7, DD-8a, DD-9…DD-12, S-14 | PASS |

**Cross-document figures:**
- **504 fields, the counts per type, 5 routes, 10 s, 1 h / 24 h:** consistent.
- **Publish status:** `tasks.md` T-9 ("one 200, one 409") and T-11 ("Expect one 200") contradict the code and the e2e, which answer **201**.
- **Stale numbers:**
  - `design.md` header says S-1…S-13; S-14 exists.
  - The `execution.md` Summary still shows 2299 / 862; it is now 2304 / 865.
  - The DTO comment says "about 8 result types"; there are 9.

**Front contract vs code:** every line citation matches HEAD. Publish 201, `Idempotency-Replayed`, the revision round trip and a nullable `keep[].version` are correct.
- **"1 to 2,000 items" is probably unreachable.** `configure-app.ts:62` registers the JSON parser with no limit, so the body-parser default of 100 KB applies. 2,000 items is about 220–260 KB, which gets a 413 `PAYLOAD_TOO_LARGE`, and neither the contract nor OpenAPI lists that code for PATCH. A full classification (504 items, about 60 KB) fits.
- **The OpenAPI examples have the wrong key shape:** `INNOVATION_DEV` and `title`. Real keys look like `innovation_development` and `general.title`.

## 9. Test Evidence Summary

The evidence comes from `test-report.md`, and the Leader re-ran the suites (§ 5). Of the 8 tests added by `/akili-test`, the NFR-6 body-stall test was mutation-checked. No PRODUCT_BUG was found.

**Gaps:**
- the crash-window replay reader (R-6);
- the 2,000-item HTTP case (R-5);
- the real-MySQL items of PI-7, accepted as manual.

## 10. Agent Guide / Constitution Impact

| Location | State |
|---|---|
| TRD § 4, § 5.1, § 6, § 13 | Current |
| Root `AGENTS.md` and `server/AGENTS.md` | Current |
| `server/src/common/AGENTS.md` (version-id replay reader) | Current |
| `server/src/database/AGENTS.md` | Current |
| `server/src/admin-config/AGENTS.md` | **WARN**, 4 stale lines (below) |

Stale lines in `server/src/admin-config/AGENTS.md`:
- :24 says "Both controllers"; there are three.
- :70 says "Busy (T-9)"; it was T-7.
- :73: the NFR-6 wording predates the test report's finding.
- :78: the replay target ids do not include the version id.

## 11. Remediation

| # | Severity | Fix | Kind | When |
|---|---|---|---|---|
| R-1 | WARN | `tasks.md` T-9 and T-11: "200" → "201" | spec | before archive |
| R-2 | WARN | `design.md`: S-14 in the header; § 4 tree; § 7.5 / DD-6 add 1213/1205 → 503 and 1062 → stale; DD-5 hold caveat | spec | before archive |
| R-3 | WARN | `execution.md`: Summary counts, the PI-7 row, the stale T-11 heading, the T-11 verification line | spec | before archive |
| R-4 | WARN | `server/src/admin-config/AGENTS.md` :24, :70, :73, :78; the DTO comment "about 8" | docs | before archive |
| R-5 | WARN | 2,000-item bound vs the 100 KB body limit: add an e2e with 504 and with 2,000 items, then raise the JSON limit, lower `MAX_DRAFT_ITEMS`, or document 413 in the contract and OpenAPI. Fix the OpenAPI examples | code + contract | follow-up (the front's first full save hits it) |
| R-6 | WARN | Test the crash-window replay (`executed` key, no stored answer → `replayPublish` → `findPublication`); correct `test-report.md` § 7 | test | follow-up |
| R-7 | WARN | NFR-6 hang on TEST: server logs for 2026-10-26 around 21:15 UTC; record that the TEST key was rotated and the token revoked | ops | follow-up |

## 12. Archive Readiness Recommendation

**Ready to archive after R-1…R-4.** These are spec and doc fixes, and none changes behavior.
- **R-5** is the only finding the front will hit soon. Fix it before the front builds the save, or as its own quick spec.
- **R-6 and R-7** can follow the archive as recorded follow-ups.

```text
/akili-archive admin-config/field-configuration
```
