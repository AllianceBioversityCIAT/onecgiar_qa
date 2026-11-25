# Visual polish, direction A — 2026-11-25

Branch: `jp-design/visual-polish`, branched from `jp-design/scope-in-title`. Merge scope-in-title first.

## Why
Juanpa wants every main screen to read as professional, portfolio-grade work, not "made by AI" and not flat. An audit of the UI found typical AI-template tells:
- One teal/mint hue used for everything.
- Violet-tinted greys that clashed with the teal.
- White cards on a white page with no depth.
- 8 different corner radii.
- 147 fully rounded pills.
- Spaced UPPERCASE labels.
- Monospace numbers in teal.
- Rainbow charts (lilac, purple, blue and green together).

He chose **direction A** over B (a dark green sidebar):
- A warm grey canvas with white cards and a soft shadow.
- A neutral sidebar.
- Green only for actions, links, focus and the current step.

## What changed (class and token changes only; no logic)
- **Tokens** (`ui/tokens/qa-tokens.css`, light theme):
  - Green-tinted neutrals replace the violet ones.
  - Canvas `--bg` is #F4F5F4.
  - New `--shadow-card`.
  - Mint tints become sage (`--tint*`, `--band-*`, `--border-accent`, `--chart-1/2`).
  - `--qa-mono` now points to Manrope: numbers and dates use the app font, not a code font.
- **Shell:**
  - Canvas background for the content, top bar and sidebar.
  - The active nav item is a white raised row; the mint fill and left marker are gone.
  - Group labels are in sentence case.
  - The cycle block is plain information with no box, shadow or hover, closed by a line; as a white card it looked selectable. It has two lines: "2026 cycle ● Active", then "Main batch · Step 1 of 5 · closes 05 Dec". The time of day is cut in the template, and a short field in `active-cycle.ts` would be cleaner (for Yeck).
- **Cards:** 20 white cards get `shadow-(--shadow-card)`.
- **Labels:** 42 spaced-uppercase labels are now sentence case, 12px medium. This includes table headers, "Step 1", "QA round 1", "Result code" and the menu group labels.
- **Badges:**
  - 37 status pills became 6px-radius badges, 12px medium; `qa-badge` changed the same way.
  - Result, timeline and stage statuses are a neutral badge with a coloured dot (`.qa-dot` in `styles.css`, colour set through `--qa-dot`).
- **Selected states:** review sections and the Fields state chips use the nav's white raised row instead of mint. This replaces the 2026-11-12 tint decision for review sections; Juanpa can ask to bring it back.
- **Avatars:** neutral grey circle with dark initials.
- **Overview:**
  - Charts use one green scale from light to dark, where darker means further along (Round 1/2 bars, Progress by result type).
  - "Pending" segments are light grey.
  - Nested boxes became soft fills: the Round cards and the pace figures.
  - The "Quality assessed" strip is sage.
- **Cycle:** steps not yet open are soft grey fills; the current step is a raised white card.

## Tested
- `ng build`: green.
- `ng test` on `pages/workspace/**`, `ui/**` and `shell/**`: 47 files, 614 passed, 1 skipped.
- Playwright on port 4300 with the design account and the full API mock (`.playwright-mcp/mock-all.js`): Overview, Results, Review, Cycle, Fields and Assessors at 1440 px; no horizontal scroll.

