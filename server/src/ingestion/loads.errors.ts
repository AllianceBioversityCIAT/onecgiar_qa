// @akili-spec ingestion/step-1-loads
import { ConflictException, NotFoundException } from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';

// Typed refusals of step-1 loads (FR-2, FR-10). Like the admin-config errors
// they extend the Nest HTTP exceptions, so the global filter maps them to the
// error envelope, and every text comes from the catalog. The other refusals of
// the start are reused: `TimelineNotFoundError` (404), `CycleClosedError` (409)
// and `UpstreamUnavailableError` (503 `SERVICE_UNAVAILABLE`).

/** Now (Rome minute) is after step 1's closing minute (FR-2). */
export class LoadWindowClosedError extends ConflictException {
  constructor() {
    super(errorBody('LOADS_WINDOW_CLOSED'));
  }
}

/** Another load of the same cycle is running and its lease is alive (FR-2, FR-9). */
export class LoadAlreadyRunningError extends ConflictException {
  constructor() {
    super(errorBody('LOADS_ALREADY_RUNNING'));
  }
}

/** The load does not exist, or belongs to another timeline (FR-10). */
export class LoadNotFoundError extends NotFoundException {
  constructor(readonly loadId: number) {
    super(errorBody('LOADS_NOT_FOUND'));
  }
}

/**
 * Reporting answered 404 to a feed call: it has no QA catalog for the cycle's
 * year (e.g. a test cycle with year 2084). A data situation, not a defect:
 * 409 instead of the 500 any other 4xx gives. The year is for logs only.
 */
export class LoadCatalogMissingError extends ConflictException {
  constructor(readonly year: number) {
    super(errorBody('LOADS_CATALOG_MISSING'));
  }
}
