/** Plan B of P2-3918: the `development` and `test` builds swap this in for `ai-preview.flag.ts`. */
// Widened to `boolean` on purpose: the guard must read it as a flag, not as the literal `true`.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const AI_PREVIEW: boolean = true;
