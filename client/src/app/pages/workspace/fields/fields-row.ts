import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { QaButtonImports, QaSegmented, QaSwitch, QaTooltipImports } from '../../../ui';
import { FieldRowVm, FieldState } from './fields-config';
import { CONDITIONAL_HELP, FIELD_STATES, REQUIRED_HIDDEN_HELP } from './fields-copy';

/**
 * One field of the Fields matrix: name, In QA segmented, Core / AI switches and documentation ⓘ.
 * Wide: one grid row matching the column header. Compact (matrix under 900px): two lines.
 */
@Component({
  selector: 'qa-fields-row',
  templateUrl: './fields-row.html',
  imports: [NgTemplateOutlet, QaButtonImports, QaSegmented, QaSwitch, QaTooltipImports],
  host: { class: 'contents' },
})
export class FieldsRow {
  readonly row = input.required<FieldRowVm>();
  readonly compact = input(false);
  /** Closed cycle: shows the configuration without letting it change. */
  readonly readOnly = input(false);

  readonly stateChange = output<FieldState>();
  readonly coreChange = output<boolean>();
  readonly aiChange = output<boolean>();

  protected readonly states = FIELD_STATES;
  protected readonly requiredHiddenHelp = REQUIRED_HIDDEN_HELP;
  protected readonly conditionalHelp = CONDITIONAL_HELP;

  protected onState(value: string | null): void {
    const state = FIELD_STATES.find((s) => s.value === value)?.value;
    if (state) this.stateChange.emit(state);
  }
}
