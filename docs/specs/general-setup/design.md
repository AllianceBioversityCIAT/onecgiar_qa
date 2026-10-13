# Template — `design.md`

> Format source for every spec's `design.md` (`/akili-specify` Phase 2). Extends `docs/trd/trd.md`; never contradicts it without an ADR-style decision here **and** a TRD update proposal.

## Conventions

| Item | Rule |
|---|---|
| Backend placement | One NestJS module per domain under `server/src/<module>/` (TRD § 4); persistence behind repositories (Drizzle in `server/src/database/drizzle/schema/`, ElectroDB entities in the DynamoDB layer) |
| Frontend placement | Lazy route per feature under `client/src/app/pages/<feature>/`; reuse `client/src/app/spartan/` and `client/src/app/ui/` first |
| Tokens | Only tokens from `docs/ux-ui/design.md` § 7; new tokens are a design decision |
| API | `/api/v1/...`, error envelope and cursor pagination (TRD § 6) |
| Decisions | Each non-trivial decision: issue → decision → alternatives → consequence, tied to FR/NFR IDs |
| Premise Ledger | Row shape, classes, triggers, citation rules and absent-values are defined **once** in `/akili-specify` Step 2.2 (*Premise Ledger* block). This template only reserves the section; it does not redefine them |

## Skeleton

```markdown
# <Spec title> — Design

## 1. Document Control
| Spec path | Requirements | Status | Last updated |
|---|---|---|---|

## 2. Executive Summary

## 3. Architecture Overview
<Where this sits in the TRD container view; a component diagram with legend only when the module is complex.>

## 4. Extended Directory Structure
<Tree of new/changed paths in server/ and client/.>

## 5. Data Model
<MySQL tables (columns, keys, indexes, migration name) and/or DynamoDB entities (pk/sk/GSI). Immutability and dedupe rules.>

## 6. API Design
| Method | Path | Roles (scope) | Request | Response | Errors |
|---|---|---|---|---|---|

## 7. Backend Module Design
<Controllers, services, ports, adapters; state transitions; jobs; error mapping.>

## 8. Frontend / UX Component Architecture
<Routes, components (atomic breakdown), state (signals/resources), UI states, tokens used.>

## 9. Shared Contracts or Package Extensions
<DTOs mirrored in client/; Reporting contract changes; env vars added to server/.env.example.>

## 10. Design Decisions
| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|

## 11. Premise Ledger
<Count line>
<Trigger line>
<Table per /akili-specify Step 2.2 — or `Premise Ledger: none — <reason>`. Never omit the section.>
```
