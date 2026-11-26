/**
 * A cycle's name for a line that already says "Cycle": "2026 cycle" → "2026", so it reads "Cycle 2026"
 * instead of "Cycle 2026 cycle". Only a leading or trailing word goes; a name that is only "cycle" stays.
 */
export function cycleShortName(name: string): string {
  // Only a leading or trailing "cycle": "Q1 cycle review" keeps its words.
  const short = name.trim().replace(/^cycle\s+|\s+cycle$/i, '').trim();
  return short || name.trim();
}
