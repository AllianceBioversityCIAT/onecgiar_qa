import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { BrnCalendarImports, injectBrnCalendar } from '@spartan-ng/brain/calendar';
import { provideNativeDateAdapter } from '@spartan-ng/brain/date-time';
import {
  BrnPopover,
  BrnPopoverImports,
  provideBrnPopoverConfig,
  provideBrnPopoverDefaultOptions,
} from '@spartan-ng/brain/popover';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_RE = /(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?/;

function toDate(m: RegExpExecArray | null, year?: number): Date | null {
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  const y = m[3] ? +m[3] : year;
  return mi < 0 || !y ? null : new Date(y, mi, +m[1]);
}

/** "06 Jul 2026" → Date. */
function parseDay(text: string): Date | null {
  return toDate(new RegExp(`^\\s*${DATE_RE.source}\\s*$`).exec(text));
}

/** "20 Jul – 24 Jul 2026" (start year optional) → [start, end]. */
function parseRange(text: string): [Date, Date] | null {
  const [a, b] = text.split(/\s*[–-]\s*/);
  const end = toDate(DATE_RE.exec(b ?? ''));
  const start = end ? toDate(DATE_RE.exec(a ?? ''), end.getFullYear()) : null;
  return start && end ? [start, end] : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const formatDay = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const formatRange = (s: Date, e: Date) =>
  s.getFullYear() === e.getFullYear() ? `${pad(s.getDate())} ${MONTHS[s.getMonth()]} – ${formatDay(e)}` : `${formatDay(s)} – ${formatDay(e)}`;

/** Month header + day grid. Lives inside [brnCalendar] / [brnCalendarRange] so it can inject either one. */
@Component({
  selector: 'qa-calendar-grid',
  imports: [BrnCalendarImports],
  host: { class: 'block' },
  template: `
    <div class="relative flex h-8 items-center justify-center">
      <div brnCalendarHeader class="text-(length:--fs-14) font-semibold text-(--text)">{{ heading() }}</div>
      <button brnCalendarPreviousButton class="absolute left-0 flex size-8 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <button brnCalendarNextButton class="absolute right-0 flex size-8 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
      </button>
    </div>
    <table brnCalendarGrid class="mt-2 w-full border-collapse">
      <thead>
        <tr class="flex">
          <th *brnCalendarWeekday="let weekday" scope="col" [attr.aria-label]="weekdaysLong[weekday]" class="flex h-8 flex-1 items-center justify-center text-(length:--fs-11) font-semibold text-(--text-muted)">{{ weekdays[weekday] }}</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        <tr *brnCalendarWeek="let week" class="mt-1 flex w-full">
          @for (date of week; track date.getTime()) {
            <td brnCalendarCell class="relative flex-1 p-0 text-center">
              <button
                brnCalendarCellButton
                [date]="date"
                class="mx-auto flex size-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text-2) tabular-nums outline-none hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) data-[outside]:text-(--text-muted) data-[today]:font-bold data-[today]:text-(--accent) data-[today]:ring-1 data-[today]:ring-(--tint-border-2) data-[range-middle]:rounded-none data-[range-middle]:bg-(--tint-2) data-[range-middle]:text-(--accent) aria-selected:bg-(--primary) aria-selected:font-semibold aria-selected:text-(--surface) aria-selected:hover:bg-(--accent) data-[disabled]:cursor-default data-[disabled]:opacity-40"
              >{{ date.getDate() }}</button>
            </td>
          }
        </tr>
      </tbody>
    </table>
  `,
})
class QaCalendarGrid {
  private readonly calendar = injectBrnCalendar<Date>();
  protected readonly weekdays = WEEKDAYS;
  protected readonly weekdaysLong = WEEKDAYS_LONG;
  protected readonly heading = computed(() => {
    const d = this.calendar.focusedDate();
    return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  });
}

/**
 * Calendar button for a text date field ("06 Jul 2026", or "20 Jul – 24 Jul 2026" in range mode).
 * Place it inside the field; it reads the current text and emits the picked date in the same format.
 */
@Component({
  selector: 'qa-date-picker',
  imports: [BrnPopoverImports, BrnCalendarImports, QaCalendarGrid],
  providers: [
    provideNativeDateAdapter(),
    provideBrnPopoverConfig({ align: 'end', sideOffset: 6 }),
    provideBrnPopoverDefaultOptions({ role: 'dialog' }),
  ],
  host: { class: 'flex flex-none' },
  template: `
    <div brnPopover #pop="brnPopover" class="flex">
      <button
        brnPopoverTrigger
        type="button"
        [disabled]="disabled()"
        [attr.aria-label]="label()"
        class="flex size-7 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-(--text-3) outline-none hover:bg-(--surface-3) hover:text-(--accent) focus-visible:shadow-(--focus-ring) disabled:cursor-default disabled:opacity-50 aria-expanded:bg-(--tint) aria-expanded:text-(--accent)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
      </button>
      <ng-template brnPopoverContent>
        <div [attr.aria-label]="label()" class="qa-tokens box-border flex w-[280px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-xl border border-(--border-raised) bg-(--surface-raised) p-3 shadow-(--shadow-pop) animate-in fade-in-0 zoom-in-95 duration-100">
          @if (mode() === 'range') {
            <p class="m-0 text-(length:--fs-12) text-(--text-4)">{{ rangeStart() ? 'Now pick the last day.' : 'Pick the first day, then the last.' }}</p>
            <div brnCalendarRange [startDate]="rangeStart()" (startDateChange)="onRangeStart($event)" [endDate]="rangeEnd()" (endDateChange)="onRangeEnd($event, pop)" [defaultFocusedDate]="focusStart()" [weekStartsOn]="1">
              <qa-calendar-grid />
            </div>
          } @else {
            <div brnCalendar [date]="selected() ?? undefined" (dateChange)="pickDay($event, pop)" [defaultFocusedDate]="focusStart()" [weekStartsOn]="1">
              <qa-calendar-grid />
            </div>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class QaDatePicker {
  /** Current text of the field. */
  readonly value = input('');
  readonly mode = input<'single' | 'range'>('single');
  /** Accessible name of the button and the calendar, e.g. "Pick the opening date". */
  readonly label = input('Pick a date');
  readonly disabled = input(false);
  readonly valueChange = output<string>();

  protected readonly selected = computed(() => parseDay(this.value()));
  private readonly range = computed(() => parseRange(this.value()));
  protected readonly rangeStart = linkedSignal<Date | undefined>(() => this.range()?.[0]);
  protected readonly rangeEnd = linkedSignal<Date | undefined>(() => this.range()?.[1]);

  /** Month the calendar opens on: the current value, or today. */
  protected readonly focusStart = computed(() => (this.mode() === 'range' ? this.range()?.[0] : this.selected()) ?? new Date());

  protected pickDay(d: Date | undefined, pop: BrnPopover): void {
    if (!d) return;
    this.valueChange.emit(formatDay(d));
    pop.close();
  }

  protected onRangeStart(d: Date | undefined): void {
    this.rangeStart.set(d);
    this.rangeEnd.set(undefined);
  }

  protected onRangeEnd(d: Date | undefined, pop: BrnPopover): void {
    this.rangeEnd.set(d);
    const s = this.rangeStart();
    if (!s || !d) return;
    this.valueChange.emit(formatRange(s, d));
    pop.close();
  }
}
