import { Component, computed, input, model } from '@angular/core';

/** One field the export can carry. */
export interface ExportFieldOption {
  readonly id: string;
  readonly label: string;
}

/** The fields of one review section, in the order of the review page. */
export interface ExportFieldGroup {
  readonly id: string;
  readonly name: string;
  readonly fields: readonly ExportFieldOption[];
}

/**
 * "Fields to include" of the export (P2-3914, criterion 3): every assessed field grouped by its review section, with a
 * checkbox each, like the Excel export of the Reporting Tool's Result Center (Juanpa, 2026-11-23). All start checked;
 * a section's own checkbox checks or clears the whole section and shows "mixed" when only some of it is checked.
 */
@Component({
  selector: 'qa-export-field-picker',
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="export-fields-title" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="export-fields-title" class="m-0 text-(length:--fs-13) font-semibold text-(--text-2)">Fields to include</h3>
        <span class="text-(length:--fs-13) text-(--text-3)" aria-live="polite"><span class="font-(family-name:--qa-mono) font-semibold tabular-nums">{{ value().length }}</span> of <span class="font-(family-name:--qa-mono) font-semibold tabular-nums">{{ total() }}</span> selected</span>
        <button
          type="button"
          (click)="allOn() ? clearAll() : selectAll()"
          class="ml-auto cursor-pointer rounded border-0 bg-transparent px-1 text-(length:--fs-13) font-semibold text-(--accent) outline-none hover:underline focus-visible:shadow-(--focus-ring)"
        >
          {{ allOn() ? 'Clear all' : 'Select all' }}
        </button>
      </div>

      <div class="flex flex-col rounded-[10px] border border-(--border)">
        @for (group of groups(); track group.id) {
          @let state = groupState(group);
          <div class="flex flex-col gap-1 border-b border-(--border) px-3 py-2.5 last:border-b-0">
            <button
              type="button"
              role="checkbox"
              [attr.aria-checked]="state"
              (click)="toggleGroup(group)"
              class="flex min-h-[34px] cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) max-sm:min-h-10"
            >
              <span aria-hidden="true" class="box-border flex size-4 flex-none items-center justify-center rounded border-[1.5px]" [class]="state === false ? 'border-(--border-strong)' : 'border-(--primary) bg-(--primary)'">
                @if (state === true) {
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                } @else if (state === 'mixed') {
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"><path d="M5 12h14" /></svg>
                }
              </span>
              <span class="min-w-0 flex-1 text-(length:--fs-14) font-semibold text-(--text)">{{ group.name }}</span>
              <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-muted) tabular-nums">{{ countIn(group) }}/{{ group.fields.length }}</span>
            </button>
            <div role="group" [attr.aria-label]="group.name" class="grid grid-cols-2 gap-x-2 gap-y-px pl-6 @max-[30rem]:grid-cols-1">
              @for (field of group.fields; track field.id) {
                @let on = isOn(field.id);
                <button
                  type="button"
                  role="checkbox"
                  [attr.aria-checked]="on"
                  (click)="toggle(field.id)"
                  class="flex min-h-[32px] min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-(length:--fs-13) text-(--text-2) outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) max-sm:min-h-10"
                >
                  <span aria-hidden="true" class="box-border flex size-4 flex-none items-center justify-center rounded border-[1.5px]" [class]="on ? 'border-(--primary) bg-(--primary)' : 'border-(--border-strong)'">
                    @if (on) {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    }
                  </span>
                  <span class="min-w-0 flex-1 leading-[1.35] text-pretty">{{ field.label }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>
    </section>
  `,
})
export class ExportFieldPicker {
  readonly groups = input.required<readonly ExportFieldGroup[]>();
  /** Ids of the checked fields. */
  readonly value = model<readonly string[]>([]);

  private readonly allIds = computed(() => this.groups().flatMap((g) => g.fields.map((f) => f.id)));
  protected readonly total = computed(() => this.allIds().length);
  protected readonly allOn = computed(() => this.value().length === this.total());
  private readonly selected = computed(() => new Set(this.value()));

  protected isOn(id: string): boolean {
    return this.selected().has(id);
  }

  protected countIn(group: ExportFieldGroup): number {
    return group.fields.filter((f) => this.isOn(f.id)).length;
  }

  protected groupState(group: ExportFieldGroup): boolean | 'mixed' {
    const n = this.countIn(group);
    return n === 0 ? false : n === group.fields.length ? true : 'mixed';
  }

  protected toggle(id: string): void {
    this.setIds(this.isOn(id) ? this.value().filter((v) => v !== id) : [...this.value(), id]);
  }

  /** A full section clears; an empty or partly checked one fills up. */
  protected toggleGroup(group: ExportFieldGroup): void {
    const ids = group.fields.map((f) => f.id);
    const next = new Set(this.value());
    const fill = this.groupState(group) !== true;
    for (const id of ids) {
      if (fill) next.add(id);
      else next.delete(id);
    }
    this.setIds([...next]);
  }

  protected selectAll(): void {
    this.value.set(this.allIds());
  }

  protected clearAll(): void {
    this.value.set([]);
  }

  /** Keeps the ids in the order of the review page, so the file's columns follow it too. */
  private setIds(ids: readonly string[]): void {
    const keep = new Set(ids);
    this.value.set(this.allIds().filter((id) => keep.has(id)));
  }
}
