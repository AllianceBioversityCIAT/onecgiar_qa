# Scope in the page title — 2026-11-25

Branch: `jp-design/scope-in-title` (from `origin/staging-center`).

## Why
Juanpa: the big timeline picker (52 px, green border, green "TIMELINE" label) next to 36 px filters looked accidental and "made by AI", and the edge-to-edge line cut the filters off from the table they filter. He chose option A: hierarchy from size and position, as in Linear, Stripe and Vercel, not from a coloured border.

## What changed
- `ui/scope-card/qa-scope-card.ts`
  - New `qa-scope-title`: page title with the scope picker next to it, "Results [Annual report 2026 ⌄]". The scope's facts become the subtitle.
  - `qa-scope-card` is now only the filter toolbar: no line, no box, no total, no picker slot.
- `ui/select/qa-select.ts`, `appearance="scope"`: a small subtle grey container (36 px, like the filters, but filled instead of outlined), 15 px semibold text, no visible label (kept for screen readers). Iterations the same day: a slash with the picker at title size and bold, then at title size and regular weight; Juanpa chose the grey container next to the title, so it reads as a selector, not as title.
- **Results:** "Results [<timeline> ⌄]". The subtitle is the timeline's facts, falling back to the old line. The toolbar total was removed because the counters line under it already says it.
- **Overview, admin:** "Overview [<timeline> ⌄]". The greeting stays for the other roles. The toolbar total was removed because the big "1,330 results in QA" block repeats it.
- **Fields:** "Fields [<result type> ⌄]". The subtitle reads "Cycle 2026 · Hidden fields never reach an assessor."
- `docs/ux-ui/design.md`: the "Scope title" pattern replaces "Viewing X ⌄" and the big picker.

## Tested
- `ng build`: green, with only the old bundle-budget warning.
- `ng test` on Results, Overview, Fields and `ui/**`: 11 files, 94 tests passed.
- Playwright on port 4300 with the design account and mocked API (Results worklist, Fields config):
  - Results, Overview and Fields at 1440 and 390 px; no horizontal scroll.
  - The timeline menu opens from the title.

## Pending / not verified
- Dark mode is not verified: the app ignored the emulated colour scheme.
- `results-view.ts` `totalText` and `overview-view.ts` `scopeCount` are now unused. They are left in place because they are dev-owned logic; Yeck can remove them.
- The personal rule `reglas/diseno-qa.md` still says "Viewing X ⌄"; the change was proposed to Juanpa.
- Next ideas, not done:
  - Less mint green overall (sidebar, selected item, applied-filter chips).
  - Same height for the Fields state chips and the cycle select.
