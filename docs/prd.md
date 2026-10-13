# OneCGIAR QA — Product Requirements Document

| | |
|---|---|
| Status | Draft v0.1 — awaiting team approval |
| Last updated | 2026-10-13 |
| Owners | Product: QA business owner · Tech: front lead, back lead |
| Related | `docs/trd/trd.md` · `docs/ux-ui/design.md` · `docs/infrastructure.md` · `docs/qa-context.md` (team glossary, on `staging-center`) |

> **In one line:** a from-scratch rebuild of the CGIAR Quality Assessment platform where assessors review, field by field, the results programs report in the Reporting Tool (PRMS), with automatic ingestion, admin-configurable cycles, and a reliable history — replacing a platform that depends on manual SQL scripts every cycle.

The current QA (repo `CGIAR/QA`, `qa.cgiar.org`) is **domain reference only**. Its architecture, code, and data are not migrated.

---

## 1. Overview & Purpose

QA is where assessors evaluate the quality of the results that CGIAR programs report in the Reporting Tool, before those results count as **Quality Assessed**. Each result is reviewed field by field; disagreements between assessors and programs follow a defined escalation path (Lead Assessor → TPB → PPU). When a result has no pending cases, QA tells Reporting it passed.

## 2. Problem Statement

| # | Today | Consequence | Rebuild must |
|---|---|---|---|
| P1 | Results are loaded into QA by SQL scripts the tech team runs manually each cycle (views, materialized tables, procedures) | Each cycle blocks on the tech team; errors are silent | Ingest automatically from the Reporting API when a batch opens |
| P2 | Cycles, windows, batches and fields are hard-coded in code or the DB | Coordination cannot open/close phases or change fields on its own | Make them admin-configurable |
| P3 | No reliable history of how a result entered QA, how it left, and what changed in Reporting between batches | Disputes and round 2 cannot be audited | Keep immutable snapshots and diffs per result |
| P4 | Authentication issues its own tokens without verifying them | Security risk | Use Cognito natively and verify every access token (JWKS) |

## 3. Target Personas

A user can hold several roles; the admin grants and revokes them. Scoped roles apply per result type or per program.

| Role | Scope | Job to be done |
|---|---|---|
| **ADMIN** (QA coordination) | Global | "Open a cycle, its windows and batches, and decide which fields are shown, core, commentable and AI input — without asking the tech team." |
| **ASSESSOR** | Per result type | "Review each field of a result and either approve it or leave a comment the program can act on, helped by AI suggestions." |
| **LEAD_ASSESSOR** | Per result type | "Everything an assessor does, plus escalate program disagreements on core fields to the TPB." |
| **TPB** (third-party broker) | Global | "Decide each escalated comment: side with the program (case closes) or with the assessor (goes to PPU)." |
| **PPU** | Global | "Close cases the TPB ruled on, once the change is made in Reporting." |
| **PROGRAM** (SP member) | Per program | "Answer each comment on my program's results: accept, accept with comment, disagree, or ask for clarification." |
| **GUEST** | — | Any authenticated user not registered in QA; read-only. |

Example: one user can be ASSESSOR for *Knowledge Product* and LEAD_ASSESSOR for *Innovation Development*.

## 4. Goals & Success Metrics

**North Star:** share of results in a cycle that reach *Quality Assessed* with a complete, auditable history, with zero manual intervention by the tech team.

| # | Metric | Target | Status |
|---|---|---|---|
| M1 | Manual SQL scripts needed to open, sync and close a cycle | 0 | Proposed |
| M2 | Time from "admin opens batch" to "results ready to evaluate" | `[TBD — needs baseline batch size]` | Open (OQ-6) |
| M3 | Evaluated results with entry and exit snapshots | 100 % | Proposed |
| M4 | AI suggestions copied by assessors, per prompt version | Measured from v1; no target yet | Proposed |
| M5 | Requests served with an unverified token | 0 | Proposed (from P4) |

## 5. Scope

### In scope (v1)

1. **Configuration** — cycles (e.g. 2026), windows, batches; per result type: which catalog fields are shown, core, commentable, AI input.
2. **Ingestion** — on batch open, pull eligible results from Reporting, validate against the catalog, store an immutable snapshot; sync changes during evaluation.
3. **Evaluation** — field-by-field review; comment or approve without comment; AI suggestions on AI-input fields.
4. **Comments** — program responses; lead escalation of core-field disagreements to TPB; TPB decision; PPU "Done".
5. **Closure** — result becomes *Quality Assessed* when no cases are pending; QA notifies Reporting.
6. **History** — per result: how it entered, how it left, and the diff between snapshots and between batches.
7. **Auth & roles** — Cognito login (SSO and custom), scoped roles, admin role management.
8. **Dashboards** — progress per cycle/batch/result type (detail in a later spec).

### Out of scope (v1)

- Notifications and follow-up between PPU and result owner inside the platform.
- Agentic chatbot.
- Data migration from the current QA.
- Direct reads of Reporting database tables (always via the Reporting API).