## Pending / not verified
- Dark mode: checked by adding `.dark` by hand (the app has no switch); Results and Overview read well. Already there before this work: in dark the search field shows a lighter box inside its frame, and the logo has low contrast.
- Phone width (390 px): Results, Overview, Cycle and Review checked; no horizontal scroll.
- Not touched: `pages/sp/**` (the program's screens), the login, and the Overview copy ("Welcome back…" for non-admin roles; the "Now · 88%" labels and legend).
- The rule file `reglas/diseno-qa.md` still describes the old look (uppercase eyebrows, "Viewing X ⌄"). An update was proposed to Juanpa.

## Round 3 — Review page (same day)
- **Field rows:** each field is now a row of the section card, with a line between fields running edge to edge, instead of a bordered card inside a card. Hidden fields keep their grey band, now across the full width.
- **Values:** values sit on a soft fill with no border.
- **On phones:** the section stays a white card (`p-4`), with rows edge to edge inside it.
- **One primary action per view:** the per-field "Approve", "Mark as highlight" and "Mark when done" are secondary buttons; "Finish assessment" is the only filled green button. Before, 5–10 green buttons per section competed with each other.
- **Tested:**
  - `ng build`: green.
  - `ng test` on `review/**`: 12 files, 265 passed.
  - Playwright at 1440 and 390 px, acting as Assessor: no horizontal scroll.

## Round 4 — Review page consistency and app-wide radius (same day)
- **One state language:**
  - Field states are the same neutral badge with a coloured dot as Results and Cycle: Validated, Not validated, Commented, Answered, Highlighted, the TPB decisions and Changes done.
  - The dot is a real `aria-hidden` element: the meaning is in the text, not in colour alone.
  - Field properties (Core, View only, Context) are outlined tags, so a state and a property never look alike.
- **Hierarchy:** view-only fields read as context. They have no fill, a muted label and a muted value, so the fields to assess stand out.
- **No repeated header:**
  - The left panel no longer repeats the code, type, status and step that sit under the title.
  - It keeps "Assessed by" when there is one.
- **"Act as":** a quiet tool row with a line under it, instead of a white card above the title.
- **AI chip:**
  - The badge says "Indicative" (it said "AI suggestion" twice).
  - The meta line says "No evidence quote".
  - The specs were updated to match.
- **Radius scale, app-wide:**
  - 121 values mapped to three sizes: 6 px (`rounded-md`, badges and tags), 8 px (`rounded-lg`, buttons, inputs, inner boxes) and 12 px (`rounded-xl`, cards).
  - The 3–4 px radii are kept only on chart marks.
  - The Fields state chips and the applied-filter chips are no longer pills.
- **Left for a team decision:** the words "Approve" / "Validated" / "Check all" / "resolved" name the same action. That is QA flow wording, for Santi / Yeck.
- **Tested:**
  - `ng build`: green.
  - `ng test` on `review/**`: 265 passed; the other workspace, UI and shell files: 46 files passed.
  - Playwright at 1440 and 390 px: no horizontal scroll.

## Round 5 — AI blocks (same day)
- **What changed:**
  - The AI suggestion chip and the "AI match" note dropped the purple box: they now have a neutral border and fill like the rest of the page.
  - The AI is named by a small sparkle icon on a lilac tile, plus "AI suggestion" in the normal text colour.
  - "Copy to comment" and "Use as comment" are secondary buttons.
  - Quotes have a grey rule.
- **Why:** this follows Notion AI, Copilot and Linear. A machine hint should read as secondary to the human review, and an all-purple panel is the stock "AI" look.
- **Token budget:** `qa-tokens.css` passed its 4 kB budget by 118 bytes after round 1. The fix was single-layer shadows and 8-digit hex for the shadow and overlay colours, so the budget warning is gone; only the old initial-bundle warning remains.
- **Tested:**
  - `ng build`: green.
  - `ng test` on workspace, UI and shell: 47 files, 614 passed.

## Round 6 — Button hierarchy (same day)
- **Three weights, never more:**
  - Filled green `primary` for the page action ("Finish assessment").
  - New soft green `tonal` for an item's main action ("Approve", "Mark as highlight", "Mark when done").
  - White `secondary` for supporting actions.
- **AI actions:** the `ai` tone is now a purple text button, the lightest weight ("Copy to comment", "Use as comment"). It ties to the AI mark without boxing it.
- **Greys:** the UI is neutral on purpose; colour is kept for meaning: status dots, charts, the AI mark and the action weights.

## Round 7 — AI suggestion block hierarchy (same day)
- **Header:** sparkle mark, then "AI suggestion" (13px semibold) and the kind badge. The facts ("No evidence quote") sit at the right in muted text.
- **Body:** indented under the title text (`pl-7`, flat on phones), in reading order:
  - the answer: "Suggested category" as a small label above the value at 16px semibold; "Reported" beside it, muted;
  - the explanation, at 14px;
  - "Copy to comment" with a copy icon, its label lined up with the text above.
- **Tested:** `ng test` on `review/**`: 265 passed. Playwright at 1440 and 390 px.

## Round 8 — AI block that explains itself (same day)
Juanpa could not tell what "Indicative", "No evidence quote" and the sentence under the category were. The block now says what each part is:
- **Header:** "✦ AI suggestion". The verdict badge (Looks consistent / Check / Review) shows only on rated fields; an indicative field has no verdict.
- **Rows:** labelled, in one label column of 9rem, stacked on phones:
  - "Suggested category | Innovation" (and "Reported" when present);
  - "Why | <the AI reasoning>".
- **Footer:**
  - Above a hairline, the note in plain words, "Only a suggestion · not rated and no evidence quote" (`AI_INDICATIVE_META`; the spec was updated).
  - "Copy to comment" on the right.
  - The note shows even when the chip is read-only.
- **Tested:** `ng test` on `review/**`: 265 passed. Playwright at 1440 and 390 px.
- **Follow-up:**
  - "Copy to comment" moved to the left of the footer, its label lined up with the text above; the note sits at the right.
  - The button got a hover hint: it opens the field's comment box with the Why text in it, editable, and nothing is saved until the assessor saves.
  - The label stays "Copy to comment", as named in P2-3918.

## Round 9 — AI suggestion card, designed as a whole (same day)
Juanpa found the block still confusing: what "Indicative" and "No evidence quote" meant, how long reasoning would look, and what "Copy to comment" did. The mockup was approved first, then built once:
- **Header:**
  - The AI mark and "AI suggestion".
  - On rated fields, the verdict badge in the app's neutral dot style (green / amber / red dot), replacing the coloured `qa-badge`.
  - "Only a suggestion" in muted text at the right (`AI_INDICATIVE_META`).
- **Answer:** one sentence, e.g. "Suggested category: **Innovation** · Reported: …". IRL / IUL keep their headline.
- **Reasoning:** a paragraph. Past about 3 lines (over 240 characters or more than 3 lines of text) it is clamped, with a "Show more" / "Show less" button (`aria-expanded`, `aria-controls`).
- **Evidence:**
  - The quote, when verified.
  - "From the evidence · <source>", linked when it is a URL. The source was in the data but not shown before.
- **Action:**
  - "Use as comment", which is "Copy to comment" in P2-3918; same handler and same events.
  - What it does is written next to it: "Opens your comment with this text. You can edit it before saving." It is wired as `aria-describedby`.
  - The specs were updated for the new label.
- **Tested:**
  - `ng test` on `review/**`: 265 passed.
  - Playwright at 1440 and 390 px with three cases: a category with long reasoning (clamped, then expanded), and an amber level verdict with its source.
