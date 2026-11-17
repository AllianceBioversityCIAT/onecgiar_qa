/**
 * Plan B of P2-3918 (spec assessment/ai-suggestions): the AI preview page for the 23-nov session.
 * This file is the PRODUCTION value and the default: off, typed as the literal `false`, so turning it on
 * here is a compile error and the production build fails. `angular.json` swaps in `ai-preview.flag.on.ts`
 * for the `development` and `test` configurations only. It is a build flag and not an environment field
 * because CI and the deploy overwrite the environment files from Secrets Manager.
 * Delete both files, the page and the route once the chip is on the Review page (plan A).
 */
export const AI_PREVIEW: false = false;
