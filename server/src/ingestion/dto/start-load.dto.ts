// @akili-spec ingestion/step-1-loads
/**
 * The body of `POST /timelines/:id/loads` is `{}` (design 6): the scope is the
 * timeline's own. A class with no property so the global pipe refuses any key
 * (`forbidNonWhitelisted`) instead of ignoring it.
 */
export class StartLoadDto {}
