# Field configuration per cycle — Test Report

**Overall: PASS.** Every FR and NFR clause has test evidence or a recorded manual gap. No product bug was found. 8 tests were added (5 unit, 3 e2e). The hang over 45 s seen on TEST is not reproducible in the client: every path the client controls ends at 10 s.

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Branch | `feat/field-configuration` |
| Date | 2026-10-27 |
| Leader | Claude Code, `claude-opus-5-5` (T1) |
| Tester | `akili-tester` wrapper (T2), effort high: one Tester, sequential, because unit and e2e share fixtures |
| Status | PASS |

## 2. Summary

| Suite | Before | After | Result |
|---|---|---|---|
| Backend unit (`pnpm test`) | 2299 | **2304** (+5), 60 files | PASS; also green under `TZ=UTC` and `TZ=America/Bogota` |
| HTTP e2e (`pnpm test:e2e -- --maxWorkers=2`) | 862 | **865** (+3), 14 files | PASS; also green under `TZ=America/Bogota` |
| Lint (`pnpm lint`, whole project) | 0 warnings | 0 warnings | PASS |
| Build (`pnpm build`) | ok | ok | PASS |
| Frontend unit / browser E2E | — | — | Not in scope: this spec has no UI |

- **One suite group, one Tester.** No suite was run inline.
- **The Leader re-ran the evidence:** unit tests `2304 passed (2304)` and lint clean.
- **Resource guard:** it blocked e2e once (3512 MB available, 4500 MB needed). The block cleared by itself and was never bypassed.
- **Lookup note:** with `pnpm test:e2e -- <file>`, vitest ignores the file filter and runs all 14 files. To run one file, use `pnpm test:e2e <file>`.

## 3. Backend Unit Tests

Existing tests are cited, not rewritten. The rules, diff, versions, catalog shaping, client, store, unit of work, service, controller and module specs are under `server/src/admin-config/field-config/`. The DDL is pinned in `server/src/database/drizzle/schema/schema.spec.ts`.

**Added** in `reporting-qa-catalog.client.spec.ts`, describe *"NFR-6: a hung Reporting is bounded by the 10 s timeout"*:

| Test | Proves |
|---|---|
| a body that stalls after the headers is aborted at 10 s: unavailable, not a hang | The timer runs until `res.json()` resolves, not only until the headers arrive. **Mutation-checked:** clearing the timer early turns this test red. |
| a call with no answer at all stays open up to 10 s and is unavailable right after | Bound on a call with no answer |
| requests that join a hung call all end at 10 s, and the next request asks Reporting again | The per-year in-flight entry is dropped, so a dead call is not reused |
| a hung Reporting serves the cached catalog of that year once the copy is no longer fresh, and nothing for a year with no copy | A stale copy is served on a hang |
| a hung Reporting does not serve a copy older than 24 h | The 24 h limit on a stale copy |

## 4. Frontend Unit Tests

Not applicable. No client code is part of this spec. The front builds from `front-contract.md`.

## 5. Integration Tests

The HTTP e2e suite is the integration layer: the full Nest app, over in-memory ports. It is listed under § 6.

## 6. E2E Tests (HTTP)

Existing: `server/test/admin-config-field-config.e2e-spec.ts` had 83 cases before this run and has 85 now.

**Added:**

| File | Test | Proves |
|---|---|---|
| `admin-config-field-config.e2e-spec.ts` | NFR-5: view, edit, preview, publish and discard each read the catalog of the cycle year exactly once; a refused one reads it at most once | NFR-5 on the write routes; before this run, only view and preview were covered |
| `admin-config-field-config.e2e-spec.ts` | FR-1 and FR-8: a keyed publish refused for no token or for a non-admin reserves no idempotency key and records nothing | A 401 or 403 leaves `idempotency_keys` empty; the key is still free for the admin |
| `openapi.e2e-spec.ts` | field-configuration FR-1, FR-8, NFR-2: documents its five admin routes, the codes each can answer, and the bounds of its two bodies | The OpenAPI check now covers field config specifically; before, only the generic routes check did. Covers 401/403, `Idempotency-Replayed`, `revision` min 0, and `items` 1..2000 |

## 7. Coverage & Traceability

"Cited" means an existing test asserts the clause. "Added" means a test from this run.

