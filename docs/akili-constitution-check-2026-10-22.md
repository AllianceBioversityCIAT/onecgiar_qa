# AKILI constitution check — 2026-10-22

Run of `/akili-constitution` by Juanpa (branch `jp-design/mockup-completo`), against AKILI **2.34.2** (installed globally today). The project baseline was written by Juanda with AKILI 2.30–2.32.

**Result:** the baseline is complete and healthy. Mode applied: **Active AKILI-SPECS (Safe Update)** — nothing was rewritten. Every gap below lives in a file owned by Juanda or Yeck and touched in the last 14 days, so this note only records them; the owners decide.

## What is already in place

| Item | State |
|---|---|
| `docs/prd.md`, `docs/ux-ui/design.md`, `docs/trd/trd.md`, `docs/infrastructure.md` | Present, non-empty |
| `docs/specs/general-setup/` (`requirements`, `design` with Premise Ledger, `task` with the 4 Verification fields + `Review`, `family`) | Present, current |
| `docs/specs/kaizen/`, `docs/specs/audits/` with scaffolding READMEs | Present |
| `.agents/{leader,implementer,reviewer,tester}.md` | Present, fenced (`akili:section`) |
| `.claude/agents/akili-*.md` wrappers, Reviewer limited to `Read, Grep, Glob` | Present |
| `AGENTS.md`: constitution table, spec taxonomy, `Default Branch: main`, `Integration Branch: staging`, write discipline, concurrency, lean verification commands, Module Guides, Model Routing, Skill Map | Present |
| CodeGraph | Not installed (CLI absent). Not installed now — needs the user's OK |

## Gaps found

| # | Gap | Why it matters | Owner |
|---|---|---|---|
| 1 | Root `CLAUDE.md` does not start with `@AGENTS.md` | When both files exist, Claude Code reads only `CLAUDE.md`. Today the constitution table, Model Routing, Skill Map and branch pins in `AGENTS.md` **do not load** in Claude Code sessions. `AGENTS.md` itself states this requirement | Yeck |
| 2 | `Integration Branch: staging` vs `CLAUDE.md` § 2, where `staging-center` integrates finished work and `staging` holds approved work | Kaizen apply passes and `/akili-archive` syncs would target a branch that only receives approved merges. Confirm which branch is the single integration point | Yeck + Juanda |
| 3 | `.agents/*.md` personas are on 2.30/2.32 templates; 2.34.2 is installed | Owned sections may be `outdated`. Run `akili doctor --agents --fix` (preserves custom-edited sections and the project block) | Juanda |
| 4 | `## Model Routing` has no `akili:section id=model-routing` fence | A later `akili routing` run cannot find or regenerate the section safely | Juanda |
| 5 | Registry has no **Cursor** column (5 supported hosts now) and the CLI table has no Cursor row (`agent`, commands as `/akili-<name>`) | Add with `<CONFIRM SLUG>` placeholders; never drop a column | Juanda |
| 6 | Antigravity T1/T3/T6 name Gemini 3.1 Pro; the packaged default is now Gemini 4 Argon | Stale entry — flagged, not edited | Juanda |
| 7 | Skill Map row `nestjs-best-practices` — no such skill is installed (project or global) | Agents told to load it will not find it; remove or install | Juanda |
| 8 | No Step 8F guardrail hook (`.claude/settings.json` + `.claude/hooks/akili-tasks-gate.sh`) | Optional. Without it, "no `[x]` without Reviewer PASS" is enforced by prompt only | Juanda (decide) |
| 9 | `docs/ux-ui/design.md` was last updated 2026-10-13; the mockup changed since (button system, Overview hero and rounds, QA stages in Results, Cycle sub-timelines, sidebar active cycle, sticky Review & publish bar, form error border) | The design doc is the visual constitution; it lags the mockup | Juanpa (design content) |
| 10 | `docs/specs/kaizen/auth--user-management--core.md` has 6 `pending` items | Applied on the integration branch, not here | Juanda |

## Tested

- Read every baseline file listed above and grepped for the required fields and markers.
- `git log` ownership and 14-day activity on each file.
- Compared persona `since=` markers with the installed template version.

## Gap 9 done: UX/UI document refreshed (same day)

`docs/ux-ui/design.md` → Draft v0.2, built from the work notes dated 2026-10-13 to 2026-10-21 and checked against the code (`ui/button`, `ui/select`, `shell/qa-shell.html`, `overview/*`). The 13 sections were kept; content was added or brought up to date:

- § 2–4: Overview, Results, Cycle and Fields as they are now; Results deep links (`?stage=`, `?timeline=`, `?status=`); new flow "Follow the cycle".
- § 5: sidebar groups, Jira-style active marker, active cycle block; the top bar no longer lists a cycle selector (there is none in the code).
- § 6: page header, context line selector, sticky action bar, pop-up detail, empty state.
- § 7: `--ai` tokens, the "color only for risk" rule, and a status vocabulary table.
- § 8: button tones and sizes, select appearances.
- § 10: form errors shown only after leaving the field (`data-error`).
- § 12: decisions UXD-6 to UXD-14. § 13: 10 new open questions.

Tested: every claim was checked against a work note or the code (button tones, `qa-select` appearances, top-bar labels, Where the work is tabs, `--ai` tokens). No build needed (docs only).

## Pending

- Gaps 1–8 and 10: owners above. Nothing was changed in their files.
- `docs/ux-ui/design.md` was written by Juanda; this update only adds and refreshes design content. Juanda or Yeck should review it when the branch is merged.
- Not verified: the "Pending" badge contrast (≈ 2.9:1) comes from `docs/ideas.md` and was not measured again.
