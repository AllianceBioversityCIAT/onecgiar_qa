import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { QaLoadingImports, skeletonRows } from '../../../ui';
import { AiChip } from '../review/ai/ai-chip';
import { AiSuggestionsStore } from '../review/ai/ai-suggestions-store';

/** Names of the AI-input fields of `production.json` (v2-1.0.0). An unknown key shows as is. */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  'general.gender_tag': 'Gender equality, youth and social inclusion tag',
  'general.climate_tag': 'Climate adaptation and mitigation tag',
  'general.nutrition_tag': 'Nutrition, health and food security tag',
  'general.environment_tag': 'Environmental health and biodiversity tag',
  'general.poverty_tag': 'Poverty reduction, livelihoods and jobs tag',
  'innovation_dev.readiness_level': 'Innovation Readiness Level',
  'innovation_use.use_level.innovation_use_level': 'Innovation Use Level',
  'general.result_type': 'Result category',
  'innovation_use.current_use.actors': 'Innovation use numbers',
};

/**
 * Plan B of P2-3918 (dev/test only, `aiPreview`): the AI suggestions of one result from the real API,
 * read only, for the 23-nov session if the Review page is not on the API yet. No validation, no comments,
 * no usage events (it is not the reviewer's page). Deleted when the chip is wired into Review (Plan A).
 */
@Component({
  selector: 'qa-ai-preview',
  imports: [AiChip, QaLoadingImports],
  providers: [AiSuggestionsStore],
  host: { class: 'flex flex-col gap-5 px-4 py-6 md:px-8' },
  template: `
    <header class="flex flex-col gap-1">
      <h1 class="m-0 text-(length:--fs-20) font-bold text-(--text)">
        AI suggestions · result {{ resultCode() }}
      </h1>
      <p class="m-0 text-(length:--fs-13) text-(--text-3)">
        Preview for testing (dev and test only). The decision on every field stays with the
        reviewer.
      </p>
    </header>
    @switch (store.state()) {
      @case ('ready') {
        @if (chips().length === 0) {
          <p class="m-0 text-(length:--fs-14) text-(--text-3)">
            This result has no AI-input fields.
          </p>
        }
        <ul class="m-0 flex max-w-[760px] list-none flex-col gap-4 p-0">
          @for (chip of chips(); track chip.fieldKey) {
            <li class="flex flex-col gap-2" [qaReveal]="$index">
              <h2 class="m-0 text-(length:--fs-14) font-semibold text-(--text-2)">
                {{ nameOf(chip.fieldKey) }}
              </h2>
              <qa-ai-chip [vm]="chip" [readOnly]="true" />
            </li>
          }
        </ul>
      }
      @case ('failed') {
        <p class="m-0 text-(length:--fs-14) text-(--text-3)" role="status">
          Suggestion not available: the AI suggestions could not be loaded.
        </p>
      }
      @default {
        <qa-loading label="Loading the AI suggestions">
          <div class="flex max-w-[760px] flex-col gap-4">
            @for (i of rows; track i) {
              <qa-skeleton class="h-24 w-full rounded-lg" />
            }
          </div>
        </qa-loading>
      }
    }
  `,
})
export class AiPreviewPage {
  protected readonly store = inject(AiSuggestionsStore);
  protected readonly rows = skeletonRows(3);
  protected readonly resultCode = signal<number | null>(null);
  protected readonly chips = computed(() => [...this.store.byField().values()]);

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((p) => {
        const timelineId = Number(p.get('timelineId'));
        const resultCode = Number(p.get('resultCode'));
        if (!Number.isInteger(timelineId) || !Number.isInteger(resultCode)) return;
        this.resultCode.set(resultCode);
        void this.store.load(timelineId, resultCode);
      });
  }

  protected nameOf(fieldKey: string): string {
    return FIELD_NAMES[fieldKey] ?? fieldKey;
  }
}