| Requirement | Scenario / clause | Type | Test | Result | Notes |
|---|---|---|---|---|---|
| FR-1 | Non-admin 403, nothing read or written | e2e | `FR-1: access` matrix (6 roles × 5 routes, catalog reads counted) | PASS | cited |
| FR-1 | 401 without a token or with a bad one | e2e | "401 without a token and with a token that is not valid" (×5) | PASS | cited |
| FR-1 | BUT must NOT reveal whether the cycle exists | e2e | "same 403 for a cycle that exists and one that does not" (×5) | PASS | cited |
| FR-1 | A refused request leaves no key | e2e | keyed publish refused, no key reserved | PASS | added |
| FR-2 | Grouping and order, `"*"`, requirement, `isNew`, no subfields | unit+e2e | catalog spec; service view; e2e "nine types in catalog order" | PASS | cited |
| FR-2 | AND ties broken by array position | unit | "breaks the ties of the five order-50 sections by array position" | PASS | cited |
| FR-2 | The year comes from the cycle | unit+e2e | "reads the catalog for the cycle's year, not the clock's"; e2e "once per request" | PASS | cited |
| FR-2 | Missing catalog 409, Reporting down 503, never an empty list | unit+e2e | client 404 → `FieldCatalogMissingError`; e2e 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 | PASS | cited |
| FR-3 | Unclassified reads hidden/false/false and is marked | unit+e2e | service view; e2e view | PASS | cited |
| FR-3 | An option set not in the catalog is returned apart (S-7) | unit+e2e | "a draft option set the catalog no longer lists" | PASS | cited |
| FR-3 | Revision, latest version and catalog version | unit+e2e | service view; e2e view | PASS | cited |
| FR-4 | A contradiction is a 400 naming the item's flag, nothing written | unit+e2e | rules table; e2e "400 naming that item" | PASS | cited |
| FR-4 | Switching off; an omitted flag is stored false (S-14) | unit+e2e | service "an omitted flag is false also on an assessed item"; e2e | PASS | cited |
| FR-4 | AND the DB refuses the contradiction from a direct write | unit | schema CHECK pin; fake refuses 3819 | PASS | cited; real MySQL is a gap (§ 9) |
| FR-5 | Several items, revision +1, others unchanged | unit+e2e | "raises revision 7 to 8, keeps the items not sent" | PASS | cited |
| FR-5 | Every problem in one 400, BUT not only the first | unit+e2e | rules "without stopping at the first"; e2e | PASS | cited |
| FR-5 | Two admins edit the same field | unit+e2e | S-10 tests | PASS | cited |
| FR-5 | Same values answer 200 and keep the revision | unit+e2e | service; e2e | PASS | cited |
| FR-6 | Discard to version N; empty with no version; revision moves | unit+e2e | service discard ×4; e2e ×2 | PASS | cited |
| FR-7 | Changes, receive/keep timelines, revision; BUT writes nothing | unit+e2e | `receiveAndKeep`; service preview; e2e | PASS | cited |
| FR-7 | Nothing to publish | unit+e2e | diff spec; e2e | PASS | cited |
| FR-8 | Version N+1 with instant, publisher and catalog version | unit+e2e | service "writes version 3…"; e2e "creates version 1" | PASS | cited; stores every applicable field (DD-2), see § 8 |
| FR-8 | Stale revision 409, nothing written | unit+e2e | service; e2e | PASS | cited |
| FR-8 | Nothing to publish 409 (S-9) | unit+e2e | service; e2e | PASS | cited |
| FR-8 | Two admins at once: exactly one wins | unit+e2e | service; unit of work (race, UNIQUE backstop); e2e NFR-3 | PASS | cited; on real MySQL at T-11 |
| FR-8 | Replay with the same key returns the first answer, no second version or audit | e2e | replay tests ×3 | PASS | cited |
| FR-9 | Every version-for-timeline scenario, incl. on hold and BUT no fallback | unit | `versionFor` (11 cases), midnight Rome, both DST changes | PASS | cited; green under UTC and Bogotá |
| FR-10 | Effective configuration; unclassified reads hidden; subfields follow their field | unit | service `effectiveFor` | PASS | cited; port only, no route by design |
| FR-10 | A type outside the timeline is an explicit error | unit | service `effectiveFor` | PASS | cited |
| FR-11 | Audit record content; BUT unchanged items not recorded | unit+e2e | service; diff; e2e NFR-8/FR-11 | PASS | cited |
| FR-11 | AND a refused publication leaves no record | unit+e2e | service refusals; e2e `refused()` checks the audit on every refusal | PASS | cited |
| FR-12 | Versions unchanged by later edits, discards and publications | unit+e2e | service; e2e FR-12 | PASS | cited |
| FR-13 | Closed cycle: writes 409 `CYCLES_CLOSED`; view and preview still answer | unit+e2e | service; e2e per route | PASS | cited |
| FR-13 | Unknown cycle 404 on every route | unit+e2e | service; e2e ×5 | PASS | cited |
| FR-14 | Front contract complete | manual | `front-contract.md` routes and codes grepped against the controller and `error-codes.ts` | PASS (manual) | full review at `/akili-validate` |
| NFR-1 | Refused before any read, on every route | e2e | FR-1 matrix | PASS | cited |
| NFR-2 | Unknown body field 400 | unit+e2e | e2e NFR-2; DTO spec | PASS | cited |
| NFR-3 | One version under concurrent publish | unit+e2e | unit of work race; e2e NFR-3 | PASS on fakes | real MySQL: T-11 |
| NFR-4 | Injectable clock; Rome boundaries; TZ independence | unit | versions; service "one clock read" | PASS | full unit run under UTC and Bogotá |
| NFR-5 | Fixed statement count | unit | service; unit of work (1 vs 50 timelines, 3 vs 2,000 items) | PASS | cited |
| NFR-5 | At most one catalog read per request | unit+e2e | service; e2e preview; **e2e all routes** | PASS | added (write routes) |
| NFR-6 | Reporting down is 503 within 10 s | unit+e2e | client timeout; **body stall, join and retry**; e2e 503 | PASS | added; see § 8 |
| NFR-6 | Cached catalog for the year | unit | client fresh, stale ≤ 24 h, > 24 h, year isolation; **hung variants** | PASS | added |
| NFR-7 | One decision line per write, no bodies | unit+e2e | service; e2e NFR-7 ×3 | PASS | cited |
| NFR-8 | Exactly one audit record per publication, none when refused | unit+e2e+schema | UNIQUE (`version_id`); unit of work; e2e | PASS | cited; real MySQL count 1 at T-11 |
| Gate | OpenAPI out of step | e2e | generic router check; **field-config check** | PASS | added |
| Gate | Migration differs from schema | unit | schema "committed migration 0005" | PASS | cited |
| Gate | Type errors the runner erases | build | `pnpm build` | PASS | |

