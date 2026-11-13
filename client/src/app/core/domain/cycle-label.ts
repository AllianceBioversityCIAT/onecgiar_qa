/**
 * A cycle's name for a line that already says "Cycle": "2026 cycle" → "2026", so it reads "Cycle 2026"
 * instead of "Cycle 2026 cycle". Names without the word stay as they are; a name that is only "cycle" too.
 */
export function cycleShortName(name: string): string {
  const short = name.replace(/\bcycle\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return short || name.trim();
}
