import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { QaSegmented, QaSwitch, QaTooltipImports } from '../../../ui';
import { FieldRowVm } from './fields-config';
import { FIELD_STATES, FieldState, REQUIRED_HIDDEN_HELP } from './fields.mock';

/**
 * One field of the Fields matrix: name, In QA segmented, Core / AI switches and documentation ⓘ.
 * Wide: one grid row matching the column header. Compact (matrix under 900px): two lines.
 */
@Component({
  selector: 'qa-fields-row',
  templateUrl: './fields-row.html',
  imports: [NgTemplateOutlet, QaSegmented, QaSwitch, QaTooltipImports],
  host: { class: 'contents' },
})
export class FieldsRow {
  readonly row = input.required<FieldRowVm>();
  readonly compact = input(false);

  readonly stateChange = output<FieldState>();
  readonly coreChange = output<boolean>();
  readonly aiChange = output<boolean>();
  readonly reset = output<void>();

  protected readonly states = FIELD_STATES;
  protected readonly requiredHiddenHelp = REQUIRED_HIDDEN_HELP;

  protected onState(value: string | null): void {
    const state = FIELD_STATES.find((s) => s.value === value)?.value;
    if (state) this.stateChange.emit(state);
  }
}
