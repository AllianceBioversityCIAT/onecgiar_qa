# Text contrast: two light-theme greys reach WCAG AA (2026-11-20)

Branch: `jp-design/text-contrast` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Yeck's UI review of Results and Review (T-21, 360 / 768 / 1440 px), Slack, 2026-11-19

## Done
Two tokens in `client/src/app/ui/tokens/qa-tokens.css`, light theme only (dark theme untouched):

| Token | Before | After | Contrast after |
|---|---|---|---|
| `--text-muted` | `#9691A8` (3.04:1 on white) | `#6E6981` | 5.25 white · 5.03 `#FAFAFB` · 4.91 `#F7F7F9` · 4.71 `#F3F2F7` · 4.53 `#EEEEF1` |
| `--nav-eyebrow` | `#879E9A` (2.66:1 on the menu) | `#5C7470` | 4.68 on the menu `#F4F8F7` · 5.02 white |

- Chose Yeck's first option for `--text-muted` because it is the only one that passes on every surface token, `#EEEEF1` included. `#726D85` kept a bigger step from `--text-4` but fails on `#EEEEF1` (4.28).
- Trade-off: `--text-muted` now sits very close to `--text-4` (`#6B6580`). Muted labels still read as secondary through size, weight and uppercase.

## Tested
- Contrast ratios computed with the WCAG 2.x formula (Yeck's numbers match).
- `ng build`: passes.
- Seen by Claude in the browser at 1440 px (design account, API blocked): the menu's "ASSESSMENT" / "ADMINISTRATION" labels and the Overview's grey text keep their hierarchy.
- Not verified: Results and Review with real data (they need the API), 360 and 768 px. Yeck re-measures before merging.

## Not done (seen in passing)
- `--text-5` (`#77728A`) also misses AA except on white (4.31 on `#F7F7F9`, 3.98 on `#EEEEF1`). Not in Yeck's list; to check where it is used.
