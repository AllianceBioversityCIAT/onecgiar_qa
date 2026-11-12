# Cycle: People drawer polish and proposals for Yeck (2026-11-12)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code) · Source: Yeck's list ("polish People in Cycle")

## Done (design only, in Yeck's files)
- `timeline-people.logic.ts`: the hints of the lead assessor, TPB and PPU follow Santi's rules (lead marks highlight with an instruction; TPB agrees or requires changes; PPU applies the required changes and marks them done).
- `people-drawer.ts`:
  - "Remove" is a link instead of an outlined button: with four lists, one outlined button per person was noisy. Its loading skeleton matches.
  - The drawer is 480px, like the other list drawers (comments, Export comments).

## Not done: proposals for Yeck (they change behaviour or his tests)
1. Subtitle says "brokers" while the section says "Third-party brokers". Changing `peopleSummary` breaks 3 of his tests, so it's left to him.
2. Same pattern on every batch: the main batch gets a "…" menu like the complementary batches, with Edit timeline, People, Export comments and Close. A card only shows a button when it unblocks something: "Assign people" (nobody on the step in force) and "Load results" (waiting for results). Juanpa, 2026-11-12: People is set up once per batch, not daily, and "Assign people" already covers the moment it's needed.
3. "Load results" shows twice on a batch waiting for results (card button and "Load results into QA round 1" in the menu), with two names. When the button shows, it uses the full name and the menu item goes away.
4. People drawer:
   - Show only the roles the batch uses (Knowledge products fast track has no lead or TPB step).
   - When nobody else holds a role, show only "Give the role in Assessors" instead of the grey picker + placeholder + help line.
   - Confirm before removing someone who already has results.

## Tested
- `ng build`: passes (only the bundle size warning that was already there).
- `people-drawer.spec`, `timeline-people.spec`, `timeline-people.logic.spec`: 18 tests pass.
- Not seen on screen by Claude: Cycle uses real data (the design account is signed out there). Juanpa checks it in his Chrome.
