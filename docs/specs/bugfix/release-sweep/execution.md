# Execution log: release sweep (P2-3910 bug)

| Field | Value |
|---|---|
| Spec | bugfix/release-sweep |
| Branch | fix/P2-3910-release-sweep (from origin/staging-center `657b8e0`) |
| Found in | P2-3912 qatest HITL, 2026-11-20 (finding F-1) |

### T-1: Periodic release sweep with backoff — PASS (2026-11-20)

- **Attempts:** 2. Effort high → xhigh. Skills: tdd, nestjs-best-practices, error-handling-patterns.
- **Attempt 1** — `ReleaseSweeper` (self-rescheduling `setTimeout`, ±20 % jitter, `unref`, `RELEASE_SWEEP_INTERVAL_MS`, 0 disables); backoff in `lease_until` on send failed / unanswered / rolled-back ack (1, 2, 4, 8, 16, then 30 min); `release_stuck` at ≥ 10 attempts; admin retry `ignoreBackoff` + `skipIds`. Red (regression e2e, before any code): "expected 'pending' to be 'sent'". Falsifier: sweeper not armed → same red. Verification: unit 3948 / 6 skipped · e2e 1265 · lint · build · client ok. Re-run (Leader): release + config unit 150/150, releases e2e 9/9 → **VERIFIED**. Reviewer **FAIL**: (1) unfenced defer could relabel a lease another dispatcher re-claimed → two concurrent sends via the retry; (2) R-5 only partly met (first backoff indistinguishable from in flight, no migration); (3) shutdown could wait a whole 50-round dispatch (D7).
- **Attempt 2** — defer fenced by the claim's `attempts`; sweeper loops one batch per `dispatch({ maxRounds: 1 })`, shutdown waits one batch; in-flight tolerance 30 s (clock skew); interval 0 or ≥ 1000 ms; controller and AGENTS texts state the limit. Red: "expected 2026-11-13T11:01:01.000Z to deeply equal 2026-11-13T10:02:01.000Z" (late defer touched a re-claimed row). Verification: unit 3955 / 6 skipped · e2e 1265 · lint · build · client ok. Re-run (Leader): release + config unit 157/157, releases e2e 9/9 → **VERIFIED**. Reviewer **PASS**.
- **Spec amendment (back lead, 2026-11-20):** R-5 reworded — the retry sends pending rows immediately except those in flight or whose backoff ends within ~90 s; the rest go out with the sweep in ≤ ~3 min; no migration. The 255-attempt limit of the fence documented and accepted.
- **Leader doc precision edits after the PASS:** "within about 3 minutes" in the controller text and `AGENTS.md`; fence-limit note in `release.store.ts`.
- **Disqualifier check:** the end transaction and the post-end dispatch are unchanged; no round-2 code on this branch.
