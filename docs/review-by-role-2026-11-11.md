# Review by role, first version (2026-11-11)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Source: Yeck's list of 2026-11-10/11 (Santi's decisions)

## Why
Review only had the assessor's buttons. Santi's flow needs the lead assessor, the third-party broker (TPB) and the PPU on the same result.

## Done (mock data, `review.mock.ts`)
- One page for every reviewing role. **"Viewing as"** (inline menu above the title, like "Viewing" in Results) switches the role and keeps it in the URL (`?as=lead|tpb|ppu`; no `as` = assessor). TODO(api): the role comes from the signed-in user's assignments.
- **Assessor:** as before, plus **Withdraw comment** in the comments drawer, on the last comment while the program has not answered it.
- **Lead assessor:** **Mark as highlight** on any commented field. It opens the drawer with the thread and an "Instruction for the third-party broker" field. Once highlighted: **Edit instruction** and **Remove highlight**. The lead's queue is the comments the program rejected.
- **TPB:** on highlighted fields, **Agreed with program** or **Required changes**, with Undo. The lead's instruction shows on the card and in the drawer.
- **PPU:** on "Required changes" fields, **Mark when done**, with Undo.
- The program's answers show in the thread as `Program · Accepted / Rejected`. The card chip says "Rejected by program" when it rejected.
- New chips: Agreed with program, Required changes, Changes done.
- The other roles don't see AI notes, "Approve remaining" or "Finish assessment". The footer and the sections list count what still needs the current role.
- `QA-2026-0841` has an example for every role: the title is rejected (for the lead), the readiness level is highlighted with no decision (for the TPB), and theory of change contribution 3 is "Required changes" (for the PPU).
- `docs/qa-context.md`: flow, roles (six, no PCU or Guest) and the program answering inside the Reporting Tool embed.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- Playwright (headless) with the design account, blocking the qatest API in the test browser so its 401 doesn't sign the session out (the sidebar shows "We could not reach the QA service", expected). On `QA-2026-0841` at 1440 px:
  - Assessor: buttons as before, AI notes and "Approve remaining" shown. **Withdraw comment** on Link removes the comment and the card goes back to "Not reviewed".
  - Lead: only the rejected title needs them ("1 field needs your attention"). Mark as highlight → drawer with the thread and the instruction field → card highlighted with the instruction, then Edit instruction / Remove highlight.
  - TPB: Agreed with program / Required changes on highlighted fields; Required changes → chip and Undo.
  - PPU: Mark when done on the "Required changes" fields; the footer count drops.
- 390 px (TPB): no horizontal scroll, the card buttons wrap and stay readable.
- Fixed while testing: a comment the program rejected counted as pending for the assessor; it now counts as done for them (it goes to the lead).

## Pending
- Juanpa's review of the design, then push.
- Questions for Yeck/Santi:
  - Do the lead assessor, TPB and PPU have a "finish" step, like the assessor's?
  - When is a rejected comment "done" for the lead if they choose not to highlight it?
  - Does the TPB leave a note for the PPU with "Required changes"?
- Not verified: 768 and 1024 px, dark mode.
- `docs/ux-ui/design.md` (Review row) gets updated once the design is approved.

## Follow-up, 2026-11-12 (Santi's answers via Yeck)
- Lead assessor: no final step. Their list and count take every field with an assessor's comment, not only the ones the program rejected (`roleScope`, `review-model.ts`).
- TPB: no final step. "Required changes" opens the drawer with a "Note for the PPU" field and saves the decision with the note. Afterwards the TPB has "Edit note"; Undo clears the decision and the note. The note shows on the card and in the drawer for the TPB and the PPU. The mock has a note on ToC contribution 3.
- A program's rejection opens the field again for the assessor: `programRejected` is out of `isResolved`, back to the earlier rule.
- PPU unchanged (Mark when done).
- Overview by role follows: the lead counts commented fields (64 in the mock, 23 of them rejected), and the PPU list labels its note "Third-party broker’s note".
- Tested: `ng build` passes. In Playwright on QA-2026-0841:
  - The assessor has 14 fields open again, the rejected title included.
  - The lead has 4 of 6 commented fields open.
  - TPB: Required changes → note drawer → the card shows the note, with Edit note and Undo.
  - The PPU sees the same note with Mark when done.
