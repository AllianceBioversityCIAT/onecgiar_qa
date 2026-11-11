import { LOAD_ERROR, LoadFailureReason } from '../../../core/api/loads.models';
import { ApiError, CLIENT_ERROR } from '../../../core/http/api-envelope';

/** Why results were skipped, in plain words. Reporting's list grows: an unknown reason shows as given. */
const SKIP_LABELS: Record<string, string> = {
  ACTIVE_IN_OTHER_TIMELINE: 'Already in another timeline',
  ALREADY_IN_THIS_TIMELINE: 'Already in this timeline',
  RETURNED_NOT_RESUBMITTED: 'Returned in round 1, not submitted again yet',
  DUPLICATE_RESULT_CODE: 'Listed twice by the Reporting Tool',
  not_found: 'Not found in the Reporting Tool',
  not_submitted: 'No longer submitted',
  other_phase: 'From another phase',
  not_w1w2: 'Not pooled funding (W1/W2)',
  type_not_catalogued: 'Result type not set up for QA',
  no_lead_program: 'No lead science program',
};

export function skipLabel(reason: string): string {
  return SKIP_LABELS[reason] ?? reason;
}

const FAILURE_LABELS: Record<LoadFailureReason, string> = {
  REPORTING_UNAUTHORIZED: 'The Reporting Tool refused our access.',
  REPORTING_REJECTED: 'The Reporting Tool refused the request.',
  REPORTING_UNAVAILABLE: 'The Reporting Tool stopped answering.',
  CATALOG_VERSION_MISMATCH: 'The Reporting Tool fields changed while loading.',
  STORE_UNAVAILABLE: 'QA could not save the results.',
  ABANDONED: 'The load stopped responding.',
  INTERNAL: 'Something went wrong on our side.',
};

/** One message per failure reason; the admin can only start a new load or ask support. */
export function failureLabel(reason: string | null): string {
  const text = (reason && FAILURE_LABELS[reason as LoadFailureReason]) || FAILURE_LABELS.INTERNAL;
  return `${text} What was loaded before stays in QA. You can start a new load, or contact support if it happens again.`;
}

/** The Reporting Tool has no QA catalog for the cycle's year: nothing to load, and retrying does not help. */
export const CATALOG_MISSING_MESSAGE =
  "The Reporting Tool has no QA fields set up for this cycle's year, so there are no results to load. Ask the technical team to set them up.";

/** The timeline's last step has closed (or the cycle): the server refuses any new sync. */
export const WINDOW_CLOSED_MESSAGE = 'The last step of this timeline has closed, so no new load can start.';

/** Why a load could not start, from the server code (never its raw text, except as a last resort). */
export function startErrorMessage(error: ApiError): string {
  switch (error.code) {
    case LOAD_ERROR.CATALOG_MISSING:
      return CATALOG_MISSING_MESSAGE;
    case LOAD_ERROR.CYCLES_CLOSED:
      return 'This cycle is closed, so no results can be loaded.';
    case LOAD_ERROR.WINDOW_CLOSED:
      return WINDOW_CLOSED_MESSAGE;
    case LOAD_ERROR.ALREADY_RUNNING:
      return 'Another load in this cycle is still running. Wait for it to finish, then try again.';
    case LOAD_ERROR.SERVICE_UNAVAILABLE:
      return 'The Reporting Tool is not answering. Nothing was loaded: try again in a few minutes.';
    case LOAD_ERROR.TIMELINES_NOT_FOUND:
      return 'This timeline no longer exists. Reload the page.';
    case CLIENT_ERROR.NETWORK:
      return 'We could not reach the QA service. Check your connection and try again.';
    default:
      return error.message;
  }
}
