# OneCGIAR QA — Agent Guide

Canonical guide for every coding agent in this repository. A root `CLAUDE.md`, when present, must start with the line `@AGENTS.md` (an import, not a sentence about this file): when both files exist, Claude Code reads only `CLAUDE.md`, so a prose pointer would silently replace this guide instead of loading it.

**Product:** rebuild from scratch of the CGIAR Quality Assessment platform — assessors review, field by field, the results programs report in the Reporting Tool (PRMS). The old QA (`CGIAR/QA`) is domain reference only; nothing is migrated.

**Monorepo:** `client/` (Angular 22, SSR, Tailwind 4, spartan/ui — **npm**) · `server/` (NestJS 12, Drizzle + MySQL, ElectroDB + DynamoDB — **pnpm**).

**Language:** everything stored in the repo is in English — code, UI copy, docs, branch names, commits, PRs. Conversation with each person stays in their language.

---

## Constitution (AKILI-SPECS baseline)

These documents are the constitution. Read them before proposing, specifying or implementing; when code and constitution disagree, raise it — do not silently follow either.

| Document | What it is | Consult when |
|---|---|---|
| `docs/prd.md` | Problem, personas/roles, goals and metrics, scope, user stories, acceptance criteria, open questions | Any feature work; deciding what is in or out of scope |
| `docs/ux-ui/design.md` | Screens, navigation, layout patterns, design tokens, components, accessibility, dark mode | Any UI work; choosing tokens or components |
| `docs/trd/trd.md` | Architecture (C4, ADRs), NFR scenarios, modules, data model, API conventions, workflows, security, testing | Any backend or cross-cutting work; any design decision |
| `docs/infrastructure.md` | Environments and domains, cloud components, deployment, network/security, **Local Environment contract** | Starting the stack locally; anything touching deploys, env vars or AWS |
| `docs/specs/general-setup/` | Templates for `requirements.md`, `design.md`, `task.md`, and `family.md` (spec families) | Every `/akili-specify` run |

### Spec organization

`docs/specs/<domain>/<spec-slug>/` with `requirements.md`, `design.md`, `tasks.md`, `execution.md`.

| Domain | Covers |
|---|---|
| `auth` | Cognito login/refresh, token verification, users and scoped roles |
| `admin-config` | Cycles and QA timelines (dated steps, rounds, scope, assigned users — `server/src/admin-config/`), field configuration per result type |
| `ingestion` | Reporting API integration, snapshots, sync |
| `evaluation` | Field-by-field review |
| `comments` | Comment flow and state machine |
| `escalation` | Lead → TPB → PPU |
| `ai-assist` | AI suggestions and usage tracking |
| `history` | Snapshot history and diffs |
| `dashboards` | Progress views |
| `bugfix`, `changes`, `epic` | Cross-cutting fixes, small changes, multi-spec efforts |

Also: `docs/specs/kaizen/` (one entry per spec, written by the `kaizen` skill) and `docs/specs/audits/` (one report per `/akili-audit`). Their `README.md` files are scaffolding, never entries.

Spec families: when a proposal is split, the parent folder holds a `family.md` manifest (template in `docs/specs/general-setup/family.md`); no child folder exists without its manifest row.

---

## Branches and write discipline

```
Default Branch: main
Integration Branch: staging
```

- `staging` is the team's single integration point: kaizen apply passes run there, serially, and its merges to `main` carry applied standardizations forward. `main` records pending items instead of applying them.
- Team flow: work on a branch `type/module-topic` created from `staging`; never commit work directly on `main`, `staging`, `staging-center` or `dev` (they only receive merges). Commits: `<emoji> <type>(<module>) [TICKET]: <present-tense change>`.
- **Shared-file write discipline:** on a spec branch, lifecycle side-effect writes — kaizen standardizations, `/akili-archive` guide/TRD syncs, `/akili-audit` outputs — never edit shared guides (`AGENTS.md`, `CLAUDE.md`), `.agents/` personas, packaged templates, or `docs/trd/trd.md`. Record each as a pending item and apply it on `staging`. Exception: files an approved `tasks.md` names as the spec's own deliverable.
- **Concurrency:** one AKILI session per checkout; extra sessions use `git worktree`. Do not run measurement commands (build, benchmark, Lighthouse, E2E) while a delegated agent is active.

