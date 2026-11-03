# Visual coverage check: P2-3971 and P2-3972 — 2026-10-20

Branch: `jp-design/mockup-completo`. Checked against the code in `client/src/app/pages/workspace/cycle/` (not screen by screen in the browser).

## P2-3971 — Timeline creation (Cycle screens)
- Done: Cycle view; "New sub-timeline" drawer; steps table with names, opens/closes and date picker; Science programs and result types scope; round marker in the step drawer ("This step starts QA round N").
- Done: validation errors (missing timeline name, missing step name, missing programs, step opens before the previous one closes).
- Done: read-only closed cycle banner ("You are viewing a closed cycle").
- Partial: empty states are plain text only ("No live timelines.", "No timelines have closed yet.").
- Partial: closed steps show as done in the timeline, but the step drawer only locks "Who can work"; the dates stay editable.

## P2-3972 — Timeline editing (edit drawers)
- Done: "Edit official timeline", "Edit timeline" and step drawers exist.
- Missing: dates of closed steps are editable in both drawers (no locked state).
- Missing: scope (programs, result types) is not locked once step 1 has started.
- Missing: confirmation before changing a step in progress.
- Missing: warning when step 1 has no load.

## Pending
- Design the missing states, then check them in the browser at 390/768/1024/1440.

## Update (same day): P2-3972 states added
Designed for the ADMIN user (María Julia): the screen informs her instead of looking locked (no padlocks, no greyed-out inputs).
- Closed steps: in the step drawer the dates read as text ("This step closed on … Its dates stay as the record of the cycle.") and "Remove step" is hidden. In the timeline drawer, closed rows show dates and Load as text, have no remove button, and "Reset to official timeline" is hidden.
- Scope set once step 1 opened: programs and result types read as text, with "To cover other programs or result types, create a new sub-timeline."
- Step in progress: saving a change opens a pop-up, "Change a step in progress?" (Keep editing / Save changes), in both drawers.
- Step 1 without a load: amber note "Step 1 doesn't load results, so this timeline starts with nothing to assess." in both drawers.

Tested in the browser (1440 and 390): July sub-timeline edit (closed rows, scope, confirmation), September pilot (step 1 load off), step drawer for a closed and an in-progress step. `npx ng build` passes (only the existing bundle budget warning).

Pending: Juanpa's review. Dark mode not checked.

## Update (same day): P2-3971 empty states
- Live tab: empty card "No live timelines" with a "New sub-timeline" button (hidden in a read-only closed cycle).
- Closed tab: empty card "No closed timelines yet" explaining that finished timelines stay as the record of the cycle.
- Timeline drawer: "No steps yet. Add the first step, or start from the official timeline." when every step was removed.
- Checked in the browser at 1440 by emptying the mock list temporarily (restored afterwards; `cycle-view.ts` is unchanged).
