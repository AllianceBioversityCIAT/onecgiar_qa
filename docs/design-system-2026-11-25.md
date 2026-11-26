# PRMS design system — shared by QA and Reporting

**Date:** 2026-11-25 · **Author:** Juan Pablo Bueno (design) · **Status:** draft, to apply in PRMS Reporting (Claude Design)
**Source of truth:** the QA front end after the visual polish (`jp-design/visual-polish`), mainly `client/src/app/ui/tokens/qa-tokens.css` and `client/src/app/ui/**`. If this document and that code disagree, the code wins and this document is updated.

QA and PRMS Reporting are sibling products. They share **one** system: the same greys, type, sizes, radius, elevation, components and patterns. Only the **brand ramp** changes: green for QA, purple for Reporting. The app's logic and flows stay as they are; this is about how it looks and reads.

---

## 1. Brand

- **Logo:** the PRMS mark and the word "PRMS" are always near-black `#0D0D16`. Only the product name carries the product colour: "quality assurance" in green `#0F766E`, "reporting" in purple `#45348C`. The mark is never recoloured per product.
- **Why the two colours:** purple stays with Reporting because it is what people already know as PRMS; in a redesign that changes everything else, it is the thread that says this is still the same tool. Green marks QA, the space for review and quality.
- **Where the brand colour may appear (both products):** primary button, links, focus ring, the current step, the logo's product name, selected tab underline, progress and charts. Never on large surfaces: no tinted sidebar, no tinted page, no tinted cards. (A soft-green sidebar was tried in QA and rejected.)

## 2. Colour tokens

### 2.1 Brand ramp (the only part that changes)

| Token | QA (green) | Reporting (purple) | Used for |
|---|---|---|---|
| `--primary` | `#0F766E` | `#5A45B8` | Primary button, current step, active progress |
| `--primary-hover` / `--accent` | `#115E59` | `#45348C` | Hover, links, tonal button text |
| `--accent-strong` | `#0C4A45` | `#36296E` | Pressed / hover on tonal |
| `--tint` | `#F1F6F4` | `#F4F2FA` | Link hover background |
| `--tint-2` | `#E1ECE8` | `#E8E4F5` | Tonal button background |
| `--tint-3` | `#C9DDD7` | `#D5CDEE` | Tonal button hover |
| `--focus-ring` | `0 0 0 3px rgba(15,118,110,.30)` | `0 0 0 3px rgba(90,69,184,.30)` | Keyboard focus |
| `--chart-1…4` | `#C5D9D4 #7FAFA6 #0F766E #0C3A37` | `#D5CDEE #9E8FD6 #5A45B8 #2E2266` | Charts, light to dark |

Contrast (WCAG AA needs 4.5): white on `--primary` is 5.47 for QA and 7.05 for Reporting; `--accent` on `--tint-2` is 6.27 for QA and 7.94 for Reporting. Both pass.

### 2.2 Shared neutrals (identical in both products)

| Role | Token | Value |
|---|---|---|
| Page canvas | `--bg` | `#F4F5F4` |
| Sidebar | `--nav-bg` | `#ECEFED` (one tone darker than the canvas) + hairline `--nav-divider` `#DCE1DE` |
| Nav hover | `--nav-2` | `#E2E6E4` |
| Card / panel | `--surface` | `#FFFFFF` |
| Soft fills | `--surface-3`, `--surface-4`, `--surface-5` | `#F4F6F5`, `#E9ECEA`, `#F1F3F2` |
| Borders | `--border`, `--border-soft`, `--border-strong` | `#E2E6E4`, `#ECEFED`, `#CFD5D2` |
| Text | `--text`, `--text-2`, `--text-3`, `--text-muted` | `#15201E`, `#26302E`, `#4F5A57`, `#5F6A67` |

### 2.3 Shared status colours (dots only, never filled pills)

`--success #047857` · `--warning #B45309` · `--danger #B91C1C` · info `#1D4ED8` · neutral `--border-strong`.

## 3. Type

- **Font:** Manrope everywhere, including numbers (no monospace). Sentence case everywhere; no uppercase eyebrows.
- **Scale and weights:**

| Use | Size | Weight |
|---|---|---|
| Page title (h1) | 26px, line-height 1.2, tracking −0.02em | Bold |
| Section title on the page (h2) | 20px, tracking −0.01em | Bold |
| Card title / drawer title | 16px | Bold |
| Panel section title (inside drawers) | 14px | Semibold |
| Body, table cells, buttons (md) | 14px | Regular / medium |
| Field labels | 13px | Medium |
| Help text, meta, tags | 12px | Regular / medium, muted |
| Smallest (chart axes only) | 11px | Regular |

