# Design

## Context

Fresh Angular 22.2 workspace (standalone, signals, SSR with `**` prerendered, Tailwind 4, Vitest). No routes, no services. The authentication provider is undecided (see proposal.md), so the provider must be swappable without touching the screen or the guards.

## Goals / Non-Goals

**Goals:**
- One login screen, one session service, one guard pair, one placeholder home.
- Provider behind an injection token so the real one replaces the stub with a single provider change.
- AXE / WCAG AA: labelled inputs, visible focus, errors linked with `aria-describedby`, live region for failures, contrast ≥ 4.5:1.

**Non-Goals:**
- Real authentication, tokens, refresh, roles, HTTP interceptors.
- The app shell (sidebar, top bar) and any QA page.
- "Forgot password" / sign-up (depend on the provider).

## Decisions

- **`AuthProvider` abstract class as DI token + `StubAuthProvider` default.** Alternative: `if (stub)` inside the service → rejected, it leaks provider logic into the session layer. The stub validates shape only, waits ~400 ms to make the busy state visible, and rejects the reserved email `fail@stub.local` so the error path can be exercised by hand and in tests.
- **`AuthSession` service (`@Service`) holds the user in a signal**, persisted to `sessionStorage` (per tab, cleared when the tab closes). `localStorage` rejected: a stub session should not outlive the tab. Storage access is guarded for SSR and wrapped in try/catch.
- **Double submit lock in the service**, not only the button: an in-flight promise is reused, so a second call returns the same attempt.
- **Signal Forms** (`form`, `required`, `email`, `[formField]`), as the repo guidelines ask for new forms.
- **Functional guards** `authGuard` / `guestGuard` returning `UrlTree`s; the login keeps `returnUrl` as a query param, accepted only when it is an internal path (starts with `/`, not `//`) to avoid open redirects.
- **SSR render modes**: `login` prerendered; protected routes `RenderMode.Client`, because the session lives in browser storage and the server cannot know it (rendering them on the server would flash the login redirect).
- **Look**: tokens taken from the mockup (dark green `#0b3b36`-ish surface, teal primary, purple PRMS mark) as `@theme` variables in `styles.css`; split layout (brand panel + form card), single column on mobile.

## Risks / Trade-offs

- [The stub accepts anything] → visible "development stub" notice on the screen, provider isolated behind one token, follow-up change required before any real deployment.
- [Real provider may be redirect-based (Cognito Hosted UI / Entra), making the email+password form unnecessary] → form lives in one component; the session/guard layer does not depend on it.
