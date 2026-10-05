# Proposal

## Why

The app still shows the Angular CLI welcome page, so there is no real entry point. Every QA role (QA lead, Assessor, Lead assessor, Third-party broker, PPU) must sign in before seeing any QA data, so a login screen is the first screen the platform needs.

## What Changes

- Remove the Angular CLI default content (welcome markup in `app.html`, demo styles, the "Hello" spec).
- Add a login screen styled after the "QA Platform" mockup (PRMS quality assurance brand, dark green surface, teal primary action). The mockup has no login screen, so the layout is new but reuses its tokens.
- Add a session layer behind a provider-agnostic contract. **The authentication provider is not decided** (PRMS uses CLARISA/Cognito; nothing confirms QA will). This change ships a clearly marked **stub provider** that accepts any well-formed credentials and never calls a network.
- Protect every route except the login screen; unauthenticated visits are sent to login and return to the requested page after sign-in.
- Add a minimal signed-in placeholder page with sign-out, only so the flow has somewhere to land. The real shell (sidebar, Overview…) is out of scope.

## Capabilities

### New Capabilities
- `auth-session`: signing in, staying signed in for the browser session, signing out, and guarding protected pages.

### Modified Capabilities
<!-- none: no specs exist yet -->

## Impact

- Code: `src/app/**` (new `auth/` and `pages/` folders), `src/styles.css` (design tokens), `src/index.html` (title), `app.routes.server.ts` (render mode per route).
- No new dependencies (Signal Forms ship with `@angular/forms` 22).
- No backend, no API, no data. Swapping the stub for the real provider is a follow-up change once the provider is decided.
