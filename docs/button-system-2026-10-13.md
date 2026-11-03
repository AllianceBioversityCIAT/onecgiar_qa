# Button system (2026-10-13)

Branch: `jp-design/mockup-completo` · Author: Juanpa (with Claude Code)

## Why

Buttons were restyled inline on every page, so the same action was drawn differently from page to page:

- "Go to Assessors" was semibold with a grey hover.
- "View all cycles" was medium with a teal hover.
- Negative margins and heights changed with the page.

There was no shared button in `src/app/ui`.

## The system

`src/app/ui/button/qa-button.ts` adds the `qaBtn` directive. It always goes together with spartan's `hlmBtn`, which keeps accessibility and the disabled state. Import it with `QaButtonImports`.

```html
<button hlmBtn qaBtn tone="primary">Load results</button>
<button hlmBtn qaBtn tone="secondary">Cancel</button>
<a hlmBtn qaBtn tone="link" size="sm" flush="start" routerLink="/assessors">Go to Assessors</a>
```

| Tone | Use it for | Examples |
|-|-|-|
| `primary` | The main action of a page, drawer or dialog. One per area. | Invite, Load results, Finish |
| `secondary` | Supporting or exit actions | Cancel, Edit timeline, Guidance |
| `danger` | Confirms something that deletes or closes | Remove, Close timeline |
| `danger-quiet` | Opens a destructive path without confirming it | Discard all |
| `link` | Goes somewhere or shows more | Go to Assessors, View all cycles, +3 more |
| `ai` | Acts on an AI suggestion (AI purple, so people know where it comes from) | Use as comment |

- **Sizes:**
  - `md` (default, 36px): page headers, drawer and dialog footers.
  - `sm` (32px): inside cards, tables and toolbars.
  - On phones every button is at least 40px tall.
- **`flush`** (links only): `start` or `end` pulls the side padding out, so the label lines up with the text next to it.
- **Rule:** the `class` attribute only carries layout (`mr-auto`, `w-full`, `justify-self-end`…). Color, size, radius, weight, hover and focus come from the tone.
- **Not covered:** icon-only buttons, filter chips, tabs and menu items. They keep their own components.

## Tested

- `npx ng build` passes (existing budget warning only).
- Browser at 1440 px: Overview, Cycle, Results, Assessors, Fields and Review render with the new buttons. On Overview, "Go to Assessors", "See SP09" and "View all in Results" measure the same (13px, weight 500, 32px tall, tint hover).

## Migrated

~80 buttons across Overview, Cycle, Results, Assessors, Fields and Review. `secondary` gained a pressed state (`aria-pressed`) for toggles like Review "Show all fields".

## Pending / to check with Juanpa

- "Use as comment" (AI note in Review) uses the new `ai` tone (purple), as Juanpa asked.
- "Reset to default" (Fields) and "View progress" (Cycle) are taller now (32px), so those rows grow a little.
- "Back to 2026 cycle" (read-only banner in Cycle) was left as is: it uses the banner color.
- Icon-only buttons, filter chips, tabs and menu items are not part of this system yet.
- Login (Yeck's) was not touched.
