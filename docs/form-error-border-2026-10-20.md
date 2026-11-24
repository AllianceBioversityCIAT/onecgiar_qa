# Red border on empty fields when a drawer opens — 2026-10-20

Branch: `jp-design/mockup-completo`

## Cause
`hlmInput` (spartan `BrnInput`) sets its own `data-invalid="true"` and `aria-invalid="true"` as soon as the form field is invalid, even before the user touches it. Our inputs styled `data-[invalid=true]:border-(--danger)`, so an empty required field (the timeline name, for example) opened in red. Our own `[attr.data-invalid]` binding was overridden by the spartan host binding.

## Fix
- Our error styling now uses our own attribute: `[attr.data-error]` and `data-[error=true]:border-(--danger)`. Files: `cycle/timeline-drawer.ts`, `cycle/step-drawer.ts`, `assessors/assessor-drawer.html`. Spartan is not touched.
- Cycle drawers now show the name and opening-date messages once the field is left, as Assessors already did, so a red border never shows without its message.

## Tested
- New sub-timeline opens with a neutral Name field; leaving it empty shows the red border and "Enter a name for the timeline."
- Invite assessor opens with neutral fields.
- `npx ng build` passes (only the existing bundle budget warning).

## Pending
- Spartan still sets `aria-invalid="true"` on an empty required field when it opens, so a screen reader may announce it as invalid early. It lives in spartan (shared code), so ask Yeck.