## Local environment

Follow `docs/infrastructure.md` § 6 (Local Environment) — do not guess start commands. The shared dev MySQL (`qadb`) is never reset by agents; TEST/PROD are never touched by agents.

## Verification commands (failure-only output)

A green run should print one summary line; failures always print in full.

| Package | Command |
|---|---|
| server | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` |
| server (HTTP surface) | `cd server && pnpm test:e2e --reporter=dot` |
| client | `cd client && npx ng build && npx ng test --watch=false` |

## Module Guides

Root rules always apply; a child guide only adds or narrows. Guides follow the [AGENTS.md](https://github.com/agentsmd/agents.md) convention: the guide closest to the edited file adds to the ones above it, and an explicit user instruction wins.

- `client/CLAUDE.md` — Angular/TypeScript conventions and accessibility rules for the front.
- `server/AGENTS.md` — NestJS API: layout, commands, code conventions, security rules.
  - `server/src/auth/AGENTS.md` — Cognito client, token verification, admission, session cookies, guards and decorators.
  - `server/src/users/AGENTS.md` — users, roles, role assignments, permission catalog, `can()`, current-user cache.
  - `server/src/database/AGENTS.md` — Drizzle/MySQL and DynamoDB wiring, schema guarantees, migrations and seeds.
  - `server/src/config/AGENTS.md` — environment variables, validation, typed config, secrets.
  - `server/src/common/AGENTS.md` — HTTP bootstrap (`configureApp`), the response standard (envelope, error catalog, field errors), request id.
  - `server/test/AGENTS.md` — e2e suites, test world, fakes and test rules.

## CodeGraph

Not initialized (CLI not installed). Analysis uses Grep/Glob. To enable: `npm install -g @colbymchenry/codegraph` then `codegraph init -i`; never commit the generated database.

---

## Model Routing

Criteria first: match the model to the phase's dominant demand. Architect = builder of the plan; **author ≠ auditor** (the Reviewer never runs on the Implementer's model); deep reasoning for propose/specify/verify **and the orchestrating Leader**; fast and cheap only for archive/formatting — **`tasks.md` decomposition is T1, not formatting**.

### Tiers

| Tier | Purpose |
|---|---|
| T1 Architect | Architecture reasoning, task decomposition, live orchestration judgment (in-flight decomposition, skill selection, FAIL adjudication, pivots) |
| T2 Coder | Implementation and test authoring throughput |
| T3 Auditor | Independent, deep review |
| T4 Context-Ingest | Reading large codebases and documents |
| T5 Fast-Cheap | Archive, formatting, summaries |
| T6 Multimodal | Visual review of screens and images |

### Phase → tier

| Phase | Tier |
|---|---|
| `/akili-constitution` | T4 ingest + T1 synthesis |
| `/akili-propose`, `/akili-specify` (incl. `tasks.md`) | T1 |
| `/akili-execute` Leader | T1 |
| `/akili-execute` Implementer | T2 |
| `/akili-execute` Reviewer | T3 — **must differ from the Implementer's model** |
| `/akili-test` Leader | T1 |
| `/akili-test` Tester(s) | T2 — prefer a model different from the Implementer (author ≠ tester) |
| `/akili-validate`, `/akili-audit` | T3 |
| `/akili-archive`, `/akili-quick` | T5 |
| Visual checks against the mockup | T6 |

### Registry

Updated: 2026-10

| Tier | Claude Code | OpenCode | Antigravity | Codex | Fallback |
|---|---|---|---|---|---|
| T1 Architect | `opus` | `<CONFIRM SLUG>` | Gemini 3.1 Pro `<CONFIRM ID>` | Astra `<CONFIRM SLUG>` | strongest available |
| T2 Coder | `sonnet` | `<CONFIRM SLUG>` | Gemini 3.8 Flash `-medium` `<CONFIRM ID>` | Sol `<CONFIRM SLUG>` | `opus` |
| T3 Auditor | `opus` | `<CONFIRM SLUG>` | Gemini 3.1 Pro `<CONFIRM ID>` | Terra `<CONFIRM SLUG>` | strongest model ≠ T2 |
| T4 Context-Ingest | `sonnet` | `<CONFIRM SLUG>` | Gemini 3.8 Flash `-high` `<CONFIRM ID>` | Sol `<CONFIRM SLUG>` | `opus` |
| T5 Fast-Cheap | `haiku` | `<CONFIRM SLUG>` | Gemini 3.8 Flash `-low` `<CONFIRM ID>` | Luna `<CONFIRM SLUG>` | `sonnet` |
| T6 Multimodal | `opus` | `<CONFIRM SLUG>` | Gemini 3.1 Pro `<CONFIRM ID>` | `<CONFIRM SLUG>` | `opus` |

| Host | CLI invocation |
|---|---|
| Claude Code | `claude` — commands as `/akili-<name>` (the team's current host) |
| OpenCode | `<CONFIRM>` |
| Antigravity | `agy` `<CONFIRM install>` |
| Codex | `codex` — commands as skills `$akili-<name>` `<CONFIRM install>` |

**Cross-host dispatch:** T6 Multimodal → Antigravity (Gemini vision) when installed; otherwise Claude Code `opus`. Reach across hosts only for a real capability gap — a cross-host spawn costs a fresh context.

To change models, edit only this registry table. Never pin a dated model name where a floating alias exists. Model selection is guidance only in command prompts — never add `model:` to command frontmatter; enforced bindings live only in the agent wrappers (`.claude/agents/akili-*.md`).

### Effort dial

Effort is per task and orthogonal to the tier: the tier picks the model, effort picks how hard it thinks.

| Signal | Effort |
|---|---|
| Trivial / mechanical | `low` |
| Standard scope | `medium` |
| Complex — algorithm, concurrency, security, ambiguity | `xhigh` |
| Correctness-critical | `max` |

- Defaults by role: T1 propose/specify/Leader `high`; T2 Implementer/Tester `medium` (flex by task); T3 Reviewer `high`; T5 archive `low`.
- Rework: bump effort one level on every retry.
- Never `max` a cheaper tier — escalate the tier instead.
- Re-baseline: effort defaults are per model generation; sweep `medium`/`high`/`xhigh` on a real spec when the generation changes. A task arriving under-specified (`[~]` resume, post-Pivot retry) starts one level higher.
- Effort is not a verbosity dial: shorten reports in the brief (`caveman`, `cognitive-doc-design`), not by lowering effort.

---

## Skill Map

| Skill | Applies to | When to load |
|---|---|---|
| `nestjs-expert` | `server/` | Any NestJS module, DI, guards, interceptors, testing |
| `nestjs-best-practices` | `server/` | Designing or reviewing modules, security, error handling |
| `api-design-principles` | `server/` API, client consumers | New or changed endpoints, DTOs, pagination, error envelope |
| `error-handling-patterns` | `server/`, `client/` | Exception filters, job failures, retries, front error states |
| `aws-serverless` | DynamoDB, Lambda/SSR deploy | DynamoDB entities and access patterns; SSR on Lambda |
| `angular-developer` | `client/` | Any Angular component, service, routing, SSR, forms, tests |
| `tailwind-design-system` | `client/` | Styling, tokens, Tailwind utilities |
| `shadcn-ui` | `client/src/app/spartan/` | spartan/ui (shadcn-style) primitives |
| `ai-agent-development` | `ai-assist` | Designing AI suggestion generation and prompt versioning |

During `/akili-specify`, derive each task's required skills from this map. During `/akili-execute` and `/akili-test`, the Leader assigns these skills and the Implementer/Tester must load them before writing code or tests.
