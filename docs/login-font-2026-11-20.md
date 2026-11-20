# Login font: same as the rest of the app (2026-11-20)

Branch: `jp-design/login-font` (from `staging-center`) · Author: Juanpa (with Claude Code) · Source: Yeck, Slack, 2026-11-19 (old pending item: "the login font is different from the rest of the app")

## Root cause
- The app's font is **Manrope**, but only inside the shell (`.qa-tokens`). The shell loads it from Google Fonts in `shell/qa-shell.html`.
- Screens outside the shell, like the login and password recovery, used the global `--font-sans` in `styles.css`, which said **Inter**. Inter is never loaded, so the browser fell back to the system font (Segoe UI on Windows).

## Done (design only)
- `src/styles.css`: `--font-sans` starts with `'Manrope'` instead of `'Inter'`.
- `src/index.html`: loads Manrope and JetBrains Mono from Google Fonts in `<head>` (same URL as the shell), with preconnect. The shell's own `<link>` stays; the browser loads the file once.
- Side effect: any `font-sans` text outside `.qa-tokens` (for example the "open comments" hint in the Results table) now also renders in Manrope.

## Tested
- `ng build`: passes. `login.spec.ts`: 18 of 18 pass.
- Seen by Claude in the browser at 1440 px: `/login` computes `Manrope` and the font is loaded.
- Not verified: password recovery screen and phone width (same stylesheet, so expected to match).
- Left as is: the login's result preview uses Tailwind's `font-mono` (system mono) for the code, while the app uses JetBrains Mono.

## Real logo on the login (same day)
- The login drew a generic four-petal icon with "PRMS quality assurance" typed as text. It now shows the real logo, the same one as the sidebar.
- Source: Juanpa's SVG exports (Figma "Frame 1171276707", plain mark; "Frame 1171276698" has the mark in a rounded square). The text is vector; the mark was a 3091 × 4096 PNG used as a mask (1.8 MB). It was shrunk to 232 × 307, so each file is 65 KB and looks the same at 56 px tall.
- `public/logo-prms-qa.svg` (purple `#45348C`) on the light panel (desktop), `public/logo-prms-qa-white.svg` (white) on the dark form panel (phones and tablets). `login.ts` imports `NgOptimizedImage`.
- The rounded-square version is not used yet; it could serve as the favicon or the collapsed sidebar icon.
- Tested: `ng build` passes, `login.spec.ts` 18 of 18; seen at 1440 px (purple, light panel) and 390 px (white, dark panel).
- Not changed: the sidebar keeps `logo-prms-qa.png` (same logo).
