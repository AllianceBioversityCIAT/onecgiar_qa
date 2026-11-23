# Overview by role: three small fixes from Yeck (2026-11-20)

Branch: `jp-design/overview-polish` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Yeck, Slack, 2026-11-19

## Done (design only, Juanpa's files)
1. **"Your work" rows broke into two lines at 768 px** (Yeck saw it on the PPU's "Updated in the Reporting Tool"; the assessor's "Answered by the program" and the lead's "Rejected by the program" / "Programs with rejections" did the same at 768 and 1024). Root cause: the three columns started at a 576 px card, too narrow for the labels. They now start at 896 px (`@4xl`), so below that the rows stack (`ov-your-work.ts`). Labels unchanged.
2. **"Not updated in the Reporting Tool yet" was too light**: `--text-muted` → `--text-3` (`ov-next-items.ts`).
3. **Result titles cut at 390 px** in "Next to decide" (TPB) and "Next changes to apply" (PPU): one line with "…" → up to two lines (`line-clamp-2`, `ov-next-items.ts`).

## Tested
- `ng build`: passes. `overview-view.spec.ts`: 3 of 3 pass.
- Seen by Claude in the browser (design account, API blocked), assessor / lead / TPB / PPU at 390, 768, 1024, 1280 and 1440 px: no row label on two lines, no title cut with "…", no horizontal scroll. Three columns from 1280 px, one column below.
- Not verified: dark mode.
