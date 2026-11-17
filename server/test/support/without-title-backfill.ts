// @akili-spec assessment/step-1-assessment
import type { TestingModuleBuilder } from '@nestjs/testing';
import {
  TITLE_BACKFILL_STORE,
  type TitleBackfillStore,
} from '../../src/assessment/title-backfill.js';

/** A store with nothing untitled: the backfill reads one empty page and ends. */
export const emptyTitleBackfillStore: TitleBackfillStore = {
  untitledAfter: () => Promise.resolve([]),
  setTitleIfNull: () => Promise.resolve(false),
};

/**
 * The title backfill (T-13) starts on `app.init()` and reads the relational
 * database. The e2e apps have no database (the pool connects lazily and
 * refuses), so every `Test.createTestingModule` that loads `AppModule` or
 * `AssessmentModule` and calls `init()` wraps its builder in this.
 */
export function withoutTitleBackfill(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(TITLE_BACKFILL_STORE)
    .useValue(emptyTitleBackfillStore);
}
