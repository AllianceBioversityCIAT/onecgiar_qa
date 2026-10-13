# Template — `requirements.md`

> Format source for every spec's `requirements.md` (`/akili-specify` Phase 1). Copy the skeleton below into `docs/specs/<domain>/<spec>/requirements.md`. Write in English, following `cognitive-doc-design`: answer first, tables and scenarios over prose.

## Conventions

| Item | Rule |
|---|---|
| Spec path | `docs/specs/<domain>/<spec-slug>/` — domains: `auth`, `admin-config`, `ingestion`, `evaluation`, `comments`, `escalation`, `ai-assist`, `history`, `dashboards`, plus `bugfix`, `changes`, `epic` for cross-cutting work |
| Functional IDs | `FR-<n>` (stable within the spec; never renumbered after approval) |
| Non-functional IDs | `NFR-<n>`, each citing the TRD scenario it refines (`QAS-…`) or adding a new measurable one |
| Cross-spec reference | `<domain>/<spec>#FR-<n>` |
| Strength | `SHALL` / `MUST` (mandatory), `SHOULD` (expected), `MAY` (optional) |
| Business rules | Cite the PRD (`docs/prd.md` § n) and, once added, the business-rules document by rule number |
| Current behavior | Every claim about how the system behaves today carries a citation as run or `UNVERIFIED — confirm at source before relying on it` |
| Out of place here | Class names, libraries, step-by-step implementation — they go in `design.md` / `tasks.md` |

## Skeleton

```markdown
# <Spec title> — Requirements

## 1. Document Control
| Spec path | Status | PRD stories | Last updated |
|---|---|---|---|
| docs/specs/<domain>/<spec> | Draft / Approved | US-… | YYYY-MM-DD |

## 2. Executive Summary
<2–4 lines: what changes for which role, and why (PRD problem P-n).>

## 3. Glossary
| Term | Meaning |
|---|---|

## 4. System Context & Scope
- In scope: …
- Out of scope: …
- Current behavior (cited or UNVERIFIED): …

## 5. Stakeholders / Personas
| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|

## 6. Functional Requirements

### FR-1: <Short behavior name>
The system SHALL <observable behavior>.

#### Scenario: <Main case>
- GIVEN <starting state>
- WHEN <action>
- THEN <expected outcome>
- AND <side effect>
- BUT it must NOT <negative path / forbidden outcome>
- AND IT MUST <validation or boundary>

<For UI requirements: loading, empty, error and success states, responsive behavior, and the roles that see each action.>

## 7. Non-Functional Requirements
| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|

### Defect classes and their gates
| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|

## 8. Requirement ID Index
| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
```

## Writing checklist

- [ ] Goals are separated from requirements; every requirement is observable and testable.
- [ ] Every role-gated action states who can and who cannot do it (and the 403 path).
- [ ] Every state change in the comment/escalation flow names the from-state and to-state (TRD § 7.3).
- [ ] Numbers from screenshots or pasted tables were confirmed at the source before entering a requirement.
- [ ] Defect classes are listed and each has a gate, a substitute, or an accepted risk.
