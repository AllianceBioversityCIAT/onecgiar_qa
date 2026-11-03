# QA ↔ PRMS alignment review — 2026-10-26

Reference: the PRMS Reporting mockup in Claude Design (project `b6234307-…`, file `PRMS Reporting.dc.html`).
Goal (Juanpa): QA and PRMS are sibling products. QA keeps its own colors (teal, its status tints) and follows PRMS in structure, type and patterns.

## What was compared
PRMS: Home, Portfolio overview, Results Center, Quality assurance (program side), program page (SP01), Administration (placeholder).
QA: Overview, Results, Cycle, Fields. All at 1440 px.

## Differences found
| # | Pattern | PRMS | QA today |
|-|-|-|-|
| 1 | Page title | 30 px / 700; optional eyebrow above it ("PORTFOLIO P25 · 2025–2030") | 26 px / 700, no eyebrow |
| 2 | Lists ("Needs your attention", "Other science programs") | Whole row clickable with a chevron; tinted type pill on the left; title 14/500; gray meta 13 with mono code; relative time on the right; gray footer "2 more…" + "Show all 7 →" | Text 13/400, gray eyebrow groups with icons, text link on the right |
| 3 | Section counter | Gray number in a small circle | Plain gray number |
| 4 | Section title placement | Outside the card on Home lists; inside the card on dashboards | Always inside (Juanpa's decision, 2026-10-23) |
| 5 | Big numbers block | White cards with a border; stat strip "label with colored dot / big number", split by vertical lines | Overview hero sits on a gray panel |
| 6 | Table header | "Showing 1–25 of 240 results." above the table | No count line |
| 7 | Status tabs with counts | Segmented control (gray track, white active item): "All 14 · Awaiting your response 5 …" | Fields uses tinted pill chips |
| 8 | Top bar | Search left, after the arrows; user's full name | Search centered; user's email |

Already equal: Manrope, sidebar structure (eyebrow groups, tinted active item with left bar), white cards with 12 px radius, table headers in uppercase 11 px gray, search + dropdown filter row, filled primary button plus outlined secondary buttons.

## Tested
Visual comparison only, with screenshots of both apps. No code changed in this review.

## Pending
- Juanpa to choose where to start. Recommended: Overview (title 30, "Needs your attention" with the PRMS row pattern, hero on a white card).
- Point 4 contradicts a decision taken on 2026-10-23; ask before moving titles.
- Point 1 changes the rule "page title 26" in `~/.claude/reglas/diseno-qa.md`; needs Juanpa's OK.

## Step 1 — Overview (done, same day)
- Page title 30 px (Overview only for now; the other pages still use 26).
- Hero: white card with a border instead of the gray panel. Round 1 and Round 2 split by a vertical line instead of two nested cards.
- "Needs your attention" uses the PRMS home list: one list sorted by deadline, a type pill on the left ("Won't be reviewed" in the danger tint, "At risk" in amber), the sentence, a gray line with timeline · stage · deadline, the whole row clickable with a chevron, and a gray footer with "Show all N →" when there are more than 5 rows. The counter is a gray circle. The title stays inside the card.
- Tested: `npx ng build` passes; checked at 390, 1024 and 1440, light and dark; no horizontal scroll.

## Step 1 reverted (same day)
Juanpa asked to put the Overview back as it was before this review. Title back to 26, hero back to the gray panel with two cards, "Needs your attention" back to two gray groups with icons. The comparison table above stays as reference; nothing from it is applied.