## 6. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-1 | ADMIN | create a cycle with windows and batches | coordination runs QA without the tech team |
| US-2 | ADMIN | configure, per result type, which catalog fields are shown/core/commentable/AI input | each result type is assessed on the right fields |
| US-3 | ADMIN | grant and revoke roles, scoped per result type or program | the right people see and act on the right results |
| US-4 | ADMIN | open a batch and see its results arrive automatically | no SQL scripts are needed |
| US-5 | ASSESSOR | review each field and comment or approve it | programs get precise, actionable feedback |
| US-6 | ASSESSOR | see an AI suggestion on AI-input fields and copy it if useful | I review faster without the AI acting on its own |
| US-7 | PROGRAM | respond to each comment (accept / accept with comment / disagree / clarify) | the assessment reflects our view |
| US-8 | LEAD_ASSESSOR | escalate disagreements on core fields to the TPB | contested core data gets an independent decision |
| US-9 | TPB | decide each escalated comment | the case closes or moves to PPU |
| US-10 | PPU | mark a TPB-confirmed case "Done" once Reporting is fixed | the result can close |
| US-11 | Any role | see how a result entered and left QA and what changed between batches | disputes and round 2 are auditable |
| US-12 | GUEST | browse results read-only | stakeholders can follow progress |

## 7. Acceptance Criteria

| Story | Criteria (Given / When / Then) |
|---|---|
| US-4 | Given an open cycle and a configured batch, when the admin opens the batch, then every eligible result is fetched from Reporting, validated against the catalog version, and stored as a snapshot — with no manual step; results failing validation are listed with the reason. |
| US-4 | Given a result whose Reporting payload is unchanged (same hash), when sync runs, then no new snapshot is created. |
| US-2 | Given a catalog `field_key`, when the admin configures it, then its key is never renamed; a type change in the catalog appears as a new key. |
| US-5 | Given an assessor without the ASSESSOR role for that result type, when they open the result, then they can read but not comment or approve. |
| US-6 | Given an AI-input field, when the assessor opens it, then a suggestion is shown, and the AI never creates a comment or approval by itself; copying a suggestion is recorded with the prompt version. |
| US-8 | Given a PROGRAM "disagree" on a non-core field, when the lead tries to escalate, then escalation is not offered. |
| US-9 | Given an escalated comment, when the TPB sides with the program, then the case closes; when it sides with the assessor, then it moves to PPU. |
| US-10 | Given a result with all cases closed or Done, when the last case closes, then the result becomes *Quality Assessed* and QA reports it to Reporting. |
| US-11 | Given a result evaluated in two batches, when a user opens its history, then the entry snapshot, exit snapshot, and field-level diff between them are shown. |
| Auth | Given a request with an expired, forged, or wrong-audience access token, when it reaches the API, then it is rejected with 401. |

The 27 business rules for comments, escalation and AI (confirmed / proposed / pending) become acceptance criteria in the `comments`, `escalation` and `ai-assist` specs once the document is added to the repo (OQ-1).

## 8. Assumptions, Dependencies & Constraints

### Assumptions (Hypothesis Template — validate before relying on them)

| ID | We believe… | …will be true if | Validate by |
|---|---|---|---|
| A1 | Reporting will deliver the results, control-list and "QA passed" endpoints in time for the ingestion spec | Reporting commits to a contract and date | Agreement with the Reporting team (OQ-2) |
| A2 | The QA business owner is the ADMIN persona (the team glossary calls it "QA lead / coordination") | Coordination confirms they configure cycles and roles | Confirm with the business owner |
| A3 | The team glossary's "SP member" is the PROGRAM role, and "highlighted" equals "escalated" | Glossaries are reconciled | Business owner review of this PRD |
| A4 | A batch is small enough (hundreds to low thousands of results) to ingest within minutes | Real batch sizes are known | 2026 cycle numbers (OQ-6) |

### Dependencies

- **Reporting Tool (PRMS) API** — `GET /api/qa/catalog?phase_year=` exists (catalog version 2026.30). Results (list + batched detail), control lists (with `level` / `parent_id`), and "QA passed" notification are **to be defined**.
- **CGIAR auth microservice** (`one-cgiar-microservices/auth-microservice`) — login and refresh against Cognito; holds the client secret via CLARISA.
- **AWS Cognito** user pool and domains — pending infrastructure answer.

### Constraints

- Catalog `field_key`s are permanent; a type change means a new key.
- Snapshots are immutable.
- AI never approves or comments by itself.
- No manual SQL scripts to operate a cycle.
- Everything stored in the repository is in English.

## 9. Open Questions

| ID | Question | Owner | Blocks |
|---|---|---|---|
| OQ-1 | Add the 27 business rules document to the repo (`docs/business-rules.md`) | Business owner | comments, escalation, ai-assist specs |
| OQ-2 | Contracts and dates for the Reporting results, control-list, and QA-passed endpoints | Back lead + Reporting | ingestion spec |
| OQ-3 | Cognito user pool, domains, and app clients | Infrastructure | auth spec |
| OQ-4 | Where SSR runs in PROD (front is static S3 + CloudFront today; Docker or Lambda tested) | Infrastructure + front lead | front deployment |
| OQ-5 | The mockup has no screen for the PROGRAM role; the comment-response flow needs design | Designer | comments spec |
| OQ-6 | Target for M2 (batch open → ready to evaluate) and typical batch size | Business owner | ingestion NFRs |
| OQ-7 | Is QA a standalone platform or a module inside the Reporting Tool? (team glossary open question) | Business owner | navigation, auth |
| OQ-8 | The mockup's "AI match" differs from today's AI contribution — which behavior is v1? | Business owner + designer | ai-assist spec |
