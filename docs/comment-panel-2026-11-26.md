# Field comment panel: clearer new comment and quick comments (2026-11-26)

Branch: `jp-design/visual-polish` · Author: Juanpa (design) with Claude Code.

## Why
Juanpa found the "New comment" part of the field comment drawer confusing: the quick comment buttons sat between the
"New comment" title and the text box, so it was not clear what the box was for or what "Save as quick comment" saved.

## What changed (`review-comments-drawer.html`, design only)
- "New comment" is now the visible `<label>` of the text box and sits right on top of it (the hidden "Write a comment" label is gone).
- The quick comment tools moved under the box, as helpers for it:
  - "Quick comment" → "Insert quick comment" with a chevron (it opens the saved list and fills the box).
  - "Save as quick comment" → "Save text as quick comment" (it saves what is in the box as a reusable comment).
- Placeholder: "Write a comment or insert a quick comment".
- "Current value", "Comments" and "New comment" use the form label style of the other drawers (13px, medium, `--text-2`) instead of 12px `--text-3`.
- Nothing changed in how it works: same bindings, same events; "Add comment" in the footer still sends the comment.
- `review-view.spec.ts`: the two tests that click the button by its text now look for "Save text as quick comment".

## Tested
- Review specs: 12 files, 265 tests passed.
- `ng build`: green (the existing `qa-tokens.css` budget warning, 31 bytes over, is not from this change).
- Seen by Juanpa in his Chrome with real data: approved.

## Pending
- Yeck's `qa-review-delete-comment` (Lead round 2, on staging-center) carries `TODO(design): Juanpa`.
