import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Typed digits → `HH:mm` as people type: `9` → `09:`, `13` → `13:`, `1330` → `13:30`. Deleting never re-adds
 * the colon, so backspace works. Pure, so the field rules stay in one place.
 */
export function maskTime(raw: string, deleting = false): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length && Number(digits[0]) > 2) digits = '0' + digits;
  digits = digits.slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return digits.length === 2 && !deleting ? `${digits}:` : digits;
}

/**
 * `<input qaTimeMask>`: the colon of a 24-hour time appears on its own while typing (no native time picker,
 * so no AM/PM). Runs in the capture phase, so the form binding already reads the masked value.
 */
@Directive({ selector: 'input[qaTimeMask]', host: { maxlength: '5', autocomplete: 'off' } })
export class QaTimeMask {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    el.addEventListener(
      'input',
      (event) => {
        const deleting = ((event as InputEvent).inputType ?? '').startsWith('delete');
        const masked = maskTime(el.value, deleting);
        if (masked !== el.value) el.value = masked;
      },
      { capture: true },
    );
  }
}