## 4. Shape, space and elevation

- **Radius:** 6px (`rounded-md`: tags, badges, small controls) · 8px (`rounded-lg`: buttons, inputs, filters, menus) · 12px (`rounded-xl`: cards, panels). Fully round only for dots, avatars, switches and progress bars.
- **Elevation:** cards are white with a hairline border and `--shadow-card` `0 1px 3px #1018160f`. Menus and popovers use `--shadow-pop` `0 8px 24px #1018161a`. Nothing else casts a shadow.
- **Spacing rhythm:** page padding 32px on desktop, 24px on tablets and 16px on phones; card padding 20px; gaps 8 / 12 / 16 / 24px.

## 5. Layout (app shell)

- **Sidebar:** 260px open, 64px collapsed. From top to bottom:
  - the logo at 24px tall with its own row (20px on phones), with 24px above it;
  - menu groups with a 12px sentence-case label ("Assessment", "Administration"); the selected item is a white raised pill;
  - an information panel at the bottom: a soft grey panel with no border, shadow or hover, so it never looks clickable (in QA: the active cycle, its step bar and when the step closes).
- **Top bar:** 56px. Collapse sidebar, Back and Forward on the left; notifications and the user menu on the right.
- **Page header:** title (h1), then the page's scope picker beside it if it has one (a grey container, 36px, 15px semibold), then one muted subtitle line, then one row of same-height filters (36px).

## 6. Components

- **Buttons** (36px md, 32px sm, 40px minimum on phones):
  - `primary`: one per view, the main action;
  - `tonal`: an item's main action (tint background, accent text);
  - `secondary`: white with a border;
  - `ghost` and `link`;
  - `danger`;
  - `ai`: purple text, tint on hover.
- **Status badge:** neutral grey fill (`--surface-5`), 12px medium text in `--text-2`, and a 6px coloured dot before the text. The colour lives only in the dot.
- **Property tag:** outlined, `rounded-md`, 1px `--border`, 12px medium, `--text-3`. Used for "Core", "Complementary batch", "Has an account"…
- **Alert band:** amber band for things that need attention, such as sample data or a deadline.
- **Cards:** see §4. A list inside a card uses hairline row dividers, not cards within cards.
- **Drawers (side panels):**
  - title 16px bold, with one muted subtitle line;
  - content in titled sections (14px semibold), each with one 12px muted help line;
  - 13px medium labels, with paired fields in two columns;
  - fixed values shown as text, with a "why" tooltip, never as disabled inputs.
- **Empty and error states:** one shared card (`qa-state-card`): a white card with a 16px bold heading, one line saying what happened, and the way forward as buttons. Errors announce themselves (`role="alert"`).
- **Loading:** a skeleton with the shape of what is coming, then items appear one after another. A button that runs an action spins and disables itself while it runs.
- **Switches in tables:** three states. On is a brand-colour switch, off is a grey switch, and not applicable is a muted "—" with a tooltip saying why.
- **Tables:** sentence-case headers in a muted colour on a soft header band, rows with hairline dividers, and the code and title on the left. On phones a row becomes a stacked card with no sideways scroll.

## 7. Content and accessibility

- English for everything stored in the product (UI text, code, commits).
- Buttons start with a verb; headings and labels have no final period; help text ends with one.
- WCAG AA: 4.5:1 for text, visible focus ring, every icon button has a label, and colour is never the only signal (dots come with text).
- Responsive: checked at 1440px and 390px, with no sideways scroll.

## 8. Open decisions (to confirm with Juanpa before applying in Reporting)

1. **AI colour in Reporting.** QA marks AI in violet (`--ai #6B46E5`). In Reporting that is close to the brand purple, so AI would read as a brand action. Options: keep violet and rely on the sparkle icon and wording, or give AI its own hue in both products.
2. **Neutrals.** QA's greys have a faint green cast. Proposal: keep them identical in Reporting for one shared system; the cast is too faint to clash with purple. To check on screen.
3. **Dark mode.** QA has dark tokens but no switch for users. Reporting follows the same plan once a switch exists.

## 9. How it is applied to Reporting (Claude Design)

1. Turn §2–§6 into a Claude Design design system, built from the QA code, with the brand ramp as the only per-product setting.
2. Make an inventory of the Reporting screens in Juanpa's Claude Design file: what each one has and what changes.
3. Go screen by screen. Change only the look; keep the flows and logic. Juanpa approves each one.
4. Do a final review against this document, as was done for QA on 2026-11-25.
