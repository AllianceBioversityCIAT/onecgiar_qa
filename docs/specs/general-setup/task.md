# Template — `tasks.md`

> Format source for every spec's `tasks.md` (`/akili-specify` Phase 3). Each task is small enough for one focused session and is executed by the Leader → Implementer → Reviewer loop (`.agents/`).

## Conventions

| Field | Rule |
|---|---|
| ID | `T-<n>`; status `[ ]` pending · `[~]` in progress · `[x]` done (only after a Reviewer PASS is recorded in `execution.md`) · `[!]` blocked |
| Size | `S` (≤ 2 h) · `M` (≤ half a day) · `L` (split it) |
| Dependencies | Task IDs or `none`; tasks touching the same shared boundary (`.agents/leader.md` project block) are serial |
| Requirements | Every FR/NFR **scenario and `BUT` / `AND IT MUST` clause** is owned by a named task |
| Skills | From `AGENTS.md` § Skill Map plus matching conditional skills; real skills only |
| Verification | A concrete command from `AGENTS.md` § Verification commands, or a manual check with its expected observation |
| `Falsifier` | The mutation and the fixture on which correct and mutated code diverge; executed against the post-change code |
| `Red run` | The run that showed the gate red before the change — or `n/a (no test gate)` when the gate is not a test |
| `Disqualifier` | What makes the evidence worthless (e.g. "tests pass because the DB call is mocked away", "count includes pre-existing hits") |
| `Consumers` | Files that pin a changed shared symbol (grep as run) — or `none (no shared symbol changed)` |
| `Review` | `skip-eligible` · `checklist` · `full` · `lenses`, plus a one-line reason (rules in `/akili-specify` Step 3.2); no field is ever left blank |

## Skeleton

```markdown
# <Spec title> — Tasks

## Dependency graph
T-1 → T-2 → T-4
T-1 → T-3 → T-4

## T-1: <Imperative title>
- **Status:** [ ]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-1 (Scenario: Main case; BUT …), NFR-1
- **Design refs:** design.md § 5, § 7
- **Scope:** <files/dirs to create or change; what is explicitly not touched>
- **Tests:** <unit/e2e tests to add, with location>
- **Verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`
- **Falsifier:** <mutation + diverging fixture>
- **Red run:** <command and failing output summary> | n/a (no test gate)
- **Disqualifier:** <what would make a green run meaningless>
- **Consumers:** <files> | none (no shared symbol changed)
- **Review:** checklist — <reason>
- **Done when:** <observable criteria, all true>
- **Skills:** nestjs-expert, api-design-principles
```

## Execution conventions

- Commits follow the team format: `<emoji> <type>(<module>) [TICKET]: <present-tense change in English>` on a work branch, never directly on `main`, `staging`, `staging-center` or `dev`.
- The Leader records each attempt in `execution.md` (same folder) before flipping a checkbox.
- Shared boundaries (`server/src/database/**`, `server/src/config/**`, `client/src/app/{spartan,ui,theme}/**`) change only in tasks that name them.
