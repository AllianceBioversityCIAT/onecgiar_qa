# Tasks

## 1. Remove Angular default content

- [ ] 1.1 Replace `app.html` welcome markup with a bare `<router-outlet />`, drop demo `title` signal and `app.css`; update `app.spec.ts` to assert the outlet renders (verify: `ng test` green)
- [ ] 1.2 Set `<title>` to "PRMS Quality Assurance" and add design tokens (`@theme`) in `styles.css` (verify: `ng build` green)

## 2. Session layer

- [ ] 2.1 Add `AuthProvider` contract + `StubAuthProvider` (stub marker, reserved failing email) with unit tests for success, rejection and malformed input
- [ ] 2.2 Add `AuthSession` service (user signal, sessionStorage persistence SSR-safe, single in-flight attempt, sign-out) with unit tests incl. two parallel sign-ins ⇒ one provider call
- [ ] 2.3 Add `authGuard` / `guestGuard` with safe `returnUrl` handling and unit tests (redirect, return path, open-redirect rejected)

## 3. Screens and routing

- [ ] 3.1 Add login page (Signal Forms, validation messages, busy state, error live region, stub notice, brand panel) with component tests for empty submit, invalid email, double submit, failure message
- [ ] 3.2 Add placeholder home page with user email and sign-out; wire lazy routes (`login` guest, `''` auth, `**` → `''`) and server render modes (verify: `ng build` green, manual run on port 4301: unauth → login, sign-in → home, reload keeps session, sign-out → login)
