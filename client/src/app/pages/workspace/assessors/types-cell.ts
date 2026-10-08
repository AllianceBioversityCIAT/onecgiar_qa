import { Component, computed, input, output, signal } from '@angular/core';
import { HlmInput } from '@spartan/input';
import { BrnPopoverImports, provideBrnPopoverConfig, provideBrnPopoverDefaultOptions } from '@spartan-ng/brain/popover';
import { TYPE_COUNTS, TYPE_NAMES, TeamMember, fmt } from './assessors.mock';

/**
 * Result-types cell of the team table (Assessor role only): chips, and a popover with a searchable
 * checkbox list. Removing a type that still has unreviewed results asks for confirmation first.
 */
@Component({
  selector: 'qa-assessor-types-cell',
  imports: [BrnPopoverImports, HlmInput],
  providers: [
    provideBrnPopoverConfig({ align: 'start', sideOffset: 4 }),
    provideBrnPopoverDefaultOptions({ role: null }),
  ],
  host: { class: 'block' },
  template: `
    <div brnPopover (closed)="reset()" class="flex">
      <button
        brnPopoverTrigger
        type="button"
        [attr.aria-label]="'Change result types of ' + member().nick + ': ' + (member().types.join(', ') || 'none')"
        class="box-border flex min-h-8 w-full min-w-0 cursor-pointer flex-wrap @max-[640px]:min-h-10 items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-2 py-1 text-left hover:border-(--border) hover:bg-(--surface) focus-visible:shadow-(--focus-ring) focus-visible:outline-none aria-expanded:border-(--border-accent) aria-expanded:bg-(--surface)"
      >
        @for (t of chips(); track t) {
          <span [title]="t" class="max-w-full truncate rounded-full bg-(--surface-3) px-2 py-0.5 text-(length:--fs-11) font-medium text-(--text-3)">{{ t }}</span>
        }
        @if (more()) {
          <span class="flex-none rounded-full bg-(--surface-3) px-2 py-0.5 text-(length:--fs-11) font-medium whitespace-nowrap text-(--text-3)">+{{ more() }}</span>
        }
        @if (!member().types.length) {
          <span class="text-(length:--fs-13) font-normal text-(--text-muted)">Add result types</span>
        }
      </button>
      <ng-template brnPopoverContent>
        <div
          role="dialog"
          [attr.aria-label]="'Result types of ' + member().nick"
          class="qa-tokens box-border flex max-h-[min(340px,70vh)] w-[300px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-(--border-raised) bg-(--surface-raised) p-3 shadow-(--shadow-pop) animate-in fade-in-0 zoom-in-95 duration-100"
        >
          <input
            hlmInput
            type="text"
            placeholder="Search result types"
            aria-label="Search result types"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            class="h-8 w-full flex-none rounded-md pointer-coarse:h-10 border-(--border) bg-(--field-bg) px-2.5 py-0 text-(length:--fs-13) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13) dark:bg-(--field-bg)"
          />
          <div role="group" aria-label="Result types" class="mt-2 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
            @for (o of options(); track o.label) {
              <button
                type="button"
                role="checkbox"
                [attr.aria-checked]="o.on"
                (click)="toggle(o.label, o.on)"
                class="flex min-h-[34px] flex-none pointer-coarse:min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)"
              >
                <span
                  aria-hidden="true"
                  class="box-border flex size-4 flex-none items-center justify-center rounded border-[1.5px]"
                  [class]="o.on ? 'border-(--primary) bg-(--primary)' : 'border-(--border-strong) bg-transparent'"
                >
                  @if (o.on) {
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                  }
                </span>
                <span class="min-w-0 flex-1 truncate text-(length:--fs-13) text-(--text-2)">{{ o.label }}</span>
                <span class="flex-none font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-4) tabular-nums">{{ o.count }}</span>
              </button>
            } @empty {
              <div class="p-2 text-(length:--fs-13) text-(--text-3)">Nothing matches that search.</div>
            }
          </div>
          @if (confirmType(); as type) {
            <div role="alertdialog" aria-label="Remove result type" class="mt-2 flex flex-none items-center gap-2 border-t border-(--surface-4) pt-2.5">
              <span class="min-w-0 flex-1 text-(length:--fs-12) leading-[1.45] font-normal text-(--text-2)"><span class="font-(family-name:--qa-mono) font-semibold tabular-nums">{{ unreviewed(type) }}</span> unreviewed results go back to the pool.</span>
              <div class="flex flex-none items-center gap-2">
                <button type="button" (click)="confirmType.set(null)" class="min-h-7 pointer-coarse:min-h-10 cursor-pointer rounded-md border-0 bg-transparent px-2 text-(length:--fs-12) font-medium text-(--text-3) hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none">Cancel</button>
                <button type="button" (click)="confirmRemove(type)" class="min-h-7 pointer-coarse:min-h-10 cursor-pointer rounded-md border-0 bg-transparent px-2 text-(length:--fs-12) font-semibold text-(--accent) hover:bg-(--tint) focus-visible:shadow-(--focus-ring) focus-visible:outline-none">Remove</button>
              </div>
            </div>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class AssessorTypesCell {
  readonly member = input.required<TeamMember>();
  readonly addType = output<string>();
  readonly removeType = output<string>();

  protected readonly query = signal('');
  protected readonly confirmType = signal<string | null>(null);

  protected readonly chips = computed(() => this.member().types.slice(0, 2));
  protected readonly more = computed(() => Math.max(0, this.member().types.length - 2));
  protected readonly options = computed(() => {
    const q = this.query().trim().toLowerCase();
    const types = this.member().types;
    return TYPE_NAMES.filter((t) => !q || t.toLowerCase().includes(q)).map((t) => ({
      label: t,
      count: fmt(TYPE_COUNTS[t] ?? 0),
      on: types.includes(t),
    }));
  });

  protected unreviewed(type: string): string {
    const p = this.member().prog.find((e) => e.label === type);
    return fmt(p ? p.assigned - p.reviewed : 0);
  }

  protected toggle(type: string, on: boolean): void {
    if (!on) {
      this.confirmType.set(null);
      this.addType.emit(type);
      return;
    }
    const p = this.member().prog.find((e) => e.label === type);
    if (p && p.assigned - p.reviewed > 0) {
      this.confirmType.set(type);
      return;
    }
    this.removeType.emit(type);
  }

  protected confirmRemove(type: string): void {
    this.removeType.emit(type);
    this.confirmType.set(null);
  }

  protected reset(): void {
    this.query.set('');
    this.confirmType.set(null);
  }
}
