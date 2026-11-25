import { Service, computed, signal } from '@angular/core';
import { SpMe } from '../../core/api/sp.models';

/**
 * What the SP pages share while the iframe lives (memory only): who is in, the chosen program, the
 * chosen timeline and the list filters, so going back from a result keeps them.
 */
@Service()
export class SpContext {
  readonly me = signal<SpMe | null>(null);
  /** The program picked by a Reporting admin; a non-admin always uses its own. */
  readonly chosenProgramId = signal<number | null>(null);
  readonly timelineId = signal<number | null>(null);
  readonly statuses = signal<readonly string[]>([]);
  readonly resultTypes = signal<readonly string[]>([]);

  readonly isAdmin = computed(() => this.me()?.isReportingAdmin ?? false);

  /** The program the pages read: the admin's pick, else the session's own. Null until known. */
  readonly programId = computed<number | null>(() => {
    const me = this.me();
    if (!me) return null;
    if (me.isReportingAdmin) return this.chosenProgramId();
    return me.program?.id ?? me.programs[0]?.id ?? null;
  });

  readonly program = computed(() => {
    const id = this.programId();
    return this.me()?.programs.find((p) => p.id === id) ?? this.me()?.program ?? null;
  });

  /** `programId` to send: always for an admin (required there), never needed for a non-admin. */
  readonly programParam = computed<number | null>(() => (this.isAdmin() ? this.programId() : null));

  /** First time `me` lands: an admin opens on the program Reporting named, if any. */
  setMe(me: SpMe): void {
    this.me.set(me);
    if (me.isReportingAdmin && this.chosenProgramId() === null && me.program) {
      this.chosenProgramId.set(me.program.id);
    }
  }

  /** Another program: its timelines and filters start over. */
  chooseProgram(id: number | null): void {
    if (id === this.chosenProgramId()) return;
    this.chosenProgramId.set(id);
    this.timelineId.set(null);
    this.statuses.set([]);
    this.resultTypes.set([]);
  }
}
