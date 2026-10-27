# Notifications for the QA Admin — spec (2026-10-22)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Done
- Mockup in Claude Design: project "QA Platform", file `notifications/Notifications.dc.html` (bell panel, Notifications page on desktop and phone, empty state).
- AKILI spec in `docs/specs/notifications/review-updates/`: `proposal.md`, `requirements.md` (FR-1…FR-9, NFR-1…NFR-4), `design.md` (14 decisions, 28 verified premises), `tasks.md` (7 tasks), `judgment.md` (blind dual review).
- Blind dual review of the design: two rounds of fixes; ended **escalated** with one open defect (filtering in Results would re-expand a collapsed sidebar). Juanpa chose the architect's fix (Results re-reads its filters on navigation; notifications use a same-URL reload), applied without a third round.

## Tested
- Mockup rendered in a browser at 1440 (desktop frame 1280, phone frame 390): no console errors except the host's missing favicon.
- Every citation in the design's Premise Ledger was run against commit `93dfe10`.
- No app code was written; no build or tests were run.

## Pending
- `/akili-execute notifications/review-updates` (first task: T-1, T-2 or T-3, all independent).
- María Julia: panel layout (newest first vs "Needs you" first) and the event list (proposal OQ-1, OQ-2).
- Business (Santi / Ángel): PRD § 5 keeps notifications out of v1.
- Juanda: `notifications` domain in the `AGENTS.md` spec taxonomy.
- No AXE tool in `client/`: accessibility is checked by hand in T-7 until a developer adds one.
