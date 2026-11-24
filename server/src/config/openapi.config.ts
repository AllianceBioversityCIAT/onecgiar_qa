import { registerAs } from '@nestjs/config';

/**
 * Interactive API docs (Swagger UI + OpenAPI JSON). On by default outside
 * production; `OPENAPI_ENABLED=true|false` overrides it either way. PROD keeps
 * them off unless someone opts in deliberately: the document maps the whole
 * attack surface.
 */
export const openApiConfig = registerAs('openapi', () => {
  const flag = process.env.OPENAPI_ENABLED;
  return {
    enabled:
      flag === undefined || flag === ''
        ? process.env.NODE_ENV !== 'production'
        : flag === 'true',
  };
});
