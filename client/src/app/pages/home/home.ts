import { Component } from '@angular/core';
import { QaShell } from '../../shell/qa-shell';
import { OverviewView } from '../workspace/overview/overview-view';

/** QA workspace home: the mockup's app frame showing the Overview view. */
@Component({
  selector: 'app-home',
  imports: [QaShell, OverviewView],
  template: `
    <qa-shell>
      <qa-overview-view />
    </qa-shell>
  `,
  host: { class: 'block' },
})
export class HomePage {}