## 8. Remediation

No failures, nothing to fix. Observations for `/akili-validate`:

- **NFR-6 finding from TEST** (first view hung for more than 45 s, no 503). The new unit tests bound every path inside the client: headers, the body, joined requests and the retry after a dead call. One limit: they model undici's abort with a mock. The likely causes are outside this code:
  - the TEST proxy or load balancer;
  - DNS or TLS before the abort timer starts;
  - something before the controller (guards, JWKS).

  **Next step:** read the TEST server logs for the first `GET /cycles/34/field-config` on 2026-10-26 around 21:15 UTC.
- **FR-8 wording:** the requirement says "every classified option set", but the version stores every applicable field, with unclassified ones as `hidden` (DD-2). That is a superset, consistent with FR-10 and documented in `design.md`.
- **`FIELD_CONFIG_CATALOG_MISSING`:** the message does not name the year. The code is enough for the front, which knows the cycle.

## 9. Accepted Gaps

| Gap | Why not automated | Evidence or owner |
|---|---|---|
| Real-InnoDB concurrent publish | No disposable MySQL, and the shared `qadb` is never reset | Verified on TEST at T-11: 1 × 201 and 4 × 409, 1 version, 1 audit row |
| Driver `timezone` round-trip | Needs real MySQL | PI-7, back lead |
| 1213 deadlock on real InnoDB | Needs real MySQL; only the 503 mapping is unit-tested | PI-7, back lead |
| Concurrent first `ensureDraft` | Needs real MySQL | PI-7, back lead |
| Cold-catalog hang over 45 s on TEST | Not reproducible in the client (§ 8) | Server logs on TEST, back lead |
| CHECK enforced by a direct DB write (FR-4) | DDL pinned, not run on MySQL | Applying `0005` on TEST created the CHECKs |
| FR-14 contract review | Documentation, by design | `/akili-validate` |
