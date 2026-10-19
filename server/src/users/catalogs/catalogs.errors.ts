import { ServiceUnavailableException } from '@nestjs/common';
import { errorBody } from '../../common/error-codes.js';

/**
 * A catalog source did not answer in time, answered 5xx or an unreadable body
 * (FR-11, NFR-3): 503 `SERVICE_UNAVAILABLE`. `CatalogService` serves a copy up
 * to 24 h old instead when it has one.
 */
export class UpstreamUnavailableError extends ServiceUnavailableException {
  constructor() {
    super(errorBody('SERVICE_UNAVAILABLE'));
  }
}
