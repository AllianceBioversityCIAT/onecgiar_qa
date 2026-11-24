
## 2026-10-21 · `perl -0pi -e 's|…|…|'` replacements that break TypeScript files
- **What happened (3 times in one session):** `results-view.ts` (twice) and `fields-view.ts` ended up with joined lines or with text at the start of the file, and the build failed with `Unexpected "|"`.
- **Root cause:** `|` was used as the delimiter of `s|…|…|`, and TypeScript code contains `|` (union types `'a' | 'b'`, `||`). In the pattern, a badly escaped `\|` became an empty alternative that matches anywhere (for example, at the start of the file). In the replacement, an unescaped `|` closed the expression too early.
- **How to avoid it:** for multi-line changes or changes with `|`, use the Edit tool (exact string). If sed or perl is needed, use a delimiter that does not appear in the code (`#` or `~`). After a bulk replacement, check `git diff` before building.

## 2026-10-26 · Assessors signs the design user out and the login sends it back there
- **What happened (4 times: 20, 21, 23 and 26 Oct):** with the emergency design user, opening `/assessors` ends the session. After signing in again, the app goes back to `/assessors` and the loop repeats.
- **Root cause:** Assessors calls the real API (`/users`), which answers 401 to that user. The `core/auth` interceptor treats the 401 as an expired session: it stores the route in `sessionStorage['qa.pendingRedirect']` (`core/auth/deep-link.ts`) and sends the user to the login. After the login, the app returns to that route and the 401 repeats.
- **Design workaround (temporary):** while on `/login`, delete `qa.pendingRedirect` in the browser and sign in again.
- **Real fix (Yeck, since `core/` is his):** a 401 from a screen with real data shows a notice instead of ending the session, or the emergency user does not store `pendingRedirect` for routes that use the real API.
