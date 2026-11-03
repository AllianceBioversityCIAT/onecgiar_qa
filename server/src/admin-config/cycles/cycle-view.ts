import type { CycleStatus } from '../../database/drizzle/schema/cycles.js';
import type { CycleSummaryRow } from './cycles.store.js';

/** A cycle as the API shows it (design 6, FR-2). Dates are `YYYY-MM-DD` Rome dates; instants leave as ISO UTC. */
export interface CycleView {
  id: number;
  year: number;
  /** "2026 cycle" (FR-1). */
  name: string;
  status: CycleStatus;
  timelineCount: number;
  /** Earliest opening over the steps of its timelines, or null when it has none. */
  startsOn: string | null;
  /** Latest closing over the steps of its timelines, or null when it has none. */
  endsOn: string | null;
  createdAt: Date;
}

/** The display name of a cycle (FR-1: year 2027 → "2027 cycle"). */
export const cycleName = (year: number): string => `${year} cycle`;

export function toCycleView(row: CycleSummaryRow): CycleView {
  return {
    id: row.id,
    year: row.year,
    name: cycleName(row.year),
    status: row.status,
    timelineCount: row.timelineCount,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    createdAt: row.createdAt,
  };
}
